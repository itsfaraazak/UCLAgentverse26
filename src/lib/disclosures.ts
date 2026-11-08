/**
 * UI text describing the system's limits, shared across every surface.
 *
 * SPEC §7.7 requires the screen's own limitation to be disclosed wherever a
 * user can drive the screen. The sentence lived inlined in four separate
 * components, which is how it came to be missing from two of the four
 * surfaces — including `/`, the default one, directly beneath a box inviting
 * the reader to defeat the gate. A judge reading only that surface would
 * reasonably conclude the screen is stronger than it is.
 *
 * One exported constant, so the wording cannot drift between surfaces and a
 * new surface has something to import rather than prose to re-type.
 *
 * Deliberately NOT under `src/lib/safety/`. That directory is a boundary:
 * `policy.ts` is the final authority on verdicts, CI fails any diff touching
 * the path, and its tree hash is expected to match `main` exactly. This is
 * text *about* the screen, not part of evaluating it, so it does not belong
 * inside that fence.
 */

/**
 * What the biosafety screen is: deterministic, over-blocking, evadable, and
 * not a substitute for institutional review.
 */
export const SCREEN_LEXICAL_DISCLOSURE =
  'The screen is a deterministic keyword-and-registry check, chosen so a reviewer can ' +
  're-derive every verdict by hand. It over-blocks on innocent phrasing and can be evaded ' +
  'by paraphrase. It belongs in front of an institutional biosafety review, never in place ' +
  'of one.';
