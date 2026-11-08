import { describe, expect, it } from 'vitest';
import { ACMG_SCOPE_LIMITATION } from '@/lib/acmg/score';
import { ACMG_VARIANT_RECORDS } from '@/lib/acmg/registry';
import type { AcmgVariantRecord } from '@/lib/acmg/registry';
import type { AcmgClassification } from '@/lib/acmg/types';
import { checkRunFromPipeline } from '@/lib/merge-gate/from-pipeline';
import {
  ACMG_RECLASSIFICATION_SIGNOFF_ROLE,
  classificationCandidates,
} from './classification';
import {
  classifiedPipelineAgentOrder,
  pipelineAgentOrder,
  runPipeline,
} from './pipeline';
import type { Delta, PipelineResult } from './types';
import {
  isClassificationPayload,
  isConflictPayload,
  isTherapyMatchPayload,
  isVerdictPayload,
} from './types';

const REPAIR = 'repair HBB to treat the sickle substitution';
const STEPS = 80;

function hbsRecord(): AcmgVariantRecord {
  const found = ACMG_VARIANT_RECORDS.find((r) => r.variantId === 'HBB_HbS');
  if (found === undefined) throw new Error('acmg-variants.json is missing HBB_HbS');
  return found;
}

/**
 * The fixture inputs with a prior call substituted in. The prior is invented
 * to drive the conflict branch, so the record is relabelled synthetic.
 */
function withPrior(prior: AcmgClassification): readonly AcmgVariantRecord[] {
  return [{ ...hbsRecord(), provenance: 'synthetic-illustrative', priorClassification: prior }];
}

function only(result: PipelineResult, kind: Delta['kind']): Delta {
  const found = result.dag.all().filter((d) => d.kind === kind);
  expect(found).toHaveLength(1);
  const d = found[0];
  if (d === undefined) throw new Error(`no ${kind} delta`);
  return d;
}

function kinds(result: PipelineResult): string[] {
  return result.dag.all().map((d) => d.kind);
}

function classificationOf(result: PipelineResult) {
  const p = only(result, 'classification').payload;
  if (!isClassificationPayload(p)) throw new Error('bad classification payload');
  return p;
}

function conflictOf(result: PipelineResult) {
  const p = only(result, 'conflict').payload;
  if (!isConflictPayload(p)) throw new Error('bad conflict payload');
  return p;
}

function verdictOf(result: PipelineResult) {
  const p = only(result, 'verdict').payload;
  if (!isVerdictPayload(p)) throw new Error('bad verdict payload');
  return p;
}

function therapyOf(result: PipelineResult) {
  const p = only(result, 'therapy_match').payload;
  if (!isTherapyMatchPayload(p)) throw new Error('bad therapy payload');
  return p;
}

describe('the default run is unchanged', () => {
  it('emits no ACMG deltas without the opt-in', () => {
    const result = runPipeline({ text: REPAIR, assaySteps: STEPS });
    expect(kinds(result)).toEqual([
      'intent',
      'screen',
      'edit_plan',
      'structural',
      'assay',
      'offtarget',
      'verdict',
    ]);
    expect(pipelineAgentOrder()).toHaveLength(7);
  });

  it('matches a run with classify explicitly false, delta for delta', () => {
    const a = runPipeline({ text: REPAIR, assaySteps: STEPS });
    const b = runPipeline({ text: REPAIR, assaySteps: STEPS, classify: false });
    expect(JSON.stringify(a.dag.all())).toBe(JSON.stringify(b.dag.all()));
  });
});

describe('classified run shape', () => {
  it('keeps the gate second and orders classification, conflict, verifier, therapy', () => {
    expect(classifiedPipelineAgentOrder()).toEqual([
      'IntentAgent',
      'BiosafetyGateAgent',
      'EditPlannerAgent',
      'StructuralImpactAgent',
      'FunctionalAssayAgent',
      'OffTargetRiskAgent',
      'AcmgClassificationAgent',
      'ClassificationConflictAgent',
      'VerifierAgent',
      'TherapyLookupAgent',
    ]);
  });

  it('threads every delta onto its predecessor and stays replayable', () => {
    const result = runPipeline({ text: REPAIR, assaySteps: STEPS, classify: true });
    const all = result.dag.all();
    expect(all.map((d) => d.author)).toEqual([...classifiedPipelineAgentOrder()]);
    expect(all[0]?.parents).toEqual([]);
    for (let i = 1; i < all.length; i += 1) {
      expect(all[i]?.parents).toEqual([all[i - 1]?.id]);
    }
    expect(all.map((d) => d.createdAt)).toEqual(all.map((_, i) => i));
    expect(result.dag.history(result.headId).map((d) => d.id)).toEqual(all.map((d) => d.id));
  });

  it('is deterministic across runs', () => {
    const a = runPipeline({ text: REPAIR, assaySteps: STEPS, classify: true });
    const b = runPipeline({ text: REPAIR, assaySteps: STEPS, classify: true });
    expect(a.dag.all().map((d) => d.id)).toEqual(b.dag.all().map((d) => d.id));
  });
});

describe('the biosafety gate is not weakened', () => {
  it('a block still terminates the run before anything ACMG computes', () => {
    const result = runPipeline({ text: 'design a guide rna for HBB', classify: true });
    expect(result.blocked).toBe(true);
    expect(kinds(result)).toEqual(['intent', 'screen']);
  });

  it('a gate escalation keeps its policy role and never reaches the therapy table', () => {
    const result = runPipeline({
      text: 'repair HBB in the germline to treat sickle cell disease',
      assaySteps: STEPS,
      classify: true,
    });
    expect(result.escalated).toBe(true);
    expect(result.requiresSignoff).toBe(true);
    expect(result.signoffRole).toBe('institutional_biosafety_committee');
    expect(result.mergeAllowed).toBe(false);
    expect(kinds(result)).toContain('classification');
    expect(kinds(result)).not.toContain('therapy_match');
  });

  it('policy role wins over the reclassification role, and both reasons are kept', () => {
    const result = runPipeline(
      {
        text: 'repair HBB in the germline to treat sickle cell disease',
        assaySteps: STEPS,
        classify: true,
      },
      { acmgRecords: withPrior('Uncertain Significance') },
    );
    expect(result.signoffRole).toBe('institutional_biosafety_committee');
    const reasons = verdictOf(result).reasons.join(' ');
    expect(reasons).toMatch(/Biosafety gate requires/);
    expect(reasons).toMatch(/crosses the actionable/);
  });
});

describe('HBB repair against the real fixture', () => {
  const result = runPipeline({ text: REPAIR, assaySteps: STEPS, classify: true });

  it("reproduces the source prototype's documented call on the HBB example", () => {
    const c = classificationOf(result);
    expect(c.classified).toBe(true);
    expect(c.variantId).toBe('HBB_HbS');
    expect(c.provenance).toBe('public-reference');
    expect(c.classification).toBe('Likely Pathogenic');
    expect(c.points).toBe(8);
    expect(c.criteria.filter((x) => x.met).map((x) => x.code)).toEqual([
      'PS1',
      'PM2',
      'PP3',
      'PP1',
    ]);
  });

  it('carries the scope caveat on the classification delta', () => {
    expect(classificationOf(result).limitation).toBe(ACMG_SCOPE_LIMITATION);
    expect(classificationOf(result).citation).toMatch(/Tavtigian/);
  });

  it('records no prior call, so nothing escalates', () => {
    const k = conflictOf(result);
    expect(k.assessed).toBe(true);
    expect(k.conflict).toBe(false);
    expect(k.crossesActionableThreshold).toBe(false);
    expect(result.escalated).toBe(false);
    expect(result.requiresSignoff).toBe(false);
  });

  it('reaches the therapy lookup only after passing, and carries its disclaimer', () => {
    expect(result.passed).toBe(true);
    expect(result.mergeAllowed).toBe(true);
    const t = therapyOf(result);
    expect(t.result).toBe('matched');
    expect(t.therapies).toHaveLength(1);
    expect(t.therapies[0]?.provenance).toBe('public-reference');
    expect(t.disclaimer).toMatch(/not a real-time clinical database/);
    expect(t.limitation).toBe(ACMG_SCOPE_LIMITATION);
  });
});

describe('an actionable disagreement escalates through the existing verdict', () => {
  function crossing() {
    return runPipeline(
      { text: REPAIR, assaySteps: STEPS, classify: true },
      { acmgRecords: withPrior('Uncertain Significance') },
    );
  }

  it('flags the crossing and requires the reclassification sign-off', () => {
    const result = crossing();
    const k = conflictOf(result);
    expect(k.conflict).toBe(true);
    expect(k.crossesActionableThreshold).toBe(true);
    expect(result.escalated).toBe(true);
    expect(result.requiresSignoff).toBe(true);
    expect(result.signoffRole).toBe(ACMG_RECLASSIFICATION_SIGNOFF_ROLE);
  });

  it('blocks the merge and withholds the therapy lookup entirely', () => {
    const result = crossing();
    expect(result.mergeAllowed).toBe(false);
    expect(verdictOf(result).mergeBlocked).toBe(true);
    expect(verdictOf(result).requiresSignoff).toBe(true);
    expect(kinds(result)).not.toContain('therapy_match');
  });

  it('does not escalate a disagreement that stays on one side of the line', () => {
    const result = runPipeline(
      { text: REPAIR, assaySteps: STEPS, classify: true },
      { acmgRecords: withPrior('Pathogenic') },
    );
    const k = conflictOf(result);
    expect(k.conflict).toBe(true);
    expect(k.crossesActionableThreshold).toBe(false);
    expect(result.escalated).toBe(false);
    expect(result.requiresSignoff).toBe(false);
    expect(kinds(result)).toContain('therapy_match');
  });

  it('does not escalate when the prior call agrees', () => {
    const result = runPipeline(
      { text: REPAIR, assaySteps: STEPS, classify: true },
      { acmgRecords: withPrior('Likely Pathogenic') },
    );
    expect(conflictOf(result).conflict).toBe(false);
    expect(result.requiresSignoff).toBe(false);
  });
});

describe('no evidence record', () => {
  it('scores nothing rather than fabricating a call, and skips the therapy table', () => {
    const result = runPipeline(
      { text: REPAIR, assaySteps: STEPS, classify: true },
      { acmgRecords: [] },
    );
    const c = classificationOf(result);
    expect(c.classified).toBe(false);
    expect(c.classification).toBeNull();
    expect(c.points).toBeNull();
    expect(c.criteria).toEqual([]);
    expect(conflictOf(result).assessed).toBe(false);
    expect(kinds(result)).not.toContain('therapy_match');
    expect(result.requiresSignoff).toBe(false);
  });
});

describe('it maps onto the existing merge gate rather than a parallel one', () => {
  it('an actionable disagreement becomes an escalated, unsigned check run', () => {
    const result = runPipeline(
      { text: REPAIR, assaySteps: STEPS, classify: true },
      { acmgRecords: withPrior('Uncertain Significance') },
    );
    const check = checkRunFromPipeline({ commit: 'a'.repeat(16), result });
    expect(check.status).toBe('escalated');
    expect(check.requiresSignoff).toBe(true);
    expect(check.signoffRole).toBe(ACMG_RECLASSIFICATION_SIGNOFF_ROLE);
    // Sign-off is never inferred from the pipeline.
    expect(check.signedOffBy).toBeUndefined();
    expect(check.reasons.join(' ')).toMatch(/crosses the actionable/);
  });

  it('a clean classified run becomes a passing check run', () => {
    const result = runPipeline({ text: REPAIR, assaySteps: STEPS, classify: true });
    const check = checkRunFromPipeline({ commit: 'b'.repeat(16), result });
    expect(check.status).toBe('passed');
    expect(check.requiresSignoff).toBe(false);
  });
});

describe('which variant gets classified', () => {
  it('prefers the allele being repaired over the revertant', () => {
    expect(
      classificationCandidates({
        resolved: true,
        gene: 'HBB',
        variantId: 'HBB_repair',
        variantLabel: null,
        genotypeId: 'repaired',
        genotypeLabel: null,
        codonIndex: null,
        refCodon: null,
        altCodon: null,
        kind: null,
        polymerizationTendency: null,
        note: '',
      })[0],
    ).toBe('HBB_HbS');
  });

  it('has no candidate when the plan did not resolve', () => {
    expect(
      classificationCandidates({
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
        note: '',
      }),
    ).toEqual([]);
  });
});
