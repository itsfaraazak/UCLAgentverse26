/**
 * The replay overlay's URL form, and the one copy of the rules that bound it.
 *
 * A created genotype line is a `BranchSpec` the server replays (see
 * `BranchSpec` for why that is sound). Holding that list only in client state
 * meant a navigation to `/ide`, `/bench` or `/graph` and back silently erased
 * every created line — the shell's own Surfaces links destroyed the feature
 * the shell exists to demonstrate. Putting the list in the query string makes
 * the server the thing that renders it, which also makes the state reloadable
 * and shareable.
 *
 * ## The form
 *
 * One repeated `line` param per created branch, in creation order:
 *
 *     /?line=line%2Fmy-proposal:main:HBB_HbS&line=line%2Fprobe:line%2Fmy-proposal:HBB_HbC
 *
 * Three colon-separated fields — `name:from:variantId` — each
 * percent-encoded. One param per entry rather than one encoded blob because
 * every entry can then be length-capped and shape-checked *before* anything
 * parses it, and a single bad entry is identifiable and droppable on its own.
 * An opaque base64-JSON blob would invite the decode-then-parse-then-validate
 * order, which is the wrong order for untrusted input.
 *
 * ## The trust position
 *
 * The URL is untrusted input that reaches branch creation, so it is held to
 * exactly the rules the server actions already enforce — this module owns
 * them, and `src/app/actions.ts` imports them rather than keeping a second
 * copy that could drift. A spec carries only a curated `variantId`, a `from`
 * branch name and a line name: never a genotype and never a sequence, so a
 * crafted link cannot introduce an edit the gate has not screened.
 * `buildWorkspace` still runs the real `runFor(requestFor(...))` pipeline for
 * every replayed spec and binds each check to its own commit oid.
 */

import type { BranchSpec } from './types';

/**
 * Branch names this application will accept, from either the form or a URL.
 * Mirrors what `Repo.branch` tolerates, and keeps a name that could be
 * mistaken for an oid or a path out of the ref namespace. The charset also
 * excludes `:`, `&`, `=`, `%` and `#`, which is what lets the query form use a
 * bare colon as its field separator.
 */
export const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export const MAX_BRANCH_NAME = 64;

/**
 * How many created branches one client may replay.
 *
 * The overlay is client-controlled and is replayed in full on every call: a
 * non-empty overlay deliberately bypasses the memo and re-seeds the
 * repository, and each spec adds an `applyVariant` plus a sha256 commit. A
 * chained overlay also grows each branch's commit list, and rendering reads
 * every commit of every branch — so cost climbs with the square of the list.
 * Unbounded, that is a one-request stall of a single-threaded server, which
 * is the same hazard `screenRequestAction` already caps its text against.
 * Twenty-five lines is far more than the demo needs.
 */
export const MAX_OVERLAY = 25;

/** The repeated query parameter that carries one spec. */
export const OVERLAY_PARAM = 'line';

/**
 * Raw guards, applied before any per-entry parsing.
 *
 * `MAX_OVERLAY` bounds the *parsed* result; these two bound the work done to
 * get there, so a URL with ten thousand `line=` params costs a length check
 * each and nothing more. The entry cap is deliberately above `MAX_OVERLAY`:
 * a link whose first entries are well-formed should still restore them, with
 * the excess reported as dropped rather than the whole link refused.
 */
export const MAX_RAW_ENTRIES = 64;

/**
 * Three fields of at most `MAX_BRANCH_NAME`, two separators, and room for
 * percent-encoding to roughly triple a field. Anything longer cannot be a
 * valid entry, so it is rejected without being split.
 */
export const MAX_RAW_ENTRY = 600;

/** Why a branch name was refused. One shape, two renderings. */
type NameProblem = 'empty' | 'too-long' | 'shape';

function branchNameProblem(name: string): NameProblem | null {
  if (name.length === 0) return 'empty';
  if (name.length > MAX_BRANCH_NAME) return 'too-long';
  if (!BRANCH_NAME.test(name)) return 'shape';
  return null;
}

/**
 * The message for a name problem on the *action* path, where the name came
 * from the form and telling the user what is wrong with it is the point.
 */
function nameProblemMessage(problem: NameProblem, field: 'name' | 'source'): string {
  switch (problem) {
    case 'empty':
      return field === 'name'
        ? 'A branch name is required.'
        : 'A source branch is required.';
    case 'too-long':
      return `Branch names are limited to ${MAX_BRANCH_NAME} characters.`;
    case 'shape':
      return 'Use letters, digits, and . _ / - only, starting with a letter or digit.';
  }
}

/**
 * Validate the whole replay list, not just the newest entry.
 *
 * Every action that accepts an overlay runs this. `createBranchAction` used
 * to check only the spec it was adding, which left an inherited list — and
 * the lists handed to `diffAction` and `mergeProposalAction` — trusted
 * verbatim.
 *
 * `from` is checked with the same rules as `name`: it is equally untrusted and
 * it selects the base commit the new line is cut from.
 *
 * `variantId` is deliberately not checked here: `buildWorkspace` resolves it
 * through `requireVariant`, which fails closed on anything not in
 * `data/loci.json`. Duplicating that would risk the two disagreeing.
 *
 * Throws, because on the action path a malformed overlay is a bug or an
 * attempt and the caller wants it refused. The URL path does not use this —
 * it drops bad entries one at a time through `parseOverlay`.
 */
export function validateOverlay(
  overlay: readonly BranchSpec[],
): readonly BranchSpec[] {
  if (overlay.length > MAX_OVERLAY) {
    throw new Error(`At most ${MAX_OVERLAY} created branches are supported.`);
  }
  const seen = new Set<string>();
  for (const spec of overlay) {
    const nameProblem = branchNameProblem(spec.name);
    if (nameProblem !== null) {
      throw new Error(nameProblemMessage(nameProblem, 'name'));
    }
    const fromProblem = branchNameProblem(spec.from);
    if (fromProblem !== null) {
      throw new Error(nameProblemMessage(fromProblem, 'source'));
    }
    if (seen.has(spec.name)) {
      throw new Error(`Branch '${spec.name}' appears twice.`);
    }
    seen.add(spec.name);
  }
  return overlay;
}

/* ──────────────────────────────── encoding ─────────────────────────────── */

/**
 * The query string for an overlay, without a leading `?`. Empty for an empty
 * overlay, so a link with no created lines keeps its bare href.
 */
export function encodeOverlay(overlay: readonly BranchSpec[]): string {
  return overlay
    .map(
      (spec) =>
        `${OVERLAY_PARAM}=${[spec.name, spec.from, spec.variantId]
          .map(encodeURIComponent)
          .join(':')}`,
    )
    .join('&');
}

/**
 * `href` with the overlay appended. Used by the Surfaces links and the
 * palette's `surface:` commands so that leaving `/` and coming back restores
 * the created lines — a variant surface that cannot render them still carries
 * them through the round trip rather than dropping them.
 */
export function withOverlay(href: string, overlay: readonly BranchSpec[]): string {
  const query = encodeOverlay(overlay);
  if (query === '') return href;
  return `${href}${href.includes('?') ? '&' : '?'}${query}`;
}

/**
 * A conservative shape for a curated variant id.
 *
 * `requireVariant` is the authority on which ids exist, and only the server
 * can consult it. This is not a second copy of that rule — it is a bound on
 * what may be *written back into a link*, so that arbitrary text from a URL
 * never reaches an `href`. Every id in `data/loci.json` satisfies it; an id
 * that does not would be dropped by the server as an unknown edit anyway.
 */
const VARIANT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The entries of an incoming overlay param that are safe to carry into a
 * link, re-emitted in canonical encoding.
 *
 * Used by the surface switcher, which has to pass the overlay from one
 * variant route to another without being able to resolve it: those routes
 * never build a workspace, so they have no vocabulary to check against. What
 * they can do — and must — is refuse to copy anything shape-invalid into an
 * href. The switcher previously echoed each raw param verbatim, which put an
 * invalid branch name from the URL straight back into the page.
 *
 * Takes already-decoded values, as `useSearchParams().getAll()` returns them.
 */
export function carriedOverlayParams(
  values: readonly string[],
): readonly string[] {
  const kept: string[] = [];
  for (const value of values.slice(0, MAX_RAW_ENTRIES)) {
    if (kept.length >= MAX_OVERLAY) break;
    if (value.length > MAX_RAW_ENTRY) continue;
    const fields = value.split(':');
    if (fields.length !== 3) continue;
    const [name, from, variantId] = fields;
    if (name === undefined || from === undefined || variantId === undefined) continue;
    if (branchNameProblem(name) !== null || branchNameProblem(from) !== null) continue;
    if (variantId.length === 0 || variantId.length > MAX_BRANCH_NAME) continue;
    if (!VARIANT_ID.test(variantId)) continue;
    kept.push([name, from, variantId].map(encodeURIComponent).join(':'));
  }
  return kept;
}

/* ──────────────────────────────── parsing ──────────────────────────────── */

/**
 * Why entries were dropped. Reported by category and count only — never with
 * the offending text, which is the same rule the gate's refusal text follows:
 * an invalid name from a URL is not echoed back into the page.
 */
export type OverlayDropReason =
  | 'malformed'
  | 'unknown-edit'
  | 'unknown-source'
  | 'duplicate'
  | 'over-capacity';

export interface OverlayDrop {
  readonly reason: OverlayDropReason;
  readonly count: number;
}

/**
 * The result of reading an overlay out of a URL.
 *
 * `ok` means every entry present was restored — including the common case of
 * no entries at all. `degraded` carries whatever *was* valid plus the reason
 * the rest was not, so the page can render a real workspace and a visible,
 * non-alarming note instead of throwing or showing a half-built state.
 */
export type OverlayParse =
  | { readonly kind: 'ok'; readonly specs: readonly BranchSpec[] }
  | {
      readonly kind: 'degraded';
      readonly specs: readonly BranchSpec[];
      readonly dropped: readonly OverlayDrop[];
      readonly note: string;
    };

export interface OverlayVocabulary {
  /** Branch names the base workspace already carries. */
  readonly branches: ReadonlySet<string>;
  /** Curated variant ids from `data/loci.json`. */
  readonly variants: ReadonlySet<string>;
}

const DROP_LABELS: Readonly<Record<OverlayDropReason, string>> = Object.freeze({
  malformed: 'malformed',
  'unknown-edit': 'an edit this locus does not carry',
  'unknown-source': 'a source branch that does not exist',
  duplicate: 'a name already in use',
  'over-capacity': 'beyond the line limit',
});

function describe(dropped: readonly OverlayDrop[]): string {
  const total = dropped.reduce((sum, d) => sum + d.count, 0);
  const parts = dropped.map((d) => `${d.count} ${DROP_LABELS[d.reason]}`);
  const lines = total === 1 ? 'line' : 'lines';
  return `${total} created ${lines} in this link could not be restored (${parts.join(
    ', ',
  )}). Everything else on this page is the real workspace; create the line again to get it back.`;
}

/**
 * Read the overlay out of a `searchParams` value, dropping bad entries.
 *
 * Order of work is deliberate. The raw param count and each raw entry's
 * length are capped first, so a pathological URL is refused before it is
 * split. Then each entry is checked on its own — exactly three non-empty
 * fields, a name and a source that satisfy `BRANCH_NAME`, a `variantId` the
 * fixture actually carries, a source that resolves, and a name not already
 * taken. An entry failing any of those is dropped, not coerced.
 *
 * `variants` is passed in rather than read here so this module stays
 * framework-free and `requireVariant` remains the authority inside
 * `buildWorkspace`. Screening the id here is not a second copy of that rule —
 * it is what turns an unknown id into a dropped entry and a note instead of a
 * throw from `buildWorkspace` surfacing as an unhandled error on the page.
 */
export function parseOverlay(
  raw: string | readonly string[] | undefined,
  vocabulary: OverlayVocabulary,
): OverlayParse {
  const entries = raw === undefined ? [] : typeof raw === 'string' ? [raw] : raw;
  if (entries.length === 0) return { kind: 'ok', specs: [] };

  const counts = new Map<OverlayDropReason, number>();
  const drop = (reason: OverlayDropReason, by = 1): void => {
    counts.set(reason, (counts.get(reason) ?? 0) + by);
  };

  // Cheap guard in front of everything: cap the number of entries considered
  // before any of them is split.
  const considered =
    entries.length > MAX_RAW_ENTRIES ? entries.slice(0, MAX_RAW_ENTRIES) : entries;
  if (entries.length > considered.length) {
    drop('over-capacity', entries.length - considered.length);
  }

  const specs: BranchSpec[] = [];
  const created = new Set<string>();

  for (const entry of considered) {
    if (specs.length >= MAX_OVERLAY) {
      drop('over-capacity');
      continue;
    }
    if (entry.length > MAX_RAW_ENTRY) {
      drop('malformed');
      continue;
    }

    const fields = entry.split(':');
    if (fields.length !== 3) {
      drop('malformed');
      continue;
    }
    const [rawName, rawFrom, rawVariant] = fields;
    if (rawName === undefined || rawFrom === undefined || rawVariant === undefined) {
      drop('malformed');
      continue;
    }

    const name = decodeField(rawName);
    const from = decodeField(rawFrom);
    const variantId = decodeField(rawVariant);
    if (name === null || from === null || variantId === null) {
      drop('malformed');
      continue;
    }
    if (branchNameProblem(name) !== null || branchNameProblem(from) !== null) {
      drop('malformed');
      continue;
    }
    if (variantId.length === 0 || !vocabulary.variants.has(variantId)) {
      drop('unknown-edit');
      continue;
    }
    if (!vocabulary.branches.has(from) && !created.has(from)) {
      // A line may be cut from an earlier line in the same list, but not from
      // one that is not there — `buildWorkspace` would throw on it.
      drop('unknown-source');
      continue;
    }
    if (vocabulary.branches.has(name) || created.has(name)) {
      drop('duplicate');
      continue;
    }

    specs.push({ name, from, variantId });
    created.add(name);
  }

  if (counts.size === 0) return { kind: 'ok', specs };

  // A stable order, so the note does not reshuffle between renders.
  const order: readonly OverlayDropReason[] = [
    'malformed',
    'unknown-edit',
    'unknown-source',
    'duplicate',
    'over-capacity',
  ];
  const dropped: OverlayDrop[] = [];
  for (const reason of order) {
    const count = counts.get(reason);
    if (count !== undefined) dropped.push({ reason, count });
  }
  return { kind: 'degraded', specs, dropped, note: describe(dropped) };
}

/**
 * A percent-decoded field, or `null` if the encoding itself was invalid.
 * `decodeURIComponent` throws on a stray `%`, and a URL is allowed to be
 * wrong — that is a dropped entry, not an exception out of the page.
 */
function decodeField(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
