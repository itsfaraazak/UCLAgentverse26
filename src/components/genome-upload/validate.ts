import {
  EmptySequenceError,
  InvalidBaseError,
  MAX_SEQUENCE_BASES,
  MAX_UPLOAD_CHARS,
  MultipleRecordsError,
  PartialCodonError,
  SequenceTooLargeError,
  codons,
  isStopCodon,
  parseSequenceUpload,
  translate,
} from '@/lib/genome';

/**
 * Turns raw pasted or dropped text into something the UI can render, without
 * ever throwing.
 *
 * Parsing and validation themselves belong to `lib/genome`: this module used
 * to carry its own FASTA reader and alphabet check, which became a second,
 * drifting copy the moment `lib/genome/fasta.ts` landed — with different size
 * caps, which would have put a wrong number in the UI. That duplicate is
 * gone. What is left here is the part that is genuinely presentational:
 *
 *  - mapping `lib/genome`'s thrown errors onto a discriminated result, so a
 *    form renders inline validation instead of catching exceptions;
 *  - writing one friendly sentence per failure, with no stack trace and no
 *    error-class name;
 *  - non-fatal observations about a sequence that is otherwise fine.
 *
 * This module must not import from `lib/safety`. Screening happens in
 * `screening.ts`, before this runs.
 */

export type SequenceErrorCode =
  | 'invalid-base'
  | 'partial-codon'
  | 'empty'
  | 'too-large'
  | 'multiple-records';

export interface SequenceError {
  readonly code: SequenceErrorCode;
  /** One friendly sentence, safe to render inline under the input. */
  readonly message: string;
  /** The offending character, for 'invalid-base'. */
  readonly char?: string;
  /** 0-based offset into the assembled sequence, for 'invalid-base'. */
  readonly offset?: number;
  /** 1-based position = offset + 1, for 'invalid-base'. */
  readonly position?: number;
  /** Observed length, for 'partial-codon'. */
  readonly length?: number;
  /** length % 3, for 'partial-codon'. */
  readonly remainder?: number;
}

export type SequenceWarningCode =
  | 'no-start-codon'
  | 'internal-stop'
  | 'no-stop-codon'
  | 'length-differs';

export interface SequenceWarning {
  readonly code: SequenceWarningCode;
  readonly message: string;
}

export interface ValidatedSequence {
  /** Normalised: uppercase A/C/G/T only. */
  readonly bases: string;
  readonly label: string;
  readonly codonCount: number;
  /** `translate(bases)` — note it halts at the first stop codon. */
  readonly protein: string;
  /** True when the input carried a FASTA header. */
  readonly wasFasta: boolean;
  readonly warnings: readonly SequenceWarning[];
}

export type ValidationResult =
  | { readonly ok: true; readonly sequence: ValidatedSequence }
  | { readonly ok: false; readonly error: SequenceError };

export interface ValidateOptions {
  /** Label used when the input carries no FASTA header. */
  readonly fallbackLabel?: string;
  /** Codon count this will be diffed against, for `length-differs`. */
  readonly referenceCodonCount?: number;
}

/** The caps, re-exported so the UI states the same numbers it enforces. */
export const UPLOAD_LIMITS: {
  readonly maxRawChars: number;
  readonly maxBases: number;
} = {
  maxRawChars: MAX_UPLOAD_CHARS,
  maxBases: MAX_SEQUENCE_BASES,
};

function formatInt(n: number): string {
  return n.toLocaleString('en-GB');
}

/**
 * `lib/genome`'s errors carry the facts; this supplies the sentence. The
 * offset is stated as a position in the *assembled* sequence because that is
 * the coordinate the parser speaks — a user looking at a wrapped FASTA file
 * would otherwise hunt for a line and column that were never meant.
 */
function toSequenceError(err: unknown): SequenceError {
  if (err instanceof InvalidBaseError) {
    const position = err.offset + 1;
    // ExplainedInvalidBaseError extends InvalidBaseError and already says
    // *why* an N or a U is refused, so prefer its richer message.
    const detail = err.message.includes('—')
      ? err.message.slice(err.message.indexOf('—') + 1).trim()
      : null;
    return {
      code: 'invalid-base',
      char: err.char,
      offset: err.offset,
      position,
      message:
        `Unexpected character ${JSON.stringify(err.char)} at position ${formatInt(position)} ` +
        `of the sequence${detail === null ? '' : ` — ${detail}`}. Only A, C, G and T are accepted. ` +
        'Positions count the assembled sequence, after any FASTA header and line breaks were removed.',
    };
  }

  if (err instanceof PartialCodonError) {
    const remainder = err.length % 3;
    return {
      code: 'partial-codon',
      length: err.length,
      remainder,
      message:
        `That sequence is ${formatInt(err.length)} bases, which is not a whole number of codons ` +
        `— there ${remainder === 1 ? 'is 1 base' : `are ${remainder} bases`} left over. ` +
        'This view compares whole codons, so the extra bases have nowhere to sit. ' +
        'Nothing was trimmed; add or remove bases so the length divides by 3.',
    };
  }

  if (err instanceof SequenceTooLargeError) {
    return {
      code: 'too-large',
      message: `${err.message}. Try a single coding region rather than a whole record.`,
    };
  }

  if (err instanceof MultipleRecordsError) {
    return {
      code: 'multiple-records',
      message: `${err.message}. Upload one coding sequence at a time.`,
    };
  }

  if (err instanceof EmptySequenceError) {
    return {
      code: 'empty',
      message: 'No sequence found. Paste bases, or drop a FASTA file with a sequence in it.',
    };
  }

  return {
    code: 'empty',
    message: 'That input could not be read as a coding sequence.',
  };
}

function warningsFor(
  bases: string,
  codonCount: number,
  referenceCodonCount: number | undefined,
): SequenceWarning[] {
  const warnings: SequenceWarning[] = [];
  const list = codons(bases);

  const first = list[0];
  if (first !== undefined && first !== 'ATG') {
    warnings.push({
      code: 'no-start-codon',
      message: `The first codon is ${first}, not ATG, so this may not start at a translation start site.`,
    });
  }

  const internal = list.findIndex((c, i) => i < list.length - 1 && isStopCodon(c));
  if (internal !== -1) {
    warnings.push({
      code: 'internal-stop',
      message:
        `There is a stop codon at codon ${internal + 1}, before the end of the sequence. ` +
        'Translation shown below halts there.',
    });
  }

  const last = list[list.length - 1];
  if (last !== undefined && !isStopCodon(last)) {
    warnings.push({
      code: 'no-stop-codon',
      message:
        'The sequence does not end in a stop codon. That is expected for a partial coding region.',
    });
  }

  if (referenceCodonCount !== undefined && referenceCodonCount !== codonCount) {
    warnings.push({
      code: 'length-differs',
      message:
        `This sequence has ${formatInt(codonCount)} codons; the reference has ` +
        `${formatInt(referenceCodonCount)}. The diff will show the difference as inserted ` +
        'or deleted codons.',
    });
  }

  return warnings;
}

/**
 * Parse and validate raw upload text. Never throws.
 *
 * Alphabet and frame are checked by `lib/genome`, in that order, so `ATGN`
 * reports the bad character rather than a confusing frame error.
 */
export function validateUpload(
  raw: string,
  options: ValidateOptions = {},
): ValidationResult {
  let parsed;
  try {
    parsed = parseSequenceUpload(raw, {
      ...(options.fallbackLabel === undefined
        ? {}
        : { fallbackLabel: options.fallbackLabel }),
    });
  } catch (err) {
    return { ok: false, error: toSequenceError(err) };
  }

  const { bases, label } = parsed.sequence;
  return {
    ok: true,
    sequence: {
      bases,
      label,
      codonCount: parsed.codonCount,
      protein: translate(bases),
      wasFasta: parsed.wasFasta,
      warnings: warningsFor(bases, parsed.codonCount, options.referenceCodonCount),
    },
  };
}
