'use server';

/**
 * The trust boundary.
 *
 * `lib/safety/policy.ts` hashes with `node:crypto`, so it can only run on the
 * server — which is exactly where the biosafety screen belongs. Every path
 * that touches free text lives in this file, runs on the server, and returns
 * only the sanitised shapes from `lib/agents`:
 *
 *   * the request text is a parameter and never a return value,
 *   * nothing derived from it is returned except an allow-listed gene-symbol
 *     list and the one-way digest from `lib/safety`,
 *   * the one other free-text field in the app — the escalation approver's
 *     name — never passes through the screen, so it is constrained to a name
 *     shape here before it can reach the delta trail,
 *   * pipeline runs are held server-side in `RUNS` and addressed by id, so the
 *     merge gate decides from the run the server computed rather than from a
 *     run shape the client hands back. The client cannot forge a passing run.
 *
 * `RUNS` is per-server-process memory: a prototype's session store, not
 * durable state. Restarting the dev server clears it.
 */

import {
  evaluateMerge,
  recordSignoff,
  runPipeline,
  screenRequest,
  type GateOutcome,
  type MergeDecision,
  type PipelineRun,
} from '@/lib/agents';
import { shortOid, Repo } from '@/lib/vcs';
import { buildWorkspace, AUTHOR } from '@/lib/workspace';

const RUNS = new Map<string, PipelineRun>();
const MAX_REQUEST_CHARS = 2000;

function clamp(text: string): string {
  return text.slice(0, MAX_REQUEST_CHARS);
}

/**
 * Red-team console. Routes free text through `lib/safety` and returns the
 * policy verdict only. For a `redacted` result the caller receives the
 * category and the generic reason — never the request, never a paraphrase of
 * it, never a template filled with it.
 */
export async function screenRequestAction(text: string): Promise<GateOutcome> {
  const workspace = buildWorkspace();
  return screenRequest(clamp(text), [workspace.gene]);
}

export interface RunPipelineResult {
  readonly run: PipelineRun;
  readonly merge: MergeDecision;
}

/**
 * Run the seven checks for a branch. `requestText` defaults to the branch's
 * own authored request; the red-team console can substitute its own, which is
 * how an escalation reaches the merge gate.
 */
export async function runPipelineAction(
  branchName: string,
  requestText?: string,
): Promise<RunPipelineResult> {
  const workspace = buildWorkspace();
  const branch = workspace.branches.find((b) => b.name === branchName);
  // The requested name is not echoed back: error strings are logged by the
  // framework, and nothing client-supplied belongs in a log (SPEC §7.3).
  if (branch === undefined) throw new Error('no such branch on this workspace');

  const run = runPipeline({
    requestText: clamp(requestText ?? branch.defaultRequest),
    branch: branch.name,
    gene: workspace.gene,
    variantId: branch.editVariantId,
    baselineVariantIds: branch.baselineVariantIds,
    now: Date.now(),
  });

  RUNS.set(run.id, run);
  return { run, merge: evaluateMerge(run) };
}

/**
 * Record a named human sign-off against an escalated run. Nothing else in the
 * app calls this: an escalation is only ever cleared by this explicit action
 * (SPEC §7.5).
 */
export async function signOffAction(
  runId: string,
  approver: string,
): Promise<RunPipelineResult> {
  const existing = RUNS.get(runId);
  if (existing === undefined) throw new Error('that run is no longer in this session');
  if (existing.conclusion === 'blocked') {
    // A blocked run is not signable. There is no sign-off path past a block.
    throw new Error('a blocked run cannot be signed off');
  }
  if (!existing.requiresSignoff) throw new Error('that run does not require sign-off');
  if (existing.signoff !== null) throw new Error('that run is already signed off');

  // The approver is the one free-text field that is persisted and rendered, so
  // it is constrained to a name shape at the boundary rather than merely
  // trimmed. Without this, someone refused by the gate could paste the refused
  // text into this box and have it written to the append-only delta trail.
  const name = approver.trim().slice(0, 120);
  if (!/^[\p{L}\p{M}][\p{L}\p{M}'’. -]{1,119}$/u.test(name)) {
    throw new Error('sign-off requires a person’s name');
  }

  const signed = recordSignoff(existing, {
    approver: name,
    role: existing.signoffRole ?? 'human_reviewer',
    at: Date.now(),
  });
  RUNS.set(signed.id, signed);
  return { run: signed, merge: evaluateMerge(signed) };
}

export interface MergeAttempt {
  readonly decision: MergeDecision;
  /** Present only when the gate allowed the merge to be attempted. */
  readonly vcs: string | null;
  readonly target: string | null;
}

/**
 * Attempt the merge. The gate is consulted first and the three-way merge is
 * only computed if the gate allows it — a refused merge produces no merged
 * tree at all, rather than a merged tree with a warning next to it.
 */
export async function attemptMergeAction(runId: string): Promise<MergeAttempt> {
  const run = RUNS.get(runId);
  if (run === undefined) {
    return {
      decision: {
        allowed: false,
        reason: 'No pipeline run is recorded for this branch in this session. Run the checks first.',
        blockingChecks: [],
      },
      vcs: null,
      target: null,
    };
  }

  const decision = evaluateMerge(run);
  const workspace = buildWorkspace();
  const branch = workspace.branches.find((b) => b.name === run.branch);
  const target = branch?.baseBranch ?? null;

  if (!decision.allowed || branch === undefined || target === null) {
    return { decision, vcs: null, target };
  }

  // Rebuild the repository (deterministic, same oids) and merge for real.
  const rebuilt = buildWorkspace();
  const targetBranch = rebuilt.branches.find((b) => b.name === target);
  if (targetBranch === undefined) return { decision, vcs: null, target };

  const repo = new Repo();
  const ourBlob = repo.write({ kind: 'blob', sequence: branch.altSequence });
  const theirBlob = repo.write({ kind: 'blob', sequence: targetBranch.altSequence });
  // The merge base is the genotype this branch forked from — not the target's
  // own parent. Using the target's parent makes both sides look changed and
  // produces a spurious conflict on a branch that merges cleanly.
  const baseBlob = repo.write({ kind: 'blob', sequence: branch.refSequence });

  const baseTree = repo.write({ kind: 'tree', entries: { [rebuilt.gene]: baseBlob } });
  repo.branch('base');
  repo.checkout('base');
  const baseCommit = repo.commit({
    tree: baseTree,
    parents: [],
    author: AUTHOR,
    message: 'merge base',
    timestamp: 0,
  });

  const ourTree = repo.write({ kind: 'tree', entries: { [rebuilt.gene]: ourBlob } });
  repo.branch('ours', baseCommit);
  repo.checkout('ours');
  const ourCommit = repo.commit({
    tree: ourTree,
    parents: [baseCommit],
    author: AUTHOR,
    message: branch.name,
    timestamp: 1,
  });

  const theirTree = repo.write({ kind: 'tree', entries: { [rebuilt.gene]: theirBlob } });
  repo.branch('theirs', baseCommit);
  repo.checkout('theirs');
  const theirCommit = repo.commit({
    tree: theirTree,
    parents: [baseCommit],
    author: AUTHOR,
    message: target,
    timestamp: 2,
  });

  const result = repo.merge(ourCommit, theirCommit);
  const vcs =
    'conflicts' in result
      ? `CONFLICT in ${result.conflicts.map((c) => c.gene).join(', ')} — ${run.branch} and ${target} changed the same genotype differently. Not auto-resolved.`
      : `Merged genotype tree ${shortOid(result.oid)} (base ${shortOid(baseCommit)}).`;

  return { decision, vcs, target };
}
