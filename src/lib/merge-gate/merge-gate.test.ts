import { describe, expect, it } from 'vitest';
import { runPipeline } from '../agents';
import { isCleanMerge, Repo } from '../vcs';
import type { Oid } from '../vcs';
import type { Sequence } from '../genome';
import {
  checkRunFromPipeline,
  evaluateMerge,
  introducedCommits,
  isAllowedMerge,
  recordSignoff,
} from './index';
import type { CheckRun, CheckRunStatus, MergeDecision } from './index';

function seq(bases: string, label: string): Sequence {
  return { bases, label };
}

function blobTree(repo: Repo, entries: Record<string, Sequence>): Oid {
  const treeEntries: Record<string, Oid> = {};
  for (const gene of Object.keys(entries)) {
    const sequence = entries[gene];
    if (sequence === undefined) continue;
    treeEntries[gene] = repo.write({ kind: 'blob', sequence });
  }
  return repo.write({ kind: 'tree', entries: treeEntries });
}

function checkRun(
  commit: Oid,
  status: CheckRunStatus,
  extra: {
    readonly id?: string;
    readonly requiresSignoff?: boolean;
    readonly signoffRole?: string;
    readonly signedOffBy?: string;
    readonly reasons?: readonly string[];
  } = {},
): CheckRun {
  return {
    id: extra.id ?? `check-${commit.slice(0, 12)}`,
    commit,
    status,
    requiresSignoff: extra.requiresSignoff ?? false,
    reasons: extra.reasons ?? [],
    ...(extra.signoffRole !== undefined ? { signoffRole: extra.signoffRole } : {}),
    ...(extra.signedOffBy !== undefined ? { signedOffBy: extra.signedOffBy } : {}),
  };
}

function checksOf(...runs: CheckRun[]): Map<string, CheckRun> {
  const map = new Map<string, CheckRun>();
  for (const run of runs) {
    map.set(run.id, run);
    map.set(run.commit, run);
  }
  return map;
}

function rootRepo() {
  const repo = new Repo();
  const tree = blobTree(repo, {
    HBB: seq('ATG', 'hbb-root'),
    SYN: seq('AAA', 'syn-root'),
  });
  const root = repo.commit({
    tree,
    author: 'tester',
    message: 'root',
    timestamp: 1,
  });
  return { repo, root };
}

/** `ours` edits HBB; caller then checks out `theirs` to edit SYN (clean) or HBB (conflict). */
function diverged() {
  const { repo, root } = rootRepo();
  repo.branch('theirs');
  const oursTree = blobTree(repo, {
    HBB: seq('GTG', 'hbb-ours'),
    SYN: seq('AAA', 'syn-root'),
  });
  const ours = repo.commit({
    tree: oursTree,
    author: 'tester',
    message: 'ours: HBB',
    timestamp: 2,
    checkRunId: 'ours-check',
  });
  repo.checkout('theirs');
  return { repo, root, ours };
}

function theirsSyn(repo: Repo, timestamp: number, checkRunId: string): Oid {
  const tree = blobTree(repo, {
    HBB: seq('ATG', 'hbb-root'),
    SYN: seq('TTT', 'syn-theirs'),
  });
  return repo.commit({
    tree,
    author: 'tester',
    message: 'theirs: SYN',
    timestamp,
    checkRunId,
  });
}

function assertBlocked(decision: MergeDecision): asserts decision is Extract<
  MergeDecision,
  { allowed: false }
> {
  expect(decision.allowed).toBe(false);
  if (decision.allowed) {
    throw new Error('expected a blocked merge');
  }
}

describe('introducedCommits', () => {
  it('is empty when theirs is already on ours', () => {
    const { repo, root } = rootRepo();
    expect(introducedCommits(repo, root, root)).toEqual([]);
  });

  it('returns the exclusive theirs history, not the merge base', () => {
    const { repo, root, ours } = diverged();
    const theirs = theirsSyn(repo, 3, 't-check');
    expect(repo.mergeBase(ours, theirs)).toBe(root);
    expect(introducedCommits(repo, ours, theirs)).toEqual([theirs]);
    expect(introducedCommits(repo, ours, theirs)).not.toContain(root);
    expect(introducedCommits(repo, ours, theirs)).not.toContain(ours);
  });

  it('includes every commit from a linear theirs chain', () => {
    const { repo, ours } = diverged();
    const mid = theirsSyn(repo, 3, 'mid-check');
    const tipTree = blobTree(repo, {
      HBB: seq('ATG', 'hbb-root'),
      SYN: seq('CCC', 'syn-tip'),
    });
    const tip = repo.commit({
      tree: tipTree,
      author: 'tester',
      message: 'theirs: SYN tip',
      timestamp: 4,
      checkRunId: 'tip-check',
    });
    const incoming = introducedCommits(repo, ours, tip);
    expect(incoming).toHaveLength(2);
    expect(incoming).toEqual(expect.arrayContaining([mid, tip]));
  });
});

describe('evaluateMerge — allowed', () => {
  it('allows a merge when every introduced commit is green', () => {
    const { repo, ours } = diverged();
    const theirs = theirsSyn(repo, 3, 'theirs-check');
    const green = checkRun(theirs, 'passed', { id: 'theirs-check' });
    repo.checkout('main');
    const decision = evaluateMerge({
      repo,
      ours,
      theirs,
      checks: checksOf(green),
    });
    expect(isAllowedMerge(decision)).toBe(true);
    if (!isAllowedMerge(decision)) return;
    const mergeCommit = repo.read(decision.oid);
    expect(mergeCommit.kind).toBe('commit');
    if (mergeCommit.kind !== 'commit') return;
    expect(mergeCommit.parents).toEqual([ours, theirs]);
    expect(mergeCommit.author).toBe('sigmafold-merge');
    expect(repo.head()).toBe(decision.oid);
  });

  it('allows a two-commit branch when both introduced commits passed', () => {
    const { repo, ours } = diverged();
    const mid = theirsSyn(repo, 3, 'mid-check');
    const tipTree = blobTree(repo, {
      HBB: seq('ATG', 'hbb-root'),
      SYN: seq('GGG', 'syn-tip'),
    });
    const tip = repo.commit({
      tree: tipTree,
      author: 'tester',
      message: 'theirs: SYN tip',
      timestamp: 4,
      checkRunId: 'tip-check',
    });
    repo.checkout('main');
    const decision = evaluateMerge({
      repo,
      ours,
      theirs: tip,
      checks: checksOf(
        checkRun(mid, 'passed', { id: 'mid-check' }),
        checkRun(tip, 'passed', { id: 'tip-check' }),
      ),
    });
    expect(isAllowedMerge(decision)).toBe(true);
  });

  it('does not require a check on the merge base already reachable from ours', () => {
    const { repo, root, ours } = diverged();
    const theirs = theirsSyn(repo, 3, 'theirs-check');
    repo.checkout('main');
    const decision = evaluateMerge({
      repo,
      ours,
      theirs,
      checks: checksOf(checkRun(theirs, 'passed', { id: 'theirs-check' })),
    });
    expect(isAllowedMerge(decision)).toBe(true);
    expect(introducedCommits(repo, ours, theirs)).not.toContain(root);
  });
});

describe('evaluateMerge — fail closed', () => {
  it('fails closed: a commit with no check run is not treated as passing', () => {
    // Absence of a check must never mean pass. SPEC §1 and §9.6 put a
    // check-run gate on the merge; if missing evidence counted as green,
    // an unreviewed edit would land on the destination branch. Fail closed.
    const { repo, ours } = diverged();
    const tree = blobTree(repo, {
      HBB: seq('ATG', 'hbb-root'),
      SYN: seq('TTT', 'syn-theirs'),
    });
    const theirs = repo.commit({
      tree,
      author: 'tester',
      message: 'theirs: unchecked',
      timestamp: 3,
    });
    repo.checkout('main');
    const before = repo.head();
    const decision = evaluateMerge({
      repo,
      ours,
      theirs,
      checks: new Map(),
    });
    assertBlocked(decision);
    expect(decision.kind).toBe('check-missing');
    if (decision.kind !== 'check-missing') return;
    expect(decision.commits).toEqual([theirs]);
    expect(repo.head()).toBe(before);
    expect(repo.head()).toBe(ours);
  });

  it('blocks on a missing check even when other introduced commits passed', () => {
    const { repo, ours } = diverged();
    const midTree = blobTree(repo, {
      HBB: seq('ATG', 'hbb-root'),
      SYN: seq('TTT', 'syn-mid'),
    });
    const mid = repo.commit({
      tree: midTree,
      author: 'tester',
      message: 'theirs: mid, no check',
      timestamp: 3,
    });
    const tipTree = blobTree(repo, {
      HBB: seq('ATG', 'hbb-root'),
      SYN: seq('CCC', 'syn-tip'),
    });
    const tip = repo.commit({
      tree: tipTree,
      author: 'tester',
      message: 'theirs: tip',
      timestamp: 4,
      checkRunId: 'tip-check',
    });
    repo.checkout('main');
    const decision = evaluateMerge({
      repo,
      ours,
      theirs: tip,
      checks: checksOf(checkRun(tip, 'passed', { id: 'tip-check' })),
    });
    assertBlocked(decision);
    expect(decision.kind).toBe('check-missing');
    if (decision.kind !== 'check-missing') return;
    expect(decision.commits).toEqual([mid]);
  });

  it('treats a check whose commit field does not match as missing', () => {
    const { repo, ours } = diverged();
    const theirs = theirsSyn(repo, 3, 'theirs-check');
    repo.checkout('main');
    const decision = evaluateMerge({
      repo,
      ours,
      theirs,
      checks: checksOf(checkRun(ours, 'passed', { id: 'theirs-check' })),
    });
    assertBlocked(decision);
    expect(decision.kind).toBe('check-missing');
    if (decision.kind !== 'check-missing') return;
    expect(decision.commits).toEqual([theirs]);
  });

  it('blocks on a pending check', () => {
    const { repo, ours } = diverged();
    const theirs = theirsSyn(repo, 3, 'pending-check');
    repo.checkout('main');
    const decision = evaluateMerge({
      repo,
      ours,
      theirs,
      checks: checksOf(checkRun(theirs, 'pending', { id: 'pending-check' })),
    });
    assertBlocked(decision);
    expect(decision.kind).toBe('check-missing');
    if (decision.kind !== 'check-missing') return;
    expect(decision.commits).toEqual([theirs]);
    expect(repo.head()).toBe(ours);
  });
});

describe('evaluateMerge — failed, escalated, sign-off', () => {
  it('blocks on a failed check and carries the reasons', () => {
    const { repo, ours } = diverged();
    const theirs = theirsSyn(repo, 3, 'fail-check');
    const failed = checkRun(theirs, 'failed', {
      id: 'fail-check',
      reasons: ['Independent hypoxic run: occlusion is substantially higher than the reference genotype.'],
    });
    repo.checkout('main');
    const decision = evaluateMerge({
      repo,
      ours,
      theirs,
      checks: checksOf(failed),
    });
    assertBlocked(decision);
    expect(decision.kind).toBe('check-failed');
    if (decision.kind !== 'check-failed') return;
    expect(decision.blocking).toEqual([failed]);
    expect(decision.reasons).toEqual(failed.reasons);
    expect(repo.head()).toBe(ours);
  });

  it('blocks awaiting sign-off on an escalated check', () => {
    const { repo, ours } = diverged();
    const theirs = theirsSyn(repo, 3, 'esc-check');
    const escalated = checkRun(theirs, 'escalated', {
      id: 'esc-check',
      requiresSignoff: true,
      signoffRole: 'institutional_biosafety_committee',
      reasons: ['Request implies heritable modification.'],
    });
    repo.checkout('main');
    const decision = evaluateMerge({
      repo,
      ours,
      theirs,
      checks: checksOf(escalated),
    });
    assertBlocked(decision);
    expect(decision.kind).toBe('awaiting-signoff');
    if (decision.kind !== 'awaiting-signoff') return;
    expect(decision.signoffRole).toBe('institutional_biosafety_committee');
    expect(decision.blocking).toEqual([escalated]);
    expect(repo.head()).toBe(ours);
  });

  it('does not auto-approve an escalation: requiresSignoff without signedOffBy stays blocked', () => {
    const { repo, ours } = diverged();
    const theirs = theirsSyn(repo, 3, 'esc-check');
    repo.checkout('main');
    const decision = evaluateMerge({
      repo,
      ours,
      theirs,
      checks: checksOf(
        checkRun(theirs, 'passed', {
          id: 'esc-check',
          requiresSignoff: true,
          signoffRole: 'principal_investigator',
        }),
      ),
    });
    assertBlocked(decision);
    expect(decision.kind).toBe('awaiting-signoff');
  });

  it('allows once an explicit sign-off is recorded', () => {
    const { repo, ours } = diverged();
    const theirs = theirsSyn(repo, 3, 'esc-check');
    const escalated = checkRun(theirs, 'escalated', {
      id: 'esc-check',
      requiresSignoff: true,
      signoffRole: 'institutional_biosafety_committee',
    });
    repo.checkout('main');
    const blocked = evaluateMerge({
      repo,
      ours,
      theirs,
      checks: checksOf(escalated),
    });
    assertBlocked(blocked);
    expect(blocked.kind).toBe('awaiting-signoff');

    const signed = recordSignoff(escalated, 'dr-reviewer');
    expect(signed.signedOffBy).toBe('dr-reviewer');
    const decision = evaluateMerge({
      repo,
      ours,
      theirs,
      checks: checksOf(signed),
    });
    expect(isAllowedMerge(decision)).toBe(true);
    if (!isAllowedMerge(decision)) return;
    expect(repo.head()).toBe(decision.oid);
  });

  it('does not let a sign-off clear a failed check', () => {
    const { repo, ours } = diverged();
    const theirs = theirsSyn(repo, 3, 'fail-check');
    repo.checkout('main');
    const failed = recordSignoff(
      checkRun(theirs, 'failed', {
        id: 'fail-check',
        requiresSignoff: true,
        signoffRole: 'principal_investigator',
        reasons: ['Verifier rejected the edit.'],
      }),
      'dr-reviewer',
    );
    const decision = evaluateMerge({
      repo,
      ours,
      theirs,
      checks: checksOf(failed),
    });
    assertBlocked(decision);
    expect(decision.kind).toBe('check-failed');
  });

  it('rejects an empty actor as a sign-off', () => {
    const { repo, ours } = diverged();
    const theirs = theirsSyn(repo, 3, 'esc-check');
    const escalated = checkRun(theirs, 'escalated', {
      id: 'esc-check',
      requiresSignoff: true,
      signoffRole: 'reviewer',
    });
    expect(() => recordSignoff(escalated, '   ')).toThrow(/named actor/);
    repo.checkout('main');
    const decision = evaluateMerge({
      repo,
      ours,
      theirs,
      checks: checksOf({ ...escalated, signedOffBy: '   ' }),
    });
    assertBlocked(decision);
    expect(decision.kind).toBe('awaiting-signoff');
  });
});

describe('evaluateMerge — history, not just the tip', () => {
  it('blocks when a mid-branch commit failed even though the tip passed', () => {
    const { repo, ours } = diverged();
    const mid = theirsSyn(repo, 3, 'mid-check');
    const tipTree = blobTree(repo, {
      HBB: seq('ATG', 'hbb-root'),
      SYN: seq('CCC', 'syn-tip'),
    });
    const tip = repo.commit({
      tree: tipTree,
      author: 'tester',
      message: 'theirs: green tip',
      timestamp: 4,
      checkRunId: 'tip-check',
    });
    repo.checkout('main');
    const decision = evaluateMerge({
      repo,
      ours,
      theirs: tip,
      checks: checksOf(
        checkRun(mid, 'failed', {
          id: 'mid-check',
          reasons: ['mid-history verifier failure'],
        }),
        checkRun(tip, 'passed', { id: 'tip-check' }),
      ),
    });
    assertBlocked(decision);
    expect(decision.kind).toBe('check-failed');
    if (decision.kind !== 'check-failed') return;
    expect(decision.blocking.map((c) => c.commit)).toEqual([mid]);
    expect(decision.reasons).toContain('mid-history verifier failure');
    expect(repo.head()).toBe(ours);
  });

  it('blocks a merge-commit tip whose other parent failed, even if the tip is green', () => {
    const { repo, root } = rootRepo();
    repo.branch('side-a');
    repo.branch('side-b');
    repo.checkout('side-a');
    const a = repo.commit({
      tree: blobTree(repo, {
        HBB: seq('GTG', 'hbb-a'),
        SYN: seq('AAA', 'syn-root'),
      }),
      author: 'tester',
      message: 'side-a',
      timestamp: 2,
      checkRunId: 'a-check',
    });
    repo.checkout('side-b');
    const b = repo.commit({
      tree: blobTree(repo, {
        HBB: seq('ATG', 'hbb-root'),
        SYN: seq('TTT', 'syn-b'),
      }),
      author: 'tester',
      message: 'side-b',
      timestamp: 3,
      checkRunId: 'b-check',
    });
    repo.checkout('side-a');
    const mergedSide = repo.merge(a, b);
    if (!isCleanMerge(mergedSide)) {
      throw new Error('expected a clean content merge of side-a and side-b');
    }
    const tip = mergedSide.oid;
    repo.checkout('main');
    const decision = evaluateMerge({
      repo,
      ours: root,
      theirs: tip,
      checks: checksOf(
        checkRun(a, 'passed', { id: 'a-check' }),
        checkRun(b, 'failed', { id: 'b-check', reasons: ['side-b failed'] }),
        checkRun(tip, 'passed', { id: `check-${tip.slice(0, 12)}` }),
      ),
    });
    assertBlocked(decision);
    expect(decision.kind).toBe('check-failed');
    if (decision.kind !== 'check-failed') return;
    expect(decision.blocking.map((c) => c.commit)).toEqual([b]);
  });
});

describe('evaluateMerge — content conflicts win', () => {
  it('reports a content conflict in preference to green check state', () => {
    const { repo, ours } = diverged();
    const conflictTree = blobTree(repo, {
      HBB: seq('TTT', 'hbb-theirs'),
      SYN: seq('AAA', 'syn-root'),
    });
    const theirs = repo.commit({
      tree: conflictTree,
      author: 'tester',
      message: 'theirs: other HBB',
      timestamp: 3,
      checkRunId: 'theirs-check',
    });
    repo.checkout('main');
    const decision = evaluateMerge({
      repo,
      ours,
      theirs,
      checks: checksOf(checkRun(theirs, 'passed', { id: 'theirs-check' })),
    });
    assertBlocked(decision);
    expect(decision.kind).toBe('content-conflict');
    if (decision.kind !== 'content-conflict') return;
    expect(decision.conflicts).toEqual([expect.objectContaining({ gene: 'HBB' })]);
    expect(repo.head()).toBe(ours);
  });

  it('reports a content conflict in preference to a failing check', () => {
    const { repo, ours } = diverged();
    const conflictTree = blobTree(repo, {
      HBB: seq('TTT', 'hbb-theirs'),
      SYN: seq('AAA', 'syn-root'),
    });
    const theirs = repo.commit({
      tree: conflictTree,
      author: 'tester',
      message: 'theirs: other HBB',
      timestamp: 3,
      checkRunId: 'theirs-check',
    });
    repo.checkout('main');
    const decision = evaluateMerge({
      repo,
      ours,
      theirs,
      checks: checksOf(
        checkRun(theirs, 'failed', {
          id: 'theirs-check',
          reasons: ['would otherwise block'],
        }),
      ),
    });
    assertBlocked(decision);
    expect(decision.kind).toBe('content-conflict');
    expect(repo.head()).toBe(ours);
  });
});

describe('evaluateMerge — determinism', () => {
  it('returns the same decision for the same inputs when repeated', () => {
    const { repo, ours } = diverged();
    const theirs = theirsSyn(repo, 3, 'fail-check');
    const failed = checkRun(theirs, 'failed', {
      id: 'fail-check',
      reasons: ['stable failure reason'],
    });
    const checks = checksOf(failed);
    repo.checkout('main');
    const first = evaluateMerge({ repo, ours, theirs, checks });
    const second = evaluateMerge({ repo, ours, theirs, checks });
    expect(second).toEqual(first);
    expect(repo.head()).toBe(ours);

    const greenRepo = diverged();
    const greenTheirs = theirsSyn(greenRepo.repo, 3, 'ok-check');
    const green = checkRun(greenTheirs, 'passed', { id: 'ok-check' });
    greenRepo.repo.checkout('main');
    const allowed1 = evaluateMerge({
      repo: greenRepo.repo,
      ours: greenRepo.ours,
      theirs: greenTheirs,
      checks: checksOf(green),
    });
    const allowed2 = evaluateMerge({
      repo: greenRepo.repo,
      ours: greenRepo.ours,
      theirs: greenTheirs,
      checks: checksOf(green),
    });
    expect(allowed2).toEqual(allowed1);
    expect(isAllowedMerge(allowed1)).toBe(true);
    if (isAllowedMerge(allowed1) && isAllowedMerge(allowed2)) {
      expect(allowed2.oid).toBe(allowed1.oid);
    }
  });
});

describe('checkRunFromPipeline', () => {
  it('maps a passing in-scope repair to status passed', () => {
    const result = runPipeline({
      text: 'repair HBB to treat the sickle substitution',
      assaySteps: 80,
    });
    const check = checkRunFromPipeline({ commit: 'abc', result });
    expect(check.status).toBe('passed');
    expect(check.requiresSignoff).toBe(false);
    expect(check.signedOffBy).toBeUndefined();
    expect(check.id).toBe(result.headId);
    expect(check.commit).toBe('abc');
  });

  it('maps a blocked pipeline to failed and never invents a sign-off', () => {
    const result = runPipeline({ text: 'design a guide rna for HBB' });
    expect(result.blocked).toBe(true);
    const check = checkRunFromPipeline({ commit: 'blocked-commit', result });
    expect(check.status).toBe('failed');
    expect(check.requiresSignoff).toBe(false);
    expect(check.signedOffBy).toBeUndefined();
    expect(check.reasons.length).toBeGreaterThan(0);
    expect(JSON.stringify(check.reasons).toLowerCase()).not.toContain('guide rna');
  });

  it('maps an escalated pipeline onto escalated + requiresSignoff', () => {
    const result = runPipeline({
      text: 'repair HBB in the germline to treat sickle cell disease',
      assaySteps: 80,
    });
    expect(result.escalated).toBe(true);
    const check = checkRunFromPipeline({ commit: 'esc-commit', result });
    expect(check.status).toBe('escalated');
    expect(check.requiresSignoff).toBe(true);
    expect(check.signoffRole).toBe('institutional_biosafety_committee');
    expect(check.signedOffBy).toBeUndefined();
  });
});
