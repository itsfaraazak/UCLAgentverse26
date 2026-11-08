/**
 * The ACMG stage, ported from the deltagene prototype's AcmgScoringAgent,
 * ConflictAgent and TreatmentPathwayAgent. Deterministic and LLM-free — the
 * source's treatment-agent LLM narration is deliberately not carried over.
 *
 * Placement in the run (see `runPipeline` with `classify: true`):
 *
 *   intent, SCREEN, plan, structural, assay, off-target,
 *   classification, conflict, verdict, therapy
 *
 * The biosafety gate stays at position 2, so a `block` ends the run before
 * any of this computes. The source's ComplianceAgent (an actionable
 * disagreement needs a human) is *not* ported as a parallel gate: a conflict
 * that crosses the actionable line feeds the verifier, which turns it into
 * our existing `escalate` + `requiresSignoff`, and `lib/merge-gate` then holds
 * the merge until a human signs off. Therapy runs only once the run has
 * actually passed with nothing awaiting sign-off.
 */

import { assessConflict } from '@/lib/acmg/conflict';
import type { AcmgVariantRecord } from '@/lib/acmg/registry';
import { ACMG_PRIOR_CALL_LIMITATION, ACMG_VARIANT_RECORDS } from '@/lib/acmg/registry';
import { ACMG_CITATION, ACMG_SCOPE_LIMITATION, scoreAcmg } from '@/lib/acmg/score';
import { lookupTherapies } from '@/lib/acmg/therapy';
import { findGenotype, findLocus } from './fixtures';
import type {
  ClassificationPayload,
  ConflictPayload,
  EditPlanPayload,
  TherapyMatchPayload,
  VerdictPayload,
} from './types';

export const AcmgClassificationAgent = { name: 'AcmgClassificationAgent' } as const;
export const ClassificationConflictAgent = { name: 'ClassificationConflictAgent' } as const;
export const TherapyLookupAgent = { name: 'TherapyLookupAgent' } as const;

/**
 * Role required to sign off a classification that crosses the actionable
 * line — the source ComplianceAgent's `required_role`. It is a constant in a
 * deterministic agent and never read from a request. It is not in
 * `lib/safety/policy.ts` only because that file is frozen; if the policy
 * table should own it, that is an orchestrator change.
 */
export const ACMG_RECLASSIFICATION_SIGNOFF_ROLE = 'genetic_counselor';

/**
 * Which variant does a plan concern, for classification purposes? The
 * planned genotype's applied variants first, then the planned variant.
 *
 * For a repair, the planned variant is the revertant (`HBB_repair`), which
 * restores the reference codon and has no ACMG meaning of its own. The
 * clinically relevant call is the allele being repaired (`HBB_HbS`), which
 * is the first applied variant of the `repaired` genotype. For an
 * introduction the two coincide.
 */
export function classificationCandidates(plan: EditPlanPayload): readonly string[] {
  if (!plan.resolved || plan.gene === null || plan.variantId === null) return [];
  const out: string[] = [];
  const locus = findLocus(plan.gene);
  const genotype =
    locus !== undefined && plan.genotypeId !== null ? findGenotype(locus, plan.genotypeId) : undefined;
  if (genotype !== undefined) {
    for (const id of genotype.appliedVariants) {
      if (!out.includes(id)) out.push(id);
    }
  }
  if (!out.includes(plan.variantId)) out.push(plan.variantId);
  return out;
}

export function classifyPlan(
  plan: EditPlanPayload,
  records: readonly AcmgVariantRecord[] = ACMG_VARIANT_RECORDS,
): ClassificationPayload {
  const candidates = classificationCandidates(plan);
  let record: AcmgVariantRecord | undefined;
  for (const id of candidates) {
    record = records.find((r) => r.variantId === id);
    if (record !== undefined) break;
  }
  if (record === undefined) {
    return {
      classified: false,
      gene: plan.gene,
      variantId: plan.variantId,
      hgvs: null,
      provenance: null,
      classification: null,
      points: null,
      criteria: [],
      priorClassification: null,
      note: 'No ACMG evidence record for the planned variant; nothing is scored or fabricated.',
      limitation: ACMG_SCOPE_LIMITATION,
      citation: ACMG_CITATION,
    };
  }
  const result = scoreAcmg(record.acmgInputs);
  return {
    classified: true,
    gene: record.gene,
    variantId: record.variantId,
    hgvs: record.hgvs,
    provenance: record.provenance,
    classification: result.classification,
    points: result.points,
    criteria: result.criteria,
    priorClassification: record.priorClassification,
    note: `Scored ${record.variantId} (${record.provenance}) from data/acmg-variants.json.`,
    limitation: ACMG_SCOPE_LIMITATION,
    citation: ACMG_CITATION,
  };
}

export function conflictFromClassification(c: ClassificationPayload): ConflictPayload {
  if (!c.classified || c.classification === null) {
    return {
      assessed: false,
      conflict: false,
      priorClassification: null,
      newClassification: null,
      crossesActionableThreshold: false,
      note: 'No classification was produced, so there is nothing to compare.',
      limitation: ACMG_PRIOR_CALL_LIMITATION,
    };
  }
  return {
    assessed: true,
    ...assessConflict(c.priorClassification, c.classification),
    limitation: ACMG_PRIOR_CALL_LIMITATION,
  };
}

/**
 * Returns null unless the run actually passed with nothing awaiting a human.
 *
 * The verifier's own verdict is a required argument rather than a documented
 * precondition: a caller cannot obtain therapy data without presenting the
 * evidence that the run cleared. A review found that when this was only a
 * doc comment, any holder of an escalated run's `classification` delta could
 * still get a therapy back — SPEC §7.5 says nothing auto-approves, and an
 * approved therapy must never render beside a call still under review.
 */
export function therapyFromClassification(
  c: ClassificationPayload,
  verdict: VerdictPayload,
): TherapyMatchPayload | null {
  if (!verdict.passed || verdict.mergeBlocked || verdict.requiresSignoff) {
    return null;
  }
  if (!c.classified || c.classification === null || c.gene === null || c.variantId === null) {
    return null;
  }
  const lookup = lookupTherapies(c.gene, c.classification);
  return {
    gene: lookup.gene,
    variantId: c.variantId,
    classification: lookup.classification,
    result: lookup.kind,
    therapies: lookup.therapies,
    note: lookup.note,
    disclaimer: lookup.disclaimer,
    limitation: ACMG_SCOPE_LIMITATION,
  };
}
