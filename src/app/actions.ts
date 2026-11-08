'use server';

/**
 * Server Functions for the bench.
 *
 * The biosafety screen runs here, on the server, and only its category,
 * reason and digest are returned. The caller's text is never echoed back,
 * never logged and never persisted — see SPEC.md §7.3.
 */

import { screen } from '@/lib/safety/policy';
import { attemptMergeFor, runChecksFor, toScreenView } from './bench-data';
import type { CheckRunView, MergeAttemptView, ScreenView } from './bench-types';

export async function runChecksAction(
  frameId: string,
  stressPO2: number,
): Promise<CheckRunView> {
  return runChecksFor(frameId, stressPO2);
}

export async function attemptMergeAction(
  frameId: string,
  signedOff: boolean,
): Promise<MergeAttemptView> {
  return attemptMergeFor(frameId, signedOff);
}

export interface RedTeamState {
  /** Null until a request has been screened in this session. */
  result: ScreenView | null;
  /** Monotonic counter so the client can tell a repeat submission apart. */
  submissions: number;
  error: string | null;
}

export async function screenRequestAction(
  prev: RedTeamState,
  formData: FormData,
): Promise<RedTeamState> {
  const raw = formData.get('request');
  const text = typeof raw === 'string' ? raw : '';
  if (text.trim().length === 0) {
    return {
      result: prev.result,
      submissions: prev.submissions,
      error: 'Enter a request to screen.',
    };
  }

  // Gene symbols are read from the request only to drive the locus registry
  // check. The tokens themselves are discarded with the rest of the text.
  const targets = [...new Set(text.toUpperCase().match(/\b[A-Z][A-Z0-9]{2,7}\b/g) ?? [])];
  const result = screen({ text, targets });

  return { result: toScreenView(result), submissions: prev.submissions + 1, error: null };
}
