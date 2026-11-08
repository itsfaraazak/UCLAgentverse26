/**
 * The shape of the pipeline, as data a client may hold.
 *
 * This exists for one reason: `lib/agents` reaches `lib/safety/policy`, which
 * hashes with `node:crypto`, so importing a *value* from `lib/agents` into a
 * client component bundles the policy module into the browser. The agent
 * names, their delta kinds and their descriptions are not secret, but the
 * actions files state that the client never imports the safety module, and an
 * invariant a comment asserts and the bundle contradicts is worse than no
 * invariant.
 *
 * So the names live here, with no imports but types, and `lib/agents` reads
 * its execution order from this list rather than keeping a second copy. There
 * is one source of truth; this module is just the part that is safe to ship.
 */

import type { DeltaKind } from '@/lib/agents/types';

export type AgentName =
  | 'IntentAgent'
  | 'BiosafetyGateAgent'
  | 'EditPlannerAgent'
  | 'StructuralImpactAgent'
  | 'FunctionalAssayAgent'
  | 'OffTargetRiskAgent'
  | 'VerifierAgent'
  | 'AcmgClassificationAgent'
  | 'ClassificationConflictAgent'
  | 'TherapyLookupAgent';

export interface PipelineStepSpec {
  /** 1-based position in the fixed order of SPEC §4.3. */
  readonly step: number;
  readonly agent: AgentName;
  readonly kind: DeltaKind;
  readonly role: string;
}

/**
 * The seven agents in the order SPEC §4.3 fixes, with the gate at position 2.
 *
 * The order is load-bearing, not presentational: `lib/agents` runs the
 * pipeline in this order, and the gate being second is what makes it
 * structural rather than a disclaimer (SPEC §7.4).
 */
export const PIPELINE_STEPS: readonly PipelineStepSpec[] = Object.freeze([
  {
    step: 1,
    agent: 'IntentAgent',
    kind: 'intent',
    role: 'Normalise the request into a structured intent',
  },
  {
    step: 2,
    agent: 'BiosafetyGateAgent',
    kind: 'screen',
    role: 'Screen the intent before any downstream work',
  },
  {
    step: 3,
    agent: 'EditPlannerAgent',
    kind: 'edit_plan',
    role: 'Resolve the target locus and edit against the fixture',
  },
  {
    step: 4,
    agent: 'StructuralImpactAgent',
    kind: 'structural',
    role: 'Amino-acid change → annotated structural consequence',
  },
  {
    step: 5,
    agent: 'FunctionalAssayAgent',
    kind: 'assay',
    role: 'Run the simulation headless and report metrics',
  },
  {
    step: 6,
    agent: 'OffTargetRiskAgent',
    kind: 'offtarget',
    role: 'Flag the target against the curated sensitive-locus registry',
  },
  {
    step: 7,
    agent: 'VerifierAgent',
    kind: 'verdict',
    role: 'Cross-check the claims against measured output',
  },
] as const satisfies readonly PipelineStepSpec[]);

/** The agent names in pipeline order. */
export const AGENT_ORDER: readonly AgentName[] = Object.freeze(
  PIPELINE_STEPS.map((spec) => spec.agent),
);

const KIND_BY_AGENT: Readonly<Record<string, DeltaKind>> = Object.freeze(
  Object.fromEntries(PIPELINE_STEPS.map((spec) => [spec.agent, spec.kind])),
);

const ROLE_BY_AGENT: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(PIPELINE_STEPS.map((spec) => [spec.agent, spec.role])),
);

/** What an agent is for. Shared so the surfaces label them alike. */
export function agentRole(agent: string): string {
  return ROLE_BY_AGENT[agent] ?? CLASSIFIED_ROLE_BY_AGENT[agent] ?? '';
}

/** The delta kind an agent emits, or undefined for an unknown name. */
export function agentDeltaKind(agent: string): DeltaKind | undefined {
  return KIND_BY_AGENT[agent] ?? CLASSIFIED_KIND_BY_AGENT[agent];
}

/**
 * The order a classified run executes (`classify: true`).
 *
 * The ACMG stage sits *after* the biosafety gate, which stays at position 2 —
 * a `block` still terminates the run before any of this computes. The
 * classification can add a sign-off requirement and never remove one, so
 * layering it here cannot loosen the gate.
 */
export const CLASSIFIED_PIPELINE_STEPS: readonly PipelineStepSpec[] = Object.freeze([
  ...PIPELINE_STEPS.slice(0, 6),
  {
    step: 7,
    agent: 'AcmgClassificationAgent',
    kind: 'classification',
    role: 'Score the variant against the ACMG/AMP point system',
  },
  {
    step: 8,
    agent: 'ClassificationConflictAgent',
    kind: 'conflict',
    role: 'Compare the score with the prior classification on record',
  },
  { ...PIPELINE_STEPS[6], step: 9 } as PipelineStepSpec,
  {
    step: 10,
    agent: 'TherapyLookupAgent',
    kind: 'therapy_match',
    role: 'Look the classified variant up in the approved-therapy table',
  },
] as readonly PipelineStepSpec[]);

const CLASSIFIED_ROLE_BY_AGENT: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(CLASSIFIED_PIPELINE_STEPS.map((spec) => [spec.agent, spec.role])),
);

const CLASSIFIED_KIND_BY_AGENT: Readonly<Record<string, DeltaKind>> = Object.freeze(
  Object.fromEntries(CLASSIFIED_PIPELINE_STEPS.map((spec) => [spec.agent, spec.kind])),
);

/** Agents in the order for `classify`, or the seven-agent order otherwise. */
export function pipelineStepsFor(classified: boolean): readonly PipelineStepSpec[] {
  return classified ? CLASSIFIED_PIPELINE_STEPS : PIPELINE_STEPS;
}
