import { aminoAcid } from './codon-table';
import { codons } from './translate';
import type { DiffRow, Sequence } from './types';

const MATCH = 2;
const MISMATCH = 0;
const GAP = -1;

interface AlignedPair {
  readonly refCodon: string | null;
  readonly altCodon: string | null;
}

/**
 * Global codon alignment that treats substitution as a first-class op.
 *
 * This is a small Needleman–Wunsch-style table with a readable scoring scheme:
 * match beats mismatch, and a mismatch beats a pair of gaps, so a SNP is
 * `changed` rather than `removed`+`added`, while a true indel shifts later
 * rows instead of truncating the shorter sequence.
 */
function alignCodons(refCodons: readonly string[], altCodons: readonly string[]): AlignedPair[] {
  const n = refCodons.length;
  const m = altCodons.length;
  const stride = m + 1;
  const dp: number[] = new Array((n + 1) * stride).fill(0);

  const at = (i: number, j: number): number => i * stride + j;
  const cell = (i: number, j: number): number => {
    const value = dp[at(i, j)];
    return value === undefined ? 0 : value;
  };
  const set = (i: number, j: number, value: number): void => {
    dp[at(i, j)] = value;
  };

  for (let i = 1; i <= n; i += 1) set(i, 0, i * GAP);
  for (let j = 1; j <= m; j += 1) set(0, j, j * GAP);

  for (let i = 1; i <= n; i += 1) {
    const refCodon = refCodons[i - 1];
    for (let j = 1; j <= m; j += 1) {
      const altCodon = altCodons[j - 1];
      const diag =
        cell(i - 1, j - 1) + (refCodon === altCodon ? MATCH : MISMATCH);
      const up = cell(i - 1, j) + GAP;
      const left = cell(i, j - 1) + GAP;
      set(i, j, Math.max(diag, up, left));
    }
  }

  const pairs: AlignedPair[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const refCodon = refCodons[i - 1];
      const altCodon = altCodons[j - 1];
      if (refCodon !== undefined && altCodon !== undefined) {
        const diag = cell(i - 1, j - 1) + (refCodon === altCodon ? MATCH : MISMATCH);
        if (cell(i, j) === diag) {
          pairs.push({ refCodon, altCodon });
          i -= 1;
          j -= 1;
          continue;
        }
      }
    }
    if (i > 0 && cell(i, j) === cell(i - 1, j) + GAP) {
      const refCodon = refCodons[i - 1];
      pairs.push({ refCodon: refCodon === undefined ? null : refCodon, altCodon: null });
      i -= 1;
      continue;
    }
    if (j > 0) {
      const altCodon = altCodons[j - 1];
      pairs.push({ refCodon: null, altCodon: altCodon === undefined ? null : altCodon });
      j -= 1;
      continue;
    }
    break;
  }

  pairs.reverse();
  return pairs;
}

function statusOf(
  refCodon: string | null,
  altCodon: string | null,
): DiffRow['status'] {
  if (refCodon === null && altCodon !== null) return 'added';
  if (refCodon !== null && altCodon === null) return 'removed';
  if (refCodon === altCodon) return 'same';
  return 'changed';
}

/**
 * Aligned codon-by-codon diff. Pure. Unequal lengths (insertions / deletions)
 * produce `added` / `removed` rows and keep subsequent matching codons aligned.
 */
export function diffSequences(ref: Sequence, alt: Sequence): DiffRow[] {
  const pairs = alignCodons(codons(ref.bases), codons(alt.bases));
  return pairs.map((pair, offset) => {
    const refAa = pair.refCodon === null ? null : aminoAcid(pair.refCodon);
    const altAa = pair.altCodon === null ? null : aminoAcid(pair.altCodon);
    const status = statusOf(pair.refCodon, pair.altCodon);
    const silent =
      status === 'changed' && refAa !== null && altAa !== null && refAa === altAa;
    return {
      codonIndex: offset + 1,
      refCodon: pair.refCodon,
      altCodon: pair.altCodon,
      refAa,
      altAa,
      status,
      silent,
    };
  });
}
