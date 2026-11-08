import { canonicalChange, consequenceFromHgvs, mapEffects, parseVariantQuery, aaToOne } from './hgvs';
import { asArray, firstString, isObject, maxNumber, mostCommon, numbers, pick, strings, type Json } from './normalise';
import { ALPHAMISSENSE, CADD, CLINVAR, DBSNP, GNOMAD, MYVARIANT, SNPEFF, type SourceLicence } from './sources';
import type {
  AlphaMissenseClass,
  ClinvarConsensus,
  ClinvarRecord,
  Consequence,
  ProteinChange,
  ResolvedVariant,
  SourceRef,
  VariantEvidence,
} from './types';

export const MYVARIANT_BASE = 'https://myvariant.info/v1';

/** Fixed order: the field list is part of the URL and therefore of the cache key. */
export const MYVARIANT_FIELDS: readonly string[] = [
  'clinvar.rcv.clinical_significance',
  'clinvar.rcv.review_status',
  'clinvar.rcv.preferred_name',
  'clinvar.rsid',
  'clinvar.variant_id',
  'clinvar.gene.symbol',
  'clinvar.hgvs.coding',
  'clinvar.hgvs.protein',
  'dbsnp.rsid',
  'dbsnp.gene.symbol',
  'gnomad_genome.af.af',
  'gnomad_exome.af.af',
  'dbnsfp.alphamissense.score',
  'dbnsfp.genename',
  'dbnsfp.aa.ref',
  'dbnsfp.aa.alt',
  'dbnsfp.aa.pos',
  'dbnsfp.aa.refcodon',
  'dbnsfp.aa.codonpos',
  'cadd.consequence',
  'cadd.phred',
  'cadd.gene.genename',
  'snpeff.ann.effect',
  'snpeff.ann.genename',
  'snpeff.ann.hgvs_c',
  'snpeff.ann.hgvs_p',
];

const QUERY_SIZE = 10;

export function queryUrl(q: string): string {
  const params = new URLSearchParams();
  params.set('assembly', 'hg38');
  params.set('fields', MYVARIANT_FIELDS.join(','));
  params.set('q', q);
  params.set('size', String(QUERY_SIZE));
  return `${MYVARIANT_BASE}/query?${params.toString()}`;
}

export function variantUrl(id: string, fields: readonly string[] = MYVARIANT_FIELDS): string {
  const params = new URLSearchParams();
  params.set('assembly', 'hg38');
  params.set('fields', fields.join(','));
  return `${MYVARIANT_BASE}/variant/${encodeURIComponent(id)}?${params.toString()}`;
}

export const RSID = /^rs\d+$/i;
export const GENOMIC_HGVS = /^chr([0-9]{1,2}|X|Y|M|MT):g\.\S+$/i;

export interface QueryPlanStep {
  readonly q: string;
  /** Free-text hits must name the typed change before they are trusted; fielded queries are exact. */
  readonly verify: boolean;
}

/** Ordered MyVariant queries to try for a non-rsID, non-genomic query. */
export function queryPlan(query: string): QueryPlanStep[] {
  const { gene, coding, protein } = parseVariantQuery(query);
  const steps: QueryPlanStep[] = [{ q: query.trim(), verify: true }];
  if (protein && gene) {
    steps.push({ q: `${gene} ${protein}`, verify: true });
    steps.push({ q: `clinvar.gene.symbol:${gene} AND clinvar.hgvs.protein:*${protein}`, verify: false });
    steps.push({ q: `snpeff.ann.genename:${gene} AND snpeff.ann.hgvs_p:"${protein}"`, verify: false });
  }
  if (coding && gene) {
    // ClinVar's coding field rejects wildcard queries containing '>'.
    if (!coding.includes('>')) {
      steps.push({ q: `clinvar.gene.symbol:${gene} AND clinvar.hgvs.coding:*${coding}`, verify: false });
    }
    steps.push({ q: `snpeff.ann.genename:${gene} AND snpeff.ann.hgvs_c:"${coding}"`, verify: false });
  }
  const seen = new Set<string>();
  return steps.filter((s) => (seen.has(s.q) ? false : (seen.add(s.q), true)));
}

export function rsidQuery(rsid: string): string {
  const rs = rsid.toLowerCase();
  return `dbsnp.rsid:${rs} OR clinvar.rsid:${rs}`;
}

export function hitsOf(body: unknown): Json[] {
  if (!isObject(body)) return [];
  return asArray(body.hits).filter(isObject);
}

function hasClinvar(hit: Json): boolean {
  return pick(hit, 'clinvar.variant_id').length > 0 || pick(hit, 'clinvar.rcv').length > 0;
}

/** True when any HGVS name on the hit matches the typed `c.`/`p.` change. */
export function hitMatchesQuery(hit: Json, query: string): boolean {
  const { coding, protein } = parseVariantQuery(query);
  const wanted = [coding, protein].filter((x): x is string => x !== null).map(canonicalChange);
  if (wanted.length === 0) return true;
  const names = strings([
    ...pick(hit, 'clinvar.hgvs.coding'),
    ...pick(hit, 'clinvar.hgvs.protein'),
    ...pick(hit, 'snpeff.ann.hgvs_c'),
    ...pick(hit, 'snpeff.ann.hgvs_p'),
  ]).map(canonicalChange);
  return wanted.some((w) => names.includes(w));
}

/**
 * Orders candidate alleles: ClinVar-curated first, then the most-submitted
 * ClinVar record, then MyVariant's relevance score. At rs334 three alleles
 * share the position and two have ClinVar records; T>A has 26 submissions
 * against 2, while their `_score`s differ in the third decimal.
 */
export function rankHits(hits: readonly Json[]): Json[] {
  const key = (h: Json) => [
    hasClinvar(h) ? 1 : 0,
    pick(h, 'clinvar.rcv').filter(isObject).length,
    typeof h._score === 'number' ? h._score : 0,
  ];
  return [...hits].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  });
}

function normaliseRsid(raw: string | null): string | null {
  if (raw === null) return null;
  const s = raw.trim().toLowerCase();
  if (/^rs\d+$/.test(s)) return s;
  return /^\d+$/.test(s) ? `rs${s}` : null;
}

function geneOf(hit: Json): string | null {
  return (
    mostCommon(strings(pick(hit, 'dbnsfp.genename'))) ??
    mostCommon(strings(pick(hit, 'snpeff.ann.genename'))) ??
    firstString(hit, 'cadd.gene.genename', 'dbsnp.gene.symbol', 'clinvar.gene.symbol')
  );
}

const PREFERRED_NAME = /^(N[MR]_\d+(?:\.\d+)?)\([^)]*\):(c\.[^\s]+)(?:\s+\((p\.[^)]+)\))?/;

/**
 * Picks the transcript-level names. ClinVar's `preferred_name` names its
 * reference transcript and is used for nomenclature only, never significance.
 * Falls back to a name matching the typed change, then to snpEff.
 */
function namesOf(hit: Json, query: string): { coding: string | null; protein: string | null } {
  const preferred = mostCommon(strings(pick(hit, 'clinvar.rcv.preferred_name')).filter((n) => PREFERRED_NAME.test(n)));
  const clinvarProteins = strings(pick(hit, 'clinvar.hgvs.protein'));
  const clinvarCoding = strings(pick(hit, 'clinvar.hgvs.coding'));
  if (preferred) {
    const m = PREFERRED_NAME.exec(preferred)!;
    const coding = `${m[1]}:${m[2]}`;
    let protein: string | null = null;
    if (m[3]) {
      const p = m[3];
      protein = clinvarProteins.find((x) => x.startsWith('NP_') && x.endsWith(`:${p}`)) ?? p;
    }
    return { coding, protein };
  }

  const { coding: typedC, protein: typedP } = parseVariantQuery(query);
  const matchIn = (pool: string[], typed: string | null, prefix: string) => {
    if (typed) {
      const want = canonicalChange(typed);
      const matches = pool.filter((x) => canonicalChange(x) === want);
      const ref = matches.find((x) => x.startsWith(prefix));
      if (ref ?? matches[0]) return ref ?? matches[0];
    }
    return pool.find((x) => x.startsWith(prefix)) ?? null;
  };
  const anns = asArray(pick(hit, 'snpeff.ann')).filter(isObject);
  const bestAnn =
    anns.find((a) => typeof a.hgvs_p === 'string' && mapEffects(strings(asArray(a.effect))) === 'missense') ??
    anns.find((a) => typeof a.hgvs_p === 'string') ??
    anns[0];
  return {
    coding: matchIn(clinvarCoding, typedC, 'NM_') ?? (bestAnn ? firstString(bestAnn, 'hgvs_c') : null),
    protein: matchIn(clinvarProteins, typedP, 'NP_') ?? (bestAnn ? firstString(bestAnn, 'hgvs_p') : null),
  };
}

export function toResolvedVariant(hit: Json, query: string, alternates: readonly string[]): ResolvedVariant {
  const names = namesOf(hit, query);
  return {
    id: String(hit._id),
    assembly: 'GRCh38',
    rsid: normaliseRsid(firstString(hit, 'clinvar.rsid', 'dbsnp.rsid')),
    gene: geneOf(hit),
    hgvsCoding: names.coding,
    hgvsProtein: names.protein,
    query,
    alternates: [...alternates],
  };
}

function sourceRef(lic: SourceLicence, url: string, retrievedAt: string, cached: boolean): SourceRef {
  return { name: lic.name, url, licence: lic.licence, licenceUrl: lic.licenceUrl, retrievedAt, cached };
}

export function alphaMissenseClass(score: number | null): AlphaMissenseClass | null {
  if (score === null) return null;
  if (score < 0.34) return 'likely_benign';
  if (score > 0.564) return 'likely_pathogenic';
  return 'ambiguous';
}

function consequenceOf(hit: Json, variant: ResolvedVariant): { consequence: Consequence; raw: string[] } {
  const raw = [...new Set(strings([...pick(hit, 'snpeff.ann.effect'), ...pick(hit, 'cadd.consequence')]))];
  if (raw.length > 0) return { consequence: mapEffects(raw), raw };
  const inferred = consequenceFromHgvs(variant.hgvsProtein, variant.hgvsCoding);
  if (inferred === null) return { consequence: 'unknown', raw: [] };
  return { consequence: inferred, raw: [`hgvs:${variant.hgvsProtein ?? variant.hgvsCoding ?? ''}`] };
}

function altCodon(refCodon: string | null, codonPos: number | null, coding: string | null): string | null {
  if (!refCodon || codonPos === null || !coding) return null;
  const m = /c\.\d+([ACGT])>([ACGT])$/.exec(coding);
  if (!m || refCodon.length !== 3 || refCodon[codonPos - 1]?.toUpperCase() !== m[1]) return null;
  return refCodon.slice(0, codonPos - 1).toUpperCase() + m[2] + refCodon.slice(codonPos).toUpperCase();
}

function proteinOf(hit: Json, variant: ResolvedVariant): ProteinChange | null {
  const fromHgvs = variant.hgvsProtein
    ? /p\.\(?([A-Z][a-z]{2}|[A-Z*])(\d+)([A-Z][a-z]{2}|[A-Z*])?/.exec(variant.hgvsProtein)
    : null;
  const hgvsPos = fromHgvs ? Number(fromHgvs[2]) : null;

  const positions = numbers(pick(hit, 'dbnsfp.aa.pos'));
  if (positions.length > 0) {
    const idx = hgvsPos !== null && positions.includes(hgvsPos) ? positions.indexOf(hgvsPos) : 0;
    const at = (path: string) => {
      const all = strings(pick(hit, path));
      return all[idx] ?? all[0] ?? null;
    };
    const refCodon = at('dbnsfp.aa.refcodon');
    const codonPosRaw = numbers(pick(hit, 'dbnsfp.aa.codonpos'));
    const codonPos = codonPosRaw[idx] ?? codonPosRaw[0] ?? null;
    return {
      refAa: at('dbnsfp.aa.ref'),
      altAa: at('dbnsfp.aa.alt'),
      position: positions[idx],
      refCodon,
      altCodon: altCodon(refCodon, codonPos, variant.hgvsCoding),
    };
  }
  if (fromHgvs) {
    return {
      refAa: aaToOne(fromHgvs[1]),
      altAa: fromHgvs[3] ? aaToOne(fromHgvs[3]) : null,
      position: hgvsPos,
      refCodon: null,
      altCodon: null,
    };
  }
  return null;
}

export function toEvidence(
  hit: Json,
  variant: ResolvedVariant,
  fetched: { retrievedAt: string; cached: boolean },
): VariantEvidence {
  const { retrievedAt, cached } = fetched;
  const gnomadGenomeAf = maxNumber(hit, 'gnomad_genome.af.af');
  const gnomadExomeAf = maxNumber(hit, 'gnomad_exome.af.af');
  const afs = [gnomadGenomeAf, gnomadExomeAf].filter((x): x is number => x !== null);
  const alphaMissense = maxNumber(hit, 'dbnsfp.alphamissense.score');
  const caddPhred = maxNumber(hit, 'cadd.phred');
  const { consequence, raw } = consequenceOf(hit, variant);

  const sources: SourceRef[] = [
    sourceRef(MYVARIANT, variantUrl(variant.id), retrievedAt, cached),
    sourceRef(GNOMAD, variantUrl(variant.id, ['gnomad_genome.af', 'gnomad_exome.af']), retrievedAt, cached),
  ];
  if (alphaMissense !== null) {
    sources.push(sourceRef(ALPHAMISSENSE, variantUrl(variant.id, ['dbnsfp.alphamissense']), retrievedAt, cached));
  }
  if (pick(hit, 'snpeff').length > 0) {
    sources.push(sourceRef(SNPEFF, variantUrl(variant.id, ['snpeff']), retrievedAt, cached));
  }
  if (caddPhred !== null) {
    sources.push(sourceRef(CADD, variantUrl(variant.id, ['cadd']), retrievedAt, cached));
  }
  if (variant.rsid) {
    sources.push(sourceRef(DBSNP, `https://www.ncbi.nlm.nih.gov/snp/${variant.rsid}`, retrievedAt, cached));
  }

  return {
    variant,
    consequence,
    consequenceRaw: raw,
    protein: proteinOf(hit, variant),
    population: {
      gnomadGenomeAf,
      gnomadExomeAf,
      maxAf: afs.length > 0 ? Math.max(...afs) : null,
    },
    predictors: { alphaMissense, alphaMissenseClass: alphaMissenseClass(alphaMissense), caddPhred },
    sources,
  };
}

type Vote = 'P' | 'LP' | 'VUS' | 'LB' | 'B';

function voteFor(term: string): Vote | null {
  switch (term.trim().toLowerCase()) {
    case 'pathogenic':
      return 'P';
    case 'likely pathogenic':
      return 'LP';
    case 'uncertain significance':
      return 'VUS';
    case 'likely benign':
      return 'LB';
    case 'benign':
      return 'B';
    default:
      return null;
  }
}

export interface ClinvarSubmission {
  readonly significance: string;
  readonly reviewStatus: string | null;
}

/** Review tiers in ClinVar's precedence order: guideline > expert panel > criteria provided > none. */
function reviewTier(reviewStatus: string | null): number {
  const stars = reviewStatus === null ? 0 : starsFor(reviewStatus);
  return stars === 2 ? 1 : stars;
}

function votesOf(significance: string): Vote[] {
  return significance
    .split(/[;,/]/)
    .map(voteFor)
    .filter((v): v is Vote => v !== null);
}

function isPathogenicityCall(s: ClinvarSubmission): boolean {
  return /conflicting/i.test(s.significance) || votesOf(s.significance).length > 0;
}

/**
 * Collapses per-condition ClinVar records into one call. Non-pathogenicity
 * terms (not provided, other, protective, risk factor, drug response,
 * association, Affects, low penetrance qualifiers) carry no vote. Only the
 * highest review tier that has a vote counts, as in ClinVar's own
 * aggregation: one unreviewed "Uncertain significance" must not overturn an
 * expert panel's "Pathogenic".
 */
export function clinvarConsensus(
  submissions: readonly ClinvarSubmission[],
  found: boolean,
): ClinvarConsensus | null {
  const usable = submissions.filter(isPathogenicityCall);
  if (usable.length === 0) return found ? 'Other' : null;
  const top = Math.max(...usable.map((s) => reviewTier(s.reviewStatus)));
  const tier = usable.filter((s) => reviewTier(s.reviewStatus) === top);
  if (tier.some((s) => /conflicting/i.test(s.significance))) return 'Conflicting';
  const votes = tier.flatMap((s) => votesOf(s.significance));

  const count = (v: Vote) => votes.filter((x) => x === v).length;
  const pSide = count('P') + count('LP');
  const bSide = count('B') + count('LB');
  const vus = count('VUS');
  const groups = [pSide, bSide, vus].filter((n) => n > 0).length;
  if (groups > 1) return 'Conflicting';
  if (pSide > 0) return count('P') > pSide / 2 ? 'Pathogenic' : 'Likely Pathogenic';
  if (bSide > 0) return count('B') > bSide / 2 ? 'Benign' : 'Likely Benign';
  return 'Uncertain Significance';
}

export function starsFor(reviewStatus: string): 0 | 1 | 2 | 3 | 4 {
  const s = reviewStatus.toLowerCase();
  if (s.includes('practice guideline')) return 4;
  if (s.includes('reviewed by expert panel')) return 3;
  if (s.includes('criteria provided, multiple submitters, no conflicts')) return 2;
  if (s.includes('criteria provided, single submitter') || s.includes('criteria provided, conflicting')) return 1;
  return 0;
}

export function toClinvarRecord(
  hit: Json | null,
  rsid: string | null,
  fetched: { retrievedAt: string; cached: boolean },
): ClinvarRecord {
  const rcvs = hit ? pick(hit, 'clinvar.rcv').filter(isObject) : [];
  const found = hit !== null && (pick(hit, 'clinvar.variant_id').length > 0 || rcvs.length > 0);
  const submissions: ClinvarSubmission[] = rcvs.flatMap((r) => {
    const status = strings(asArray(r.review_status))[0] ?? null;
    return strings(asArray(r.clinical_significance)).map((significance) => ({ significance, reviewStatus: status }));
  });
  const significances = submissions.map((s) => s.significance);
  // Stars describe the pathogenicity call, not e.g. an expert-panel "drug response" record.
  const calls = submissions.filter(isPathogenicityCall);
  const statuses = (calls.length > 0 ? calls : submissions)
    .map((s) => s.reviewStatus)
    .filter((s): s is string => s !== null);
  let reviewStatus: string | null = null;
  let stars: 0 | 1 | 2 | 3 | 4 = 0;
  for (const status of statuses) {
    const s = starsFor(status);
    if (reviewStatus === null || s > stars) {
      reviewStatus = status;
      stars = s;
    }
  }
  const variantId = hit ? firstString(hit, 'clinvar.variant_id') : null;
  const url = variantId
    ? `https://www.ncbi.nlm.nih.gov/clinvar/variation/${variantId}/`
    : rsid
      ? `https://www.ncbi.nlm.nih.gov/clinvar/?term=${rsid}`
      : null;
  return {
    found,
    consensus: clinvarConsensus(submissions, found),
    significances,
    reviewStatus,
    stars,
    url,
    source: sourceRef(CLINVAR, url ?? 'https://www.ncbi.nlm.nih.gov/clinvar/', fetched.retrievedAt, fetched.cached),
  };
}
