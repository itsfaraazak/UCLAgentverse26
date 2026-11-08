'use server';

/**
 * The trust boundary for /ide.
 *
 * `lib/safety/policy.ts` hashes with `node:crypto`, so it can only run on the
 * server — which is exactly where the biosafety screen belongs. Every path
 * that touches free text lives in this file, runs on the server, and returns
 * only the sanitised shapes from `lib/run-view`:
 *
 *   * the request text is a parameter and never a return value,
 *   * nothing derived from it is returned except an allow-listed gene-symbol
 *     list and the one-way digest from `lib/safety`,
 *   * pipeline runs are held server-side in `RUNS` and addressed by id, so the
 *     merge gate decides from the run the server computed rather than from a
 *     run shape the client hands back. The client cannot forge a passing run.
 *   * no action accepts a sign-off `role`. The role is derived inside
 *     `resolveSignoff` from the policy's own verdict, so a crafted request
 *     cannot name the role that satisfies the gate (SPEC §7.5).
 *
 * `RUNS` is per-server-process memory: a prototype's session store, not
 * durable state. Restarting the dev server clears it.
 */

import { runPipeline } from '@/lib/agents';
import {
  checkRunFromPipeline,
  evaluateMerge,
  resolveSignoff,
  signoffRefusalReason,
  type CheckRun,
  type MergeDecision,
} from '@/lib/merge-gate';
import { runView, type RunView } from '@/lib/run-view';
import { openWorkspace } from '@/lib/workspace';
import { shortOid } from '@/lib/vcs';
import type { PipelineResult } from '@/lib/agents';

const MAX_REQUEST_CHARS = 2000;

interface StoredRun {
  readonly branch: string;
  readonly result: PipelineResult;
  readonly check: CheckRun;
}

const RUNS = new Map<string, StoredRun>();

function clamp(text: string): string {
  return text.slice(0, MAX_REQUEST_CHARS);
}

/** The run list and the gate decision, as the CI panel renders them. */
export interface RunPipelineResult {
  readonly run: RunView;
  readonly branch: string;
  readonly merge: MergeDecisionView;
}

/**
 * The gate's decision, flattened for the client.
 *
 * `lib/merge-gate` returns a discriminated union; the panel needs a single
 * shape it can render, and the oids it carries are already abbreviated here
 * so the client never has to know the full-width form.
 */
export interface MergeDecisionView {
  readonly allowed: boolean;
  /** 'allowed', or the refusing `MergeDecision.kind`. */
  readonly kind: string;
  readonly reasons: readonly string[];
  readonly conflicts: readonly string[];
  readonly signoffRole: string | null;
  /** Abbreviated oid of the merge commit, when one was written. */
  readonly mergedOid: string | null;
  readonly target: string | null;
}

function decisionView(decision: MergeDecision, target: string | null): MergeDecisionView {
  const base = { signoffRole: null, conflicts: [], mergedOid: null, target } as const;
  switch (decision.allowed) {
    case true:
      return {
        ...base,
        allowed: true,
        kind: 'allowed',
        reasons: [],
        mergedOid: shortOid(decision.oid),
      };
    case false:
      switch (decision.kind) {
        case 'content-conflict':
          return {
            ...base,
            allowed: false,
            kind: decision.kind,
            reasons: [
              'The two branches changed the same genotype differently. Not auto-resolved.',
            ],
            conflicts: decision.conflicts.map((c) => c.gene),
          };
        case 'check-failed':
          return {
            ...base,
            allowed: false,
            kind: decision.kind,
            reasons: [...decision.reasons],
          };
        case 'awaiting-signoff':
          return {
            ...base,
            allowed: false,
            kind: decision.kind,
            reasons: [
              `This run was escalated and needs a sign-off from ${decision.signoffRole} before it can merge.`,
            ],
            signoffRole: decision.signoffRole,
          };
        case 'check-missing':
          return {
            ...base,
            allowed: false,
            kind: decision.kind,
            reasons: [
              `${decision.commits.length} incoming commit(s) have no completed check. Run the pipeline first.`,
            ],
          };
      }
  }
}

/**
 * Evaluate the gate for a stored run, against the real repository.
 *
 * The repository is rebuilt deterministically on every call, so the oids are
 * the same ones the snapshot shows. `evaluateMerge` writes the merge commit
 * only when the gate allows it — a refused merge produces no merged tree at
 * all, rather than a merged tree with a warning beside it (SPEC §7.4).
 */
function gateFor(stored: StoredRun): MergeDecisionView {
  const { snapshot, repo, heads } = openWorkspace();
  const branch = snapshot.branches.find((b) => b.name === stored.branch);
  const target = branch?.baseBranch ?? null;
  if (branch === undefined || target === null) {
    return {
      allowed: false,
      kind: 'no-target',
      reasons: ['This branch has no base branch to merge into.'],
      conflicts: [],
      signoffRole: null,
      mergedOid: null,
      target,
    };
  }

  const ours = heads.get(target);
  const theirs = heads.get(branch.name);
  if (ours === undefined || theirs === undefined) {
    return {
      allowed: false,
      kind: 'no-target',
      reasons: ['The branch heads for this merge are not in the rebuilt repository.'],
      conflicts: [],
      signoffRole: null,
      mergedOid: null,
      target,
    };
  }

  // The check must already be attributed to this branch's head. Re-pointing it
  // here would make the binding nominal — the gate would verify a field this
  // function had just written. The repository is rebuilt deterministically, so
  // a mismatch means the stored run is stale, and that fails closed.
  if (stored.check.commit !== theirs) {
    return {
      allowed: false,
      kind: 'check-missing',
      reasons: [
        'The recorded check was computed for a different commit than this branch now points at. Run the checks again.',
      ],
      conflicts: [],
      signoffRole: null,
      mergedOid: null,
      target,
    };
  }

  const checks = new Map<string, CheckRun>([[theirs, stored.check]]);
  repo.checkout(target);
  return decisionView(evaluateMerge({ repo, ours, theirs, checks }), target);
}

/**
 * Run the seven checks for a branch.
 *
 * The request is the branch's own authored request and nothing else. It used
 * to accept a `requestText` override so the red-team console could push its
 * text through the full pipeline, and that was a gate bypass: the resulting
 * check was stored against the branch's head commit, so screening *benign*
 * text produced a passing check that gated a branch whose actual content
 * fails. The sickle-allele baseline merged into main that way, through the
 * shipped UI, with no crafted request.
 *
 * A check gates a commit, so it must be derived from that commit's content.
 * The console screens arbitrary text through `screenRequestAction`, which
 * stores nothing and can gate nothing.
 */
export async function runPipelineAction(branchName: string): Promise<RunPipelineResult> {
  const { snapshot, heads } = openWorkspace();
  const branch = snapshot.branches.find((b) => b.name === branchName);
  // The requested name is not echoed back: error strings are logged by the
  // framework, and nothing client-supplied belongs in a log (SPEC §7.3).
  if (branch === undefined) throw new Error('no such branch on this workspace');

  // `classify: true` runs the ACMG stage after the gate. It adds three deltas
  // and can add a sign-off requirement; it can never remove one, and the gate
  // still terminates a blocked run at position 2 before any of it computes.
  const result = runPipeline({ text: clamp(branch.defaultRequest), classify: true });
  const head = heads.get(branch.name);
  if (head === undefined) throw new Error('branch head missing from the rebuilt repository');

  const check = checkRunFromPipeline({ commit: head, result });
  const view = runView(result);
  const stored: StoredRun = { branch: branch.name, result, check };
  RUNS.set(view.id, stored);

  return { run: view, branch: branch.name, merge: gateFor(stored) };
}

/**
 * Red-team console. Routes free text through the same `runPipeline` entry the
 * branches use — there is no privileged path into the agents — and returns the
 * run view only. For a `redacted` result the caller receives the category and
 * the generic reason; never the request, never a paraphrase of it, never a
 * template filled with it.
 */
export async function screenRequestAction(text: string): Promise<RunView> {
  return runView(runPipeline({ text: clamp(text), classify: true }));
}

export type SignOffOutcome =
  | { readonly ok: true; readonly result: RunPipelineResult; readonly role: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Record a named human sign-off against an escalated run (SPEC §7.5).
 *
 * The role is not a parameter — `resolveSignoff` derives it from the policy's
 * verdict for this run and refuses anything that is not an escalation, so a
 * block has no sign-off path at all.
 */
export async function signOffAction(runId: string, approver: string): Promise<SignOffOutcome> {
  const stored = RUNS.get(runId);
  if (stored === undefined) {
    return { ok: false, reason: 'That run is no longer in this session. Run the checks again.' };
  }

  // The approver is the one free-text field that is persisted and rendered, so
  // it is constrained to a name shape at the boundary rather than merely
  // trimmed. Without this, someone refused by the gate could paste the refused
  // text into this box and have it written to the audit trail.
  const name = approver.trim().slice(0, 120);
  if (!/^[\p{L}\p{M}][\p{L}\p{M}'’. -]{1,119}$/u.test(name)) {
    return { ok: false, reason: 'A sign-off requires a person’s name.' };
  }

  const resolved = resolveSignoff(stored.check, name);
  if (!resolved.ok) {
    return { ok: false, reason: signoffRefusalReason(resolved) };
  }

  const signed: StoredRun = { ...stored, check: resolved.check };
  RUNS.set(runId, signed);
  return {
    ok: true,
    role: resolved.role,
    result: {
      run: runView(signed.result),
      branch: signed.branch,
      merge: gateFor(signed),
    },
  };
}

/**
 * Attempt the merge. The gate is consulted from the run the server computed,
 * never from a shape the client supplied.
 */
export async function attemptMergeAction(runId: string): Promise<MergeDecisionView> {
  const stored = RUNS.get(runId);
  if (stored === undefined) {
    return {
      allowed: false,
      kind: 'check-missing',
      reasons: [
        'No pipeline run is recorded for this branch in this session. Run the checks first.',
      ],
      conflicts: [],
      signoffRole: null,
      mergedOid: null,
      target: null,
    };
  }
  return gateFor(stored);
}
