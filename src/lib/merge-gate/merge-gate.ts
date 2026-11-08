import type { Commit, MergeConflict, Oid, Repo, Tree } from '../vcs';
import type { CheckRun, EvaluateMergeArgs, MergeDecision } from './types';

type CheckClass = 'ok' | 'missing' | 'failed' | 'awaiting';

function compareOid(a: Oid, b: Oid): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function readCommit(repo: Repo, oid: Oid): Commit {
  const obj = repo.read(oid);
  if (obj.kind !== 'commit') {
    throw new Error(`expected commit at ${oid}, got ${obj.kind}`);
  }
  return obj;
}

function readTree(repo: Repo, oid: Oid): Tree {
  const obj = repo.read(oid);
  if (obj.kind !== 'tree') {
    throw new Error(`expected tree at ${oid}, got ${obj.kind}`);
  }
  return obj;
}

function entryOf(tree: Tree, gene: string): Oid | null {
  const oid = tree.entries[gene];
  return oid === undefined ? null : oid;
}

function pickThreeWay(
  base: Oid | null,
  ours: Oid | null,
  theirs: Oid | null,
): Oid | null | 'conflict' {
  if (ours === theirs) return ours;
  if (ours === base) return theirs;
  if (theirs === base) return ours;
  return 'conflict';
}

function reachableCommits(repo: Repo, start: Oid): Set<Oid> {
  const found = new Set<Oid>();
  const queue: Oid[] = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || found.has(current)) continue;
    found.add(current);
    const commit = readCommit(repo, current);
    for (const parent of commit.parents) {
      queue.push(parent);
    }
  }
  return found;
}

/**
 * Commits a merge of `theirs` into `ours` would introduce: reachable from
 * `theirs` but not from `ours`. The merge base is excluded because it is
 * already on the destination history.
 */
export function introducedCommits(repo: Repo, ours: Oid, theirs: Oid): readonly Oid[] {
  const oursReachable = reachableCommits(repo, ours);
  const base = repo.mergeBase(ours, theirs);
  if (base !== null && !oursReachable.has(base)) {
    throw new Error(`merge-gate: merge base ${base} is not reachable from ours`);
  }

  const introduced: Oid[] = [];
  const visited = new Set<Oid>();
  const queue: Oid[] = [theirs];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    if (oursReachable.has(current)) continue;
    introduced.push(current);
    const commit = readCommit(repo, current);
    for (const parent of commit.parents) {
      queue.push(parent);
    }
  }
  introduced.sort(compareOid);
  return introduced;
}

/**
 * Same per-gene three-way as `Repo.merge`, but read-only — a clean result
 * must not write a merge commit before the check gate has passed.
 */
function contentConflicts(repo: Repo, ours: Oid, theirs: Oid): MergeConflict[] {
  const oursCommit = readCommit(repo, ours);
  const theirsCommit = readCommit(repo, theirs);
  const baseOid = repo.mergeBase(ours, theirs);
  const baseTree =
    baseOid === null
      ? { kind: 'tree' as const, entries: {} }
      : readTree(repo, readCommit(repo, baseOid).tree);
  const oursTree = readTree(repo, oursCommit.tree);
  const theirsTree = readTree(repo, theirsCommit.tree);

  const genes = new Set<string>([
    ...Object.keys(baseTree.entries),
    ...Object.keys(oursTree.entries),
    ...Object.keys(theirsTree.entries),
  ]);

  const conflicts: MergeConflict[] = [];
  for (const gene of [...genes].sort()) {
    const base = entryOf(baseTree, gene);
    const ourOid = entryOf(oursTree, gene);
    const theirOid = entryOf(theirsTree, gene);
    if (pickThreeWay(base, ourOid, theirOid) === 'conflict') {
      conflicts.push({ gene, base, ours: ourOid, theirs: theirOid });
    }
  }
  return conflicts;
}

function lookupCheck(
  commitOid: Oid,
  commit: Commit,
  checks: ReadonlyMap<string, CheckRun>,
): CheckRun | undefined {
  if (commit.checkRunId !== undefined) {
    const byId = checks.get(commit.checkRunId);
    if (byId !== undefined) {
      return byId.commit === commitOid ? byId : undefined;
    }
  }
  const byCommit = checks.get(commitOid);
  if (byCommit !== undefined && byCommit.commit === commitOid) {
    return byCommit;
  }
  return undefined;
}

function hasSignoff(check: CheckRun): boolean {
  return check.signedOffBy !== undefined && check.signedOffBy.trim().length > 0;
}

function classify(check: CheckRun): CheckClass {
  switch (check.status) {
    case 'pending':
      return 'missing';
    case 'failed':
      return 'failed';
    case 'escalated':
      return hasSignoff(check) ? 'ok' : 'awaiting';
    case 'passed':
      return check.requiresSignoff && !hasSignoff(check) ? 'awaiting' : 'ok';
  }
}

function signoffRoleOf(check: CheckRun): string {
  if (check.signoffRole !== undefined && check.signoffRole.length > 0) {
    return check.signoffRole;
  }
  return 'reviewer';
}

/**
 * Decide whether `theirs` may merge into `ours`. Content conflicts are
 * reported without writing; a merge commit is written only when every
 * introduced commit has a completed passing (or signed-off) check.
 */
export function evaluateMerge(args: EvaluateMergeArgs): MergeDecision {
  const conflicts = contentConflicts(args.repo, args.ours, args.theirs);
  if (conflicts.length > 0) {
    return { allowed: false, kind: 'content-conflict', conflicts };
  }

  const incoming = introducedCommits(args.repo, args.ours, args.theirs);
  const missing: Oid[] = [];
  const failed: CheckRun[] = [];
  const awaiting: CheckRun[] = [];

  for (const oid of incoming) {
    const commit = readCommit(args.repo, oid);
    const check = lookupCheck(oid, commit, args.checks);
    if (check === undefined) {
      missing.push(oid);
      continue;
    }
    switch (classify(check)) {
      case 'missing':
        missing.push(oid);
        break;
      case 'failed':
        failed.push(check);
        break;
      case 'awaiting':
        awaiting.push(check);
        break;
      case 'ok':
        break;
    }
  }

  if (missing.length > 0) {
    return { allowed: false, kind: 'check-missing', commits: missing };
  }
  if (failed.length > 0) {
    const reasons: string[] = [];
    for (const check of failed) {
      for (const reason of check.reasons) {
        reasons.push(reason);
      }
    }
    if (reasons.length === 0) {
      reasons.push('One or more check runs failed.');
    }
    return { allowed: false, kind: 'check-failed', blocking: failed, reasons };
  }
  if (awaiting.length > 0) {
    const first = awaiting[0];
    if (first === undefined) {
      throw new Error('merge-gate: awaiting-signoff set was empty');
    }
    return {
      allowed: false,
      kind: 'awaiting-signoff',
      blocking: awaiting,
      signoffRole: signoffRoleOf(first),
    };
  }

  const merged = args.repo.merge(args.ours, args.theirs);
  if ('conflicts' in merged) {
    return { allowed: false, kind: 'content-conflict', conflicts: merged.conflicts };
  }
  return { allowed: true, oid: merged.oid };
}

export function isAllowedMerge(
  decision: MergeDecision,
): decision is { readonly allowed: true; readonly oid: Oid } {
  return decision.allowed;
}

/**
 * Record an explicit human sign-off. Never called by the pipeline.
 *
 * Low-level and deliberately permissive about status: stamping a name onto a
 * `failed` check is allowed because it does not clear the failure —
 * `classify` still reports it as failed. Callers that are acting on a user's
 * sign-off action should use `resolveSignoff`, which refuses the cases a
 * human sign-off must not reach.
 */
export function recordSignoff(check: CheckRun, signedOffBy: string): CheckRun {
  const actor = signedOffBy.trim();
  if (actor.length === 0) {
    throw new Error('merge-gate: sign-off requires a named actor');
  }
  return { ...check, signedOffBy: actor };
}

export type SignoffRefusal =
  | { readonly ok: false; readonly reason: 'not-escalated' }
  | { readonly ok: false; readonly reason: 'blocked' }
  | { readonly ok: false; readonly reason: 'check-failed' }
  | { readonly ok: false; readonly reason: 'no-role' }
  | { readonly ok: false; readonly reason: 'unnamed-actor' }
  | { readonly ok: false; readonly reason: 'already-signed' };

export type SignoffResult =
  | { readonly ok: true; readonly check: CheckRun; readonly role: string }
  | SignoffRefusal;

/**
 * The single place a human sign-off is constructed (SPEC §7.5).
 *
 * Three properties, and the reason this is one function rather than a check
 * repeated per surface:
 *
 * 1. **The role is derived, never supplied.** It is read from the check's own
 *    `signoffRole`, which `checkRunFromPipeline` copies from the policy's
 *    verdict. A caller cannot name the role that satisfies the gate, so a
 *    crafted request cannot invent one that matches.
 * 2. **A refusal has no sign-off path at all.** A `failed` check — which is
 *    what a `block` verdict becomes — is refused here outright, rather than
 *    being signed and then rejected downstream.
 * 3. **Only an escalation is signable.** A check that does not require a
 *    sign-off cannot acquire one, so the trail cannot show approvals that
 *    nothing asked for.
 *
 * Callers must not accept a role from their own caller. If a wire type
 * carries a `role` field, that is the bypass this function exists to remove.
 */
export function resolveSignoff(check: CheckRun, signedOffBy: string): SignoffResult {
  // Both a gate refusal and a verifier failure are `failed`, and neither is
  // signable. Only the wording differs, so a check that does not say it was
  // blocked is reported as a failed check rather than as a refusal.
  if (check.status === 'failed') {
    return { ok: false, reason: check.blockedAtGate === true ? 'blocked' : 'check-failed' };
  }
  if (check.status !== 'escalated' && !check.requiresSignoff) {
    return { ok: false, reason: 'not-escalated' };
  }
  if (hasSignoff(check)) return { ok: false, reason: 'already-signed' };

  const role = check.signoffRole;
  if (role === undefined || role.length === 0) return { ok: false, reason: 'no-role' };

  const actor = signedOffBy.trim();
  if (actor.length === 0) return { ok: false, reason: 'unnamed-actor' };

  return { ok: true, check: { ...check, signedOffBy: actor }, role };
}

/** Human-readable refusal text, so each surface words it the same way. */
export function signoffRefusalReason(refusal: SignoffRefusal): string {
  switch (refusal.reason) {
    case 'blocked':
      return 'This run was refused at the biosafety gate. A refusal cannot be signed off.';
    case 'check-failed':
      return 'This run did not pass its checks, so there is nothing to sign off. It was not refused at the biosafety gate.';
    case 'not-escalated':
      return 'This run is not awaiting a sign-off.';
    case 'no-role':
      return 'The policy named no sign-off role for this escalation.';
    case 'unnamed-actor':
      return 'A sign-off requires the name of the person accepting it.';
    case 'already-signed':
      return 'This run is already signed off.';
  }
}
