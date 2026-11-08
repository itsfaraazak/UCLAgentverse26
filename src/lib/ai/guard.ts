import './server-only';
import {
  POLICY,
  screen,
  type PolicyCategory,
  type ScreenInput,
  type ScreenResult,
  type Verdict,
} from '@/lib/safety/policy';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE SAFETY INVARIANT: AI MAY ONLY NARROW, NEVER UNLOCK.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * This module is the only place in `lib/ai` permitted to combine a model's
 * opinion with a policy verdict, and it is written so that the combination
 * cannot loosen anything:
 *
 *  1. `screen()` from `lib/safety/policy` is authoritative. It is deterministic
 *     and LLM-free, and it is consulted on the **raw user text**, independently
 *     of anything a model said about that text. A prompt injection that fools
 *     a parser therefore cannot route around the lexical screen.
 *
 *  2. Verdicts combine by *maximum restriction* (`combineVerdicts`). There is
 *     no code path by which a model verdict lowers a lexical one. A model
 *     saying "allow" against a lexical `block` yields `block`.
 *
 *  3. A model never mints a verdict. It selects a **category label** from the
 *     closed set already defined in `policy.ts`, and the verdict for that
 *     label is then read out of the frozen `POLICY` table. An unrecognised
 *     label does not become `allow` — it becomes the restrictive default.
 *
 *  4. Nothing refused is ever transmitted. `screen()` runs **before** any
 *     outbound call, and when it sets `redacted` the text must not leave the
 *     process. `assertTransmissible` enforces that at the call site.
 *
 * `lib/safety/policy.ts` is not modified by this module — only consumed.
 */

/**
 * How restrictive each verdict is. Higher wins when combining.
 *
 * This ordering *is* the invariant. If it is ever edited so that `allow`
 * outranks `block`, `guard.test.ts` fails.
 */
const RESTRICTION_RANK: Readonly<Record<Verdict, number>> = Object.freeze({
  allow: 0,
  escalate: 1,
  block: 2,
});

export function restrictionRank(verdict: Verdict): number {
  return RESTRICTION_RANK[verdict];
}

/**
 * Logical OR of restriction: the more restrictive of two verdicts.
 *
 * Total, commutative and associative, so the order in which opinions arrive
 * cannot change the outcome.
 */
export function combineVerdicts(a: Verdict, b: Verdict): Verdict {
  return RESTRICTION_RANK[a] >= RESTRICTION_RANK[b] ? a : b;
}

/**
 * The verdict a model's chosen category carries — read from `POLICY`, never
 * from the model.
 *
 * A model that returns a category this code does not know gets the restrictive
 * default rather than the benefit of the doubt.
 */
export const UNRECOGNISED_CATEGORY_VERDICT: Verdict = 'escalate';

export function verdictForCategory(category: string): Verdict {
  const known = (Object.keys(POLICY) as PolicyCategory[]).find((c) => c === category);
  if (known === undefined) return UNRECOGNISED_CATEGORY_VERDICT;
  return POLICY[known].verdict;
}

/** Thrown when code attempts to transmit text that policy refused. */
export class RefusedContentTransmissionError extends Error {
  readonly category: PolicyCategory;
  readonly requestDigest: string;

  constructor(result: ScreenResult) {
    // Carries the category and the digest only — never the text itself.
    super(
      `refusing to transmit screened content: policy category ${result.category} ` +
        `is redacted (request digest ${result.requestDigest}). No third-party API ` +
        `call may carry refused content.`,
    );
    this.name = new.target.name;
    this.category = result.category;
    this.requestDigest = result.requestDigest;
  }
}

/**
 * The mandatory first step before any outbound AI call that would carry user
 * text. Screen first, then decide whether a call may happen at all.
 */
export function screenBeforeTransmit(input: ScreenInput): ScreenResult {
  return screen(input);
}

/**
 * True when this screened text may be sent to a third-party API.
 *
 * Keyed on `redacted`, which `policy.ts` sets for every `block`-class verdict.
 * Escalated text is transmissible — it was not refused, it needs a human — and
 * allowed text obviously is.
 */
export function mayTransmit(result: ScreenResult): boolean {
  return !result.redacted;
}

/**
 * Throw unless this screened text may be transmitted.
 *
 * Call this immediately before constructing any outbound request body. It is
 * the backstop that makes "never send refused content to a third party" a
 * mechanical property rather than a convention someone has to remember.
 */
export function assertTransmissible(result: ScreenResult): void {
  if (!mayTransmit(result)) {
    throw new RefusedContentTransmissionError(result);
  }
}

export interface CombinedScreen {
  /** The authoritative deterministic result. Never overridden. */
  readonly lexical: ScreenResult;
  /** The final verdict after OR-ing in any model opinion. */
  readonly verdict: Verdict;
  /** The category the final verdict came from. */
  readonly category: PolicyCategory | string;
  /** True when a model opinion made the outcome stricter than the lexical one. */
  readonly narrowedByModel: boolean;
  /** True when a model opinion was obtained at all. */
  readonly modelConsulted: boolean;
  readonly requiresSignoff: boolean;
  /** Generic, request-independent reasons. Never templated with user text. */
  readonly reasons: readonly string[];
}

export interface ModelOpinion {
  /** Did the model think this request raises a concern? */
  readonly concern: boolean;
  /** A category label from `policy.ts`'s closed set, when the model named one. */
  readonly category?: string;
}

/**
 * Combine the authoritative lexical screen with an optional model opinion.
 *
 * The lexical result is passed through untouched; the model can only push the
 * verdict up the restriction ordering. Note what is *absent*: there is no
 * branch here that reads the model's opinion when the lexical verdict is
 * already `block`, and no branch that lowers `verdict` under any condition.
 */
export function combineScreen(
  lexical: ScreenResult,
  opinion?: ModelOpinion,
): CombinedScreen {
  const reasons: string[] = [lexical.reason];

  // No opinion, or an opinion of "no concern": the lexical result stands as-is.
  if (opinion === undefined || !opinion.concern) {
    return {
      lexical,
      verdict: lexical.verdict,
      category: lexical.category,
      narrowedByModel: false,
      modelConsulted: opinion !== undefined,
      requiresSignoff: lexical.requiresSignoff,
      reasons,
    };
  }

  const modelVerdict =
    opinion.category === undefined
      ? UNRECOGNISED_CATEGORY_VERDICT
      : verdictForCategory(opinion.category);

  const combined = combineVerdicts(lexical.verdict, modelVerdict);
  const narrowed = restrictionRank(combined) > restrictionRank(lexical.verdict);

  // Resolved against the frozen table, not taken on trust. An unrecognised
  // label still narrows the *verdict* — `verdictForCategory` gave it the
  // restrictive default above — but it is not itself a category, so it must
  // not be reported as one.
  const known = (Object.keys(POLICY) as PolicyCategory[]).find(
    (c) => c === opinion.category,
  );

  if (narrowed) {
    // The reason shown is the *policy's* generic reason for the category, not
    // the model's prose, so refused text can never be echoed through it.
    reasons.push(
      known === undefined
        ? 'A second-opinion classifier flagged this request but did not name a ' +
            'known policy category, so it is held for human review.'
        : POLICY[known].reason,
    );
  }

  return {
    lexical,
    verdict: combined,
    // The category only moves when the model actually narrowed the outcome,
    // and only to a label the frozen table defines. Passing an unrecognised
    // label through would put untrusted model output — bounded only by the
    // response size cap — into a field documented as the category the verdict
    // came from, and render it as one. The closed set is the whole point of
    // having the model name a label rather than mint a verdict (SPEC §6).
    category: narrowed && known !== undefined ? known : lexical.category,
    narrowedByModel: narrowed,
    modelConsulted: true,
    requiresSignoff: lexical.requiresSignoff || combined === 'escalate',
    reasons,
  };
}

/** Convenience mirroring `policy.passesGate`, over a combined result. */
export function combinedPassesGate(combined: CombinedScreen): boolean {
  return combined.verdict === 'allow';
}
