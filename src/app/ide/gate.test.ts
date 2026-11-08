import { describe, expect, it } from 'vitest';

import { attemptMergeAction, runPipelineAction, screenRequestAction } from './actions';
import { buildWorkspace } from '@/lib/workspace';

/**
 * Regression suite for a High-severity gate bypass.
 *
 * `runPipelineAction` used to accept a `requestText` override, and the red-team
 * console passed its own text through it. The resulting check was stored
 * against the *branch's head commit*, so screening a benign request produced a
 * passing check that gated a branch whose actual content fails. The
 * sickle-allele baseline merged into main that way — through the shipped UI,
 * no crafted payload needed.
 *
 * The property these tests hold down: a check that gates a commit must be
 * derived from that commit's own proposed edit. Nothing a caller supplies can
 * change what a branch's check says.
 */

const SICKLE_BRANCH = 'patient/hbss-baseline';
const BENIGN =
  'Restore the reference codon at HBB codon 7 in somatic cells in order to treat sickle cell disease.';

describe('a branch check is computed from the branch, not from a caller', () => {
  it('refuses to merge the sickle baseline, whose own edit fails the verifier', async () => {
    const result = await runPipelineAction(SICKLE_BRANCH);
    expect(result.run.conclusion).toBe('failed');
    expect(result.merge.allowed).toBe(false);
    expect(result.merge.kind).toBe('check-failed');
  });

  it('takes no second argument, so benign text cannot be substituted', () => {
    // The signature is the fix: there is no parameter to pass. A caller that
    // supplies one is a type error, and at runtime it is ignored.
    expect(runPipelineAction).toHaveLength(1);
  });

  it('still refuses the merge when extra arguments are forced through', async () => {
    const forced = await (
      runPipelineAction as unknown as (
        branch: string,
        text?: string,
      ) => ReturnType<typeof runPipelineAction>
    )(SICKLE_BRANCH, BENIGN);
    expect(forced.run.conclusion).toBe('failed');
    expect(forced.merge.allowed).toBe(false);
    expect(await attemptMergeAction(forced.run.id)).toMatchObject({ allowed: false });
  });

  it('screens arbitrary text without producing anything that can gate a merge', async () => {
    const consoleRun = await screenRequestAction(BENIGN);
    expect(consoleRun.conclusion).toBe('passed');
    // The console run is not addressable by the merge gate: attempting to
    // merge against its id finds no stored run at all.
    const attempt = await attemptMergeAction(consoleRun.id);
    expect(attempt.allowed).toBe(false);
    expect(attempt.kind).toBe('check-missing');
  });

  it('each branch gets the verdict its own edit earns', async () => {
    const branches = buildWorkspace().branches.filter((b) => b.baseBranch !== null);
    expect(branches.length).toBeGreaterThan(1);

    const verdicts = new Map<string, string>();
    for (const branch of branches) {
      const result = await runPipelineAction(branch.name);
      verdicts.set(branch.name, result.run.conclusion);
    }
    // Not all alike: a gate that returned one answer for every branch would
    // satisfy the assertions above while proving nothing.
    expect(new Set(verdicts.values()).size).toBeGreaterThan(1);
    expect(verdicts.get(SICKLE_BRANCH)).toBe('failed');
  });

  it('is stable across repeated runs, so a retry cannot flip the gate', async () => {
    const first = await runPipelineAction(SICKLE_BRANCH);
    const second = await runPipelineAction(SICKLE_BRANCH);
    expect(second.run.conclusion).toBe(first.run.conclusion);
    expect(second.merge.allowed).toBe(first.merge.allowed);
  });
});
