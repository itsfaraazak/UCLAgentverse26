import { describe, expect, it } from 'vitest';
import { runPipeline } from '@/lib/agents';
import { runView } from './index';

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

  it('shows the verifier passing the repair at a short assay', () => {
    const view = runView(runPipeline({ text: REPAIR, assaySteps: 80 }));
    expect(view.conclusion).toBe('passed');
    expect(view.mergeAllowed).toBe(true);
  });

  /**
   * The same request fails at the default assay length. This is not a bug in
   * this module: the verifier reads a 48-step trailing window, and for the
   * repaired genotype (tendency 0.05) an intermittent jam in that final
   * window reads as elevated occlusion against a reference that sits at
   * exactly 0. It is pinned here so the instability is visible in the suite
   * rather than surfacing as a flaky demo. See the PR for the measurements.
   */
  it('fails the same repair at the default assay length — a known instability', () => {
    const view = runView(runPipeline({ text: REPAIR }));
    expect(view.agentsRun).toBe(7);
    expect(view.conclusion).toBe('failed');
    const verdictStep = view.steps[6];
    expect(verdictStep?.status).toBe('failed');
    expect(verdictStep?.details.some((d) => d.label === 'disagreement')).toBe(true);
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
