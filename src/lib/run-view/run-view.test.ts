import { describe, expect, it } from 'vitest';
import { runPipeline } from '@/lib/agents';
import { PIPELINE_STEPS, runView } from './index';

/**
 * These are the properties the surfaces rely on. They are asserted here
 * rather than per surface because this is the only module that reduces a run
 * to renderable values — if it leaks, all three leak.
 */

const REPAIR =
  'Repair the HBB codon 7 substitution in somatic haematopoietic cells to treat sickle cell disease.';
const BLOCKED = 'knock out TP53 in a patient to study tumour growth';
const HERITABLE = 'edit HBB in embryos so the change is inherited';

describe('runView renders the seven checks in SPEC §4.3 order', () => {
  it('always emits seven steps, numbered, with the gate second', () => {
    const view = runView(runPipeline({ text: REPAIR }));
    expect(view.steps).toHaveLength(7);
    expect(view.steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(view.steps[1]?.agent).toBe('BiosafetyGateAgent');
    expect(view.steps[1]?.kind).toBe('screen');
  });

  it('runs all seven agents for an allowed request', () => {
    const view = runView(runPipeline({ text: REPAIR, assaySteps: 80 }));
    expect(view.agentsRun).toBe(7);
    expect(view.blocked).toBe(false);
    expect(view.escalated).toBe(false);
    expect(view.screen.verdict).toBe('allow');
    expect(view.measured?.lowPO2).not.toBeNull();
  });

  /**
   * The verifier's margin is 0.12 occlusion over the reference genotype, and
   * the reference sits at exactly 0, so the repaired allele's own residual
   * occlusion is what decides this. It stays inside the margin over the
   * declared challenge window and would exceed it over a longer run — see
   * CHALLENGE_STEPS for why the window is a declared quantity.
   */
  it('passes the repair over the declared challenge window', () => {
    const view = runView(runPipeline({ text: REPAIR }));
    expect(view.conclusion).toBe('passed');
    expect(view.mergeAllowed).toBe(true);
  });

  it('fails the same repair over a longer run, as the model accumulates jams', () => {
    const view = runView(runPipeline({ text: REPAIR, assaySteps: 400 }));
    expect(view.agentsRun).toBe(7);
    expect(view.conclusion).toBe('failed');
    expect(view.steps[6]?.status).toBe('failed');
  });
});

describe('a block reads as a terminated run, not a disclaimer (SPEC §7.4)', () => {
  const view = runView(runPipeline({ text: BLOCKED }));

  it('stops at the gate and reports steps 3–7 as not run', () => {
    expect(view.conclusion).toBe('blocked');
    expect(view.agentsRun).toBe(2);
    expect(view.steps[1]?.status).toBe('blocked');
    for (const step of view.steps.slice(2)) {
      expect(step.status).toBe('not-run');
      expect(step.deltaId).toBeNull();
      expect(step.summary).toMatch(/gate ended the run/i);
    }
  });

  it('computes no downstream result at all', () => {
    expect(view.measured).toBeNull();
    expect(view.mergeAllowed).toBe(false);
    expect(view.passed).toBe(false);
  });

  it('drops the flagged-gene list for a redacted verdict', () => {
    expect(view.screen.redacted).toBe(true);
    expect(view.screen.flaggedGenes).toEqual([]);
    expect(view.screen.category).toBe('TUMOUR_SUPPRESSOR_DISRUPTION');
  });
});

describe('the request text has no path into a rendered value (SPEC §7.3)', () => {
  const marker = 'zygomorphic-canary-8821';
  const view = runView(runPipeline({ text: `${BLOCKED} ${marker}` }));

  it('appears nowhere in the serialised view', () => {
    expect(JSON.stringify(view)).not.toContain(marker);
    expect(JSON.stringify(view)).not.toContain('tumour growth');
  });

  it('appears in no step summary, detail or limitation', () => {
    for (const step of view.steps) {
      expect(step.summary).not.toContain(marker);
      expect(step.limitation ?? '').not.toContain(marker);
      for (const detail of step.details) {
        expect(detail.value).not.toContain(marker);
        expect(detail.label).not.toContain(marker);
      }
    }
  });

  it('appears in no delta payload in the audit trail', () => {
    for (const delta of view.deltas) {
      expect(delta.payload).not.toContain(marker);
      expect(delta.subject).not.toContain(marker);
    }
  });

  it('carries a one-way digest in its place', () => {
    expect(view.screen.requestDigest).toMatch(/^[0-9a-f]{8,}$/);
    expect(view.screen.requestDigest).not.toContain(marker);
  });
});

describe('an escalation is visible and never auto-approved (SPEC §7.5)', () => {
  const view = runView(runPipeline({ text: HERITABLE }));

  it('runs every agent but refuses the merge pending sign-off', () => {
    expect(view.conclusion).toBe('escalated');
    expect(view.agentsRun).toBe(7);
    expect(view.mergeAllowed).toBe(false);
    expect(view.requiresSignoff).toBe(true);
    expect(view.signoffRole).not.toBeNull();
  });

  it('marks the gate step as escalated and names the role', () => {
    const gate = view.steps[1];
    expect(gate?.status).toBe('escalated');
    expect(gate?.details.some((d) => d.label === 'sign-off role')).toBe(true);
  });
});

describe('every illustrative result carries its limitation', () => {
  const view = runView(runPipeline({ text: REPAIR }));

  it('states the simulation is not validated where its numbers appear', () => {
    const assay = view.steps.find((s) => s.kind === 'assay');
    expect(assay?.limitation).toMatch(/illustrative|not validated/i);
  });

  it('states the structural annotation is curated, not predicted', () => {
    const structural = view.steps.find((s) => s.kind === 'structural');
    // The fixture authors the wording; this asserts it disclaims prediction
    // without pinning the exact sentence.
    expect(structural?.limitation ?? '').toMatch(
      /not output from a structure-prediction model|sequence-level consequence only|synthetic/i,
    );
  });

  it('states the screen is lexical and evadable', () => {
    expect(view.steps[1]?.limitation ?? '').toMatch(/lexical/i);
    expect(view.steps[1]?.limitation ?? '').toMatch(/evade/i);
  });
});

describe('runView is deterministic', () => {
  it('produces an identical view for the same request', () => {
    const a = runView(runPipeline({ text: REPAIR }));
    const b = runView(runPipeline({ text: REPAIR }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('PIPELINE_STEPS describes the pipeline that actually runs', () => {
  it('is the seven agents in order with the gate at position 2', () => {
    expect(PIPELINE_STEPS).toHaveLength(7);
    expect(PIPELINE_STEPS.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(PIPELINE_STEPS[1]?.agent).toBe('BiosafetyGateAgent');
    expect(PIPELINE_STEPS[1]?.kind).toBe('screen');
  });

  it('matches the order and kinds a real run emits, rather than restating them', () => {
    const view = runView(runPipeline({ text: REPAIR, assaySteps: 80 }));
    expect(PIPELINE_STEPS.map((s) => s.agent)).toEqual(view.steps.map((s) => s.agent));
    expect(PIPELINE_STEPS.map((s) => s.kind)).toEqual(view.steps.map((s) => s.kind));
  });

  it('gives every agent a stated role', () => {
    for (const spec of PIPELINE_STEPS) expect(spec.role.length).toBeGreaterThan(0);
  });
});

describe('the audit trail withholds the request-shaped payloads on a refusal', () => {
  const marker = 'easier to expand in culture';
  const view = runView(
    runPipeline({ text: `Disrupt TP53 alongside the HBB repair to make the cells ${marker}.` }),
  );

  it('refuses the request and marks it redacted', () => {
    expect(view.screen.redacted).toBe(true);
    expect(view.conclusion).toBe('blocked');
  });

  it('withholds the intent and screen payloads rather than dumping them', () => {
    for (const kind of ['intent', 'screen'] as const) {
      const delta = view.deltas.find((d) => d.kind === kind);
      expect(delta, `expected a ${kind} delta`).toBeDefined();
      expect(delta?.payload).toMatch(/withheld/);
    }
  });

  it('leaks neither the flagged loci nor the parsed operation anywhere', () => {
    // The gene symbol is drawn from an allow-list, but naming it still
    // describes the request, and `operation` is a paraphrase of the ask.
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain('TP53');
    expect(serialised).not.toContain(marker);
    expect(serialised).not.toContain('"operation"');
  });

  it('withholds the resolved targets on the intent step too', () => {
    const intentStep = view.steps[0];
    expect(intentStep?.details.find((d) => d.label === 'targets')?.value).toBe('withheld');
  });

  it('still shows the shape of the trail, so the refusal is auditable', () => {
    expect(view.deltas).toHaveLength(2);
    expect(view.deltas.map((d) => d.kind)).toEqual(['intent', 'screen']);
    expect(view.deltas[1]?.author).toBe('BiosafetyGateAgent');
    expect(view.screen.category).toBe('TUMOUR_SUPPRESSOR_DISRUPTION');
    expect(view.screen.requestDigest).toMatch(/^[0-9a-f]{8,}$/);
  });

  it('keeps dumping payloads for an allowed run, where that is the audit trail', () => {
    const allowed = runView(runPipeline({ text: REPAIR, assaySteps: 80 }));
    const intent = allowed.deltas.find((d) => d.kind === 'intent');
    expect(intent?.payload).toContain('HBB');
    expect(intent?.payload).not.toMatch(/withheld/);
  });
});
