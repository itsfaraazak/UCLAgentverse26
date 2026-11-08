/** A DNA base in the modelled alphabet. RNA U is not used. */
export type Base = 'A' | 'C' | 'G' | 'T';

/** A coding sequence with provenance. Always uppercase, always 5'→3'. */
export interface Sequence {
  readonly bases: string;
  readonly label: string;
}

export type VariantKind = 'substitution' | 'deletion' | 'insertion';

/** A single edit against a reference, in 1-based codon coordinates. */
export interface Variant {
  readonly gene: string;
  readonly codonIndex: number;
  readonly refCodon: string;
  readonly altCodon: string;
  readonly kind: VariantKind;
  /** Human-readable, e.g. "HbS (sickle allele)". */
  readonly label: string;
}

/** Aligned, row-per-codon diff — the data behind the side-by-side view. */
export interface DiffRow {
  readonly codonIndex: number;
  readonly refCodon: string | null;
  readonly altCodon: string | null;
  readonly refAa: string | null;
  readonly altAa: string | null;
  readonly status: 'same' | 'changed' | 'added' | 'removed';
  /** True when the codon changed but the amino acid did not. */
  readonly silent: boolean;
}
