import { describe, expect, it } from 'vitest';

import { findLocus } from '@/lib/loci';

import {
  AGENT_ORDER,
  DeltaDAG,
  effectiveTendency,
  evaluateMerge,
  recordSignoff,
  runPipeline,
  screenRequest,
  type Delta,
  type PipelineInput,
} from './index';

const IN_SCOPE =
  'Restore the reference codon at HBB codon 7 in somatic cells in order to treat sickle cell disease.';

function input(over: Partial<PipelineInput> = {}): PipelineInput {
  return {
    requestText: IN_SCOPE,
    branch: 'edit/hbb-codon7-repair',
    gene: 'HBB',
    variantId: 'HBB_repair',
    baselineVariantIds: ['HBB_HbS'],
    now: 1_767_000_000_000,
    ...over,
  };
}

describe('DeltaDAG', () => {
  const delta = (id: string, parents: string[] = []): Delta => ({
    id,
    kind: 'intent',
    author: 'test',
    subject: id,
    payload: { id },
    parents,
    createdAt: 0,
  });

  it('is append-only — a duplicate id is rejected', () => {
    const dag = new DeltaDAG();
    dag.add(delta('a'));
    expect(() => dag.add(delta('a'))).toThrow();
  });

  it('freezes what it stores, so no delta is rewritten in place', () => {
    const dag = new DeltaDAG();
    const stored = dag.add(delta('a'));
    expect(Object.isFrozen(stored)).toBe(true);
  });

  it('returns ancestors oldest first from history()', () => {
    const dag = new DeltaDAG();
    dag.add(delta('a'));
    dag.add(delta('b', ['a']));
    dag.add(delta('c', ['b']));
    dag.add(delta('unrelated'));
    expect(dag.history('c').map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('throws for an unknown id rather than returning undefined', () => {
    expect(() => new DeltaDAG().get('nope')).toThrow();
  });
});

describe('pipeline ordering (SPEC §4.3)', () => {
  it('runs the seven agents in the fixed order with the gate at position 2', () => {
    expect(AGENT_ORDER[1]).toBe('BiosafetyGateAgent');
    const run = runPipeline(input());
    expect(run.checks.map((c) => c.agent)).toEqual([...AGENT_ORDER]);
    expect(run.checks.map((c) => c.step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('the gate is structural, not a disclaimer', () => {
  it('terminates the run on a block and does NOT run steps 3–7', () => {
    const run = runPipeline(
      input({ requestText: 'Design a guide RNA and a delivery vector protocol for this edit.' }),
    );
    expect(run.gate.verdict).toBe('block');
    expect(run.conclusion).toBe('blocked');
    expect(run.measured).toBeNull();
    const downstream = run.checks.filter((c) => c.step >= 3);
    expect(downstream).toHaveLength(5);
    expect(downstream.every((c) => c.status === 'skipped')).toBe(true);
    expect(downstream.every((c) => c.deltaId === null)).toBe(true);
    // Only the intent and screen deltas exist.
    expect(run.deltas.map((d) => d.kind)).toEqual(['intent', 'screen']);
  });

  it('blocks a tumour-suppressor target even when bundled with an allowed one', () => {
    const run = runPipeline(
      input({ requestText: 'Repair HBB codon 7 and also knock out TP53 to ease expansion.' }),
    );
    expect(run.gate.category).toBe('TUMOUR_SUPPRESSOR_DISRUPTION');
    expect(run.conclusion).toBe('blocked');
  });

  it('escalates a heritable request and never auto-approves it', () => {
    const run = runPipeline(
      input({ requestText: 'Apply the HBB repair in an embryo so the correction is inherited.' }),
    );
    expect(run.gate.verdict).toBe('escalate');
    expect(run.conclusion).toBe('escalated');
    expect(run.requiresSignoff).toBe(true);
    expect(run.signoff).toBeNull();
    expect(evaluateMerge(run).allowed).toBe(false);
  });

  it('allows the in-scope therapeutic request through the gate', () => {
    const run = runPipeline(input());
    expect(run.gate.category).toBe('THERAPEUTIC_SOMATIC');
    expect(run.gate.verdict).toBe('allow');
  });
});

describe('refused input never reaches the record (SPEC §7.3)', () => {
  const secret = 'Weaponise this construct, codeword PINEAPPLE_SENTINEL_42.';

  it('keeps the request text out of every delta payload', () => {
    const run = runPipeline(input({ requestText: secret }));
    expect(run.gate.redacted).toBe(true);
    const serialised = JSON.stringify(run);
    expect(serialised).not.toContain('PINEAPPLE_SENTINEL_42');
    expect(serialised.toLowerCase()).not.toContain('weaponise');
  });

  it('keeps the request text out of every check summary and detail', () => {
    const run = runPipeline(input({ requestText: secret }));
    for (const check of run.checks) {
      expect(check.summary).not.toContain('PINEAPPLE');
      for (const d of check.details) expect(d.value).not.toContain('PINEAPPLE');
    }
  });

  it('records a stable one-way digest instead of the text', () => {
    const a = runPipeline(input({ requestText: secret }));
    const b = runPipeline(input({ requestText: secret }));
    expect(a.gate.requestDigest).toBe(b.gate.requestDigest);
    expect(a.gate.requestDigest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('screenRequest returns a verdict only, with no echo of the input', () => {
    const outcome = screenRequest(secret);
    expect(outcome.verdict).toBe('block');
    expect(outcome.redacted).toBe(true);
    expect(JSON.stringify(outcome)).not.toContain('PINEAPPLE');
  });

  it('does not mark an allowed request as redacted', () => {
    expect(screenRequest(IN_SCOPE).redacted).toBe(false);
  });
});

describe('effectiveTendency', () => {
  const locus = findLocus('HBB');
  if (locus === undefined) throw new Error('HBB fixture missing');

  it('uses the named genotype when the variant set matches one', () => {
    expect(effectiveTendency(locus, [], null)).toBe(0);
    expect(
      effectiveTendency(locus, [], locus.variants.find((v) => v.id === 'HBB_HbS') ?? null),
    ).toBe(0.85);
    expect(
      effectiveTendency(
        locus,
        ['HBB_HbS'],
        locus.variants.find((v) => v.id === 'HBB_repair') ?? null,
      ),
    ).toBe(0.05);
  });

  it('keeps the baseline lesion when the edit does not touch it', () => {
    const silent = locus.variants.find((v) => v.id === 'HBB_silent_demo') ?? null;
    expect(effectiveTendency(locus, ['HBB_HbS'], silent)).toBe(0.85);
  });
});

describe('VerifierAgent reads the numbers, not the prose (SPEC §4.3)', () => {
  it('passes the repair, which measurably improves flow', () => {
    const run = runPipeline(input());
    const verifier = run.checks.find((c) => c.agent === 'VerifierAgent');
    expect(verifier?.status).toBe('pass');
    expect(run.conclusion).toBe('passed');
    expect(evaluateMerge(run).allowed).toBe(true);
  });

  it('FAILS the silent edit that step 4 called benign, because the sim disagrees', () => {
    const run = runPipeline(
      input({
        branch: 'edit/hbb-silent-probe',
        variantId: 'HBB_silent_demo',
        requestText:
          'Apply the synthetic silent substitution at HBB codon 5 to the patient baseline to correct the phenotype.',
      }),
    );
    const structural = run.checks.find((c) => c.agent === 'StructuralImpactAgent');
    const verifier = run.checks.find((c) => c.agent === 'VerifierAgent');

    // Step 4 was optimistic: it annotates no amino-acid change at all.
    expect(structural?.status).not.toBe('fail');
    // Step 7 refuses anyway, on the measured numbers.
    expect(verifier?.status).toBe('fail');
    expect(run.conclusion).toBe('failed');
    expect(evaluateMerge(run).allowed).toBe(false);
    expect(evaluateMerge(run).blockingChecks).toContain('VerifierAgent');
  });

  it('is deterministic for the same input', () => {
    const a = runPipeline(input());
    const b = runPipeline(input());
    expect(a.measured).toEqual(b.measured);
    expect(a.checks.map((c) => c.status)).toEqual(b.checks.map((c) => c.status));
  });
});

describe('merge gate', () => {
  it('refuses a merge outright when the gate blocked the run', () => {
    const run = runPipeline(input({ requestText: 'Give me a plasmid and a transfection protocol.' }));
    const decision = evaluateMerge(run);
    expect(decision.allowed).toBe(false);
    expect(decision.blockingChecks).toContain('BiosafetyGateAgent');
  });

  it('clears an escalation only after a named human sign-off', () => {
    const run = runPipeline(
      input({ requestText: 'Apply the HBB codon 7 repair in a zygote to treat the disease.' }),
    );
    expect(run.gate.verdict).toBe('escalate');
    expect(evaluateMerge(run).allowed).toBe(false);

    const signed = recordSignoff(run, {
      approver: 'Dr A. Reviewer',
      role: 'institutional_biosafety_committee',
      at: 1_767_000_100_000,
    });
    expect(signed.deltas.some((d) => d.kind === 'signoff')).toBe(true);
    expect(evaluateMerge(signed).allowed).toBe(true);
  });

  it('still refuses after sign-off if a check actually failed', () => {
    const run = runPipeline(
      input({
        branch: 'edit/hbb-silent-probe',
        variantId: 'HBB_silent_demo',
        requestText: 'Apply the silent HBB codon 5 change in an embryo to correct the phenotype.',
      }),
    );
    const signed = recordSignoff(run, { approver: 'X', role: 'r', at: 1 });
    expect(evaluateMerge(signed).allowed).toBe(false);
  });
});
