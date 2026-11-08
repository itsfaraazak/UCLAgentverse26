'use server';

/**
 * Server Actions. Everything that touches `lib/safety` or `lib/vcs` runs here,
 * because both use `node:crypto` and must not be bundled for the browser.
 *
 * Two safety properties this boundary buys us (SPEC §7):
 *
 * 1. **The gate cannot be reordered or skipped from the client.** `attemptMerge`
 *    rebuilds the scenario and re-runs the pipeline server-side, then consults
 *    the merge gate before calling `Repo.merge`. A hand-rolled POST to this
 *    action is checked exactly like a button press; nothing the client sends
 *    can mark a run as passing.
 *
 * 2. **Refused request text never comes back.** `runProposal` takes the text,
 *    runs the pipeline on it, and returns only the run's own output plus two
 *    derived counts. The return type has no field for the text, so there is no
 *    path by which it can reach the DOM, a log line or the delta trail — and no
 *    server-side store keeps it either.
 */

import { FLAGGED_LOCI } from '@/lib/safety/policy';
import { allLoci } from '@/lib/fixtures/loci';
import {
  attemptMerge as runMerge,
  buildScenario,
  runProposal as runProposalPipeline,
} from '@/lib/demo/scenario';
import type {
  ConsoleRunView,
  MergeOutcome,
  MergeRequest,
  ScenarioView,
  SignoffRequest,
} from '@/lib/demo/view';

export interface SessionState {
  readonly appliedMerges: readonly MergeRequest[];
  readonly signoffs: readonly SignoffRequest[];
}

/**
 * The demo has six branches, so a legitimate session can never need many
 * entries. Every action replays the whole list to rebuild the history, so an
 * unbounded array from the client is cheap server CPU amplification; bound it.
 */
const MAX_REPLAY = 32;

/**
 * A sign-off is only as good as the name on it, so the name is required and
 * shape-checked here. Unbounded free text would also be replayed through
 * `buildScenario` on every later action.
 */
const APPROVER_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}'’. -]{1,119}$/u;

function bounded(state: SessionState): {
  readonly appliedMerges: readonly MergeRequest[];
  readonly signoffs: readonly SignoffRequest[];
} {
  const seenMerge = new Set<string>();
  const appliedMerges = (state.appliedMerges ?? [])
    .filter((m) => {
      const key = `${m.into}\u0000${m.from}`;
      if (seenMerge.has(key)) return false;
      seenMerge.add(key);
      return true;
    })
    .slice(0, MAX_REPLAY);
  const seenBranch = new Set<string>();
  const signoffs = (state.signoffs ?? [])
    .filter((s) => {
      if (seenBranch.has(s.branch)) return false;
      seenBranch.add(s.branch);
      return true;
    })
    .slice(0, MAX_REPLAY);
  return { appliedMerges, signoffs };
}

/** Gene symbols this prototype can resolve from free text. */
const KNOWN_GENES: readonly string[] = [
  ...new Set([...FLAGGED_LOCI.map((l) => l.gene), ...allLoci().map((l) => l.gene)]),
].sort();

/**
 * Resolve gene symbols from free text, as the planner would. Whole-word match
 * only, so "APC" in prose matches but "capcom" does not.
 */
function resolveTargets(text: string): string[] {
  const upper = ` ${text.toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `;
  return KNOWN_GENES.filter((gene) => upper.includes(` ${gene} `));
}

/**
 * Run the full seven-agent pipeline on a free-text proposal (SPEC §9.4).
 *
 * The text goes in and nothing derived from its characters comes back. When the gate blocks, the returned run shows
 * steps 3–7 as `skipped` — the refusal is visible as a terminated pipeline,
 * not as a disclaimer beside results that were computed anyway (SPEC §7.4).
 */
export async function runProposal(text: string): Promise<ConsoleRunView> {
  const trimmed = text.trim();
  const targets = resolveTargets(trimmed);
  const result = runProposalPipeline(trimmed, targets);
  return {
    id: result.id,
    at: Date.now(),
    run: result.run,
    tokenCount: result.tokenCount,
    resolvedTargets: result.resolvedTargets,
    plannedVariantLabel: result.plannedVariantLabel,
    passedGate: result.run.policy.verdict === 'allow',
  };
}

/** Rebuild the history for a given session state. */
export async function loadScenario(state: SessionState): Promise<ScenarioView> {
  return buildScenario(bounded(state)).view;
}

/**
 * Attempt a merge. The gate is checked server-side from freshly re-derived
 * pipeline results before `Repo.merge` is ever called.
 */
export async function attemptMerge(
  state: SessionState,
  request: MergeRequest,
): Promise<MergeOutcome> {
  return runMerge(bounded(state), request);
}

/**
 * Record a human sign-off for an escalated branch and return the rebuilt
 * history. The role is **not** taken from the client: it is read from the
 * policy's own `signoffRole` for that branch's run, so a client cannot
 * invent a role that satisfies the gate. A branch whose verdict is `block`
 * has no `signoffRole` and is refused here (SPEC §7.5).
 */
export async function signOff(
  state: SessionState,
  branch: string,
  by: string,
): Promise<{ readonly ok: true; readonly scenario: ScenarioView; readonly role: string } | { readonly ok: false; readonly reason: string }> {
  const by_ = by.trim().slice(0, 120);
  if (!APPROVER_PATTERN.test(by_)) {
    return { ok: false, reason: 'A sign-off requires a person’s name.' };
  }

  const safe = bounded(state);
  const scenario = buildScenario(safe);
  const run = scenario.runByBranch.get(branch);
  if (run === undefined) {
    return { ok: false, reason: `No agent run exists for ${branch}.` };
  }
  if (run.verdict === 'blocked') {
    return {
      ok: false,
      reason:
        `${branch} was refused at the biosafety gate (${run.screen.category}). ` +
        `A refusal cannot be signed off.`,
    };
  }
  if (run.verdict !== 'escalated') {
    return { ok: false, reason: `${branch} is not awaiting a sign-off.` };
  }
  // Null, not undefined: the view layer normalises an absent role to null.
  const role = run.screen.signoffRole;
  if (role === null) {
    return { ok: false, reason: 'The policy named no sign-off role for this escalation.' };
  }

  // Only the signer travels; the role is re-derived server-side on every
  // read, so it can never be supplied by a client (SPEC §7.5).
  const signoffs: SignoffRequest[] = [
    ...safe.signoffs.filter((s) => s.branch !== branch),
    { branch, by: by_ },
  ];
  return {
    ok: true,
    role,
    scenario: buildScenario({ appliedMerges: safe.appliedMerges, signoffs }).view,
  };
}
