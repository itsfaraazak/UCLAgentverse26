/**
 * Malformed genome input — distinct from a genuine refCodon / coordinate mismatch.
 * UI code can `instanceof GenomeInputError` to surface these as user-facing
 * validation failures rather than unexpected crashes.
 */
export class GenomeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A sequence contained a character outside A/C/G/T (after case normalisation). */
export class InvalidBaseError extends GenomeInputError {
  readonly char: string;
  readonly offset: number;

  constructor(char: string, offset: number) {
    super(
      `invalid sequence: DNA base ${JSON.stringify(char)} at offset ${offset} is not A, C, G, or T`,
    );
    this.char = char;
    this.offset = offset;
  }
}

/** A sequence whose length is not a multiple of 3 — this model diffs whole codons. */
export class PartialCodonError extends GenomeInputError {
  readonly label: string;
  readonly length: number;

  constructor(label: string, length: number) {
    const named = label.length > 0 ? label : 'unnamed';
    super(
      `invalid sequence: '${named}' has length ${length}, which is not a multiple of 3; a trailing partial codon is not allowed`,
    );
    this.label = label;
    this.length = length;
  }
}

/**
 * Insertions have nothing to verify against the sequence. A non-empty
 * `refCodon` would look as if a check happened that did not.
 */
export class InsertionRefCodonError extends GenomeInputError {
  readonly refCodon: string;

  constructor(refCodon: string) {
    super(
      `invalid variant: insertion specifies refCodon ${JSON.stringify(refCodon)}, but insertions are not checked against the sequence. Pass an empty refCodon.`,
    );
    this.refCodon = refCodon;
  }
}
