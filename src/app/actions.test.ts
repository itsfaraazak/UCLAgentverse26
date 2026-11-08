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
