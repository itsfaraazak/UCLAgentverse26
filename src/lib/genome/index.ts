// TEMP STUB — replaced at integration. Signatures must match SPEC.md §4.
//
// SPEC.md §4.1 `lib/genome`. Minimal but genuinely working implementation so
// the `variant/ide-triptych` UI renders real numbers rather than placeholders.
// Pure, framework-free, no DOM.
//
// Known simplification (documented, not hidden): `diffSequences` aligns codon
// positions index-for-index and reports the length difference as a trailing
// added/removed run. It therefore never throws on unequal lengths, as the spec
// requires, but it does not perform a gap-aware alignment — an interior indel
// is reported as a run of changed codons followed by the tail, which is the
// frameshift-honest reading rather than a pretty one. The real implementation
// may do better; the UI does not depend on which.

/** The four DNA bases, uppercase, 5'→3'. */
export type Base = 'A' | 'C' | 'G' | 'T';

/** A coding sequence with provenance. Always uppercase, always 5'→3'. */
export interface Sequence {
  readonly bases: string;
  readonly label: string;
}

/**
 * The standard genetic code, built in NCBI table-1 order so that it can be
 * checked by eye against a textbook rather than trusted as 64 hand-typed
 * literals. Result is frozen and exactly 64 entries.
 */
function buildCodonTable(): Readonly<Record<string, string>> {
  const aminoAcids = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
  const order: readonly Base[] = ['T', 'C', 'A', 'G'];
  const table: Record<string, string> = {};
  let i = 0;
  for (const first of order) {
    for (const second of order) {
      for (const third of order) {
        table[`${first}${second}${third}`] = aminoAcids[i];
        i += 1;
      }
    }
  }
  return Object.freeze(table);
}

/** Standard genetic code. 64 codons → one-letter AA, '*' for stop. */
export const CODON_TABLE: Readonly<Record<string, string>> = buildCodonTable();

/** Split into frame-0 codons, discarding a trailing partial codon. */
export function codons(bases: string): string[] {
  const clean = bases.toUpperCase();
  const out: string[] = [];
  for (let i = 0; i + 3 <= clean.length; i += 3) {
    out.push(clean.slice(i, i + 3));
  }
  return out;
}

/**
 * Translate in frame 0. Stops at the first stop codon, inclusive of the '*'
 * so that a premature stop is visible in the rendered amino-acid register.
 * An unrecognised codon becomes 'X'.
 */
export function translate(bases: string): string {
  let protein = '';
  for (const codon of codons(bases)) {
    const aa = CODON_TABLE[codon] ?? 'X';
    protein += aa;
    if (aa === '*') break;
  }
  return protein;
}

/** Single-letter amino acid for one codon, or null if the codon is unknown. */
export function translateCodon(codon: string): string | null {
  return CODON_TABLE[codon.toUpperCase()] ?? null;
}

/** A single edit against a reference, in 1-based codon coordinates. */
export interface Variant {
  gene: string;
  codonIndex: number; // 1-based
  refCodon: string;
  altCodon: string;
  kind: 'substitution' | 'deletion' | 'insertion';
  label: string; // human-readable, e.g. "HbS (Glu6Val)"
}

/**
 * Apply a variant to a sequence, returning a new Sequence. Pure.
 * Out-of-range codon indices return the input unchanged rather than throwing,
 * so a malformed fixture degrades to "no edit" instead of crashing a render.
 */
export function applyVariant(seq: Sequence, v: Variant): Sequence {
  const existing = codons(seq.bases);
  const zero = v.codonIndex - 1;
  if (zero < 0 || zero > existing.length) return seq;

  const next = [...existing];
  switch (v.kind) {
    case 'substitution':
      if (zero >= next.length) return seq;
      next[zero] = v.altCodon.toUpperCase();
      break;
    case 'deletion':
      if (zero >= next.length) return seq;
      next.splice(zero, 1);
      break;
    case 'insertion':
      next.splice(zero, 0, v.altCodon.toUpperCase());
      break;
  }
  return { bases: next.join(''), label: v.label };
}

/** Aligned, row-per-codon diff — the data behind the side-by-side view. */
export interface DiffRow {
  codonIndex: number;
  refCodon: string | null;
  altCodon: string | null;
  refAa: string | null;
  altAa: string | null;
  status: 'same' | 'changed' | 'added' | 'removed';
  /** true when the codon changed but the amino acid did not */
  silent: boolean;
}

/**
 * Row-per-codon diff. Handles unequal lengths without throwing. Pure.
 */
export function diffSequences(ref: Sequence, alt: Sequence): DiffRow[] {
  const refCodons = codons(ref.bases);
  const altCodons = codons(alt.bases);
  const length = Math.max(refCodons.length, altCodons.length);
  const rows: DiffRow[] = [];

  for (let i = 0; i < length; i += 1) {
    const refCodon = refCodons[i] ?? null;
    const altCodon = altCodons[i] ?? null;
    const refAa = refCodon === null ? null : translateCodon(refCodon);
    const altAa = altCodon === null ? null : translateCodon(altCodon);

    let status: DiffRow['status'];
    if (refCodon === null) status = 'added';
    else if (altCodon === null) status = 'removed';
    else if (refCodon === altCodon) status = 'same';
    else status = 'changed';

    rows.push({
      codonIndex: i + 1,
      refCodon,
      altCodon,
      refAa,
      altAa,
      status,
      silent: status === 'changed' && refAa !== null && refAa === altAa,
    });
  }

  return rows;
}
