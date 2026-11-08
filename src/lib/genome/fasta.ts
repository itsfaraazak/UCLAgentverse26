/**
 * Strict FASTA / plain-sequence parsing for user-supplied genome input.
 *
 * This is the boundary between untrusted text and `lib/genome`. It is
 * deliberately unforgiving: SigmaFold's pitch is auditability, so a sequence
 * that cannot be read exactly is refused with a named error rather than
 * repaired by guesswork (SPEC.md §4.6 #13/#14).
 *
 * Framework-free and pure — no I/O, no DOM, no network. Callers are
 * responsible for screening the raw text through `lib/safety` *before* calling
 * this; see `lib/ai/upload` for the server-side ordering.
 */

import { InvalidBaseError, PartialCodonError, GenomeInputError } from './errors';
import type { Sequence } from './types';

/**
 * Hard cap on accepted input, in characters of raw text.
 *
 * 2 MB is far more than the curated demo needs (the HBB record is 628 nt) and
 * still small enough to parse synchronously in a request handler without
 * giving an uploader a cheap way to tie up the server.
 */
export const MAX_UPLOAD_CHARS = 2 * 1024 * 1024;

/** Cap on the parsed sequence itself, in bases. */
export const MAX_SEQUENCE_BASES = 500_000;

/** Input exceeded a size cap. Distinct from malformed content. */
export class SequenceTooLargeError extends GenomeInputError {
  readonly size: number;
  readonly limit: number;
  readonly unit: 'characters' | 'bases';

  constructor(size: number, limit: number, unit: 'characters' | 'bases') {
    super(
      `sequence too large: ${size} ${unit} exceeds the ${limit} ${unit} limit for uploaded input`,
    );
    this.size = size;
    this.limit = limit;
    this.unit = unit;
  }
}

/** Input held no sequence characters at all. */
export class EmptySequenceError extends GenomeInputError {
  constructor() {
    super('no sequence found: input contained no bases');
  }
}

/** Input looked like a multi-record FASTA file. */
export class MultipleRecordsError extends GenomeInputError {
  readonly count: number;

  constructor(count: number) {
    super(
      `multi-record FASTA not supported: found ${count} records, expected 1. ` +
        `Upload a single sequence.`,
    );
    this.count = count;
  }
}

export interface ParsedUpload {
  readonly sequence: Sequence;
  /** The FASTA description line without its '>', when the input had one. */
  readonly header?: string;
  /** True when the input was FASTA rather than a bare sequence. */
  readonly wasFasta: boolean;
  readonly lengthNt: number;
  /** Whole codons in the sequence. */
  readonly codonCount: number;
}

export interface ParseUploadOptions {
  /**
   * Label for the resulting `Sequence` when the input carries no FASTA header.
   * Never taken from the file's bytes.
   */
  readonly fallbackLabel?: string;
  /**
   * Require a whole number of codons. Defaults to true, because every
   * downstream consumer in this app diffs whole codons (§4.6 #14 / §4.7).
   */
  readonly requireWholeCodons?: boolean;
}

/**
 * IUPAC ambiguity codes and RNA uracil, called out by name so the error can
 * explain *why* a biologically meaningful character is still refused here.
 * This model has no representation for an ambiguous base.
 */
const EXPLAINED_CHARS: Readonly<Record<string, string>> = Object.freeze({
  U: 'RNA uracil; this model works on DNA (use T)',
  N: 'an ambiguous/unknown base; this model has no representation for one',
  R: 'an IUPAC ambiguity code',
  Y: 'an IUPAC ambiguity code',
  S: 'an IUPAC ambiguity code',
  W: 'an IUPAC ambiguity code',
  K: 'an IUPAC ambiguity code',
  M: 'an IUPAC ambiguity code',
  B: 'an IUPAC ambiguity code',
  D: 'an IUPAC ambiguity code',
  H: 'an IUPAC ambiguity code',
  V: 'an IUPAC ambiguity code',
  '-': 'an alignment gap',
  '*': 'a translation stop symbol; upload nucleotides, not protein',
});

/**
 * An `InvalidBaseError` that can say what the offending character *is*. Still
 * an `InvalidBaseError`, so existing `instanceof` checks and the §4.6 #13
 * contract are unaffected — only the message is richer.
 */
export class ExplainedInvalidBaseError extends InvalidBaseError {
  readonly explanation: string;

  constructor(char: string, offset: number, explanation: string) {
    super(char, offset);
    this.explanation = explanation;
    this.message = `${this.message} — ${JSON.stringify(char)} is ${explanation}`;
  }
}

/**
 * A non-ACGT character, annotated where we can explain it. Offsets are into
 * the *assembled sequence*, not the raw file, because that is the coordinate
 * the rest of `lib/genome` speaks.
 */
function rejectNonAcgt(bases: string): void {
  const match = /[^ACGT]/.exec(bases);
  if (match === null) return;
  const char = match[0];
  const offset = match.index;
  const explanation = EXPLAINED_CHARS[char];
  throw explanation === undefined
    ? new InvalidBaseError(char, offset)
    : new ExplainedInvalidBaseError(char, offset, explanation);
}

/** FASTA headers are untrusted text that the UI renders; keep them short. */
const MAX_HEADER_CHARS = 120;

/**
 * Parse pasted text or an uploaded file's contents into a `Sequence`.
 *
 * Accepts single-record FASTA or a bare sequence. Whitespace, blank lines and
 * digits-as-line-numbers are *not* silently stripped except where FASTA and
 * common sequence-viewer formats make them unambiguous: internal whitespace is
 * removed, and so are the digits of a leading line-number column, because both
 * are layout rather than content. Everything else must be A/C/G/T.
 *
 * @throws SequenceTooLargeError, EmptySequenceError, MultipleRecordsError,
 *         InvalidBaseError, PartialCodonError
 */
export function parseSequenceUpload(
  raw: string,
  options: ParseUploadOptions = {},
): ParsedUpload {
  if (raw.length > MAX_UPLOAD_CHARS) {
    throw new SequenceTooLargeError(raw.length, MAX_UPLOAD_CHARS, 'characters');
  }

  const lines = raw.split(/\r\n|\r|\n/);
  const headers = lines.filter((l) => l.startsWith('>') || l.startsWith(';'));
  if (headers.length > 1) {
    throw new MultipleRecordsError(headers.length);
  }

  const header = headers[0]?.replace(/^[>;]\s*/, '').trim().slice(0, MAX_HEADER_CHARS);
  const wasFasta = headers.length === 1;

  const assembled = lines
    .filter((l) => !l.startsWith('>') && !l.startsWith(';'))
    // Sequence viewers prefix a 1-based coordinate column; it is layout, not data.
    .map((l) => l.replace(/^\s*\d+\s*/, ''))
    .join('')
    .replace(/\s+/g, '')
    .replace(/\d/g, '')
    .toUpperCase();

  if (assembled.length === 0) {
    throw new EmptySequenceError();
  }
  if (assembled.length > MAX_SEQUENCE_BASES) {
    throw new SequenceTooLargeError(assembled.length, MAX_SEQUENCE_BASES, 'bases');
  }

  rejectNonAcgt(assembled);

  const label =
    header !== undefined && header.length > 0
      ? header
      : (options.fallbackLabel ?? 'Uploaded sequence');

  if (options.requireWholeCodons !== false && assembled.length % 3 !== 0) {
    throw new PartialCodonError(label, assembled.length);
  }

  return {
    sequence: { bases: assembled, label },
    ...(header === undefined || header.length === 0 ? {} : { header }),
    wasFasta,
    lengthNt: assembled.length,
    codonCount: Math.floor(assembled.length / 3),
  };
}
