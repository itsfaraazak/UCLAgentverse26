// TEMP STUB — replaced at integration. Signatures must match SPEC.md §4.
//
// Append-only DAG of attributed deltas plus the seven-agent pipeline.
// Deterministic and LLM-free. The biosafety gate is agent 2 and a `block`
// verdict terminates the run — see SPEC.md §4.3 and §7.4.

import lociData from '@/data/loci.json';
import { applyVariant, codons, translate, type Sequence, type Variant } from '@/lib/genome';
import { CellSim, type SimMetrics } from '@/lib/cellsim';
import { digestRequest, screen, passesGate, type ScreenResult } from '@/lib/safety/policy';

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

export class DeltaDAG {
  private readonly deltas = new Map<string, Delta>();
  private seq = 0;

  add(d: Omit<Delta, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): Delta {
    this.seq += 1;
    const delta: Delta = {
      id: d.id ?? `d${String(this.seq).padStart(3, '0')}`,
      kind: d.kind,
      author: d.author,
      subject: d.subject,
      payload: d.payload,
      parents: d.parents,
      createdAt: d.createdAt ?? this.seq,
    };
    this.deltas.set(delta.id, delta);
    return delta;
  }

  get(id: string): Delta {
    const delta = this.deltas.get(id);
    if (delta === undefined) throw new Error(`unknown delta: ${id}`);
    return delta;
  }

  all(): Delta[] {
    return [...this.deltas.values()];
  }

  history(id: string): Delta[] {
    const out: Delta[] = [];
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (cur === undefined || seen.has(cur)) continue;
      seen.add(cur);
      const delta = this.deltas.get(cur);
      if (delta === undefined) continue;
      out.push(delta);
      stack.push(...delta.parents);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }
}

// ── Fixture access ───────────────────────────────────────────────────────────

export type Provenance = 'public-reference' | 'synthetic-illustrative';

export interface LocusExon {
  index: number;
  label: string;
  codonStart: number;
  codonEnd: number;
  note: string;
}

export interface StructuralAnnotation {
  refAa: string;
  altAa: string;
  refAaName: string;
  altAaName: string;
  summary: string;
  consequence: string;
  polymerizationTendency: number;
  confidence: string;
  limitation: string;
}

export interface LocusVariant {
  id: string;
  provenance: Provenance;
  label: string;
  hgvs?: string;
  proteinHgvs?: string;
  legacyName?: string;
  numberingNote?: string;
  codonIndex: number;
  refCodon: string;
  altCodon: string;
  kind: 'substitution' | 'deletion' | 'insertion';
  structural: StructuralAnnotation;
}

export interface LocusGenotype {
  id: string;
  label: string;
  appliedVariants: string[];
  polymerizationTendency: number;
}

export interface Locus {
  gene: string;
  provenance: Provenance;
  name: string;
  chromosome: string;
  note: string;
  cdsReference: { label: string; startCodon: number; codonCount: number; bases: string };
  exons: LocusExon[];
  variants: LocusVariant[];
  genotypes: LocusGenotype[];
}

export interface SimulationFixture {
  defaults: {
    seed: number;
    cellCount: number;
    pO2: number;
    capillaryConstriction: number;
  };
  pO2: { min: number; max: number; unit: string; label: string; sicklingOnsetBelow: number };
}

interface LociFile {
  loci: Locus[];
  simulation: SimulationFixture;
}

const FIXTURES = lociData as unknown as LociFile;

export function loadLoci(): readonly Locus[] {
  return FIXTURES.loci;
}

export function getLocus(gene: string): Locus | undefined {
  return FIXTURES.loci.find((l) => l.gene.toUpperCase() === gene.trim().toUpperCase());
}

export function simulationFixture(): SimulationFixture {
  return FIXTURES.simulation;
}

export function toVariant(locus: Locus, v: LocusVariant): Variant {
  return {
    gene: locus.gene,
    codonIndex: v.codonIndex,
    refCodon: v.refCodon,
    altCodon: v.altCodon,
    kind: v.kind,
    label: v.label,
  };
}

export function referenceSequence(locus: Locus): Sequence {
  return { bases: locus.cdsReference.bases, label: locus.cdsReference.label };
}

export function sequenceForGenotype(locus: Locus, genotypeId: string): Sequence {
  const genotype = locus.genotypes.find((g) => g.id === genotypeId);
  let seq = referenceSequence(locus);
  if (genotype === undefined) return seq;
  for (const variantId of genotype.appliedVariants) {
    const variant = locus.variants.find((v) => v.id === variantId);
    if (variant === undefined) continue;
    seq = applyVariant(seq, toVariant(locus, variant));
  }
  return { bases: seq.bases, label: genotype.label };
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

export type StepStatus = 'pass' | 'fail' | 'blocked' | 'escalated' | 'skipped';
export type RunVerdict = 'pass' | 'fail' | 'blocked' | 'escalated';

export interface CheckStep {
  readonly index: number;
  readonly agent: string;
  readonly kind: DeltaKind;
  readonly status: StepStatus;
  /** Generic, never templated with refused request text. */
  readonly summary: string;
  readonly durationMs: number;
  readonly deltaId: string | null;
}

export interface Intent {
  readonly gene: string;
  readonly genotypeId: string;
  /** sha256 prefix only — the request text itself is not retained here. */
  readonly requestDigest: string;
}

export interface CheckRun {
  readonly id: string;
  readonly steps: readonly CheckStep[];
  readonly verdict: RunVerdict;
  readonly screenResult: ScreenResult;
  readonly intent: Intent;
  readonly deltas: readonly Delta[];
  readonly metrics: SimMetrics | null;
  readonly stressPO2: number;
  readonly requiresSignoff: boolean;
  readonly signoffRole: string | null;
  readonly structuralClaim: string | null;
  readonly verifierNotes: readonly string[];
}

export interface PipelineRequest {
  readonly text: string;
  readonly gene: string;
  readonly genotypeId: string;
  readonly author?: string;
}

const STRESS_TICKS = 900;
/** Metric thresholds the verifier holds the other agents to. */
export const VERIFIER_THRESHOLDS = Object.freeze({
  maxOcclusion: 0.25,
  maxSickledFraction: 0.2,
  minMeanFlowRatio: 0.6,
});

export class IntentAgent {
  static readonly agentName = 'IntentAgent';
  run(req: PipelineRequest): Intent {
    return {
      gene: req.gene.trim().toUpperCase(),
      genotypeId: req.genotypeId,
      requestDigest: digestRequest(req.text),
    };
  }
}

export class BiosafetyGateAgent {
  static readonly agentName = 'BiosafetyGateAgent';
  run(req: PipelineRequest, intent: Intent): ScreenResult {
    return screen({ text: req.text, targets: [intent.gene] });
  }
}

export class EditPlannerAgent {
  static readonly agentName = 'EditPlannerAgent';
  run(intent: Intent): { locus: Locus; genotype: LocusGenotype; edits: LocusVariant[] } | null {
    const locus = getLocus(intent.gene);
    if (locus === undefined) return null;
    const genotype = locus.genotypes.find((g) => g.id === intent.genotypeId);
    if (genotype === undefined) return null;
    const edits = genotype.appliedVariants
      .map((id) => locus.variants.find((v) => v.id === id))
      .filter((v): v is LocusVariant => v !== undefined);
    return { locus, genotype, edits };
  }
}

export class StructuralImpactAgent {
  static readonly agentName = 'StructuralImpactAgent';
  run(edits: readonly LocusVariant[]): { claim: string; tendency: number } {
    if (edits.length === 0) {
      return { claim: 'Reference allele; no amino-acid change to annotate.', tendency: 0 };
    }
    const last = edits[edits.length - 1];
    return { claim: last.structural.consequence, tendency: last.structural.polymerizationTendency };
  }
}

export class FunctionalAssayAgent {
  static readonly agentName = 'FunctionalAssayAgent';
  run(tendency: number, stressPO2: number): SimMetrics {
    const { defaults } = simulationFixture();
    const sim = new CellSim({
      seed: defaults.seed,
      cellCount: defaults.cellCount,
      pO2: stressPO2,
      polymerizationTendency: tendency,
      capillaryConstriction: defaults.capillaryConstriction,
    });
    const final = sim.run(STRESS_TICKS);
    return {
      occlusion: final.occlusion,
      meanFlow: final.meanFlow,
      sickledFraction: final.sickledFraction,
    };
  }
}

export class OffTargetRiskAgent {
  static readonly agentName = 'OffTargetRiskAgent';
  run(intent: Intent): ScreenResult {
    return screen({ text: 'locus registry check', targets: [intent.gene] });
  }
}

export class VerifierAgent {
  static readonly agentName = 'VerifierAgent';
  /**
   * Reads the measured metrics, not the other agents' prose. Can fail an edit
   * that the structural or assay agent was optimistic about.
   */
  run(
    metrics: SimMetrics,
    baseline: SimMetrics,
    claimedTendency: number,
  ): { pass: boolean; notes: string[] } {
    const notes: string[] = [];
    const flowRatio = baseline.meanFlow > 0 ? metrics.meanFlow / baseline.meanFlow : 1;
    let pass = true;

    if (metrics.occlusion > VERIFIER_THRESHOLDS.maxOcclusion) {
      pass = false;
      notes.push(
        `Measured occlusion ${metrics.occlusion.toFixed(3)} exceeds the ` +
          `${VERIFIER_THRESHOLDS.maxOcclusion} ceiling under oxygen stress.`,
      );
    }
    if (metrics.sickledFraction > VERIFIER_THRESHOLDS.maxSickledFraction) {
      pass = false;
      notes.push(
        `Sickled fraction ${metrics.sickledFraction.toFixed(3)} exceeds the ` +
          `${VERIFIER_THRESHOLDS.maxSickledFraction} ceiling under oxygen stress.`,
      );
    }
    if (flowRatio < VERIFIER_THRESHOLDS.minMeanFlowRatio) {
      pass = false;
      notes.push(
        `Mean flow is ${(flowRatio * 100).toFixed(1)}% of the reference allele, below the ` +
          `${VERIFIER_THRESHOLDS.minMeanFlowRatio * 100}% floor.`,
      );
    }
    if (claimedTendency < 0.2 && metrics.sickledFraction > VERIFIER_THRESHOLDS.maxSickledFraction) {
      notes.push(
        'Structural annotation predicted low polymerization tendency; the measured ' +
          'simulation disagrees. Cross-check failed.',
      );
    }
    if (pass) {
      notes.push(
        `Measured metrics are within every threshold (occlusion ` +
          `${metrics.occlusion.toFixed(3)}, sickled fraction ` +
          `${metrics.sickledFraction.toFixed(3)}, flow ${(flowRatio * 100).toFixed(1)}% of reference).`,
      );
    }
    return { pass, notes };
  }
}

function now(): number {
  return typeof performance === 'object' ? performance.now() : 0;
}

/**
 * Run the fixed seven-agent pipeline. The gate is agent 2; a `block` verdict
 * terminates the run and every later step is reported as `skipped`.
 *
 * Nothing derived from `req.text` is written into a delta payload other than
 * its digest, so refused input cannot reach the audit trail.
 */
export function runPipeline(req: PipelineRequest, stressPO2 = 20): CheckRun {
  const dag = new DeltaDAG();
  const steps: CheckStep[] = [];
  const runId = `run-${digestRequest(`${req.gene}:${req.genotypeId}:${req.text}`).slice(0, 8)}`;

  const record = (
    index: number,
    agent: string,
    kind: DeltaKind,
    status: StepStatus,
    summary: string,
    durationMs: number,
    deltaId: string | null,
  ): void => {
    steps.push({ index, agent, kind, status, summary, durationMs, deltaId });
  };

  const skipRest = (fromIndex: number, reason: string): void => {
    const remaining: Array<[number, string, DeltaKind]> = [
      [3, EditPlannerAgent.agentName, 'edit_plan'],
      [4, StructuralImpactAgent.agentName, 'structural'],
      [5, FunctionalAssayAgent.agentName, 'assay'],
      [6, OffTargetRiskAgent.agentName, 'offtarget'],
      [7, VerifierAgent.agentName, 'verdict'],
    ];
    for (const [index, agent, kind] of remaining) {
      if (index < fromIndex) continue;
      record(index, agent, kind, 'skipped', reason, 0, null);
    }
  };

  // 1. Intent
  let t = now();
  const intent = new IntentAgent().run(req);
  const intentDelta = dag.add({
    kind: 'intent',
    author: IntentAgent.agentName,
    subject: `${intent.gene}:${intent.genotypeId}`,
    payload: { gene: intent.gene, genotypeId: intent.genotypeId, requestDigest: intent.requestDigest },
    parents: [],
  });
  record(
    1,
    IntentAgent.agentName,
    'intent',
    'pass',
    `Normalised to target ${intent.gene}, genotype ${intent.genotypeId}. Request digest ${intent.requestDigest}.`,
    now() - t,
    intentDelta.id,
  );

  // 2. Biosafety gate — structural, before any downstream work.
  t = now();
  const screenResult = new BiosafetyGateAgent().run(req, intent);
  const screenDelta = dag.add({
    kind: 'screen',
    author: BiosafetyGateAgent.agentName,
    subject: screenResult.category,
    // Category, reason and digest only. Never the request text.
    payload: {
      category: screenResult.category,
      verdict: screenResult.verdict,
      reason: screenResult.reason,
      flaggedGenes: screenResult.flaggedGenes,
      requestDigest: screenResult.requestDigest,
      redacted: screenResult.redacted,
    },
    parents: [intentDelta.id],
  });
  const gateStatus: StepStatus =
    screenResult.verdict === 'block'
      ? 'blocked'
      : screenResult.verdict === 'escalate'
        ? 'escalated'
        : 'pass';
  record(
    2,
    BiosafetyGateAgent.agentName,
    'screen',
    gateStatus,
    `${screenResult.category} → ${screenResult.verdict}. ${screenResult.reason}`,
    now() - t,
    screenDelta.id,
  );

  if (!passesGate(screenResult)) {
    const reason =
      screenResult.verdict === 'block'
        ? 'Not run: the biosafety gate blocked this request.'
        : 'Not run: the biosafety gate escalated this request for human review.';
    skipRest(3, reason);
    return {
      id: runId,
      steps,
      verdict: screenResult.verdict === 'block' ? 'blocked' : 'escalated',
      screenResult,
      intent,
      deltas: dag.all(),
      metrics: null,
      stressPO2,
      requiresSignoff: screenResult.requiresSignoff,
      signoffRole: screenResult.signoffRole ?? null,
      structuralClaim: null,
      verifierNotes: [],
    };
  }

  // 3. Edit planner
  t = now();
  const plan = new EditPlannerAgent().run(intent);
  if (plan === null) {
    record(
      3,
      EditPlannerAgent.agentName,
      'edit_plan',
      'fail',
      'No curated locus or genotype could be resolved from the intent.',
      now() - t,
      null,
    );
    skipRest(4, 'Not run: no resolved edit plan.');
    return {
      id: runId,
      steps,
      verdict: 'fail',
      screenResult,
      intent,
      deltas: dag.all(),
      metrics: null,
      stressPO2,
      requiresSignoff: false,
      signoffRole: null,
      structuralClaim: null,
      verifierNotes: [],
    };
  }
  const planDelta = dag.add({
    kind: 'edit_plan',
    author: EditPlannerAgent.agentName,
    subject: `${plan.locus.gene} ${plan.genotype.label}`,
    payload: {
      gene: plan.locus.gene,
      genotype: plan.genotype.id,
      edits: plan.edits.map((e) => ({
        id: e.id,
        codonIndex: e.codonIndex,
        refCodon: e.refCodon,
        altCodon: e.altCodon,
        provenance: e.provenance,
      })),
    },
    parents: [screenDelta.id],
  });
  const seq = sequenceForGenotype(plan.locus, plan.genotype.id);
  record(
    3,
    EditPlannerAgent.agentName,
    'edit_plan',
    'pass',
    `Resolved ${plan.locus.gene} ${plan.genotype.label}: ${plan.edits.length} edit(s) over ` +
      `${codons(seq.bases).length} codons, protein length ${translate(seq.bases).length}.`,
    now() - t,
    planDelta.id,
  );

  // 4. Structural impact
  t = now();
  const structural = new StructuralImpactAgent().run(plan.edits);
  const structuralDelta = dag.add({
    kind: 'structural',
    author: StructuralImpactAgent.agentName,
    subject: plan.genotype.label,
    payload: {
      claim: structural.claim,
      polymerizationTendency: structural.tendency,
      limitation: 'Illustrative teaching annotation, not a structure-prediction result.',
    },
    parents: [planDelta.id],
  });
  record(
    4,
    StructuralImpactAgent.agentName,
    'structural',
    'pass',
    `Annotated polymerization tendency ${structural.tendency.toFixed(2)} (illustrative).`,
    now() - t,
    structuralDelta.id,
  );

  // 5. Functional assay — headless cellsim
  t = now();
  const assay = new FunctionalAssayAgent();
  const metrics = assay.run(plan.genotype.polymerizationTendency, stressPO2);
  const baseline = assay.run(0, stressPO2);
  const assayDelta = dag.add({
    kind: 'assay',
    author: FunctionalAssayAgent.agentName,
    subject: `pO2 ${stressPO2} mmHg, ${STRESS_TICKS} ticks`,
    payload: { metrics, baseline, stressPO2, ticks: STRESS_TICKS },
    parents: [structuralDelta.id],
  });
  record(
    5,
    FunctionalAssayAgent.agentName,
    'assay',
    'pass',
    `Occlusion ${metrics.occlusion.toFixed(3)}, sickled fraction ` +
      `${metrics.sickledFraction.toFixed(3)}, mean flow ${metrics.meanFlow.toExponential(2)}.`,
    now() - t,
    assayDelta.id,
  );

  // 6. Off-target / sensitive-locus registry
  t = now();
  const offtarget = new OffTargetRiskAgent().run(intent);
  const offtargetDelta = dag.add({
    kind: 'offtarget',
    author: OffTargetRiskAgent.agentName,
    subject: offtarget.category,
    payload: {
      category: offtarget.category,
      verdict: offtarget.verdict,
      flaggedGenes: offtarget.flaggedGenes,
    },
    parents: [assayDelta.id],
  });
  const offtargetStatus: StepStatus = offtarget.verdict === 'allow' ? 'pass' : 'fail';
  record(
    6,
    OffTargetRiskAgent.agentName,
    'offtarget',
    offtargetStatus,
    `Registry check on ${intent.gene}: ${offtarget.category}.`,
    now() - t,
    offtargetDelta.id,
  );

  // 7. Verifier — reads the measured numbers, not the prose
  t = now();
  const verified = new VerifierAgent().run(metrics, baseline, structural.tendency);
  const verdictDelta = dag.add({
    kind: 'verdict',
    author: VerifierAgent.agentName,
    subject: verified.pass ? 'pass' : 'fail',
    payload: { pass: verified.pass, notes: verified.notes, thresholds: VERIFIER_THRESHOLDS },
    parents: [offtargetDelta.id, structuralDelta.id],
  });
  record(
    7,
    VerifierAgent.agentName,
    'verdict',
    verified.pass && offtargetStatus === 'pass' ? 'pass' : 'fail',
    verified.notes.join(' '),
    now() - t,
    verdictDelta.id,
  );

  const overall: RunVerdict = verified.pass && offtargetStatus === 'pass' ? 'pass' : 'fail';

  return {
    id: runId,
    steps,
    verdict: overall,
    screenResult,
    intent,
    deltas: dag.all(),
    metrics,
    stressPO2,
    requiresSignoff: false,
    signoffRole: null,
    structuralClaim: structural.claim,
    verifierNotes: verified.notes,
  };
}

/** Merge is permitted only on a clean pass. Escalations need a human signoff. */
export function mayMerge(run: CheckRun, signedOff: boolean): boolean {
  if (run.verdict === 'pass') return true;
  if (run.verdict === 'escalated') return signedOff;
  return false;
}
