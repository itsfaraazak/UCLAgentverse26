// TEMP STUB — replaced at integration. Signatures must match SPEC.md §4.
//
// Minimal implementation of `lib/genome` so the graph-first UI can be built
// against the real interface while the owning agent finishes the module.
// Every exported name, type and shape here is taken literally from SPEC §4.1.
// Pure and framework-free: no React, no DOM.

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
// Standard genetic code in the canonical TCAG ordering. Reading the table in
// this order makes the 64 entries verifiable by eye against any textbook.
const AA_ORDER =
  'FFLLSSSSYY**CC*W' + 'LLLLPPPPHHQQRRRR' + 'IIIMTTTTNNKKSSRR' + 'VVVVAAAADDEEGGGG';

function buildCodonTable(): Record<string, string> {
  const table: Record<string, string> = {};
  let i = 0;
  for (const first of BASES) {
    for (const second of BASES) {
      for (const third of BASES) {
        table[`${first}${second}${third}`] = AA_ORDER.charAt(i);
        i += 1;
      }
    }
  }
  return table;
}

/** Standard genetic code. 64 codons → one-letter AA, '*' for stop. */
export const CODON_TABLE: Readonly<Record<string, string>> = Object.freeze(
  buildCodonTable(),
);

/** Split into whole codons, discarding a trailing partial codon. */
export function codons(bases: string): string[] {
  const upper = bases.toUpperCase();
  const out: string[] = [];
  for (let i = 0; i + 3 <= upper.length; i += 3) {
    out.push(upper.slice(i, i + 3));
  }
  return out;
}

/** Translate in frame 0. Stops at the first stop codon (the '*' is emitted). */
export function translate(bases: string): string {
  let protein = '';
  for (const codon of codons(bases)) {
    const aa = CODON_TABLE[codon];
    const residue = aa === undefined ? 'X' : aa;
    protein += residue;
    if (residue === '*') break;
  }
  return protein;
}

function aaOf(codon: string | null): string | null {
  if (codon === null) return null;
  const aa = CODON_TABLE[codon.toUpperCase()];
  return aa === undefined ? 'X' : aa;
}

/**
 * Apply a variant to a sequence. 1-based codon coordinates. Substitutions and
 * deletions verify `refCodon` against the sequence so a mis-specified edit
 * fails loudly rather than silently corrupting the genotype.
 */
export function applyVariant(seq: Sequence, v: Variant): Sequence {
  const list = codons(seq.bases);
  const tailLength = seq.bases.length % 3;
  const tail = tailLength === 0 ? '' : seq.bases.slice(seq.bases.length - tailLength);
  const idx = v.codonIndex - 1;

  if (!Number.isInteger(v.codonIndex) || v.codonIndex < 1) {
    throw new Error(`codonIndex must be a 1-based integer, got ${String(v.codonIndex)}`);
  }

  if (v.kind === 'insertion') {
    if (idx > list.length) {
      throw new Error(`codonIndex ${v.codonIndex} is past the end of the sequence`);
    }
    list.splice(idx, 0, v.altCodon.toUpperCase());
    return { bases: list.join('') + tail, label: v.label };
  }

  if (idx >= list.length) {
    throw new Error(
      `codonIndex ${v.codonIndex} is out of range for a ${list.length}-codon sequence`,
    );
  }
  const current = list[idx];
  if (current !== v.refCodon.toUpperCase()) {
    throw new Error(
      `refCodon mismatch at codon ${v.codonIndex}: expected ${v.refCodon}, found ${current}`,
    );
  }

  if (v.kind === 'deletion') {
    list.splice(idx, 1);
  } else {
    list[idx] = v.altCodon.toUpperCase();
  }
  return { bases: list.join('') + tail, label: v.label };
}

interface AlignedPair {
  readonly refCodon: string | null;
  readonly altCodon: string | null;
}

const MATCH = 2;
const MISMATCH = 0;
const GAP = -1;

/**
 * Needleman–Wunsch over codons. Scoring makes a mismatch cheaper than a pair
 * of gaps, so a point substitution aligns as one `changed` row rather than a
 * `removed` + `added` pair, while a real indel shifts the frame and keeps the
 * codons after it aligned.
 */
function align(refCodons: readonly string[], altCodons: readonly string[]): AlignedPair[] {
  const n = refCodons.length;
  const m = altCodons.length;
  const stride = m + 1;
  const dp = new Int32Array((n + 1) * stride);

  for (let i = 1; i <= n; i += 1) dp[i * stride] = i * GAP;
  for (let j = 1; j <= m; j += 1) dp[j] = j * GAP;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const same = refCodons[i - 1] === altCodons[j - 1];
      const diag = dp[(i - 1) * stride + (j - 1)] + (same ? MATCH : MISMATCH);
      const up = dp[(i - 1) * stride + j] + GAP;
      const left = dp[i * stride + (j - 1)] + GAP;
      dp[i * stride + j] = Math.max(diag, up, left);
    }
  }

  const pairs: AlignedPair[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const same = refCodons[i - 1] === altCodons[j - 1];
      const diag = dp[(i - 1) * stride + (j - 1)] + (same ? MATCH : MISMATCH);
      if (dp[i * stride + j] === diag) {
        pairs.push({ refCodon: refCodons[i - 1], altCodon: altCodons[j - 1] });
        i -= 1;
        j -= 1;
        continue;
      }
    }
    if (i > 0 && dp[i * stride + j] === dp[(i - 1) * stride + j] + GAP) {
      pairs.push({ refCodon: refCodons[i - 1], altCodon: null });
      i -= 1;
      continue;
    }
    if (j > 0) {
      pairs.push({ refCodon: null, altCodon: altCodons[j - 1] });
      j -= 1;
      continue;
    }
    break;
  }

  pairs.reverse();
  return pairs;
}

/**
 * Aligned, row-per-codon diff. Pure. Handles unequal lengths without throwing.
 */
export function diffSequences(ref: Sequence, alt: Sequence): DiffRow[] {
  const pairs = align(codons(ref.bases), codons(alt.bases));
  return pairs.map((pair, offset) => {
    const refAa = aaOf(pair.refCodon);
    const altAa = aaOf(pair.altCodon);
    let status: DiffRow['status'];
    if (pair.refCodon === null) status = 'added';
    else if (pair.altCodon === null) status = 'removed';
    else if (pair.refCodon === pair.altCodon) status = 'same';
    else status = 'changed';
    return {
      codonIndex: offset + 1,
      refCodon: pair.refCodon,
      altCodon: pair.altCodon,
      refAa,
      altAa,
      status,
      silent: status === 'changed' && refAa !== null && refAa === altAa,
    };
  });
}
