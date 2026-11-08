'use server';

/**
 * The server boundary.
 *
 * Everything the client shell cannot compute for itself runs here, for two
 * separate reasons:
 *
 *  1. Mechanically, `lib/vcs`, `lib/agents` and `lib/safety` all reach
 *     `node:crypto`. They cannot run in a browser bundle at all.
 *  2. By policy, free text from the red-team console must be screened
 *     server-side (SPEC §7). Screening on the client would put the policy
 *     module — and the refused text — in a file the user can read and edit.
 *
 * These actions are pure functions of their arguments. They hold no session
 * state: the shell's current branch, open panes and console log live in client
 * state, and the repository is rebuilt deterministically per call. That is
 * sound because `lib/vcs` oids hash canonical JSON with explicit timestamps
 * and `lib/agents` delta ids use a logical counter, so the same inputs always
 * produce the same objects.
 */

import {
  buildDiff,
  buildMergeProposal,
  buildWorkspace,
  screenConsoleRequest,
} from '@/components/shell/model/workspace';
import type {
  BranchSpec,
  DiffView,
  MergeProposalView,
  ScreenView,
  WorkspaceView,
} from '@/components/shell/model/types';

/**
 * Screen one free-text request and, when the gate permits, run the full
 * seven-agent pipeline over it.
 *
 * The returned `ScreenView.echo` is `null` for every `redacted` verdict, and
 * that nulling happens in `screenConsoleRequest` on this side of the wire —
 * so a refused request is not sent to the client, not written to a log, and
 * not restated anywhere. What crosses back is the policy category, the
 * generic reason, and the one-way digest that makes the entry auditable
 * without retaining what was typed (SPEC §7.3).
 */
export async function screenRequestAction(input: {
  readonly text: string;
  readonly seq: number;
}): Promise<ScreenView> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new Error('A request is required.');
  }
  // Bound the input so a pathological paste cannot be used to stall the
  // deterministic screen. The limit is generous for a sentence-long request.
  if (text.length > 2000) {
    throw new Error('Request is too long to screen; keep it under 2000 characters.');
  }
  return screenConsoleRequest({ text, seq: input.seq });
}

/** The three-register diff of a branch's genotype against the reference. */
export async function diffAction(
  branch: string,
  overlay: readonly BranchSpec[] = [],
): Promise<DiffView> {
  return buildDiff(branch, overlay);
}

/**
 * Create a genotype line and return the workspace that contains it.
 *
 * The branch is a real `Repo.branch()` ref with a real `applyVariant` commit
 * and its own pipeline run — not a UI-only row. Because the server keeps no
 * session state, the new branch is expressed as a `BranchSpec` the client
 * holds and re-sends; see `BranchSpec` for why that is sound.
 *
 * Validation is here rather than in the component because this is the trust
 * seam: the branch name is the one piece of free text in the request, and the
 * variant id has to be one the fixture actually carries.
 */
export async function createBranchAction(input: {
  readonly name: string;
  readonly from: string;
  readonly variantId: string;
  readonly overlay: readonly BranchSpec[];
}): Promise<{ readonly workspace: WorkspaceView; readonly overlay: readonly BranchSpec[] }> {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error('A branch name is required.');
  }
  if (name.length > 64) {
    throw new Error('Branch names are limited to 64 characters.');
  }
  // Mirrors what `Repo.branch` will accept, and keeps a name that could be
  // confused for an oid or a path out of the ref namespace.
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)) {
    throw new Error(
      'Use letters, digits, and . _ / - only, starting with a letter or digit.',
    );
  }
  if (input.overlay.some((spec) => spec.name === name)) {
    throw new Error(`Branch '${name}' already exists.`);
  }

  const spec: BranchSpec = { name, from: input.from, variantId: input.variantId };
  const overlay = [...input.overlay, spec];
  // buildWorkspace throws if `from` is unknown or the variant is not in the
  // fixture, so a bad request fails here rather than rendering a broken line.
  return { workspace: buildWorkspace(overlay), overlay };
}

/**
 * Evaluate a merge without trusting the client.
 *
 * `signedOffBy` is supplied by the UI's sign-off control, but the decision is
 * still made by `lib/merge-gate`: a signature only clears a check that
 * `requiresSignoff`, and it cannot turn a failed check into a passing one.
 * Nothing here auto-approves an escalation (SPEC §7.5).
 */
export async function mergeProposalAction(input: {
  readonly into: string;
  readonly incoming: string;
  readonly signedOffBy?: readonly string[];
  readonly overlay?: readonly BranchSpec[];
}): Promise<MergeProposalView> {
  return buildMergeProposal({
    into: input.into,
    incoming: input.incoming,
    ...(input.signedOffBy === undefined ? {} : { signedOffBy: input.signedOffBy }),
    ...(input.overlay === undefined ? {} : { overlay: input.overlay }),
  });
}
