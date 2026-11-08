import {
  screen,
  type PolicyCategory,
  type ScreenResult,
  type Verdict,
} from '@/lib/safety/policy';

/**
 * The biosafety gate for uploaded genomes.
 *
 * SPEC §7.4: the gate is structural, not a disclaimer rendered next to
 * results that were computed anyway. So nothing in this directory parses,
 * diffs, translates, renders or stores uploaded text until it has been
 * through `screen()` — `screenUpload` is the only entry point, and the
 * component calls it first.
 *
 * SPEC §7.3: for a `block`-class verdict the uploaded text must never be
 * echoed back, persisted or logged. That rule is enforced here by the *type*
 * rather than by convention: a refused result simply has no field carrying
 * the text, so there is nothing for the UI to render even by mistake. The
 * only thing that survives a refusal is the policy category, the generic
 * reason, and `screen()`'s own one-way digest.
 *
 * This module adds no policy of its own. It does not define categories,
 * soften verdicts, or decide anything `lib/safety` has not already decided —
 * it maps one `ScreenResult` onto a shape the UI can render.
 */

/** The parts of a verdict that are always safe to display. */
export interface UploadScreening {
  readonly verdict: Verdict;
  readonly category: PolicyCategory;
  /** Generic, request-independent explanation from `POLICY`. */
  readonly reason: string;
  readonly requiresSignoff: boolean;
  readonly signoffRole: string | null;
  readonly flaggedGenes: readonly string[];
  /** sha256 prefix, so an audit trail can reference input it does not keep. */
  readonly requestDigest: string;
  /** True when policy forbids echoing the input back. */
  readonly redacted: boolean;
}

/**
 * The result of screening an upload.
 *
 * `accepted: true` carries the text onward. `accepted: false` carries no
 * text at all — not an empty string, not a redacted placeholder, no field.
 * Removing it from the type is what makes SPEC §7.3 unforgettable.
 */
export type ScreenedUpload =
  | {
      readonly accepted: true;
      readonly screening: UploadScreening;
      /** The original input, released for parsing only because it passed. */
      readonly text: string;
    }
  | {
      readonly accepted: false;
      readonly screening: UploadScreening;
    };

export interface ScreenUploadInput {
  /** Everything the user supplied: pasted text, or the file's contents. */
  readonly text: string;
  /**
   * The curated locus this upload will be diffed against. This is a real
   * resolved target, not a guess: the uploaded sequence stands in for that
   * locus's reference allele, so it is the gene under edit. Passing it is
   * what lets a legitimate upload resolve as `THERAPEUTIC_SOMATIC` instead
   * of falling through to `OUT_OF_SCOPE`.
   */
  readonly targetGene: string;
  /**
   * A dropped file's name. Screened along with the contents, because a
   * filename is user-supplied text that can carry out-of-scope intent just
   * as a FASTA header can.
   */
  readonly fileName?: string;
}

/**
 * Filenames separate words with `-`, `_` and `.`, but `lib/safety`'s cues are
 * written as English phrases ("guide rna"), so `guide-rna-order.fasta` would
 * sail past a screen that the same words in prose would fail.
 *
 * Replacing separators with spaces before screening makes the gate catch
 * strictly *more* than it otherwise would. It adds no policy, defines no
 * category and changes no verdict — `lib/safety` still makes every decision;
 * it simply sees the filename as the words it actually contains.
 *
 * This does not make the lexical screen robust. `policy.ts` is explicit that
 * it over-blocks on innocent phrasing and can be evaded by paraphrase, and
 * that a real deployment puts a human biosafety officer behind it. This just
 * closes one mechanical gap rather than leaving it open.
 */
function normaliseFileName(fileName: string): string {
  return fileName.replace(/[._\-/\\]+/g, ' ');
}

function present(result: ScreenResult): UploadScreening {
  return {
    verdict: result.verdict,
    category: result.category,
    reason: result.reason,
    requiresSignoff: result.requiresSignoff,
    signoffRole: result.signoffRole ?? null,
    flaggedGenes: result.flaggedGenes,
    requestDigest: result.requestDigest,
    redacted: result.redacted,
  };
}

/**
 * Screen an upload before anything else touches it.
 *
 * A `block` verdict refuses the upload and drops the text on the floor. An
 * `escalate` verdict does **not** auto-approve (SPEC §7.5): it is returned
 * as accepted-but-flagged, with `requiresSignoff` set, and the component
 * holds the sequence behind an explicit human acknowledgement rather than
 * applying it silently.
 */
export function screenUpload(input: ScreenUploadInput): ScreenedUpload {
  // The filename is part of what the user supplied, so it is screened too.
  const subject =
    input.fileName === undefined || input.fileName.length === 0
      ? input.text
      : `${normaliseFileName(input.fileName)}\n${input.text}`;

  const result = screen({ text: subject, targets: [input.targetGene] });
  const screening = present(result);

  if (result.verdict === 'block') {
    // Deliberately drop `text`: see the note on `ScreenedUpload`.
    return { accepted: false, screening };
  }
  return { accepted: true, screening, text: input.text };
}

/** Does this verdict need a human sign-off before the sequence is applied? */
export function needsAcknowledgement(screening: UploadScreening): boolean {
  return screening.verdict === 'escalate' || screening.requiresSignoff;
}
