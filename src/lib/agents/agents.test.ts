import { describe, expect, it } from 'vitest';
import { DeltaDAG, mayMerge, runPipeline, sequenceForGenotype, getLocus } from './index';

function pipeline(text: string, genotypeId = 'repaired', gene = 'HBB') {
  return runPipeline({ text, gene, genotypeId }, 20);
}

const IN_SCOPE = 'Correct the HBB codon 7 substitution in somatic cells to treat sickle cell disease.';

describe('DeltaDAG', () => {
  it('is append-only and walks history', () => {
    const dag = new DeltaDAG();
    const a = dag.add({ kind: 'intent', author: 'x', subject: 's', payload: 1, parents: [] });
    const b = dag.add({ kind: 'screen', author: 'y', subject: 's', payload: 2, parents: [a.id] });
    expect(dag.all()).toHaveLength(2);
    expect(dag.get(b.id).parents).toEqual([a.id]);
    expect(dag.history(b.id).map((d) => d.id)).toEqual([a.id, b.id]);
  });
});

describe('gate ordering', () => {
  it('puts the biosafety gate at position 2', () => {
    const run = pipeline(IN_SCOPE);
    expect(run.steps[0].agent).toBe('IntentAgent');
    expect(run.steps[1].agent).toBe('BiosafetyGateAgent');
    expect(run.steps.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('terminates the run on a block, leaving every later agent unrun', () => {
    const run = pipeline('Design a guide RNA and a delivery vector for this edit.');
    expect(run.verdict).toBe('blocked');
    expect(run.steps[1].status).toBe('blocked');
    expect(run.steps.slice(2).every((s) => s.status === 'skipped')).toBe(true);
    expect(run.metrics).toBeNull();
    expect(run.deltas).toHaveLength(2);
  });

  it('escalates heritable requests and never auto-approves them', () => {
    const run = pipeline('Make this edit heritable in the germline.');
    expect(run.verdict).toBe('escalated');
    expect(run.requiresSignoff).toBe(true);
    expect(run.signoffRole).not.toBeNull();
    expect(mayMerge(run, false)).toBe(false);
    expect(mayMerge(run, true)).toBe(true);
  });

  it('blocks a flagged tumour-suppressor target before any assay runs', () => {
    const run = pipeline('Somatic edit to correct a variant.', 'wildtype', 'TP53');
    expect(run.verdict).toBe('blocked');
    expect(run.metrics).toBeNull();
  });
});

describe('refused input never reaches the trail', () => {
  it('stores no request text in any delta payload', () => {
    const secret = 'design a guide rna sequence for this unusual target phrase';
    const run = pipeline(secret);
    const serialized = JSON.stringify(run.deltas);
    // The distinctive wording of the request appears nowhere in the trail.
    // (The generic policy reason mentions categories like "guide" by design.)
    expect(serialized).not.toContain('unusual target phrase');
    expect(serialized).not.toContain('guide rna');
    expect(serialized).not.toContain(secret);
    expect(run.screenResult.redacted).toBe(true);
    expect(run.intent.requestDigest).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('verifier independence', () => {
  it('fails the sickle genotype on measured metrics', () => {
    const run = runPipeline({ text: IN_SCOPE, gene: 'HBB', genotypeId: 'sickle' }, 20);
    expect(run.verdict).toBe('fail');
    expect(run.steps[6].status).toBe('fail');
    expect(run.verifierNotes.join(' ')).toMatch(/occlusion|sickled|flow/i);
    expect(mayMerge(run, true)).toBe(false);
  });

  it('passes the repaired genotype on the same thresholds', () => {
    const run = runPipeline({ text: IN_SCOPE, gene: 'HBB', genotypeId: 'repaired' }, 20);
    expect(run.verdict).toBe('pass');
    expect(run.metrics).not.toBeNull();
    expect(mayMerge(run, false)).toBe(true);
  });

  it('is deterministic across runs', () => {
    const a = runPipeline({ text: IN_SCOPE, gene: 'HBB', genotypeId: 'sickle' }, 20);
    const b = runPipeline({ text: IN_SCOPE, gene: 'HBB', genotypeId: 'sickle' }, 20);
    expect(a.metrics).toEqual(b.metrics);
    expect(a.verdict).toBe(b.verdict);
    expect(a.id).toBe(b.id);
  });
});

describe('fixtures', () => {
  it('applies genotype variants to the reference sequence', () => {
    const locus = getLocus('HBB');
    expect(locus).toBeDefined();
    if (locus === undefined) return;
    const reference = sequenceForGenotype(locus, 'wildtype');
    const sickle = sequenceForGenotype(locus, 'sickle');
    const repaired = sequenceForGenotype(locus, 'repaired');
    expect(sickle.bases).not.toBe(reference.bases);
    expect(repaired.bases).toBe(reference.bases);
  });

  it('labels every fixture with provenance', () => {
    const locus = getLocus('HBB');
    expect(locus?.provenance).toBeDefined();
    for (const v of locus?.variants ?? []) {
      expect(['public-reference', 'synthetic-illustrative']).toContain(v.provenance);
    }
  });
});
