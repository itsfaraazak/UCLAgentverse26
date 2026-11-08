// TEMP STUB — replaced at integration. Signatures must match SPEC.md §4.

export type Base = 'A' | 'C' | 'G' | 'T';

/** A coding sequence with provenance. Always uppercase, always 5'→3'. */
export interface Sequence {
  readonly bases: string;
  readonly label: string;
}

/** A single edit against a reference, in 1-based codon coordinates. */
export interface Variant {
  gene: string;
  codonIndex: number;
  refCodon: string;
  altCodon: string;
  kind: 'substitution' | 'deletion' | 'insertion';
  label: string;
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

const BASES: readonly string[] = ['T', 'C', 'A', 'G'];
const AA_ROWS =
  'FFLLSSSSYY**CC*W' + 'LLLLPPPPHHQQRRRR' + 'IIIMTTTTNNKKSSRR' + 'VVVVAAAADDEEGGGG';

function buildCodonTable(): Record<string, string> {
  const table: Record<string, string> = {};
  let i = 0;
  for (const first of BASES) {
    for (const second of BASES) {
      for (const third of BASES) {
        table[`${first}${second}${third}`] = AA_ROWS[i];
        i += 1;
      }
    }
  }
  return table;
}

/** Standard genetic code. 64 codons → one-letter AA, '*' for stop. */
export const CODON_TABLE: Readonly<Record<string, string>> = Object.freeze(buildCodonTable());

export function codons(bases: string): string[] {
  const clean = bases.toUpperCase().replace(/[^ACGT]/g, '');
  const out: string[] = [];
  for (let i = 0; i + 3 <= clean.length; i += 3) {
    out.push(clean.slice(i, i + 3));
  }
  return out;
}

/** frame 0, stops at '*' */
export function translate(bases: string): string {
  let protein = '';
  for (const codon of codons(bases)) {
    const aa = CODON_TABLE[codon];
    if (aa === undefined) break;
    if (aa === '*') break;
    protein += aa;
  }
  return protein;
}

export function applyVariant(seq: Sequence, v: Variant): Sequence {
  const list = codons(seq.bases);
  const idx = v.codonIndex - 1;
  if (idx < 0 || idx > list.length) return seq;

  if (v.kind === 'insertion') {
    list.splice(idx, 0, v.altCodon.toUpperCase());
  } else if (v.kind === 'deletion') {
    if (idx >= list.length) return seq;
    list.splice(idx, 1);
  } else {
    if (idx >= list.length) return seq;
    list[idx] = v.altCodon.toUpperCase();
  }

  return { bases: list.join(''), label: v.label };
}

export function diffSequences(ref: Sequence, alt: Sequence): DiffRow[] {
  const refCodons = codons(ref.bases);
  const altCodons = codons(alt.bases);
  const rows: DiffRow[] = [];
  const n = Math.max(refCodons.length, altCodons.length);

  for (let i = 0; i < n; i += 1) {
    const refCodon = i < refCodons.length ? refCodons[i] : null;
    const altCodon = i < altCodons.length ? altCodons[i] : null;
    const refAa = refCodon === null ? null : (CODON_TABLE[refCodon] ?? null);
    const altAa = altCodon === null ? null : (CODON_TABLE[altCodon] ?? null);

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
