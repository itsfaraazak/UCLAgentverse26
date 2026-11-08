// TEMP STUB — replaced at integration. Signatures must match SPEC.md §4.
//
// The agent harness per SPEC §4.3: an append-only DAG of attributed deltas and
// the seven-agent pipeline, in the fixed order given in the spec table.
// Every agent is deterministic and LLM-free, so a judge can re-derive any
// verdict by hand.
//
// SPEC §4.3 fixes `DeltaKind`, `Delta` and `DeltaDAG` exactly; it does NOT
// specify a signature for the pipeline runner itself. `runPipeline` and the
// `CheckRun` / `PipelineRun` shapes are this stub's reading — see the PR body.
//
// ──────────────────────────────────────────────────────────────────────────
// SAFETY INVARIANTS ENFORCED HERE (SPEC §7). Do not relax these:
//  - The gate is step 2 of 7 and runs before any locus is resolved (§7.4).
//  - A `block` verdict terminates the run; steps 3–7 are never executed and
//    are recorded as `skipped` (§7.4).
//  - No delta payload anywhere in this module contains the caller's request
//    text. IntentAgent deliberately records only derived, non-verbatim facts
//    plus the policy digest, so a refused request leaves no verbatim trace in
//    the audit trail whatever the gate decides (§7.3).
//  - An `escalate` verdict never auto-clears. `isMergeable` requires an
//    explicit, role-matched signoff delta (§7.5).
// ──────────────────────────────────────────────────────────────────────────

import { screen, type PolicyCategory, type ScreenResult, type Verdict } from '@/lib/safety/policy';
import { lookupLocus } from '@/lib/safety/policy';
import { getLocus, getVariant, SIMULATION, type LocusVariant } from '@/lib/fixtures/loci';
import { runHeadless, type SimMetrics } from '@/lib/cellsim';

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
 * Append-only DAG of attributed deltas. Nothing is ever overwritten: a
 * disagreement is recorded as a new delta whose parents include the claim it
 * disagrees with, so the record forks instead of being edited.
 */
export class DeltaDAG {
  private readonly byId = new Map<string, Delta>();
  private readonly order: string[] = [];

  add(d: Delta): Delta {
    if (this.byId.has(d.id)) throw new Error(`delta ${d.id} already exists`);
    for (const parent of d.parents) {
      if (!this.byId.has(parent)) throw new Error(`unknown parent delta ${parent}`);
    }
    const frozen: Delta = {
      id: d.id,
      kind: d.kind,
      author: d.author,
      subject: d.subject,
      payload: d.payload,
      parents: [...d.parents],
      createdAt: d.createdAt,
    };
    this.byId.set(frozen.id, frozen);
    this.order.push(frozen.id);
    return frozen;
  }

  get(id: string): Delta {
    const delta = this.byId.get(id);
    if (delta === undefined) throw new Error(`unknown delta ${id}`);
    return delta;
  }

  all(): Delta[] {
    return this.order.map((id) => this.get(id));
  }

  /**
   * The lineage of `id`: that delta and every ancestor, in insertion order
   * (oldest first). Terminates on cyclic input because each id is visited once.
   */
  history(id: string): Delta[] {
    const keep = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || keep.has(current)) continue;
      keep.add(current);
      for (const parent of this.get(current).parents) stack.push(parent);
    }
    return this.order.filter((candidate) => keep.has(candidate)).map((x) => this.get(x));
  }
}

export type CheckStatus = 'pass' | 'fail' | 'blocked' | 'escalated' | 'skipped';
export type RunVerdict = 'pass' | 'fail' | 'blocked' | 'escalated';

export interface CheckRun {
  /** Stable within a run, e.g. `run-fix-hbb-codon7.2`. */
  readonly id: string;
  /** 1-based position in the fixed pipeline order. */
  readonly step: number;
  readonly agent: string;
  readonly kind: DeltaKind;
  readonly status: CheckStatus;
  readonly title: string;
  /** Generic, never templated with request text. */
  readonly summary: string;
  readonly durationMs: number;
  /** The delta this check appended, or null when the step was skipped. */
  readonly deltaId: string | null;
}

export interface PipelineInput {
  /** Stable id for the run; used to derive delta ids deterministically. */
  readonly runId: string;
  /** Free-text proposal. Never stored or echoed by this module. */
  readonly requestText: string;
  /** Gene symbols the caller is proposing to touch. */
  readonly targets: readonly string[];
  /** Curated variant to plan, when the caller already has one in mind. */
  readonly variantId?: string;
  /** Genotype the edit would be applied on top of, for the assay baseline. */
  readonly baselineTendency: number;
  readonly author: string;
  /** Fixed clock so runs are reproducible. */
  readonly startedAt: number;
}

export interface PipelineRun {
  readonly id: string;
  readonly checks: readonly CheckRun[];
  readonly deltas: readonly Delta[];
  readonly screen: ScreenResult;
  readonly verdict: RunVerdict;
  /** Present only when the assay actually ran. */
  readonly metrics: SimMetrics | null;
  readonly plannedVariantId: string | null;
  /** Illustrative-model notice for whatever numbers this run produced. */
  readonly limitation: string | null;
}

/** The fixed pipeline, in the order SPEC §4.3 mandates. */
export const PIPELINE: readonly { readonly step: number; readonly agent: string; readonly kind: DeltaKind; readonly role: string }[] =
  Object.freeze([
    { step: 1, agent: 'IntentAgent', kind: 'intent', role: 'normalise free-text request into a structured intent' },
    { step: 2, agent: 'BiosafetyGateAgent', kind: 'screen', role: 'screen the intent before any downstream work' },
    { step: 3, agent: 'EditPlannerAgent', kind: 'edit_plan', role: 'resolve target locus + edit against data/loci.json' },
    { step: 4, agent: 'StructuralImpactAgent', kind: 'structural', role: 'amino-acid change → annotated structural consequence' },
    { step: 5, agent: 'FunctionalAssayAgent', kind: 'assay', role: 'run cellsim headless, return metrics' },
    { step: 6, agent: 'OffTargetRiskAgent', kind: 'offtarget', role: 'flag target against the sensitive-locus registry' },
    { step: 7, agent: 'VerifierAgent', kind: 'verdict', role: 'cross-check claims against measured sim output' },
  ]);

/** Deterministic pseudo-duration so timings look real but never change. */
function durationFor(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 40 + ((h >>> 0) % 460);
}

const WORD = /[a-z0-9']+/g;

/** Stress condition used for verification: well below the sickling onset. */
const STRESS_PO2 = 24;

function assayParams(tendency: number, pO2: number) {
  const d = SIMULATION.defaults;
  return {
    seed: d.seed,
    cellCount: d.cellCount,
    pO2,
    capillaryConstriction: d.capillaryConstriction,
    polymerizationTendency: tendency,
  };
}

/**
 * Run the seven-agent pipeline. Pure and deterministic: same input ⇒ same
 * checks, same deltas, same metrics.
 */
export function runPipeline(input: PipelineInput): PipelineRun {
  const dag = new DeltaDAG();
  const checks: CheckRun[] = [];
  let clock = input.startedAt;

  const emit = (
    step: number,
    status: CheckStatus,
    title: string,
    summary: string,
    payload: unknown,
    parents: string[],
  ): CheckRun => {
    const spec = PIPELINE[step - 1];
    const id = `${input.runId}.${step}`;
    const durationMs = durationFor(id);
    clock += durationMs;
    const delta = dag.add({
      id,
      kind: spec.kind,
      author: spec.agent,
      subject: input.runId,
      payload,
      parents,
      createdAt: clock,
    });
    const check: CheckRun = {
      id,
      step,
      agent: spec.agent,
      kind: spec.kind,
      status,
      title,
      summary,
      durationMs,
      deltaId: delta.id,
    };
    checks.push(check);
    return check;
  };

  const skip = (step: number, reason: string): void => {
    const spec = PIPELINE[step - 1];
    checks.push({
      id: `${input.runId}.${step}`,
      step,
      agent: spec.agent,
      kind: spec.kind,
      status: 'skipped',
      title: spec.agent,
      summary: reason,
      durationMs: 0,
      deltaId: null,
    });
  };

  // ── 1. IntentAgent ──────────────────────────────────────────────────────
  // Records ONLY derived facts. The request text is never put in a payload,
  // because this delta is written before the gate has decided anything.
  const words = input.requestText.toLowerCase().match(WORD) ?? [];
  const targets = input.targets.map((g) => g.trim().toUpperCase()).filter((g) => g.length > 0);
  const intent = emit(
    1,
    'pass',
    'Intent normalised',
    `Parsed a ${words.length}-token proposal naming ${targets.length} target ` +
      `${targets.length === 1 ? 'locus' : 'loci'}.`,
    {
      tokenCount: words.length,
      resolvedTargets: targets,
      // No request text here, by design (SPEC §7.3).
      note: 'Request text is not retained in the delta trail.',
    },
    [],
  );

  // ── 2. BiosafetyGateAgent ───────────────────────────────────────────────
  // Structurally second, before any locus is resolved or any number computed.
  const verdict: ScreenResult = screen({ text: input.requestText, targets });
  const gateStatus: CheckStatus =
    verdict.verdict === 'allow' ? 'pass' : verdict.verdict === 'escalate' ? 'escalated' : 'blocked';
  const gate = emit(
    2,
    gateStatus,
    `Biosafety gate — ${verdict.category}`,
    verdict.reason,
    {
      category: verdict.category,
      verdict: verdict.verdict,
      reason: verdict.reason,
      requiresSignoff: verdict.requiresSignoff,
      signoffRole: verdict.signoffRole ?? null,
      flaggedGenes: verdict.flaggedGenes,
      requestDigest: verdict.requestDigest,
      redacted: verdict.redacted,
    },
    [intent.id],
  );

  if (verdict.verdict === 'block') {
    // SPEC §7.4: a block ends the run. Nothing downstream is computed, so
    // there are no results to disclaim and nothing to "annotate".
    for (let step = 3; step <= 7; step += 1) {
      skip(step, 'Not executed — the run terminated at the biosafety gate.');
    }
    return {
      id: input.runId,
      checks,
      deltas: dag.all(),
      screen: verdict,
      verdict: 'blocked',
      metrics: null,
      plannedVariantId: null,
      limitation: null,
    };
  }

  // ── 3. EditPlannerAgent ─────────────────────────────────────────────────
  const gene = targets[0];
  const locus = gene === undefined ? undefined : getLocus(gene);
  const planned: LocusVariant | undefined =
    locus === undefined || input.variantId === undefined
      ? undefined
      : getVariant(locus, input.variantId);

  if (locus === undefined || planned === undefined) {
    emit(
      3,
      'fail',
      'No curated edit could be planned',
      locus === undefined
        ? 'The proposal did not resolve to a curated locus in data/loci.json.'
        : 'The proposal resolved a locus but no curated variant for it.',
      { resolvedLocus: locus?.gene ?? null, variantId: input.variantId ?? null },
      [gate.id],
    );
    for (let step = 4; step <= 7; step += 1) {
      skip(step, 'Not executed — no edit plan to evaluate.');
    }
    return {
      id: input.runId,
      checks,
      deltas: dag.all(),
      screen: verdict,
      verdict: 'fail',
      metrics: null,
      plannedVariantId: null,
      limitation: null,
    };
  }

  const plan = emit(
    3,
    'pass',
    `Edit planned at ${locus.gene} codon ${planned.codonIndex}`,
    `Resolved ${planned.label} against the curated ${locus.gene} reference ` +
      `(${locus.cdsReference.label}, ${locus.cdsReference.codonCount} codons modelled).`,
    {
      gene: locus.gene,
      variantId: planned.id,
      codonIndex: planned.codonIndex,
      refCodon: planned.refCodon,
      altCodon: planned.altCodon,
      kind: planned.kind,
      provenance: planned.provenance,
      hgvs: planned.hgvs ?? null,
    },
    [gate.id],
  );

  // ── 4. StructuralImpactAgent ────────────────────────────────────────────
  const structural = planned.structural;
  const silent = structural.refAa === structural.altAa;
  const structuralCheck = emit(
    4,
    'pass',
    silent
      ? `Synonymous at codon ${planned.codonIndex} — no residue change`
      : `${structural.refAaName} → ${structural.altAaName} at codon ${planned.codonIndex}`,
    structural.summary,
    {
      refAa: structural.refAa,
      altAa: structural.altAa,
      summary: structural.summary,
      consequence: structural.consequence,
      claimedPolymerizationTendency: structural.polymerizationTendency,
      confidence: structural.confidence,
      limitation: structural.limitation,
    },
    [plan.id],
  );

  // ── 5. FunctionalAssayAgent ─────────────────────────────────────────────
  // Measures the genotype the edit actually produces, not the edit's claim.
  const resultingTendency = input.baselineTendency;
  const atRest = runHeadless(assayParams(resultingTendency, SIMULATION.defaults.pO2));
  const underStress = runHeadless(assayParams(resultingTendency, STRESS_PO2));
  const assay = emit(
    5,
    'pass',
    `Assay complete — occlusion ${(underStress.occlusion * 100).toFixed(0)}% under stress`,
    `Headless cellsim at pO2 ${SIMULATION.defaults.pO2} and ${STRESS_PO2} ${SIMULATION.pO2.unit}. ` +
      `Illustrative model, not validated haemorheology.`,
    {
      resultingPolymerizationTendency: resultingTendency,
      atRest,
      underStress,
      stressPO2: STRESS_PO2,
      limitation:
        'Illustrative particle model. Parameters were chosen for legibility and ' +
        'are not calibrated against experimental haemorheology.',
    },
    [plan.id],
  );

  // ── 6. OffTargetRiskAgent ───────────────────────────────────────────────
  const flagged = targets
    .map((g) => lookupLocus(g))
    .filter((l): l is NonNullable<typeof l> => l !== undefined);
  const sensitive = flagged.filter((l) => l.classification !== 'therapeutic_target');
  const offtarget = emit(
    6,
    sensitive.length > 0 ? 'fail' : 'pass',
    sensitive.length > 0
      ? `${sensitive.length} target(s) on the sensitive-locus registry`
      : 'No targets on the sensitive-locus registry',
    sensitive.length > 0
      ? sensitive.map((l) => `${l.gene}: ${l.classification}`).join('; ')
      : `Checked ${targets.length || 0} target(s) against the curated registry; ` +
        `${flagged.map((l) => l.gene).join(', ') || 'none'} matched, all therapeutic-target class.`,
    {
      checked: targets,
      matched: flagged.map((l) => ({ gene: l.gene, classification: l.classification, note: l.note })),
      sensitive: sensitive.map((l) => l.gene),
    },
    [plan.id],
  );

  // ── 7. VerifierAgent ────────────────────────────────────────────────────
  // Reads the measured numbers, not the other agents' prose. It must be able
  // to fail an edit that step 4 was optimistic about — and it does: a
  // synonymous edit layered on a pathogenic allele claims "no change" while
  // the assay still measures a sickling genotype.
  const claimed = structural.polymerizationTendency;
  const measuredSickling = underStress.sickledFraction;
  const impliedBound = claimed + 0.25;
  const inconsistent = measuredSickling > impliedBound;
  const disagreements: string[] = [];
  if (inconsistent) {
    disagreements.push(
      `Structural annotation claims a polymerization tendency of ${claimed.toFixed(2)}, ` +
        `but the assay measured a sickled fraction of ${measuredSickling.toFixed(2)} at ` +
        `pO2 ${STRESS_PO2} ${SIMULATION.pO2.unit}. The edit does not remove the ` +
        `pathogenic codon from the resulting genotype.`,
    );
  }
  if (sensitive.length > 0) {
    disagreements.push(
      `Off-target review flagged ${sensitive.map((l) => l.gene).join(', ')} as sensitive.`,
    );
  }

  const failed = disagreements.length > 0;
  const escalated = verdict.verdict === 'escalate';
  const verifier = emit(
    7,
    failed ? 'fail' : escalated ? 'escalated' : 'pass',
    failed
      ? 'Verification failed — claims contradict measurement'
      : escalated
        ? 'Claims consistent, but the gate escalated this proposal'
        : 'Verification passed — claims match measurement',
    failed
      ? disagreements.join(' ')
      : escalated
        ? `Measured output is consistent with the structural claim, but the biosafety ` +
          `gate returned ${verdict.category}; a human sign-off is required before merge.`
        : `Measured sickled fraction ${measuredSickling.toFixed(2)} is consistent with the ` +
          `claimed polymerization tendency ${claimed.toFixed(2)}.`,
    {
      claimedPolymerizationTendency: claimed,
      measuredSickledFraction: measuredSickling,
      measuredOcclusion: underStress.occlusion,
      consistencyBound: impliedBound,
      disagreements,
      gateCategory: verdict.category,
    },
    // Parents include the claims it is checking: disagreement forks the record.
    [structuralCheck.id, assay.id, offtarget.id],
  );
  void verifier;

  const runVerdict: RunVerdict = failed ? 'fail' : escalated ? 'escalated' : 'pass';

  return {
    id: input.runId,
    checks,
    deltas: dag.all(),
    screen: verdict,
    verdict: runVerdict,
    metrics: underStress,
    plannedVariantId: planned.id,
    limitation:
      'Structural consequence is a textbook teaching summary, not a ' +
      'structure-prediction output. Simulation metrics come from an ' +
      'illustrative particle model that is not calibrated against ' +
      'experimental haemorheology.',
  };
}

export interface Signoff {
  readonly runId: string;
  readonly role: string;
  readonly by: string;
  readonly at: number;
}

/**
 * May this run's commit be merged?
 *
 * SPEC §7.5: an `escalate` never auto-clears. It needs an explicit signoff
 * whose role matches the one the policy named. A `block` is never mergeable,
 * and no signoff can override it.
 */
export function isMergeable(
  run: Pick<PipelineRun, 'verdict' | 'id' | 'screen'>,
  signoffs: readonly Signoff[] = [],
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (run.verdict === 'blocked') {
    return {
      ok: false,
      reason: `Refused at the biosafety gate (${run.screen.category}). This cannot be signed off.`,
    };
  }
  if (run.verdict === 'fail') {
    return { ok: false, reason: 'A required check failed. Merge is blocked until it passes.' };
  }
  if (run.verdict === 'escalated') {
    const required = run.screen.signoffRole;
    if (required === undefined) {
      return { ok: false, reason: 'Escalated proposals require a named human sign-off.' };
    }
    const match = signoffs.find((s) => s.runId === run.id && s.role === required);
    if (match === undefined) {
      return {
        ok: false,
        reason: `Escalated by policy (${run.screen.category}). Requires sign-off by ${required}.`,
      };
    }
    return { ok: true };
  }
  return { ok: true };
}

/** Record a human sign-off as a delta, so the clearance itself is auditable. */
export function signoffDelta(signoff: Signoff, parentDeltaId: string): Delta {
  return {
    id: `${signoff.runId}.signoff`,
    kind: 'signoff',
    author: signoff.by,
    subject: signoff.runId,
    payload: { role: signoff.role, by: signoff.by, at: signoff.at },
    parents: [parentDeltaId],
    createdAt: signoff.at,
  };
}

export type { PolicyCategory, ScreenResult, Verdict, SimMetrics };
