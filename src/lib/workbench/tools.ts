import type {
  ClinvarRecord,
  EvidenceService,
  HumanAssertions,
  Interpretation,
  VariantEvidence,
} from '../evidence/types';
import { gateEdit } from './gate';
import type { FunctionDeclaration } from './gemini';
import { latestOfKind, ofKind } from './merge';
import type { AppendInput, WorkbenchStore } from './store';
import type { Actor, AnyDelta, RequestMode, ToolTrace, WbDelta, WbDeltaKind } from './types';

export const EVIDENCE_AGENT: Actor = { kind: 'agent', name: 'Evidence agent', model: null };
export const ACMG_CLASSIFIER: Actor = { kind: 'agent', name: 'ACMG classifier', model: null };
export const REFERENCE_CHECK: Actor = { kind: 'agent', name: 'ClinVar reference check', model: null };
export const LITERATURE_AGENT: Actor = { kind: 'agent', name: 'Literature agent', model: null };
export const EDIT_PLANNER: Actor = { kind: 'agent', name: 'Edit planner', model: null };

export const TOOL_DECLARATIONS: readonly FunctionDeclaration[] = [
  {
    name: 'lookup_variant',
    description:
      'Resolve a variant (rsID like rs334, genomic HGVS like chr11:g.5227002T>A, or gene + HGVS like "BRCA1 c.5266dupC" / "HBB p.Glu7Val") and fetch its evidence: consequence, gnomAD frequency, AlphaMissense, CADD. Automatically runs the deterministic ACMG classifier and then compares the result with ClinVar. Returns all three results with their delta ids.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The variant to look up.' } },
      required: ['query'],
    },
  },
  {
    name: 'search_literature',
    description: 'Search Europe PMC for papers. Returns titles, journals, years and PMIDs.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search terms, e.g. "HBB Glu7Val sickle cell".' } },
      required: ['query'],
    },
  },
  {
    name: 'propose_correction',
    description:
      'Edit requests only. Propose reverting the variant already looked up on this branch back to the reference allele (codon and amino-acid view). The proposal is screened by the biosafety policy. Call lookup_variant first.',
    parameters: { type: 'object', properties: {} },
  },
];

/** What this run has produced, so the fallback can skip steps already done. */
export interface RunState {
  evidence: WbDelta<'evidence'> | null;
  clinvar: ClinvarRecord | null;
  interpretation: WbDelta<'interpretation'> | null;
  reference: WbDelta<'reference'> | null;
  literature: WbDelta<'literature'> | null;
  edit: WbDelta<'edit'> | null;
}

export function emptyRunState(): RunState {
  return { evidence: null, clinvar: null, interpretation: null, reference: null, literature: null, edit: null };
}

export interface ToolContext {
  readonly store: WorkbenchStore;
  readonly branch: string;
  readonly evidence: EvidenceService;
  readonly mode: RequestMode;
  /** The human text that triggered this run; edit proposals are screened against it. */
  readonly triggerText: string;
  readonly state: RunState;
  add<K extends WbDeltaKind>(input: AppendInput<K>): WbDelta<K>;
  progress(message: string): void;
}

export function short(id: string): string {
  return id.slice(0, 8);
}

/** Human assertions on the history, latest wins per criterion. */
export function assertionsOn(deltas: readonly AnyDelta[]): HumanAssertions {
  let segregation: HumanAssertions['segregation'] = null;
  const dismissed = new Map<string, HumanAssertions['dismissed'][number]>();
  for (const d of ofKind(deltas, 'assertion')) {
    const by = d.actor.name;
    if (d.data.kind === 'segregation') segregation = { value: d.data.value, reason: d.data.reason, by };
    else dismissed.set(d.data.code, { code: d.data.code, reason: d.data.reason, by });
  }
  return { segregation, dismissed: [...dismissed.values()] };
}

/**
 * Classify with the branch's assertions. A dismissal that no longer applies
 * to new evidence (criterion now unmet) is dropped rather than failing the run.
 */
export function interpretWith(
  service: EvidenceService,
  evidence: VariantEvidence,
  assertions: HumanAssertions,
): Interpretation {
  try {
    return service.interpret(evidence, assertions);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
  }
  const kept: HumanAssertions['dismissed'][number][] = [];
  for (const d of assertions.dismissed) {
    try {
      service.interpret(evidence, { ...assertions, dismissed: [...kept, d] });
      kept.push(d);
    } catch (err) {
      if (!(err instanceof RangeError)) throw err;
    }
  }
  return service.interpret(evidence, { ...assertions, dismissed: kept });
}

export function variantLabel(e: VariantEvidence): string {
  const v = e.variant;
  const name = v.hgvsProtein?.replace(/^[^:]*:/, '') ?? v.hgvsCoding?.replace(/^[^:]*:/, '') ?? v.id;
  return `${v.gene ?? 'Unknown gene'} ${name}${v.rsid ? ` (${v.rsid})` : ''}`;
}

function metCodes(i: Interpretation): string[] {
  const dismissed = new Set(i.dismissed.map((d) => d.code));
  return i.engine.criteria.filter((c) => c.met && !dismissed.has(c.code)).map((c) => c.code);
}

/** Append interpretation + reference deltas: the checks the model cannot skip. */
export function runRequiredChecks(
  ctx: Pick<ToolContext, 'store' | 'branch' | 'evidence' | 'add' | 'progress'>,
  evidenceDelta: WbDelta<'evidence'>,
  clinvar: ClinvarRecord,
  parent: string = evidenceDelta.id,
): { interpretation: WbDelta<'interpretation'>; reference: WbDelta<'reference'> } {
  ctx.progress('Running the ACMG classifier');
  const assertions = assertionsOn(ctx.store.ancestry(ctx.branch));
  const interp = interpretWith(ctx.evidence, evidenceDelta.data.evidence, assertions);
  const met = metCodes(interp);
  const interpretation = ctx.add({
    kind: 'interpretation',
    actor: ACMG_CLASSIFIER,
    title: `ACMG: ${interp.classification}`,
    body: `${interp.points} points; criteria met: ${met.length > 0 ? met.join(', ') : 'none'}${
      interp.dismissed.length > 0 ? `; dismissed by a human: ${interp.dismissed.map((d) => d.code).join(', ')}` : ''
    }.`,
    data: { interpretation: interp, evidenceDelta: evidenceDelta.id },
    parents: [parent],
  });
  ctx.progress('Comparing with ClinVar');
  const comparison = ctx.evidence.compareWithReference(interp, clinvar);
  const reference = ctx.add({
    kind: 'reference',
    actor: REFERENCE_CHECK,
    title:
      comparison.severity === 'unavailable'
        ? 'ClinVar: no usable consensus'
        : `ClinVar: ${comparison.clinvar.consensus ?? 'n/a'} (${comparison.severity === 'none' ? 'agrees' : `${comparison.severity} disagreement`})`,
    body: comparison.note,
    data: { comparison, interpretationDelta: interpretation.id },
    parents: [interpretation.id],
    sources: [clinvar.source],
  });
  return { interpretation, reference };
}

export async function lookupVariant(ctx: ToolContext, query: string): Promise<Record<string, unknown>> {
  const started = Date.now();
  ctx.progress(`Fetching evidence for ${query} from MyVariant.info`);
  const resolved = await ctx.evidence.resolveVariant(query);
  const bundle = await ctx.evidence.fetchEvidence(resolved);
  const tool: ToolTrace = { name: 'lookup_variant', args: { query }, ms: Date.now() - started };
  const e = bundle.evidence;
  const af = e.population.maxAf;
  const evidenceDelta = ctx.add({
    kind: 'evidence',
    actor: EVIDENCE_AGENT,
    title: `Evidence: ${variantLabel(e)}`,
    body: [
      `Consequence ${e.consequence}`,
      `gnomAD max AF ${af === null ? 'absent' : af.toExponential(2)}`,
      `AlphaMissense ${e.predictors.alphaMissense ?? 'n/a'}`,
      `CADD ${e.predictors.caddPhred ?? 'n/a'}`,
    ].join('; '),
    data: { evidence: e, tool },
    sources: e.sources,
  });
  const { interpretation, reference } = runRequiredChecks(ctx, evidenceDelta, bundle.clinvar);
  Object.assign(ctx.state, { evidence: evidenceDelta, clinvar: bundle.clinvar, interpretation, reference });
  const i = interpretation.data.interpretation;
  const c = reference.data.comparison;
  return {
    evidenceDelta: short(evidenceDelta.id),
    variant: {
      id: e.variant.id,
      rsid: e.variant.rsid,
      gene: e.variant.gene,
      hgvsCoding: e.variant.hgvsCoding,
      hgvsProtein: e.variant.hgvsProtein,
      alternates: e.variant.alternates.slice(0, 5),
    },
    consequence: e.consequence,
    protein: e.protein,
    population: e.population,
    predictors: e.predictors,
    interpretationDelta: short(interpretation.id),
    acmg: {
      classification: i.classification,
      points: i.points,
      criteria: i.engine.criteria.map((cr) => ({ code: cr.code, met: cr.met, note: cr.note })),
      dismissedByHuman: i.dismissed.map((d) => d.code),
      limitation: i.limitation,
    },
    referenceDelta: short(reference.id),
    clinvar: {
      found: c.clinvar.found,
      consensus: c.clinvar.consensus,
      stars: c.clinvar.stars,
      reviewStatus: c.clinvar.reviewStatus,
      agrees: c.agrees,
      severity: c.severity,
      note: c.note,
    },
  };
}

export async function searchLiterature(ctx: ToolContext, query: string): Promise<Record<string, unknown>> {
  const started = Date.now();
  ctx.progress(`Searching Europe PMC for "${query}"`);
  const result = await ctx.evidence.searchLiterature(query, 5);
  const tool: ToolTrace = { name: 'search_literature', args: { query }, ms: Date.now() - started };
  const delta = ctx.add({
    kind: 'literature',
    actor: LITERATURE_AGENT,
    title: `Literature: ${result.papers.length} paper${result.papers.length === 1 ? '' : 's'} for "${query}"`,
    body: result.papers
      .slice(0, 3)
      .map((p) => `${p.title}${p.year ? ` (${p.year})` : ''}`)
      .join(' | '),
    data: { result, tool },
    sources: [result.source],
  });
  ctx.state.literature = delta;
  return {
    literatureDelta: short(delta.id),
    papers: result.papers.map((p) => ({ pmid: p.pmid, title: p.title, journal: p.journal, year: p.year })),
  };
}

export function proposeCorrection(ctx: ToolContext): Record<string, unknown> {
  if (ctx.mode !== 'edit') {
    return { error: 'propose_correction is only available for edit requests. This request was screened as interpretation.' };
  }
  const evidenceDelta = ctx.state.evidence ?? latestOfKind(ctx.store.ancestry(ctx.branch), 'evidence');
  if (evidenceDelta === null) return { error: 'No variant on this branch yet. Call lookup_variant first.' };
  const e = evidenceDelta.data.evidence;
  const gene = e.variant.gene;
  if (gene === null) return { error: 'The variant has no resolved gene, so no curated locus can be screened.' };
  ctx.progress('Screening the edit proposal against policy');
  const gate = gateEdit(ctx.triggerText, [gene]);
  const p = e.protein;
  const aaFrom = p?.altAa ?? null;
  const aaTo = p?.refAa ?? null;
  const description =
    aaFrom && aaTo && p?.position != null
      ? `Revert ${gene} ${aaFrom}${p.position}${aaTo}: restore the reference allele at ${e.variant.id}.`
      : `Revert ${variantLabel(e)} to the reference allele at ${e.variant.id}.`;
  const edit = ctx.add({
    kind: 'edit',
    actor: EDIT_PLANNER,
    title: `${gate.verdict === 'block' ? 'Refused edit' : 'Proposed edit'}: revert ${variantLabel(e)} to reference`,
    body: `${description} Policy: ${gate.verdict} (${gate.category}). Sequence-level proposal only; no construct design.`,
    data: {
      gene,
      variantId: e.variant.id,
      description,
      codon: { position: p?.position ?? null, from: p?.altCodon ?? null, to: p?.refCodon ?? null },
      aminoAcid: { from: aaFrom, to: aaTo },
      gate,
    },
    parents: [evidenceDelta.id],
  });
  ctx.state.edit = edit;
  if (gate.verdict === 'block') ctx.store.setStatus(ctx.branch, 'blocked');
  return {
    editDelta: short(edit.id),
    description,
    codon: edit.data.codon,
    aminoAcid: edit.data.aminoAcid,
    policy: { verdict: gate.verdict, category: gate.category, reason: gate.reason, signoffRole: gate.signoffRole },
  };
}

function stringArg(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, 200) : null;
}

/** Execute one model tool call. Tool failures are returned to the model, not thrown. */
export async function executeTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case 'lookup_variant': {
        const q = stringArg(args, 'query');
        return q === null ? { error: 'query is required' } : await lookupVariant(ctx, q);
      }
      case 'search_literature': {
        const q = stringArg(args, 'query');
        return q === null ? { error: 'query is required' } : await searchLiterature(ctx, q);
      }
      case 'propose_correction':
        return proposeCorrection(ctx);
      default:
        return { error: `Unknown tool ${name}.` };
    }
  } catch (err) {
    const message = (err instanceof Error ? err.message : 'Tool failed.').slice(0, 300);
    ctx.add({
      kind: 'error',
      actor: name === 'search_literature' ? LITERATURE_AGENT : EVIDENCE_AGENT,
      title: `${name} failed`,
      body: message,
      data: { message, recoverable: true },
    });
    return { error: message };
  }
}
