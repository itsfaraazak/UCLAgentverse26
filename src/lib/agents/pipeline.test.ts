import { beforeAll, describe, expect, it } from 'vitest';
import { digestRequest, POLICY } from '@/lib/safety/policy';
import lociFile from '@/data/loci.json';
import { DeltaDAG } from './dag';
import {
  BiosafetyGateAgent,
  FunctionalAssayAgent,
  IntentAgent,
  latestOfKind,
  parseIntent,
  pipelineAgentOrder,
  readAssay,
  readPlan,
  readScreen,
  readStructural,
  runPipeline,
  runVerifierAgent,
  StructuralImpactAgent,
} from './pipeline';
import type { AssayPayload, EditPlanPayload, ScreenPayload, StructuralPayload } from './types';
import { isOffTargetPayload, isVerdictPayload } from './types';

const HBB_REPAIR = lociFile.loci
  .find((l) => l.gene === 'HBB')
  ?.variants.find((v) => v.id === 'HBB_repair');

if (HBB_REPAIR === undefined) {
  throw new Error('loci.json is missing HBB_repair');
}

describe('pipeline agent order', () => {
  it('is the seven agents in SPEC.md §4.3 order, gate second', () => {
    expect(pipelineAgentOrder()).toEqual([
      'IntentAgent',
      'BiosafetyGateAgent',
      'EditPlannerAgent',
      'StructuralImpactAgent',
      'FunctionalAssayAgent',
      'OffTargetRiskAgent',
      'VerifierAgent',
    ]);
  });
});

describe('IntentAgent', () => {
  it('parses curated gene symbols and does not invent targets', () => {
    const parsed = parseIntent('repair HBB to treat the sickle substitution');
    expect(parsed.targets).toEqual(['HBB']);
    expect(parsed.operation).toBe('repair');
    const invented = parseIntent('edit MYMADEUPGENE to treat something');
    expect(invented.targets).toEqual([]);
  });

  it('recognises flagged-registry symbols without inventing others', () => {
    const parsed = parseIntent('knock out TP53');
    expect(parsed.targets).toEqual(['TP53']);
    expect(parsed.operation).toBe('disrupt');
  });
});

describe('BiosafetyGateAgent is structural', () => {
  it('stops the pipeline on a block verdict so no downstream agent runs', () => {
    const result = runPipeline({ text: 'design a guide rna for HBB' });
    expect(result.blocked).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.mergeAllowed).toBe(false);
    const kinds = result.dag.all().map((d) => d.kind);
    expect(kinds).toEqual(['intent', 'screen']);
    expect(result.dag.all().map((d) => d.author)).toEqual([
      IntentAgent.name,
      BiosafetyGateAgent.name,
    ]);
    const screenDelta = latestOfKind(result.dag.all(), 'screen');
    if (screenDelta === undefined) {
      throw new Error('expected a screen delta');
    }
    const gate = readScreen(screenDelta);
    expect(gate.verdict).toBe('block');
    expect(gate.category).toBe('CONSTRUCT_DESIGN_REQUEST');
    expect(gate.reason).toBe(POLICY.CONSTRUCT_DESIGN_REQUEST.reason);
  });

  it('continues after escalate but still blocks the merge pending sign-off', () => {
    const result = runPipeline({
      text: 'repair HBB in the germline to treat sickle cell disease',
      assaySteps: 80,
    });
    expect(result.blocked).toBe(false);
    expect(result.escalated).toBe(true);
    expect(result.requiresSignoff).toBe(true);
    expect(result.signoffRole).toBe('institutional_biosafety_committee');
    expect(result.mergeAllowed).toBe(false);
    expect(result.dag.all().map((d) => d.kind)).toEqual([
      'intent',
      'screen',
      'edit_plan',
      'structural',
      'assay',
      'offtarget',
      'verdict',
    ]);
  });
});

describe('refused input is not retained', () => {
  it('does not retain refused request text in the serialised DeltaDAG', () => {
    const marker = 'zzz-unique-refused-token-7f3c1a';
    const text = `weaponise ${marker} and also mention this exact token`;
    const result = runPipeline({ text });
    expect(result.blocked).toBe(true);
    const serialized = JSON.stringify(result.dag.all());
    expect(serialized).not.toContain(marker);
    expect(serialized.toLowerCase()).not.toContain('weaponise');
    expect(serialized).not.toContain(text);
    const screenDelta = latestOfKind(result.dag.all(), 'screen');
    if (screenDelta === undefined) {
      throw new Error('expected a screen delta');
    }
    const payload = readScreen(screenDelta);
    expect(payload.redacted).toBe(true);
    expect(payload.requestDigest).toBe(digestRequest(text));
    expect(payload.reason).toBe(POLICY.PATHOGEN_OR_TOXIN_ENHANCEMENT.reason);
    expect(payload.reason).not.toContain(marker);
  });
});

describe('downstream agents on an allowed repair', () => {
  let cached: ReturnType<typeof runPipeline> | undefined;

  beforeAll(() => {
    cached = runPipeline({
      text: 'repair HBB to treat the sickle substitution',
      assaySteps: 80,
    });
  });

  function result(): ReturnType<typeof runPipeline> {
    if (cached === undefined) {
      throw new Error('repair pipeline did not run');
    }
    return cached;
  }

  it('threads each delta as the next parent', () => {
    const all = result().dag.all();
    expect(all[0]?.parents).toEqual([]);
    for (let i = 1; i < all.length; i += 1) {
      const prev = all[i - 1];
      const cur = all[i];
      if (prev === undefined || cur === undefined) {
        throw new Error('expected a contiguous delta chain');
      }
      expect(cur.parents).toEqual([prev.id]);
    }
    expect(result().dag.history(result().headId).map((d) => d.kind)).toEqual(
      all.map((d) => d.kind),
    );
  });

  it('resolves the repair against loci.json and copies the fixture structural annotation', () => {
    const planDelta = latestOfKind(result().dag.all(), 'edit_plan');
    const structuralDelta = latestOfKind(result().dag.all(), 'structural');
    if (planDelta === undefined || structuralDelta === undefined) {
      throw new Error('expected plan and structural deltas');
    }
    const plan = readPlan(planDelta);
    expect(plan.resolved).toBe(true);
    expect(plan.gene).toBe('HBB');
    expect(plan.variantId).toBe('HBB_repair');
    const structural = readStructural(structuralDelta);
    expect(structural.sourcedFromFixture).toBe(true);
    expect(structural.summary).toBe(HBB_REPAIR.structural.summary);
    expect(structural.limitation).toBe(HBB_REPAIR.structural.limitation);
    expect(structural.consequence).toBe(HBB_REPAIR.structural.consequence);
  });

  it('runs a real headless assay and looks up off-target risk from the registry only', () => {
    const assayDelta = latestOfKind(result().dag.all(), 'assay');
    const offDelta = latestOfKind(result().dag.all(), 'offtarget');
    if (assayDelta === undefined || offDelta === undefined) {
      throw new Error('expected assay and offtarget deltas');
    }
    expect(assayDelta.author).toBe(FunctionalAssayAgent.name);
    const assay = readAssay(assayDelta);
    expect(assay.ran).toBe(true);
    if (assay.metrics === null) {
      throw new Error('expected assay metrics');
    }
    expect(assay.metrics.occlusion).toBeGreaterThanOrEqual(0);
    expect(assay.metrics.occlusion).toBeLessThanOrEqual(1);
    if (!isOffTargetPayload(offDelta.payload)) {
      throw new Error('expected offtarget payload');
    }
    expect(offDelta.payload.method).toBe('curated-registry-lookup');
    expect(JSON.stringify(offDelta.payload)).not.toMatch(/grna|guide rna|primer|spacer/i);
    expect(offDelta.payload.hits.some((h) => h.gene === 'HBB')).toBe(true);
  });

  it('passes the in-scope HBB repair', () => {
    expect(result().blocked).toBe(false);
    expect(result().escalated).toBe(false);
    expect(result().passed).toBe(true);
    expect(result().mergeAllowed).toBe(true);
  });
});

describe('VerifierAgent can fail an optimistic edit', () => {
  it('fails an edit that structural and assay agents were optimistic about', () => {
    const dag = new DeltaDAG();
    const intent = dag.add({
      kind: 'intent',
      author: 'IntentAgent',
      subject: 'parsed-intent',
      payload: { targets: ['HBB'], operation: 'introduce', variantHint: 'HBB_HbS' },
      parents: [],
      createdAt: 0,
    });
    const screenPayload: ScreenPayload = {
      category: 'THERAPEUTIC_SOMATIC',
      verdict: 'allow',
      reason: POLICY.THERAPEUTIC_SOMATIC.reason,
      requiresSignoff: false,
      flaggedGenes: ['HBB'],
      requestDigest: digestRequest('introduce HbS in HBB'),
      redacted: false,
    };
    const screenDelta = dag.add({
      kind: 'screen',
      author: 'BiosafetyGateAgent',
      subject: 'biosafety-screen',
      payload: screenPayload,
      parents: [intent.id],
      createdAt: 1,
    });
    const planPayload: EditPlanPayload = {
      resolved: true,
      gene: 'HBB',
      variantId: 'HBB_HbS',
      variantLabel: 'HbS (sickle allele)',
      genotypeId: 'sickle',
      genotypeLabel: 'HbS / HbS',
      codonIndex: 7,
      refCodon: 'GAG',
      altCodon: 'GTG',
      kind: 'substitution',
      polymerizationTendency: 0.85,
      note: 'Resolved HBB against data/loci.json.',
    };
    const plan = dag.add({
      kind: 'edit_plan',
      author: 'EditPlannerAgent',
      subject: 'edit-plan',
      payload: planPayload,
      parents: [screenDelta.id],
      createdAt: 2,
    });
    const structuralPayload: StructuralPayload = {
      sourcedFromFixture: true,
      variantId: 'HBB_HbS',
      refAa: 'E',
      altAa: 'V',
      refAaName: 'Glutamate',
      altAaName: 'Valine',
      summary: 'Benign surface substitution; no structural concern.',
      consequence: 'Predicted to be well tolerated.',
      polymerizationTendency: 0.05,
      confidence: 'textbook-consensus',
      limitation: 'A qualitative teaching summary of a well-documented mechanism. Not output from a structure-prediction model.',
    };
    const structural = dag.add({
      kind: 'structural',
      author: StructuralImpactAgent.name,
      subject: 'structural-impact',
      payload: structuralPayload,
      parents: [plan.id],
      createdAt: 3,
    });
    const assayPayload: AssayPayload = {
      ran: true,
      params: {
        seed: 20260308,
        cellCount: 140,
        pO2: 95,
        polymerizationTendency: 0.85,
        capillaryConstriction: 0.42,
      },
      metrics: { occlusion: 0.01, meanFlow: 2.1, sickledFraction: 0.0 },
      assessment: 'flow_preserved',
      limitation: 'illustrative',
    };
    const assay = dag.add({
      kind: 'assay',
      author: FunctionalAssayAgent.name,
      subject: 'functional-assay',
      payload: assayPayload,
      parents: [structural.id],
      createdAt: 4,
    });
    const off = dag.add({
      kind: 'offtarget',
      author: 'OffTargetRiskAgent',
      subject: 'off-target-registry',
      payload: { method: 'curated-registry-lookup', targets: ['HBB'], hits: [] },
      parents: [assay.id],
      createdAt: 5,
    });

    const verdictDelta = runVerifierAgent({
      dag,
      parentId: off.id,
      createdAt: 6,
      seed: 20260308,
      steps: 160,
    });
    if (!isVerdictPayload(verdictDelta.payload)) {
      throw new Error('expected verdict payload');
    }
    expect(verdictDelta.payload.passed).toBe(false);
    expect(verdictDelta.payload.disagreedWithAssay).toBe(true);
    expect(verdictDelta.payload.disagreedWithStructural).toBe(true);
    expect(verdictDelta.payload.reasons.some((r) => /optimistic/i.test(r))).toBe(true);
    expect(verdictDelta.payload.mergeBlocked).toBe(true);
  });

  it('fails the live pipeline when the planned genotype is still the sickle allele', () => {
    const result = runPipeline({
      text: 'introduce the HbS sickle allele in HBB',
      assaySteps: 80,
    });
    expect(result.blocked).toBe(false);
    const planDelta = latestOfKind(result.dag.all(), 'edit_plan');
    const assayDelta = latestOfKind(result.dag.all(), 'assay');
    const verdictDelta = latestOfKind(result.dag.all(), 'verdict');
    if (planDelta === undefined || assayDelta === undefined || verdictDelta === undefined) {
      throw new Error('expected plan, assay and verdict');
    }
    expect(readPlan(planDelta).genotypeId).toBe('sickle');
    const assay = readAssay(assayDelta);
    expect(assay.assessment).toBe('flow_preserved');
    if (!isVerdictPayload(verdictDelta.payload)) {
      throw new Error('expected verdict payload');
    }
    expect(verdictDelta.payload.passed).toBe(false);
    expect(verdictDelta.payload.disagreedWithAssay).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.mergeAllowed).toBe(false);
  });
});
