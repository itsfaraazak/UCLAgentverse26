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
 * 2. **Refused request text never comes back.** `screenRequest` takes the text,
 *    passes it to `screen()`, and returns only the policy's own output plus two
 *    derived counts. The return type has no field for the text, so there is no
 *    path by which it can reach the DOM, a log line or the delta trail — and no
 *    server-side store keeps it either.
 */

import { FLAGGED_LOCI, screen } from '@/lib/safety/policy';
import { allLoci } from '@/lib/fixtures/loci';
import { attemptMerge as runMerge, buildScenario } from '@/lib/demo/scenario';
import type {
  MergeOutcome,
  MergeRequest,
  ScenarioView,
  ScreenEntryView,
  SignoffRequest,
} from '@/lib/demo/view';

export interface SessionState {
  readonly appliedMerges: readonly MergeRequest[];
  readonly signoffs: readonly SignoffRequest[];
}

/** Gene symbols this prototype can resolve from free text. */
const KNOWN_GENES: readonly string[] = [
  ...new Set([...FLAGGED_LOCI.map((l) => l.gene), ...allLoci().map((l) => l.gene)]),
].sort();

const WORD = /[a-z0-9']+/g;

/**
 * Resolve gene symbols from free text, as the planner would. Whole-word match
 * only, so "APC" in prose matches but "capcom" does not.
 */
function resolveTargets(text: string): string[] {
  const upper = ` ${text.toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `;
  return KNOWN_GENES.filter((gene) => upper.includes(` ${gene} `));
}

/**
 * Screen a free-text request through `lib/safety` and return a renderable
 * entry. Never echoes the request.
 */
export async function screenRequest(text: string): Promise<ScreenEntryView> {
  const trimmed = text.trim();
  const targets = resolveTargets(trimmed);
  const result = screen({ text: trimmed, targets });

  return {
    id: `${result.requestDigest}-${result.category}`,
    at: Date.now(),
    policy: {
      category: result.category,
      verdict: result.verdict,
      reason: result.reason,
      requiresSignoff: result.requiresSignoff,
      signoffRole: result.signoffRole ?? null,
      flaggedGenes: [...result.flaggedGenes],
      requestDigest: result.requestDigest,
      redacted: result.redacted,
    },
    tokenCount: (trimmed.toLowerCase().match(WORD) ?? []).length,
    // A refused request's resolved targets are withheld too; only the genes
    // the policy itself chose to name are shown.
    resolvedTargets: result.redacted ? [] : targets,
    passedGate: result.verdict === 'allow',
  };
}

/** Rebuild the history for a given session state. */
export async function loadScenario(state: SessionState): Promise<ScenarioView> {
  return buildScenario({ appliedMerges: state.appliedMerges, signoffs: state.signoffs }).view;
}

/**
 * Attempt a merge. The gate is checked server-side from freshly re-derived
 * pipeline results before `Repo.merge` is ever called.
 */
export async function attemptMerge(
  state: SessionState,
  request: MergeRequest,
): Promise<MergeOutcome> {
  return runMerge({ appliedMerges: state.appliedMerges, signoffs: state.signoffs }, request);
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
  const scenario = buildScenario({
    appliedMerges: state.appliedMerges,
    signoffs: state.signoffs,
  });
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
  const role = run.screen.signoffRole;
  if (role === undefined) {
    return { ok: false, reason: 'The policy named no sign-off role for this escalation.' };
  }

  const signoffs: SignoffRequest[] = [
    ...state.signoffs.filter((s) => s.branch !== branch),
    { branch, role, by },
  ];
  return {
    ok: true,
    role,
    scenario: buildScenario({ appliedMerges: state.appliedMerges, signoffs }).view,
  };
}
