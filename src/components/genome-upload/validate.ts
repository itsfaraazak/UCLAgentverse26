import {
  InvalidBaseError,
  PartialCodonError,
  codons,
  isStopCodon,
  translate,
} from '@/lib/genome';

/** A fatal problem: the sequence cannot be used at all. */
export type SequenceErrorCode = 'invalid-base' | 'partial-codon' | 'empty';

export interface SequenceError {
  readonly code: SequenceErrorCode;
  /** One friendly sentence, safe to render inline under the input. */
  readonly message: string;
  /** The offending character, for 'invalid-base'. */
  readonly char?: string;
  /** 0-based offset into the CLEANED sequence, for 'invalid-base'. */
  readonly offset?: number;
  /** 1-based position = offset + 1, for 'invalid-base'. Precomputed for the UI. */
  readonly position?: number;
  /** Observed length, for 'partial-codon'. */
  readonly length?: number;
  /** length % 3, for 'partial-codon'. */
  readonly remainder?: number;
}

/** A non-fatal observation worth telling the user about. */
export type SequenceWarningCode =
  | 'no-start-codon' // does not begin with ATG
  | 'internal-stop' // a stop codon before the final codon
  | 'no-stop-codon' // last codon is not a stop
  | 'length-differs'; // codon count differs from the comparison reference

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
  readonly warnings: readonly SequenceWarning[];
}

export type ValidationResult =
  | { readonly ok: true; readonly sequence: ValidatedSequence }
  | { readonly ok: false; readonly error: SequenceError };

export interface ValidateOptions {
  /** Codon count of the sequence this will be diffed against, for 'length-differs'. */
  readonly referenceCodonCount?: number;
}

function invalidBaseError(error: InvalidBaseError): SequenceError {
  const position = error.offset + 1;
  return {
    code: 'invalid-base',
    message: `Unexpected character ${JSON.stringify(error.char)} at position ${position}. Only A, C, G and T are accepted. Positions count the cleaned sequence, after whitespace and any FASTA header were removed.`,
    char: error.char,
    offset: error.offset,
    position,
  };
}

function partialCodonError(length: number): SequenceError {
  const remainder = length % 3;
  const extra =
    remainder === 1 ? '1 extra base' : `${remainder} extra bases`;
  return {
    code: 'partial-codon',
    message: `This view diffs whole codons, so a trailing 1 or 2 bases cannot be placed. The sequence is ${length} bases long, which leaves ${extra} with no codon row; those bases are not dropped or padded.`,
    length,
    remainder,
  };
}

function collectWarnings(
  codonList: readonly string[],
  referenceCodonCount: number | undefined,
): SequenceWarning[] {
  const warnings: SequenceWarning[] = [];
  const first = codonList[0];
  if (first !== undefined && first !== 'ATG') {
    warnings.push({
      code: 'no-start-codon',
      message:
        'The sequence does not begin with ATG, the usual start codon.',
    });
  }

  const lastIndex = codonList.length - 1;
  for (let i = 0; i < lastIndex; i += 1) {
    const codon = codonList[i];
    if (codon !== undefined && isStopCodon(codon)) {
      warnings.push({
        code: 'internal-stop',
        message: `A stop codon appears at codon ${i + 1}, before the last codon.`,
      });
      break;
    }
  }

  const last = codonList[lastIndex];
  if (last !== undefined && !isStopCodon(last)) {
    warnings.push({
      code: 'no-stop-codon',
      message:
        'The last codon is not a stop codon. That is expected for a partial coding region, and the sequence can still be compared.',
    });
  }

  if (
    referenceCodonCount !== undefined &&
    referenceCodonCount !== codonList.length
  ) {
    warnings.push({
      code: 'length-differs',
      message: `This sequence has ${codonList.length} codons and the comparison sequence has ${referenceCodonCount}. The diff will show inserted or deleted codons.`,
    });
  }

  return warnings;
}

/**
 * Never throws. Returns a discriminated result so the UI renders inline
 * validation rather than catching exceptions.
 */
export function validateSequence(
  bases: string,
  label: string,
  options?: ValidateOptions,
): ValidationResult {
  try {
    if (bases.trim() === '') {
      return {
        ok: false,
        error: {
          code: 'empty',
          message:
            'Paste a DNA coding sequence. The cleaned input is empty.',
        },
      };
    }

    // Alphabet first: `codons` rejects non-ACGT via InvalidBaseError.
    // Frame length is checked afterwards so ATGN reports the bad base, not a
    // confusing partial-codon error (SPEC.md §4.6 #13 before #14).
    const codonList = codons(bases);

    if (bases.length % 3 !== 0) {
      return { ok: false, error: partialCodonError(bases.length) };
    }

    const normalised = codonList.join('');
    return {
      ok: true,
      sequence: {
        bases: normalised,
        label,
        codonCount: codonList.length,
        protein: translate(normalised),
        warnings: collectWarnings(codonList, options?.referenceCodonCount),
      },
    };
  } catch (error) {
    if (error instanceof InvalidBaseError) {
      return { ok: false, error: invalidBaseError(error) };
    }
    if (error instanceof PartialCodonError) {
      return { ok: false, error: partialCodonError(error.length) };
    }
    return {
      ok: false,
      error: {
        code: 'invalid-base',
        message:
          'This sequence could not be read. Only A, C, G and T are accepted.',
      },
    };
  }
}
