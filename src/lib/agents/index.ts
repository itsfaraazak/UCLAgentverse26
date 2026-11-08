// TEMP STUB — replaced at integration. Signatures must match SPEC.md §4.
//
// SPEC.md §4.3 `lib/agents` — the harness. Append-only DAG of attributed
// deltas; seven deterministic, LLM-free agents; the biosafety gate at
// position 2 with `block` terminating the run.
//
// Specified by SPEC §4.3 and reproduced here verbatim: `DeltaKind`, `Delta`,
// `DeltaDAG`, the agent names and their fixed order.
//
// NOT specified by SPEC §4.3, and therefore this variant's literal reading
// (flagged in the final report): the pipeline runner's own signature, the
// per-agent result shape, and the check/verdict vocabulary the CI panel
// renders. Everything below `Delta`/`DeltaDAG` is in that category.
//
// SAFETY INVARIANTS THIS FILE UPHOLDS (SPEC §7.3, §7.4):
//   * The request's verbatim text is never placed in a Delta payload, a check
//     summary, or any returned value. `IntentAgent` reduces it to an
//     allow-listed target list plus the one-way digest from `lib/safety`.
//   * `BiosafetyGateAgent` is step 2 and a `block` verdict returns
//     immediately. Steps 3–7 are not executed and are reported as skipped —
//     the gate is structural, not a disclaimer beside computed results.
//   * An `escalate` verdict never auto-approves. `evaluateMerge` requires a
//     recorded `signoff` delta naming a human.
//
// Pure and framework-free. No React, no DOM.

import {
  runHeadless,
  SICKLING_ONSET_PO2,
  type SimMetrics,
  type SimParams,
} from '@/lib/cellsim';
import type { Variant } from '@/lib/genome';
import {
  findLocus,
  matchGeneSymbols,
  PO2_CONTROL,
  SIMULATION_DEFAULTS,
  type Locus,
  type LocusVariant,
} from '@/lib/loci';
import {
  FLAGGED_LOCI,
  passesGate,
  screen,
  type PolicyCategory,
  type ScreenResult,
  type Verdict,
} from '@/lib/safety/policy';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC §4.3 — the delta DAG
// ─────────────────────────────────────────────────────────────────────────────

export type DeltaKind =
  | 'intent'
  | 'screen'
  | 'edit_plan'
  | 'structural'
  | 'assay'
  | 'offtarget'
  | 'verdict'
  | 'signoff';

export interface Delta {
  id: string;
  kind: DeltaKind;
  author: string;
  subject: string;
  payload: unknown;
  parents: string[];
  createdAt: number;
}

/**
 * Append-only. Disagreement forks the record instead of overwriting it, so
 * `add` never mutates an existing delta and there is no `remove`.
 */
export class DeltaDAG {
  private readonly byId = new Map<string, Delta>();
  private readonly order: string[] = [];

  add(d: Delta): Delta {
    if (this.byId.has(d.id)) throw new Error(`delta ${d.id} already recorded`);
    const frozen: Delta = Object.freeze({ ...d, parents: [...d.parents] });
    this.byId.set(d.id, frozen);
    this.order.push(d.id);
    return frozen;
  }

  get(id: string): Delta {
    const d = this.byId.get(id);
    if (d === undefined) throw new Error(`no such delta: ${id}`);
    return d;
  }

  all(): Delta[] {
    return this.order.map((id) => this.get(id));
  }

  /** `id` and every ancestor, oldest first. */
  history(id: string): Delta[] {
    const seen = new Set<string>();
    const collect = (current: string): void => {
      if (seen.has(current)) return;
      seen.add(current);
      for (const parent of this.get(current).parents) collect(parent);
    };
    collect(id);
    return this.all().filter((d) => seen.has(d.id));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline vocabulary (not specified by SPEC §4.3 — see header)
// ─────────────────────────────────────────────────────────────────────────────

export type AgentId =
  | 'IntentAgent'
  | 'BiosafetyGateAgent'
  | 'EditPlannerAgent'
  | 'StructuralImpactAgent'
  | 'FunctionalAssayAgent'
  | 'OffTargetRiskAgent'
  | 'VerifierAgent';

/** Fixed order. The gate is position 2 and this array is the source of truth. */
export const AGENT_ORDER: readonly AgentId[] = Object.freeze([
  'IntentAgent',
  'BiosafetyGateAgent',
  'EditPlannerAgent',
  'StructuralImpactAgent',
  'FunctionalAssayAgent',
  'OffTargetRiskAgent',
  'VerifierAgent',
]);

export const AGENT_META: Readonly<Record<AgentId, { step: number; role: string; kind: DeltaKind }>> =
  Object.freeze({
    IntentAgent: { step: 1, role: 'normalise free-text request into a structured intent', kind: 'intent' },
    BiosafetyGateAgent: {
      step: 2,
      role: 'screens the intent before any downstream work; block ends the run',
      kind: 'screen',
    },
    EditPlannerAgent: { step: 3, role: 'resolve target locus + edit against data/loci.json', kind: 'edit_plan' },
    StructuralImpactAgent: {
      step: 4,
      role: 'amino-acid change → annotated structural consequence',
      kind: 'structural',
    },
    FunctionalAssayAgent: { step: 5, role: 'run cellsim headless, return metrics', kind: 'assay' },
    OffTargetRiskAgent: { step: 6, role: 'flag target against the curated sensitive-locus registry', kind: 'offtarget' },
    VerifierAgent: { step: 7, role: 'cross-check claims against measured sim output; final pass/fail', kind: 'verdict' },
  });

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'blocked' | 'escalated' | 'skipped';

export interface CheckDetail {
  readonly label: string;
  readonly value: string;
}

export interface CheckRun {
  readonly agent: AgentId;
  readonly step: number;
  readonly status: CheckStatus;
  /** Generic, request-independent. Never contains request text. */
  readonly summary: string;
  readonly details: readonly CheckDetail[];
  /** Honest statement of what this check does not establish, when relevant. */
  readonly limitation?: string;
  readonly deltaId: string | null;
  readonly durationMs: number;
}

export type RunConclusion = 'passed' | 'failed' | 'blocked' | 'escalated';

export interface SignoffRecord {
  readonly approver: string;
  readonly role: string;
  readonly at: number;
}

/**
 * The gate's outcome, reduced to exactly what may cross a trust boundary:
 * category, verdict, generic policy reason, digest. Never the request.
 */
export interface GateOutcome {
  readonly category: PolicyCategory;
  readonly verdict: Verdict;
  readonly reason: string;
  readonly requiresSignoff: boolean;
  readonly signoffRole?: string;
  readonly flaggedGenes: readonly string[];
  readonly requestDigest: string;
  readonly redacted: boolean;
}

export interface PipelineRun {
  readonly id: string;
  readonly startedAt: number;
  readonly gene: string;
  readonly variantId: string | null;
  readonly branch: string;
  readonly checks: readonly CheckRun[];
  readonly deltas: readonly Delta[];
  readonly gate: GateOutcome;
  readonly conclusion: RunConclusion;
  readonly requiresSignoff: boolean;
  readonly signoffRole: string | null;
  readonly signoff: SignoffRecord | null;
  /** Measured simulation output, when the assay ran. */
  readonly measured: SimMetrics | null;
  readonly assayPO2: number;
}

export interface PipelineInput {
  /**
   * The free-text request. Consumed by `IntentAgent` and `screen()` only;
   * never stored, never returned, never logged.
   */
  readonly requestText: string;
  /** Branch the run is attributed to, for the audit trail. */
  readonly branch: string;
  /** Gene the branch's working genotype edits. */
  readonly gene: string;
  /** Fixture variant id the branch applies, if any. */
  readonly variantId: string | null;
  /** Variant ids already present on the branch's baseline genotype. */
  readonly baselineVariantIds: readonly string[];
  /** Clock injected so the caller controls timestamps. */
  readonly now: number;
}

/** Oxygen tension the functional assay stresses the genotype at. */
export const ASSAY_PO2 = 24;
/** Steps the headless assay runs. Fixed, so the metrics are reproducible. */
export const ASSAY_STEPS = 420;
/** Above this measured occlusion the verifier refuses to call an edit good. */
export const OCCLUSION_FAIL_THRESHOLD = 0.4;

/**
 * Turn free text into the `targets` list `screen()` expects. Matching is
 * against an allow-list of curated gene symbols only, so nothing from the
 * request itself survives this call — which is what keeps a refused request
 * out of every downstream payload.
 */
export function resolveTargets(text: string, extraSymbols: readonly string[] = []): string[] {
  const known = [...new Set([...FLAGGED_LOCI.map((l) => l.gene), ...extraSymbols])];
  return matchGeneSymbols(text, known);
}

/** Screen a request and return only what may cross a trust boundary. */
export function screenRequest(text: string, extraSymbols: readonly string[] = []): GateOutcome {
  const r = screen({ text, targets: resolveTargets(text, extraSymbols) });
  return {
    category: r.category,
    verdict: r.verdict,
    reason: r.reason,
    requiresSignoff: r.requiresSignoff,
    signoffRole: r.signoffRole,
    flaggedGenes: r.flaggedGenes,
    requestDigest: r.requestDigest,
    redacted: r.redacted,
  };
}

function digestedId(run: string, kind: DeltaKind, step: number): string {
  return `${run}:${step}:${kind}`;
}

/**
 * Effective polymerisation tendency of the genotype that results from
 * applying `edit` on top of `baselineVariantIds`.
 *
 * Rule, stated plainly: if the resulting variant set is one the fixture names
 * as a genotype, use that genotype's tendency. Otherwise the baseline lesion
 * is still present, so take the worst of the baseline and the edit — an edit
 * elsewhere in the gene does not repair a lesion it does not touch. This is
 * what lets `VerifierAgent` fail an edit `StructuralImpactAgent` liked.
 */
export function effectiveTendency(
  locus: Locus,
  baselineVariantIds: readonly string[],
  edit: LocusVariant | null,
): number {
  const applied = edit === null ? [...baselineVariantIds] : [...baselineVariantIds, edit.id];
  const key = [...applied].sort().join('|');

  const named = locus.genotypes.find((g) => [...g.appliedVariants].sort().join('|') === key);
  if (named !== undefined) return named.polymerizationTendency;

  const baselineWorst = baselineVariantIds
    .map((id) => locus.variants.find((v) => v.id === id)?.structural.polymerizationTendency ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);
  const editTendency = edit === null ? 0 : edit.structural.polymerizationTendency;
  return Math.max(baselineWorst, editTendency);
}

export function assayParams(polymerizationTendency: number, pO2: number): SimParams {
  return {
    seed: SIMULATION_DEFAULTS.seed,
    cellCount: SIMULATION_DEFAULTS.cellCount,
    pO2,
    constriction: SIMULATION_DEFAULTS.capillaryConstriction,
    polymerizationTendency,
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Run the seven checks in the fixed order of SPEC §4.3.
 *
 * Deterministic apart from the measured wall-clock `durationMs` of each step,
 * which is reported as timing and feeds no decision.
 */
export function runPipeline(input: PipelineInput): PipelineRun {
  const dag = new DeltaDAG();
  const checks: CheckRun[] = [];
  const runId = `run_${input.now.toString(36)}`;
  const clock = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now());

  const skipRest = (from: number, reason: string): void => {
    for (const agent of AGENT_ORDER) {
      const meta = AGENT_META[agent];
      if (meta.step < from) continue;
      checks.push({
        agent,
        step: meta.step,
        status: 'skipped',
        summary: reason,
        details: [],
        deltaId: null,
        durationMs: 0,
      });
    }
  };

  // ── 1. IntentAgent ───────────────────────────────────────────────────────
  // Reduces the request to an allow-listed target list. The text itself goes
  // no further than this function's argument.
  let t0 = clock();
  const targets = resolveTargets(input.requestText, [input.gene]);
  const gateResult: ScreenResult = screen({ text: input.requestText, targets });

  const intentDelta = dag.add({
    id: digestedId(runId, 'intent', 1),
    kind: 'intent',
    author: 'IntentAgent',
    subject: `request ${gateResult.requestDigest}`,
    // Structured only: allow-listed symbols and a one-way digest.
    payload: { targets, requestDigest: gateResult.requestDigest },
    parents: [],
    createdAt: input.now,
  });
  checks.push({
    agent: 'IntentAgent',
    step: 1,
    status: targets.length > 0 ? 'pass' : 'warn',
    summary:
      targets.length > 0
        ? `Normalised to ${targets.length} curated target${targets.length === 1 ? '' : 's'}.`
        : 'No curated target locus could be resolved from the request.',
    details: [
      { label: 'targets', value: targets.length > 0 ? targets.join(', ') : '—' },
      { label: 'request digest', value: gateResult.requestDigest },
    ],
    limitation:
      'Structured intent only. The request text is reduced to allow-listed gene symbols plus a one-way digest and is not retained.',
    deltaId: intentDelta.id,
    durationMs: clock() - t0,
  });

  // ── 2. BiosafetyGateAgent ────────────────────────────────────────────────
  t0 = clock();
  const gate: GateOutcome = {
    category: gateResult.category,
    verdict: gateResult.verdict,
    reason: gateResult.reason,
    requiresSignoff: gateResult.requiresSignoff,
    signoffRole: gateResult.signoffRole,
    flaggedGenes: gateResult.flaggedGenes,
    requestDigest: gateResult.requestDigest,
    redacted: gateResult.redacted,
  };
  const screenDelta = dag.add({
    id: digestedId(runId, 'screen', 2),
    kind: 'screen',
    author: 'BiosafetyGateAgent',
    subject: gate.category,
    payload: gate,
    parents: [intentDelta.id],
    createdAt: input.now,
  });
  const gateStatus: CheckStatus =
    gate.verdict === 'block' ? 'blocked' : gate.verdict === 'escalate' ? 'escalated' : 'pass';
  checks.push({
    agent: 'BiosafetyGateAgent',
    step: 2,
    status: gateStatus,
    summary: gate.reason,
    details: [
      { label: 'category', value: gate.category },
      { label: 'verdict', value: gate.verdict },
      { label: 'flagged genes', value: gate.flaggedGenes.length > 0 ? gate.flaggedGenes.join(', ') : '—' },
      { label: 'request digest', value: gate.requestDigest },
      ...(gate.signoffRole === undefined ? [] : [{ label: 'sign-off required from', value: gate.signoffRole }]),
    ],
    limitation:
      'Deterministic keyword-and-registry screen, not a trained classifier and not a substitute for institutional biosafety review. It over-blocks on innocent phrasing and can be evaded by paraphrase.',
    deltaId: screenDelta.id,
    durationMs: clock() - t0,
  });

  if (!passesGate(gateResult) && gate.verdict === 'block') {
    // Structural termination: steps 3–7 do not run at all.
    skipRest(3, 'Not run — the biosafety gate blocked this request at step 2.');
    return {
      id: runId,
      startedAt: input.now,
      gene: input.gene,
      variantId: input.variantId,
      branch: input.branch,
      checks,
      deltas: dag.all(),
      gate,
      conclusion: 'blocked',
      requiresSignoff: false,
      signoffRole: null,
      signoff: null,
      measured: null,
      assayPO2: ASSAY_PO2,
    };
  }

  // ── 3. EditPlannerAgent ──────────────────────────────────────────────────
  t0 = clock();
  const locus = findLocus(input.gene);
  const fixtureVariant =
    locus === undefined || input.variantId === null
      ? undefined
      : locus.variants.find((v) => v.id === input.variantId);

  if (locus === undefined || fixtureVariant === undefined) {
    checks.push({
      agent: 'EditPlannerAgent',
      step: 3,
      status: 'fail',
      summary: 'No curated locus and variant pair could be resolved for this run.',
      details: [{ label: 'gene', value: input.gene }],
      deltaId: null,
      durationMs: clock() - t0,
    });
    skipRest(4, 'Not run — no edit plan was produced at step 3.');
    return {
      id: runId,
      startedAt: input.now,
      gene: input.gene,
      variantId: input.variantId,
      branch: input.branch,
      checks,
      deltas: dag.all(),
      gate,
      conclusion: 'failed',
      requiresSignoff: gate.requiresSignoff,
      signoffRole: gate.signoffRole ?? null,
      signoff: null,
      measured: null,
      assayPO2: ASSAY_PO2,
    };
  }

  const plan: Variant = {
    gene: locus.gene,
    codonIndex: fixtureVariant.codonIndex,
    refCodon: fixtureVariant.refCodon,
    altCodon: fixtureVariant.altCodon,
    kind: fixtureVariant.kind,
    label: fixtureVariant.label,
  };
  const planDelta = dag.add({
    id: digestedId(runId, 'edit_plan', 3),
    kind: 'edit_plan',
    author: 'EditPlannerAgent',
    subject: `${locus.gene} codon ${plan.codonIndex}`,
    payload: { plan, provenance: fixtureVariant.provenance },
    parents: [screenDelta.id],
    createdAt: input.now,
  });
  checks.push({
    agent: 'EditPlannerAgent',
    step: 3,
    status: 'pass',
    summary: `Resolved to ${locus.gene} codon ${plan.codonIndex}: ${plan.refCodon} → ${plan.altCodon}.`,
    details: [
      { label: 'locus', value: `${locus.gene} — ${locus.name} (chr ${locus.chromosome})` },
      { label: 'fixture variant', value: `${fixtureVariant.id} (${fixtureVariant.provenance})` },
      { label: 'kind', value: plan.kind },
      ...(fixtureVariant.hgvs === undefined ? [] : [{ label: 'HGVS', value: fixtureVariant.hgvs }]),
      ...(fixtureVariant.numberingNote === undefined
        ? []
        : [{ label: 'numbering', value: fixtureVariant.numberingNote }]),
    ],
    limitation:
      'Resolves a curated fixture only. This tool models edits at the sequence-diff level and produces no construct, guide, primer, vector or protocol.',
    deltaId: planDelta.id,
    durationMs: clock() - t0,
  });

  // ── 4. StructuralImpactAgent ─────────────────────────────────────────────
  t0 = clock();
  const structural = fixtureVariant.structural;
  const silent = structural.refAa === structural.altAa;
  const structuralDelta = dag.add({
    id: digestedId(runId, 'structural', 4),
    kind: 'structural',
    author: 'StructuralImpactAgent',
    subject: `${structural.refAa}${plan.codonIndex}${structural.altAa}`,
    payload: structural,
    parents: [planDelta.id],
    createdAt: input.now,
  });
  const structuralStatus: CheckStatus =
    structural.polymerizationTendency >= 0.5 ? 'fail' : silent ? 'warn' : 'pass';
  checks.push({
    agent: 'StructuralImpactAgent',
    step: 4,
    status: structuralStatus,
    summary: silent
      ? `Synonymous substitution — ${structural.refAaName} retained. ${structural.summary}`
      : `${structural.refAaName} → ${structural.altAaName}. ${structural.summary}`,
    details: [
      { label: 'amino acid', value: `${structural.refAa} → ${structural.altAa}` },
      { label: 'consequence', value: structural.consequence },
      { label: 'annotated polymerisation tendency', value: structural.polymerizationTendency.toFixed(2) },
      { label: 'confidence', value: structural.confidence },
    ],
    limitation: structural.limitation,
    deltaId: structuralDelta.id,
    durationMs: clock() - t0,
  });

  // ── 5. FunctionalAssayAgent ──────────────────────────────────────────────
  t0 = clock();
  const tendency = effectiveTendency(locus, input.baselineVariantIds, fixtureVariant);
  const measured = runHeadless(assayParams(tendency, ASSAY_PO2), ASSAY_STEPS);
  const baselineTendency = effectiveTendency(locus, input.baselineVariantIds, null);
  const baseline = runHeadless(assayParams(baselineTendency, ASSAY_PO2), ASSAY_STEPS);
  const assayDelta = dag.add({
    id: digestedId(runId, 'assay', 5),
    kind: 'assay',
    author: 'FunctionalAssayAgent',
    subject: `pO2 ${ASSAY_PO2} ${PO2_CONTROL.unit}`,
    payload: { measured, baseline, tendency, baselineTendency, pO2: ASSAY_PO2, steps: ASSAY_STEPS },
    parents: [structuralDelta.id],
    createdAt: input.now,
  });
  const assayStatus: CheckStatus =
    measured.occlusion > OCCLUSION_FAIL_THRESHOLD ? 'fail' : measured.occlusion > 0.15 ? 'warn' : 'pass';
  checks.push({
    agent: 'FunctionalAssayAgent',
    step: 5,
    status: assayStatus,
    summary: `Headless run at pO2 ${ASSAY_PO2} ${PO2_CONTROL.unit} over ${ASSAY_STEPS} steps: occlusion ${pct(
      measured.occlusion,
    )}, sickled fraction ${pct(measured.sickledFraction)}.`,
    details: [
      { label: 'genotype tendency (post-edit)', value: tendency.toFixed(2) },
      { label: 'occlusion', value: pct(measured.occlusion) },
      { label: 'mean flow', value: measured.meanFlow.toFixed(5) },
      { label: 'sickled fraction', value: pct(measured.sickledFraction) },
      { label: 'pre-edit occlusion (same seed)', value: pct(baseline.occlusion) },
      { label: 'seed', value: String(SIMULATION_DEFAULTS.seed) },
      { label: 'cells', value: String(SIMULATION_DEFAULTS.cellCount) },
    ],
    limitation:
      'Illustrative seeded particle model, not validated haemorheology. Parameters were chosen so the demo reads clearly on screen; the numbers are not predictions about any real cell, capillary or patient.',
    deltaId: assayDelta.id,
    durationMs: clock() - t0,
  });

  // ── 6. OffTargetRiskAgent ────────────────────────────────────────────────
  t0 = clock();
  const registryHits = FLAGGED_LOCI.filter((l) => targets.includes(l.gene.toUpperCase()));
  const sensitive = registryHits.filter((l) => l.classification !== 'therapeutic_target');
  const offTargetDelta = dag.add({
    id: digestedId(runId, 'offtarget', 6),
    kind: 'offtarget',
    author: 'OffTargetRiskAgent',
    subject: `${registryHits.length} registry hit${registryHits.length === 1 ? '' : 's'}`,
    payload: { registryHits, targets },
    parents: [assayDelta.id],
    createdAt: input.now,
  });
  checks.push({
    agent: 'OffTargetRiskAgent',
    step: 6,
    status: sensitive.length > 0 ? 'warn' : 'pass',
    summary:
      sensitive.length > 0
        ? `${sensitive.length} target(s) carry a sensitive-locus classification.`
        : `Target set matched the curated registry with no sensitive classification (${registryHits.length} hit${
            registryHits.length === 1 ? '' : 's'
          }).`,
    details:
      registryHits.length > 0
        ? registryHits.map((l) => ({ label: `${l.gene} — ${l.classification}`, value: l.note }))
        : [{ label: 'registry', value: 'no curated locus matched the resolved target set' }],
    limitation:
      'Registry lookup over curated gene-function knowledge. It is not a genome-wide off-target prediction and performs no sequence search.',
    deltaId: offTargetDelta.id,
    durationMs: clock() - t0,
  });

  // ── 7. VerifierAgent ─────────────────────────────────────────────────────
  // Reads the measured numbers, not the other agents' prose.
  t0 = clock();
  const claimedBenign = structural.polymerizationTendency < 0.5;
  const measuredBad = measured.occlusion > OCCLUSION_FAIL_THRESHOLD;
  const improved = measured.occlusion < baseline.occlusion - 0.02;
  const contradiction = claimedBenign && measuredBad;

  const verifierStatus: CheckStatus = measuredBad || !improved ? 'fail' : 'pass';
  const verdictDelta = dag.add({
    id: digestedId(runId, 'verdict', 7),
    kind: 'verdict',
    author: 'VerifierAgent',
    subject: verifierStatus,
    payload: {
      claimedPolymerizationTendency: structural.polymerizationTendency,
      effectiveTendency: tendency,
      measured,
      baseline,
      contradiction,
      improved,
      threshold: OCCLUSION_FAIL_THRESHOLD,
    },
    parents: [structuralDelta.id, assayDelta.id, offTargetDelta.id],
    createdAt: input.now,
  });
  checks.push({
    agent: 'VerifierAgent',
    step: 7,
    status: verifierStatus,
    summary: contradiction
      ? `Rejected: step 4 annotated this edit as benign (tendency ${structural.polymerizationTendency.toFixed(
          2,
        )}) but the measured occlusion is ${pct(measured.occlusion)} — the lesion driving occlusion is untouched.`
      : measuredBad
        ? `Rejected: measured occlusion ${pct(measured.occlusion)} exceeds the ${pct(
            OCCLUSION_FAIL_THRESHOLD,
          )} threshold.`
        : improved
          ? `Accepted: occlusion falls from ${pct(baseline.occlusion)} to ${pct(
              measured.occlusion,
            )} against the same seed.`
          : `Rejected: no measurable improvement over the pre-edit genotype (${pct(
              baseline.occlusion,
            )} → ${pct(measured.occlusion)}).`,
    details: [
      { label: 'step 4 claimed tendency', value: structural.polymerizationTendency.toFixed(2) },
      { label: 'step 5 effective tendency', value: tendency.toFixed(2) },
      { label: 'claim contradicted by measurement', value: contradiction ? 'yes' : 'no' },
      { label: 'occlusion vs pre-edit', value: `${pct(baseline.occlusion)} → ${pct(measured.occlusion)}` },
      { label: 'threshold', value: pct(OCCLUSION_FAIL_THRESHOLD) },
      { label: 'assay pO2', value: `${ASSAY_PO2} ${PO2_CONTROL.unit} (onset below ${SICKLING_ONSET_PO2})` },
    ],
    limitation:
      'Cross-checks the other agents against this prototype’s own illustrative simulation. It verifies internal consistency, not biological truth.',
    deltaId: verdictDelta.id,
    durationMs: clock() - t0,
  });

  const anyFail = checks.some((c) => c.status === 'fail');
  const conclusion: RunConclusion =
    gate.verdict === 'escalate' ? 'escalated' : anyFail ? 'failed' : 'passed';

  return {
    id: runId,
    startedAt: input.now,
    gene: locus.gene,
    variantId: fixtureVariant.id,
    branch: input.branch,
    checks,
    deltas: dag.all(),
    gate,
    conclusion,
    requiresSignoff: gate.requiresSignoff,
    signoffRole: gate.signoffRole ?? null,
    signoff: null,
    measured,
    assayPO2: ASSAY_PO2,
  };
}

/** Append a human sign-off delta. Nothing in this module calls it for you. */
export function recordSignoff(run: PipelineRun, signoff: SignoffRecord): PipelineRun {
  const verdict = run.checks.find((c) => c.agent === 'VerifierAgent')?.deltaId;
  const dag = new DeltaDAG();
  for (const d of run.deltas) dag.add(d);
  dag.add({
    id: `${run.id}:8:signoff`,
    kind: 'signoff',
    author: signoff.approver,
    subject: signoff.role,
    payload: signoff,
    parents: verdict === undefined || verdict === null ? [] : [verdict],
    createdAt: signoff.at,
  });
  return { ...run, signoff, deltas: dag.all() };
}

export interface MergeDecision {
  readonly allowed: boolean;
  /** Generic, policy-level explanation. Never contains request text. */
  readonly reason: string;
  readonly blockingChecks: readonly AgentId[];
}

/**
 * The merge gate. A failing or escalated check stops the merge; an escalation
 * needs a recorded human sign-off and is never auto-approved.
 */
export function evaluateMerge(run: PipelineRun): MergeDecision {
  if (run.conclusion === 'blocked') {
    return {
      allowed: false,
      reason: `Merge refused: the biosafety gate blocked this run (${run.gate.category}). ${run.gate.reason}`,
      blockingChecks: ['BiosafetyGateAgent'],
    };
  }

  const failing = run.checks.filter((c) => c.status === 'fail').map((c) => c.agent);
  if (failing.length > 0) {
    return {
      allowed: false,
      reason: `Merge refused: ${failing.length} check${failing.length === 1 ? '' : 's'} failed (${failing.join(
        ', ',
      )}).`,
      blockingChecks: failing,
    };
  }

  if (run.requiresSignoff && run.signoff === null) {
    return {
      allowed: false,
      reason: `Merge held: ${run.gate.category} requires named sign-off from ${
        run.signoffRole ?? 'a human reviewer'
      }. ${run.gate.reason}`,
      blockingChecks: ['BiosafetyGateAgent'],
    };
  }

  return {
    allowed: true,
    reason:
      run.signoff === null
        ? 'All seven checks passed. Merge permitted.'
        : `All seven checks passed and ${run.signoff.role} sign-off was recorded by ${run.signoff.approver}.`,
    blockingChecks: [],
  };
}
