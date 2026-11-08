import type { AcmgClassification, AcmgCode } from '../acmg/types';
import { compareWithReference, LOF_MECHANISM_GENES } from '../evidence/interpret';
import { toClinvarRecord, toEvidence, toResolvedVariant } from '../evidence/myvariant';
import { asArray, isObject, type Json } from '../evidence/normalise';
import type { ReferenceSeverity } from '../evidence/types';
import {
  alphaMissenseCall,
  caddCall,
  consequenceGroup,
  frequencyCall,
  METHODS,
  sigmaFold,
  type ConsequenceGroup,
  type MethodId,
  type MethodInfo,
} from './methods';
import { computeMetrics, rate, type Call, type MethodMetrics, type Rate, type Truth } from './metrics';

export interface LicenceNote {
  readonly name: string;
  readonly licence: string;
  readonly licenceUrl: string;
}

export interface BenchmarkStratum {
  readonly id: string;
  readonly truth: Truth;
  readonly group: Exclude<ConsequenceGroup, 'other'>;
  readonly query: string;
  /** MyVariant hit count for the query at fetch time. */
  readonly total: number;
  readonly pages: readonly { readonly from: number; readonly size: number }[];
  /** Candidates that passed the client-side ClinVar and consequence checks. */
  readonly eligible: number;
  readonly target: number;
  readonly selected: number;
}

export interface BenchmarkVariant {
  readonly id: string;
  readonly stratum: string;
  readonly gene: string;
  readonly truth: Truth;
  readonly clinvar: {
    readonly consensus: AcmgClassification;
    readonly stars: number;
    readonly reviewStatus: string | null;
    readonly url: string | null;
  };
  /** MyVariant.info document as returned for `provenance.fields`, minus `_license`/`_score`/`_version`/`query`. */
  readonly hit: Json;
}

export interface Benchmark {
  readonly schemaVersion: 1;
  readonly title: string;
  readonly dataNote: string;
  readonly provenance: {
    readonly api: string;
    readonly assembly: 'hg38';
    readonly fetchedAt: string;
    readonly seed: number;
    readonly geneCap: number;
    readonly inclusion: string;
    readonly candidateFields: readonly string[];
    readonly documentRequest: string;
    readonly fields: readonly string[];
    readonly strata: readonly BenchmarkStratum[];
    readonly licences: readonly LicenceNote[];
  };
  readonly variants: readonly BenchmarkVariant[];
}

export interface VariantRow {
  readonly id: string;
  readonly gene: string;
  readonly hgvs: string | null;
  readonly consequence: string;
  readonly group: ConsequenceGroup;
  readonly truth: Truth;
  readonly clinvarConsensus: AcmgClassification;
  readonly stars: number;
  readonly clinvarUrl: string | null;
  readonly maxAf: number | null;
  readonly alphaMissense: number | null;
  readonly caddPhred: number | null;
  readonly calls: Readonly<Record<MethodId, Call>>;
  readonly sigmafold: {
    readonly classification: AcmgClassification;
    readonly points: number;
    readonly criteria: readonly AcmgCode[];
    readonly referenceSeverity: ReferenceSeverity;
  };
}

export interface MethodResult extends MethodInfo {
  readonly overall: MethodMetrics;
  readonly missense: MethodMetrics;
  readonly lof: MethodMetrics;
}

const CLASSES: readonly AcmgClassification[] = [
  'Pathogenic',
  'Likely Pathogenic',
  'Uncertain Significance',
  'Likely Benign',
  'Benign',
];

export interface EvalResults {
  readonly schemaVersion: 1;
  readonly dataset: {
    readonly title: string;
    readonly dataNote: string;
    readonly fetchedAt: string;
    readonly seed: number;
    readonly geneCap: number;
    readonly inclusion: string;
    readonly api: string;
    readonly strata: readonly BenchmarkStratum[];
    readonly licences: readonly LicenceNote[];
    readonly n: number;
    readonly genes: number;
    readonly maxPerGene: number;
    readonly byTruth: Readonly<Record<Truth, number>>;
    readonly byGroup: Readonly<Record<ConsequenceGroup, number>>;
    readonly byTruthAndGroup: Readonly<Record<string, number>>;
    readonly byClinvarClass: Readonly<Record<string, number>>;
    readonly byStars: Readonly<Record<string, number>>;
    readonly withAlphaMissense: number;
    readonly withCadd: number;
    readonly inGnomad: number;
  };
  readonly methods: readonly MethodResult[];
  readonly omittedMethods: readonly { readonly id: MethodId; readonly reason: string }[];
  readonly sigmafold: {
    /** Rows: ClinVar class. Columns: SigmaFold class. */
    readonly confusion5: Readonly<Record<string, Readonly<Record<string, number>>>>;
    readonly criteriaFired: Readonly<Record<string, number>>;
    /** ClinVar P/LP null variants whose gene is on the curated PVS1 list. */
    readonly lofPathogenicInCuratedGenes: Rate;
    readonly referenceCheck: {
      readonly majorFlags: number;
      readonly decisiveErrors: number;
      readonly decisiveErrorsFlagged: number;
      readonly pathogenicAbstentions: number;
      readonly pathogenicAbstentionsFlagged: number;
      /** ClinVar B/LB left at VUS: same side of the actionable line, so not escalated. */
      readonly benignAbstentionsUnflagged: number;
    };
  };
  readonly falseReassurance: Readonly<Partial<Record<MethodId, readonly VariantRow[]>>>;
  readonly falseAlarm: Readonly<Partial<Record<MethodId, readonly VariantRow[]>>>;
  readonly variants: readonly VariantRow[];
}

/** Drops ClinVar's significance and review status so the evidence builder provably cannot see the label. */
export function withoutClinvarLabels(hit: Json): Json {
  if (!isObject(hit.clinvar)) return hit;
  const rcv = asArray(hit.clinvar.rcv).map((r) => {
    if (!isObject(r)) return r;
    const { clinical_significance: _s, review_status: _r, ...rest } = r;
    void _s;
    void _r;
    return rest;
  });
  return { ...hit, clinvar: { ...hit.clinvar, rcv } };
}

function tally<T extends string>(items: readonly T[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const k of items) out[k] = (out[k] ?? 0) + 1;
  return out;
}

function countEach<T extends string>(keys: readonly T[], items: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((k) => [k, items.filter((i) => i === k).length])) as Record<T, number>;
}

export function evaluate(b: Benchmark): EvalResults {
  const fetched = { retrievedAt: b.provenance.fetchedAt, cached: true };
  const curated = new Set<string>();
  const rows: VariantRow[] = b.variants.map((v) => {
    const clinvar = toClinvarRecord(v.hit, null, fetched);
    if (clinvar.consensus !== v.clinvar.consensus || clinvar.stars < 2) {
      throw new Error(`${v.id}: stored label ${v.clinvar.consensus} does not match the hit (${String(clinvar.consensus)}, ${String(clinvar.stars)} stars).`);
    }
    const blind = withoutClinvarLabels(v.hit);
    const evidence = toEvidence(blind, toResolvedVariant(blind, v.id, []), fetched);
    const sf = sigmaFold(evidence);
    if (evidence.variant.gene !== null && LOF_MECHANISM_GENES.has(evidence.variant.gene.toUpperCase())) curated.add(v.id);
    return {
      id: v.id,
      gene: v.gene,
      hgvs: evidence.variant.hgvsProtein ?? evidence.variant.hgvsCoding,
      consequence: evidence.consequence,
      group: consequenceGroup(evidence.consequence),
      truth: v.truth,
      clinvarConsensus: v.clinvar.consensus,
      stars: v.clinvar.stars,
      clinvarUrl: v.clinvar.url,
      maxAf: evidence.population.maxAf,
      alphaMissense: evidence.predictors.alphaMissense,
      caddPhred: evidence.predictors.caddPhred,
      calls: {
        sigmafold: sf.call,
        alphamissense: alphaMissenseCall(evidence),
        frequency: frequencyCall(evidence),
        cadd: caddCall(evidence),
      },
      sigmafold: {
        classification: sf.interpretation.classification,
        points: sf.interpretation.points,
        criteria: sf.interpretation.engine.criteria.filter((c) => c.met).map((c) => c.code),
        referenceSeverity: compareWithReference(sf.interpretation, clinvar).severity,
      },
    };
  });

  const outcomes = (id: MethodId, subset: readonly VariantRow[]) => subset.map((r) => ({ truth: r.truth, call: r.calls[id] }));
  const missense = rows.filter((r) => r.group === 'missense');
  const lof = rows.filter((r) => r.group === 'lof');
  const hasCadd = rows.some((r) => r.caddPhred !== null);
  const omitted = hasCadd
    ? []
    : [{ id: 'cadd' as const, reason: 'No variant in the benchmark carries a CADD score: MyVariant.info serves CADD for hg19 only, and the evidence layer queries hg38.' }];
  const active = METHODS.filter((m) => !omitted.some((o) => o.id === m.id));
  const methods: MethodResult[] = active.map((m) => ({
    ...m,
    overall: computeMetrics(outcomes(m.id, rows)),
    missense: computeMetrics(outcomes(m.id, missense)),
    lof: computeMetrics(outcomes(m.id, lof)),
  }));

  const confusion5: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    confusion5[r.clinvarConsensus] ??= Object.fromEntries(CLASSES.map((c) => [c, 0]));
    confusion5[r.clinvarConsensus][r.sigmafold.classification] += 1;
  }

  const lofP = rows.filter((r) => r.group === 'lof' && r.truth === 'P/LP');
  const wrong = rows.filter((r) => r.calls.sigmafold !== r.truth && (r.calls.sigmafold === 'P/LP' || r.calls.sigmafold === 'B/LB'));
  const pAbstain = rows.filter((r) => r.truth === 'P/LP' && r.calls.sigmafold === 'VUS');
  const isMajor = (r: VariantRow) => r.sigmafold.referenceSeverity === 'major';

  const listFor = (pred: (r: VariantRow, id: MethodId) => boolean) =>
    Object.fromEntries(active.map((m) => [m.id, rows.filter((r) => pred(r, m.id))])) as Partial<Record<MethodId, VariantRow[]>>;

  const genes = tally(rows.map((r) => r.gene));
  return {
    schemaVersion: 1,
    dataset: {
      title: b.title,
      dataNote: b.dataNote,
      fetchedAt: b.provenance.fetchedAt,
      seed: b.provenance.seed,
      geneCap: b.provenance.geneCap,
      inclusion: b.provenance.inclusion,
      api: b.provenance.api,
      strata: b.provenance.strata,
      licences: b.provenance.licences,
      n: rows.length,
      genes: Object.keys(genes).length,
      maxPerGene: Math.max(0, ...Object.values(genes)),
      byTruth: countEach(['P/LP', 'B/LB'], rows.map((r) => r.truth)),
      byGroup: countEach(['missense', 'lof', 'other'], rows.map((r) => r.group)),
      byTruthAndGroup: tally(rows.map((r) => `${r.truth} ${r.group}`)),
      byClinvarClass: tally(rows.map((r) => r.clinvarConsensus)),
      byStars: tally(rows.map((r) => String(r.stars))),
      withAlphaMissense: rows.filter((r) => r.alphaMissense !== null).length,
      withCadd: rows.filter((r) => r.caddPhred !== null).length,
      inGnomad: rows.filter((r) => r.maxAf !== null).length,
    },
    methods,
    omittedMethods: omitted,
    sigmafold: {
      confusion5,
      criteriaFired: tally(rows.flatMap((r) => r.sigmafold.criteria)),
      lofPathogenicInCuratedGenes: rate(lofP.filter((r) => curated.has(r.id)).length, lofP.length),
      referenceCheck: {
        majorFlags: rows.filter(isMajor).length,
        decisiveErrors: wrong.length,
        decisiveErrorsFlagged: wrong.filter(isMajor).length,
        pathogenicAbstentions: pAbstain.length,
        pathogenicAbstentionsFlagged: pAbstain.filter(isMajor).length,
        benignAbstentionsUnflagged: rows.filter((r) => r.truth === 'B/LB' && r.calls.sigmafold === 'VUS' && !isMajor(r)).length,
      },
    },
    falseReassurance: listFor((r, id) => r.truth === 'P/LP' && r.calls[id] === 'B/LB'),
    falseAlarm: listFor((r, id) => r.truth === 'B/LB' && r.calls[id] === 'P/LP'),
    variants: rows,
  };
}
