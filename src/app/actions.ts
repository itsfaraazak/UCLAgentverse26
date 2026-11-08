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
  screenConsoleRequest,
} from '@/components/shell/model/workspace';
import type {
  DiffView,
  MergeProposalView,
  ScreenView,
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
export async function diffAction(branch: string): Promise<DiffView> {
  return buildDiff(branch);
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
}): Promise<MergeProposalView> {
  return buildMergeProposal({
    into: input.into,
    incoming: input.incoming,
    ...(input.signedOffBy === undefined ? {} : { signedOffBy: input.signedOffBy }),
  });
}
