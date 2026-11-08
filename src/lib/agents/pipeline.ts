import { lookupLocus, screen } from '@/lib/safety/policy';
import {
  ASSAY_MODEL_LIMITATION,
  CHALLENGE_STEPS,
  PO2_RANGE,
  SIMULATION_DEFAULTS,
  runAssay,
} from '@/lib/cellsim';
import type { AcmgVariantRecord } from '@/lib/acmg/registry';
import {
  ACMG_RECLASSIFICATION_SIGNOFF_ROLE,
  AcmgClassificationAgent,
  ClassificationConflictAgent,
  TherapyLookupAgent,
  classifyPlan,
  conflictFromClassification,
  therapyFromClassification,
} from './classification';
import { DeltaDAG } from './dag';
import {
  allLoci,
  escapeRegExp,
  findGenotype,
  findLocus,
  findVariant,
  knownGeneSymbols,
  referenceGenotype,
} from './fixtures';
import type {
  AssayAssessment,
  AssayPayload,
  ConflictPayload,
  Delta,
  EditPlanPayload,
  IntentPayload,
  OffTargetPayload,
  PipelineInput,
  PipelineResult,
  RequestedOperation,
  ScreenPayload,
  StructuralPayload,
  VerdictPayload,
} from './types';
import {
  isAssayPayload,
  isConflictPayload,
  isEditPlanPayload,
  isIntentPayload,
  isScreenPayload,
  isStructuralPayload,
  isVerdictPayload,
} from './types';

const POLY_PATHOGENIC = 0.3;
const OCCLUSION_MARGIN = 0.12;
const SICKLED_MARGIN = 0.2;
const NAIVE_OCCLUSION_PASS = 0.25;

export const IntentAgent = { name: 'IntentAgent' } as const;
export const BiosafetyGateAgent = { name: 'BiosafetyGateAgent' } as const;
export const EditPlannerAgent = { name: 'EditPlannerAgent' } as const;
export const StructuralImpactAgent = { name: 'StructuralImpactAgent' } as const;
export const FunctionalAssayAgent = { name: 'FunctionalAssayAgent' } as const;
export const OffTargetRiskAgent = { name: 'OffTargetRiskAgent' } as const;
export const VerifierAgent = { name: 'VerifierAgent' } as const;

const AGENT_ORDER = [
  IntentAgent.name,
  BiosafetyGateAgent.name,
  EditPlannerAgent.name,
  StructuralImpactAgent.name,
  FunctionalAssayAgent.name,
  OffTargetRiskAgent.name,
  VerifierAgent.name,
] as const;

export function pipelineAgentOrder(): readonly string[] {
  return AGENT_ORDER;
}

const CLASSIFIED_AGENT_ORDER = [
  IntentAgent.name,
  BiosafetyGateAgent.name,
  EditPlannerAgent.name,
  StructuralImpactAgent.name,
  FunctionalAssayAgent.name,
  OffTargetRiskAgent.name,
  AcmgClassificationAgent.name,
  ClassificationConflictAgent.name,
  VerifierAgent.name,
  TherapyLookupAgent.name,
] as const;

/** Order with `classify: true`. The gate is still second. */
export function classifiedPipelineAgentOrder(): readonly string[] {
  return CLASSIFIED_AGENT_ORDER;
}

export function parseIntent(text: string): IntentPayload {
  const targets = resolveTargets(text);
  return {
    targets,
    operation: parseOperation(text),
    variantHint: resolveVariantHint(text),
  };
}

function resolveTargets(text: string): string[] {
  const found = new Set<string>();
  const genes = knownGeneSymbols();
  for (let i = 0; i < genes.length; i += 1) {
    const gene = genes[i];
    if (gene === undefined) continue;
    const re = new RegExp(`\\b${escapeRegExp(gene)}\\b`, 'i');
    if (re.test(text)) found.add(gene);
  }
  const hint = resolveVariantHint(text);
  if (hint) {
    for (const locus of allLoci()) {
      if (locus.variants.some((v) => v.id === hint)) {
        found.add(locus.gene.toUpperCase());
      }
    }
  }
  return [...found].sort();
}

function parseOperation(text: string): RequestedOperation {
  const t = text.toLowerCase();
  if (/\b(silent|synonymous)\b/.test(t)) return 'silent';
  if (/\b(repair|correct|restore|revert|fix)\b/.test(t)) return 'repair';
  if (/\b(knock\s*out|disrupt|delete|ablate)\b/.test(t)) return 'disrupt';
  if (/\b(hbs|sickle|glu6val|glu7val|\be6v\b|introduce)\b/.test(t)) return 'introduce';
  return 'unresolved';
}

function resolveVariantHint(text: string): string | null {
  const t = text.toLowerCase();
  for (const locus of allLoci()) {
    for (const variant of locus.variants) {
      if (t.includes(variant.id.toLowerCase())) return variant.id;
      if (variant.hgvs && t.includes(variant.hgvs.toLowerCase())) return variant.id;
      if (variant.proteinHgvs && t.includes(variant.proteinHgvs.toLowerCase())) {
        return variant.id;
      }
      if (variant.legacyName) {
        const parts = variant.legacyName.split(/[/,()]/);
        for (let i = 0; i < parts.length; i += 1) {
          const part = parts[i];
          if (part === undefined) continue;
          const needle = part.trim().toLowerCase();
          if (needle.length >= 3 && t.includes(needle)) return variant.id;
        }
      }
      if (/\bhbs\b/.test(t) && /\bhbs\b/i.test(variant.label)) return variant.id;
      if (/\bsickle\b/.test(t) && /\bsickle\b/i.test(variant.label)) return variant.id;
    }
  }
  return null;
}

export function planEdit(intent: IntentPayload): EditPlanPayload {
  const unresolved = (note: string): EditPlanPayload => ({
    resolved: false,
    gene: null,
    variantId: null,
    variantLabel: null,
    genotypeId: null,
    genotypeLabel: null,
    codonIndex: null,
    refCodon: null,
    altCodon: null,
    kind: null,
    polymerizationTendency: null,
    note,
  });

  const gene = firstCuratedGene(intent.targets);
  if (gene === undefined) {
    return unresolved('No curated locus in data/loci.json matched the parsed targets.');
  }
  const locus = findLocus(gene);
  if (locus === undefined) {
    return unresolved('No curated locus in data/loci.json matched the parsed targets.');
  }

  if (intent.operation === 'silent') {
    const silent = locus.variants.find((v) => v.structural.refAa === v.structural.altAa);
    if (silent) {
      return planFromVariant(locus.gene, silent, genotypeForOrFromVariant(locus, silent));
    }
  }

  if (intent.operation === 'repair') {
    const repaired = findGenotype(locus, 'repaired') ?? locus.genotypes.find((g) => /repair/i.test(g.id));
    const variant =
      (repaired && lastApplied(locus, repaired)) ||
      findVariant(locus, 'HBB_repair') ||
      locus.variants.find((v) => /repair/i.test(v.id));
    if (repaired && variant) {
      return planFromVariant(locus.gene, variant, repaired);
    }
  }

  if (intent.operation === 'introduce' || intent.variantHint) {
    const hinted = intent.variantHint ? findVariant(locus, intent.variantHint) : undefined;
    const sickleGeno = findGenotype(locus, 'sickle');
    const variant = hinted ?? (sickleGeno ? lastApplied(locus, sickleGeno) : undefined);
    const genotype =
      (variant && genotypeForVariants(locus, [variant.id])) ?? sickleGeno;
    if (variant && genotype) {
      return planFromVariant(locus.gene, variant, genotype);
    }
  }

  const repaired = findGenotype(locus, 'repaired');
  const repairVariant = findVariant(locus, 'HBB_repair') ?? lastApplied(locus, repaired);
  if (repaired && repairVariant) {
    return planFromVariant(locus.gene, repairVariant, repaired);
  }

  const firstVariant = locus.variants[0];
  const firstGeno = locus.genotypes[0];
  if (firstVariant && firstGeno) {
    return planFromVariant(locus.gene, firstVariant, firstGeno);
  }
  return unresolved(`Locus ${locus.gene} has no curated variant to plan.`);
}

function firstCuratedGene(targets: readonly string[]): string | undefined {
  for (let i = 0; i < targets.length; i += 1) {
    const gene = targets[i];
    if (gene !== undefined && findLocus(gene)) return gene;
  }
  return undefined;
}

function lastApplied(
  locus: ReturnType<typeof findLocus>,
  genotype: { appliedVariants: readonly string[] } | undefined,
) {
  if (!locus || !genotype || genotype.appliedVariants.length === 0) return undefined;
  const lastId = genotype.appliedVariants[genotype.appliedVariants.length - 1];
  if (lastId === undefined) return undefined;
  return findVariant(locus, lastId);
}

function genotypeForVariants(
  locus: NonNullable<ReturnType<typeof findLocus>>,
  variantIds: readonly string[],
) {
  const key = variantIds.join(',');
  return locus.genotypes.find((g) => g.appliedVariants.join(',') === key);
}

function genotypeForOrFromVariant(
  locus: NonNullable<ReturnType<typeof findLocus>>,
  variant: NonNullable<ReturnType<typeof findVariant>>,
): { id: string; label: string; polymerizationTendency: number } {
  const found = genotypeForVariants(locus, [variant.id]);
  if (found) return found;
  return {
    id: variant.id,
    label: variant.label,
    polymerizationTendency: variant.structural.polymerizationTendency,
  };
}

function planFromVariant(
  gene: string,
  variant: NonNullable<ReturnType<typeof findVariant>>,
  genotype: { id: string; label: string; polymerizationTendency: number },
): EditPlanPayload {
  return {
    resolved: true,
    gene,
    variantId: variant.id,
    variantLabel: variant.label,
    genotypeId: genotype.id,
    genotypeLabel: genotype.label,
    codonIndex: variant.codonIndex,
    refCodon: variant.refCodon,
    altCodon: variant.altCodon,
    kind: variant.kind,
    polymerizationTendency: genotype.polymerizationTendency,
    note: `Resolved ${gene} against data/loci.json.`,
  };
}

export function structuralFromPlan(plan: EditPlanPayload): StructuralPayload {
  const missing = (limitation: string): StructuralPayload => ({
    sourcedFromFixture: false,
    variantId: plan.variantId,
    refAa: null,
    altAa: null,
    refAaName: null,
    altAaName: null,
    summary: 'No curated structural annotation is available for this plan.',
    consequence: 'No structural claim is made.',
    polymerizationTendency: null,
    confidence: null,
    limitation,
  });
  if (!plan.resolved || plan.gene === null || plan.variantId === null) {
    return missing('Planner did not resolve a curated variant; nothing is fabricated.');
  }
  const locus = findLocus(plan.gene);
  const variant = locus ? findVariant(locus, plan.variantId) : undefined;
  if (!variant) {
    return missing('The planned variant is not in the fixture; nothing is fabricated.');
  }
  const s = variant.structural;
  return {
    sourcedFromFixture: true,
    variantId: variant.id,
    refAa: s.refAa,
    altAa: s.altAa,
    refAaName: s.refAaName,
    altAaName: s.altAaName,
    summary: s.summary,
    consequence: s.consequence,
    polymerizationTendency: s.polymerizationTendency,
    confidence: s.confidence,
    limitation: s.limitation,
  };
}

export function runFunctionalAssay(
  plan: EditPlanPayload,
  opts: { pO2: number; seed: number; steps: number },
): AssayPayload {
  if (!plan.resolved || plan.polymerizationTendency === null) {
    return {
      ran: false,
      params: null,
      metrics: null,
      assessment: 'unresolved',
      limitation: ASSAY_MODEL_LIMITATION,
    };
  }
  const params = {
    polymerizationTendency: plan.polymerizationTendency,
    pO2: opts.pO2,
    seed: opts.seed,
    cellCount: SIMULATION_DEFAULTS.cellCount,
    capillaryConstriction: SIMULATION_DEFAULTS.capillaryConstriction,
  };
  const metrics = runAssay({ ...params, steps: opts.steps });
  const assessment: AssayAssessment =
    metrics.occlusion < NAIVE_OCCLUSION_PASS ? 'flow_preserved' : 'flow_impaired';
  return {
    ran: true,
    params: {
      seed: params.seed,
      cellCount: params.cellCount,
      pO2: params.pO2,
      polymerizationTendency: params.polymerizationTendency,
      capillaryConstriction: params.capillaryConstriction,
    },
    metrics,
    assessment,
    limitation: ASSAY_MODEL_LIMITATION,
  };
}

export function offTargetFromIntent(intent: IntentPayload): OffTargetPayload {
  const hits: Array<{ gene: string; classification: string; note: string }> = [];
  for (let i = 0; i < intent.targets.length; i += 1) {
    const gene = intent.targets[i];
    if (gene === undefined) continue;
    const flagged = lookupLocus(gene);
    if (!flagged) continue;
    hits.push({
      gene: flagged.gene,
      classification: flagged.classification,
      note: flagged.note,
    });
  }
  return {
    method: 'curated-registry-lookup',
    targets: [...intent.targets],
    hits,
  };
}

export function verifyEdit(args: {
  plan: EditPlanPayload;
  structural: StructuralPayload;
  assay: AssayPayload;
  screen: ScreenPayload;
  seed: number;
  steps: number;
  /** Present only on a classified run. It can add a sign-off, never remove one. */
  conflict?: ConflictPayload;
}): VerdictPayload {
  const reasons: string[] = [];
  const conflictCrossed = args.conflict?.crossesActionableThreshold === true;
  const requiresSignoff = args.screen.requiresSignoff || conflictCrossed;
  // One CheckRun carries one role. When the biosafety gate also escalated,
  // its policy role wins and the reclassification review is stated as a
  // reason rather than dropped.
  const signoffRole =
    args.screen.signoffRole ?? (conflictCrossed ? ACMG_RECLASSIFICATION_SIGNOFF_ROLE : undefined);

  if (!args.plan.resolved || args.plan.polymerizationTendency === null) {
    return {
      passed: false,
      mergeBlocked: true,
      requiresSignoff,
      signoffRole,
      reasons: [
        'Verifier could not resolve a curated edit plan against data/loci.json.',
        ...(conflictCrossed ? [reclassificationReason(args.conflict)] : []),
      ],
      disagreedWithAssay: false,
      disagreedWithStructural: false,
      measured: { highPO2: null, lowPO2: null, referenceLowPO2: null },
    };
  }

  const poly = args.plan.polymerizationTendency;
  const gene = args.plan.gene;
  const wtPoly = wildtypePoly(gene);
  const highPO2 = SIMULATION_DEFAULTS.pO2;
  const lowPO2 = PO2_RANGE.min;
  const high = runAssay({ polymerizationTendency: poly, pO2: highPO2, seed: args.seed, steps: args.steps });
  const low = runAssay({ polymerizationTendency: poly, pO2: lowPO2, seed: args.seed, steps: args.steps });
  const referenceLow = runAssay({
    polymerizationTendency: wtPoly,
    pO2: lowPO2,
    seed: args.seed,
    steps: args.steps,
  });

  let passed = true;
  if (low.occlusion > referenceLow.occlusion + OCCLUSION_MARGIN) {
    passed = false;
    reasons.push(
      'Independent hypoxic run: occlusion is substantially higher than the reference genotype.',
    );
  }
  if (low.sickledFraction > referenceLow.sickledFraction + SICKLED_MARGIN) {
    passed = false;
    reasons.push(
      'Independent hypoxic run: sickled fraction is substantially higher than the reference genotype.',
    );
  }
  if (poly >= POLY_PATHOGENIC) {
    passed = false;
    reasons.push(
      'Planned genotype retains a high polymerization tendency; the edit does not restore reference-like behaviour.',
    );
  }

  const disagreedWithAssay =
    args.assay.assessment === 'flow_preserved' &&
    low.occlusion > referenceLow.occlusion + OCCLUSION_MARGIN;
  if (disagreedWithAssay) {
    passed = false;
    reasons.push(
      'Functional assay assessment is optimistic: it reported preserved flow, but independent hypoxic metrics do not.',
    );
  }

  const structuralPoly = args.structural.polymerizationTendency;
  const disagreedWithStructural =
    args.structural.sourcedFromFixture &&
    structuralPoly !== null &&
    structuralPoly < POLY_PATHOGENIC &&
    low.occlusion > referenceLow.occlusion + OCCLUSION_MARGIN;
  if (disagreedWithStructural) {
    passed = false;
    reasons.push(
      'Structural annotation is optimistic relative to the measured hypoxic occlusion.',
    );
  }

  if (passed) {
    reasons.push(
      'Independent hypoxic metrics stay close to the reference genotype; merge checks pass on simulation grounds.',
    );
  }

  const mergeBlocked = !passed || requiresSignoff || args.screen.verdict === 'escalate';
  if (args.screen.requiresSignoff) {
    reasons.push('Biosafety gate requires named human sign-off before merge.');
  }
  if (conflictCrossed) {
    reasons.push(reclassificationReason(args.conflict));
  }

  return {
    passed,
    mergeBlocked,
    requiresSignoff,
    signoffRole,
    reasons,
    disagreedWithAssay,
    disagreedWithStructural,
    measured: {
      highPO2: high,
      lowPO2: low,
      referenceLowPO2: referenceLow,
    },
  };
}

function reclassificationReason(conflict: ConflictPayload | undefined): string {
  const prior = conflict?.priorClassification ?? 'unknown';
  const next = conflict?.newClassification ?? 'unknown';
  return (
    `ACMG reclassification '${prior}' -> '${next}' crosses the actionable ` +
    `Pathogenic/Uncertain line; ${ACMG_RECLASSIFICATION_SIGNOFF_ROLE} sign-off is required ` +
    'before this classification informs any treatment-pathway decision.'
  );
}

function wildtypePoly(gene: string | null): number {
  if (gene === null) return 0;
  const locus = findLocus(gene);
  if (!locus) return 0;
  const wt = referenceGenotype(locus);
  return wt ? wt.polymerizationTendency : 0;
}

export function latestOfKind(deltas: readonly Delta[], kind: Delta['kind']): Delta | undefined {
  for (let i = deltas.length - 1; i >= 0; i -= 1) {
    const d = deltas[i];
    if (d && d.kind === kind) return d;
  }
  return undefined;
}

/**
 * Verifier reads the plan and re-runs cellsim. It does not trust assay prose.
 * Used by the pipeline and by tests that plant optimistic upstream deltas.
 */
export function runVerifierAgent(args: {
  dag: DeltaDAG;
  parentId: string;
  createdAt: number;
  seed: number;
  steps: number;
}): Delta {
  const hist = args.dag.history(args.parentId);
  const planDelta = latestOfKind(hist, 'edit_plan');
  const structuralDelta = latestOfKind(hist, 'structural');
  const assayDelta = latestOfKind(hist, 'assay');
  const screenDelta = latestOfKind(hist, 'screen');
  const conflictDelta = latestOfKind(hist, 'conflict');
  if (
    conflictDelta !== undefined &&
    !isConflictPayload(conflictDelta.payload)
  ) {
    throw new Error('VerifierAgent: conflict payload shape is invalid');
  }
  const conflict =
    conflictDelta !== undefined && isConflictPayload(conflictDelta.payload)
      ? conflictDelta.payload
      : undefined;
  if (
    planDelta === undefined ||
    structuralDelta === undefined ||
    assayDelta === undefined ||
    screenDelta === undefined
  ) {
    throw new Error('VerifierAgent: missing upstream deltas');
  }
  if (
    !isEditPlanPayload(planDelta.payload) ||
    !isStructuralPayload(structuralDelta.payload) ||
    !isAssayPayload(assayDelta.payload) ||
    !isScreenPayload(screenDelta.payload)
  ) {
    throw new Error('VerifierAgent: upstream payload shape is invalid');
  }
  const payload = verifyEdit({
    plan: planDelta.payload,
    structural: structuralDelta.payload,
    assay: assayDelta.payload,
    screen: screenDelta.payload,
    seed: args.seed,
    steps: args.steps,
    ...(conflict !== undefined ? { conflict } : {}),
  });
  return args.dag.add({
    kind: 'verdict',
    author: VerifierAgent.name,
    subject: 'verifier-verdict',
    payload,
    parents: [args.parentId],
    createdAt: args.createdAt,
  });
}

export interface PipelineDeps {
  /** ACMG evidence records; defaults to data/acmg-variants.json. */
  readonly acmgRecords?: readonly AcmgVariantRecord[];
}

export function runPipeline(input: PipelineInput, deps: PipelineDeps = {}): PipelineResult {
  const dag = new DeltaDAG();
  const seed = input.seed ?? SIMULATION_DEFAULTS.seed;
  const pO2 = input.pO2 ?? SIMULATION_DEFAULTS.pO2;
  // The assay is a challenge of declared duration, not an open-ended run —
  // see CHALLENGE_STEPS for why that distinction is load-bearing here.
  const steps = input.assaySteps ?? CHALLENGE_STEPS;
  let createdAt = 0;
  let parentId: string | null = null;

  const emit = (
    kind: Delta['kind'],
    author: string,
    subject: string,
    payload: unknown,
  ): Delta => {
    const delta = dag.add({
      kind,
      author,
      subject,
      payload,
      parents: parentId === null ? [] : [parentId],
      createdAt,
    });
    createdAt += 1;
    parentId = delta.id;
    return delta;
  };

  const intent = parseIntent(input.text);
  emit('intent', IntentAgent.name, 'parsed-intent', intent);

  const gate = screen({ text: input.text, targets: intent.targets });
  const screenPayload: ScreenPayload = {
    category: gate.category,
    verdict: gate.verdict,
    reason: gate.reason,
    requiresSignoff: gate.requiresSignoff,
    flaggedGenes: gate.flaggedGenes,
    requestDigest: gate.requestDigest,
    redacted: gate.redacted,
    ...(gate.signoffRole ? { signoffRole: gate.signoffRole } : {}),
  };
  const screenDelta = emit('screen', BiosafetyGateAgent.name, 'biosafety-screen', screenPayload);

  const finish = (opts: {
    blocked: boolean;
    escalated: boolean;
    passed: boolean;
    mergeAllowed: boolean;
    requiresSignoff: boolean;
    signoffRole?: string;
  }): PipelineResult => {
    const head = parentId === null ? screenDelta.id : parentId;
    return {
      dag,
      blocked: opts.blocked,
      escalated: opts.escalated,
      passed: opts.passed,
      mergeAllowed: opts.mergeAllowed,
      requiresSignoff: opts.requiresSignoff,
      signoffRole: opts.signoffRole,
      headId: head,
      classified: input.classify === true,
    };
  };

  if (gate.verdict === 'block') {
    return finish({
      blocked: true,
      escalated: false,
      passed: false,
      mergeAllowed: false,
      requiresSignoff: false,
    });
  }

  const plan = planEdit(intent);
  emit('edit_plan', EditPlannerAgent.name, 'edit-plan', plan);

  const structural = structuralFromPlan(plan);
  emit('structural', StructuralImpactAgent.name, 'structural-impact', structural);

  const assay = runFunctionalAssay(plan, { pO2, seed, steps });
  emit('assay', FunctionalAssayAgent.name, 'functional-assay', assay);

  const offtarget = offTargetFromIntent(intent);
  const offDelta = emit('offtarget', OffTargetRiskAgent.name, 'off-target-registry', offtarget);

  const classification = input.classify === true ? classifyPlan(plan, deps.acmgRecords) : null;
  let conflictCrossed = false;
  let verifierParent = offDelta.id;
  if (classification !== null) {
    emit('classification', AcmgClassificationAgent.name, 'acmg-classification', classification);
    const conflict = conflictFromClassification(classification);
    conflictCrossed = conflict.crossesActionableThreshold;
    const conflictDelta = emit(
      'conflict',
      ClassificationConflictAgent.name,
      'classification-conflict',
      conflict,
    );
    verifierParent = conflictDelta.id;
  }

  if (parentId === null) {
    throw new Error('runPipeline: missing parent after off-target agent');
  }
  runVerifierAgent({
    dag,
    parentId: verifierParent,
    createdAt,
    seed,
    steps,
  });

  const verdictDelta = latestOfKind(dag.all(), 'verdict');
  if (verdictDelta === undefined) {
    throw new Error('runPipeline: verifier did not emit a verdict');
  }
  parentId = verdictDelta.id;

  createdAt += 1;

  const escalated = gate.verdict === 'escalate' || conflictCrossed;
  const passed = isVerdictPayload(verdictDelta.payload) && verdictDelta.payload.passed;
  const requiresSignoff = gate.requiresSignoff || conflictCrossed;
  const mergeAllowed = passed && !escalated && !requiresSignoff;
  const signoffRole =
    gate.signoffRole ?? (conflictCrossed ? ACMG_RECLASSIFICATION_SIGNOFF_ROLE : undefined);

  // Therapy is reachable only from a run that passed with nothing awaiting a
  // human. An escalated run gets no lookup at all — not an empty one — so no
  // therapy is ever shown beside a call that is still under review.
  if (classification !== null && mergeAllowed && isVerdictPayload(verdictDelta.payload)) {
    const therapy = therapyFromClassification(classification, verdictDelta.payload);
    if (therapy !== null) {
      emit('therapy_match', TherapyLookupAgent.name, 'therapy-lookup', therapy);
    }
  }

  return finish({
    blocked: false,
    escalated,
    passed,
    mergeAllowed,
    requiresSignoff,
    signoffRole,
  });
}

export function readIntent(delta: Delta): IntentPayload {
  if (!isIntentPayload(delta.payload)) {
    throw new Error('expected intent payload');
  }
  return delta.payload;
}

export function readScreen(delta: Delta): ScreenPayload {
  if (!isScreenPayload(delta.payload)) {
    throw new Error('expected screen payload');
  }
  return delta.payload;
}

export function readPlan(delta: Delta): EditPlanPayload {
  if (!isEditPlanPayload(delta.payload)) {
    throw new Error('expected edit_plan payload');
  }
  return delta.payload;
}

export function readStructural(delta: Delta): StructuralPayload {
  if (!isStructuralPayload(delta.payload)) {
    throw new Error('expected structural payload');
  }
  return delta.payload;
}

export function readAssay(delta: Delta): AssayPayload {
  if (!isAssayPayload(delta.payload)) {
    throw new Error('expected assay payload');
  }
  return delta.payload;
}
