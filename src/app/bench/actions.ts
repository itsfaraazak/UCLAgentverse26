'use server';

/**
 * Server Functions for the bench.
 *
 * The biosafety screen runs here, on the server, through the same
 * `runPipeline` entry point the frames use — there is no privileged path
 * into the agents. Only a category, a generic reason and a digest come back.
 * The caller's text is never returned, logged or persisted (SPEC §7.3).
 */

import { latestOfKind, runPipeline } from '@/lib/agents';
import { isScreenPayload } from '@/lib/agents/types';
import { PO2_RANGE, SIMULATION_DEFAULTS } from '@/lib/cellsim';
import { attemptMergeFor, runChecksFor } from './bench-data';
import type { CheckRunView, MergeAttemptView, ScreenView } from './bench-types';

/**
 * The slider's value arrives from the client, so it can be anything.
 *
 * It is not a gate input — `verifyEdit` compares at its own fixed high and low
 * pO₂, so this value never moves a pass/fail. It does reach the assay the
 * panel displays, and `NaN` or an out-of-range value would be read back as a
 * measurement, so pin it to the range the UI claims to offer.
 */
function safePO2(pO2: number): number {
  if (!Number.isFinite(pO2)) return SIMULATION_DEFAULTS.pO2;
  return Math.min(Math.max(pO2, PO2_RANGE.min), PO2_RANGE.max);
}

export async function runChecksAction(frameId: string, pO2: number): Promise<CheckRunView> {
  return runChecksFor(frameId, safePO2(pO2));
}

/**
 * Attempt a merge. `approver` is the name of the person accepting an
 * escalation, and it is the only thing the client may contribute to a
 * sign-off: the role comes from the policy and the decision comes from
 * `lib/merge-gate`. A null or malformed name simply yields no sign-off, so
 * the gate still refuses the merge (SPEC §7.5).
 */
export async function attemptMergeAction(
  frameId: string,
  pO2: number,
  approver: string | null,
): Promise<MergeAttemptView> {
  return attemptMergeFor(frameId, safePO2(pO2), approver);
}

export interface RedTeamState {
  /** Null until a request has been screened in this session. */
  result: ScreenView | null;
  /** True when the gate stopped the run before any downstream agent ran. */
  terminatedAtGate: boolean;
  /** How many of the seven agents ran at all. */
  agentsRun: number;
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
    return { ...prev, error: 'Enter a request to screen.' };
  }

  const result = runPipeline({ text, classify: true });
  const screenDelta = latestOfKind(result.dag.all(), 'screen');
  if (screenDelta === undefined || !isScreenPayload(screenDelta.payload)) {
    return { ...prev, error: 'The pipeline returned no screening result.' };
  }
  const payload = screenDelta.payload;

  // Category, reason and digest only. `flaggedGenes` holds curated gene
  // symbols resolved by the planner, and is dropped entirely when the
  // verdict is block-class so no fragment of a refused request survives.
  const view: ScreenView = {
    category: payload.category,
    verdict: payload.verdict,
    reason: payload.reason,
    requiresSignoff: payload.requiresSignoff,
    signoffRole: payload.signoffRole ?? null,
    flaggedGenes: payload.redacted ? [] : [...payload.flaggedGenes],
    requestDigest: payload.requestDigest,
    redacted: payload.redacted,
  };

  return {
    result: view,
    terminatedAtGate: result.blocked,
    agentsRun: result.dag.all().length,
    submissions: prev.submissions + 1,
    error: null,
  };
}
