/**
 * The server actions' trust seam.
 *
 * These assert the input bounds rather than the happy path — the happy path is
 * covered through the model in `components/shell/model/workspace.test.ts`.
 * What matters here is that a client cannot hand the server an overlay that
 * costs it an unbounded amount of work, which a review found it could.
 */

import { describe, expect, it } from 'vitest';

import { diffAction, createBranchAction, mergeProposalAction } from './actions';
import type { BranchSpec } from '@/components/shell/model/types';

const valid: BranchSpec = {
  name: 'line/probe',
  from: 'main',
  variantId: 'HBB_HbS',
};

function chain(n: number): BranchSpec[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `line/p${i}`,
    from: i === 0 ? 'main' : `line/p${i - 1}`,
    variantId: 'HBB_HbS',
  }));
}

describe('overlay validation is applied on every action that accepts one', () => {
  it('caps the replay list', async () => {
    // Unbounded, this is a single synchronous request that re-seeds the repo
    // and walks a quadratic number of commits.
    await expect(diffAction('main', chain(26))).rejects.toThrow(/At most 25/);
    await expect(
      mergeProposalAction({ into: 'main', incoming: 'main', overlay: chain(26) }),
    ).rejects.toThrow(/At most 25/);
    await expect(
      createBranchAction({ ...valid, overlay: chain(26) }),
    ).rejects.toThrow(/At most 25/);
  });

  it('validates every inherited spec, not just the newest', async () => {
    const tampered: BranchSpec[] = [{ ...valid, name: '../../etc/passwd' }];
    await expect(diffAction('main', tampered)).rejects.toThrow(/letters, digits/);
    await expect(
      createBranchAction({ name: 'line/ok', from: 'main', variantId: 'HBB_HbS', overlay: tampered }),
    ).rejects.toThrow(/letters, digits/);
  });

  it('rejects an over-long name and a duplicate', async () => {
    await expect(
      diffAction('main', [{ ...valid, name: 'a'.repeat(65) }]),
    ).rejects.toThrow(/64 characters/);
    await expect(diffAction('main', [valid, valid])).rejects.toThrow(/twice/);
  });

  it('still rejects a variant the fixture does not carry', async () => {
    await expect(
      createBranchAction({
        name: 'line/ok',
        from: 'main',
        variantId: 'NOT_A_VARIANT',
        overlay: [],
      }),
    ).rejects.toThrow(/not in data\/loci\.json/);
  });

  it('accepts a well-formed overlay', async () => {
    const result = await createBranchAction({ ...valid, overlay: [] });
    expect(result.overlay).toHaveLength(1);
    expect(result.workspace.branches.some((b) => b.name === valid.name)).toBe(true);
  });
});

describe('createBranchAction explains an incoherent source-and-edit pair', () => {
  // The form offers every source crossed with every curated edit, and the most
  // natural click — branch from the reference, apply Repair — is one of the
  // pairs that cannot work. `applyVariant` is right to refuse it; the judge
  // should not meet that refusal as `refCodon mismatch at 7`.
  it('names the codon, both sides, and what to branch from instead', async () => {
    await expect(
      createBranchAction({
        name: 'line/repair-from-main',
        from: 'main',
        variantId: 'HBB_repair',
        overlay: [],
      }),
    ).rejects.toThrow(
      /does not apply to `main`[\s\S]*codon 7[\s\S]*carries GAG there[\s\S]*repair applies/,
    );
  });

  it('still creates the coherent pair it was offered alongside', async () => {
    const { workspace } = await createBranchAction({
      name: 'line/sickle-from-main',
      from: 'main',
      variantId: 'HBB_HbS',
      overlay: [],
    });
    expect(workspace.branches.map((b) => b.name)).toContain('line/sickle-from-main');
  });

  it('does not swallow an unrelated failure', async () => {
    // An unknown variant is a different fault and must not be reworded as a
    // codon mismatch, or the translation would be hiding errors.
    await expect(
      createBranchAction({
        name: 'line/nope',
        from: 'main',
        variantId: 'HBB_does_not_exist',
        overlay: [],
      }),
    ).rejects.toThrow(/^(?![\s\S]*does not apply to)[\s\S]*/);
  });
});
