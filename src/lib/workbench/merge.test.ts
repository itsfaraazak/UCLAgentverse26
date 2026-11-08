import { describe, expect, it } from 'vitest';
import { computeMergeStatus } from './merge';
import { StoreError } from './store';
import { ALICE, IBC, collect, testService } from './test-helpers';
import type { MergeStatus } from './types';

function check(status: MergeStatus, id: string) {
  return status.checks.find((c) => c.id === id)!;
}

async function reviewBranch(text = 'Assess rs334') {
  const svc = testService();
  await collect(svc.preparePrompt({ branch: 'main', text, by: ALICE }));
  const name = svc.snapshot().branches.find((b) => b.name !== 'main')!.name;
  return { svc, name };
}

function statusCode(fn: () => unknown): number | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof StoreError ? err.status : -1;
  }
}

describe('merge checks', () => {
  it('names the branch after the variant and runs the required checks', async () => {
    const { svc, name } = await reviewBranch();
    expect(name).toBe('review/rs334');
    const kinds = svc.snapshot().deltas.map((d) => d.kind);
    expect(kinds).toEqual(expect.arrayContaining(['prompt', 'gate', 'evidence', 'interpretation', 'reference', 'literature', 'message']));
  });

  it('a major ClinVar disagreement needs a sign-off with a rationale', async () => {
    const { svc, name } = await reviewBranch();
    const m = svc.store.mergeStatus(name);
    expect(m.allowed).toBe(false);
    expect(check(m, 'gate').state).toBe('pass');
    expect(check(m, 'classification').state).toBe('pass');
    expect(check(m, 'reference').state).toBe('pending');
    expect(check(m, 'signoff').state).toBe('pending');
    expect(svc.merge({ branch: name, by: ALICE }).merged).toBe(false);

    const agentClass = svc.store.ancestry(name).filter((d) => d.kind === 'interpretation').at(-1)!;
    const classification = (agentClass.data as { interpretation: { classification: 'Benign' } }).interpretation.classification;
    expect(statusCode(() => svc.signoff({ branch: name, finalClassification: classification, rationale: '', by: ALICE }))).toBe(400);

    svc.signoff({
      branch: name,
      finalClassification: 'Pathogenic',
      rationale: 'Recessive disorder with heterozygote advantage; ClinVar expert panel is correct.',
      by: ALICE,
    });
    const after = svc.store.mergeStatus(name);
    expect(check(after, 'reference')).toMatchObject({ state: 'pass', detail: `Disagreement acknowledged by ${ALICE.name}.` });
    expect(check(after, 'signoff').state).toBe('pass');
    expect(after.allowed).toBe(true);
  });

  it('merge appends a merge delta to main and marks the branch merged', async () => {
    const { svc, name } = await reviewBranch();
    svc.signoff({ branch: name, finalClassification: 'Pathogenic', rationale: 'Expert panel.', by: ALICE });
    const head = svc.store.getBranch(name)!.head!;
    const res = svc.merge({ branch: name, by: ALICE });
    expect(res).toMatchObject({ merged: true, reasons: [] });
    const merge = res.snapshot.deltas.at(-1)!;
    expect(merge).toMatchObject({ kind: 'merge', branch: 'main', parents: [head], data: { branch: name, branchHead: head } });
    expect(res.snapshot.branches.find((b) => b.name === name)?.status).toBe('merged');
    expect(svc.store.getBranch('main')!.head).toBe(merge.id);
    expect(res.snapshot.merge[name].allowed).toBe(false);
    expect(statusCode(() => svc.signoff({ branch: name, finalClassification: 'Pathogenic', rationale: 'x', by: ALICE }))).toBe(409);
  });

  it('a newer interpretation makes an older sign-off stale', async () => {
    const { svc, name } = await reviewBranch();
    svc.signoff({ branch: name, finalClassification: 'Pathogenic', rationale: 'Expert panel.', by: ALICE });
    expect(svc.store.mergeStatus(name).allowed).toBe(true);

    await svc.assert({
      branch: name,
      assertion: { kind: 'segregation', value: true, reason: 'Affected siblings are homozygous.' },
      by: ALICE,
    });
    const m = svc.store.mergeStatus(name);
    expect(m.allowed).toBe(false);
    expect(check(m, 'signoff').state).toBe('pending');
    expect(check(m, 'signoff').detail).toMatch(/stale/);
    const kinds = svc.store.ancestry(name).slice(-3).map((d) => d.kind);
    expect(kinds).toEqual(['assertion', 'interpretation', 'reference']);
  });

  it('a blocked branch cannot be signed off or merged', async () => {
    const { svc, name } = await reviewBranch('Propose disrupting BRCA1');
    expect(statusCode(() => svc.signoff({ branch: name, finalClassification: 'Benign', rationale: 'x', by: ALICE }))).toBe(409);
    const res = svc.merge({ branch: name, by: ALICE });
    expect(res.merged).toBe(false);
    expect(res.reasons[0]).toMatch(/TUMOUR_SUPPRESSOR_DISRUPTION/);
  });

  it('enforces the role the policy names', async () => {
    const { svc, name } = await reviewBranch('Interpret rs334 found in an IVF embryo');
    const m = svc.store.mergeStatus(name);
    expect(m.requiredRole).toBe('Institutional biosafety committee');
    expect(statusCode(() => svc.signoff({ branch: name, finalClassification: 'Pathogenic', rationale: 'ok', by: ALICE }))).toBe(403);
    svc.signoff({ branch: name, finalClassification: 'Pathogenic', rationale: 'Reviewed by the committee.', by: IBC });
    expect(svc.store.mergeStatus(name).allowed).toBe(true);
  });

  it('rejects dismissing a criterion the engine did not apply', async () => {
    const { svc, name } = await reviewBranch();
    await expect(
      svc.assert({ branch: name, assertion: { kind: 'dismiss', code: 'PVS1', reason: 'n/a' }, by: ALICE }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses assertions before any evidence exists', async () => {
    const svc = testService();
    svc.createBranch({ title: 'Empty', from: null, by: ALICE });
    await expect(
      svc.assert({ branch: 'work/empty', assertion: { kind: 'segregation', value: true, reason: 'x' }, by: ALICE }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('fails the idle check while running', () => {
    const m = computeMergeStatus([], 'running');
    expect(m.allowed).toBe(false);
    expect(check(m, 'idle').state).toBe('fail');
    expect(check(m, 'classification').state).toBe('pending');
  });

  it('inherits the parent branch history up to the fork point', async () => {
    const { svc, name } = await reviewBranch();
    const history = svc.store.ancestry(name);
    const evidence = history.find((d) => d.kind === 'evidence')!;
    svc.createBranch({ title: 'Second opinion', from: { branch: name, delta: evidence.id }, by: ALICE });
    const forked = svc.store.ancestry('work/second-opinion');
    expect(forked.at(-1)!.id).toBe(evidence.id);
    expect(check(svc.store.mergeStatus('work/second-opinion'), 'classification').state).toBe('pending');
  });
});
