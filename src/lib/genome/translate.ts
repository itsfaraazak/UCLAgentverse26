import { aminoAcid } from './codon-table';
import { InvalidBaseError } from './errors';

function isDnaBase(ch: string): boolean {
  return ch === 'A' || ch === 'C' || ch === 'G' || ch === 'T';
}

/**
 * Uppercase a DNA string and reject anything outside A/C/G/T.
 * Offset in the thrown error is 0-based in the original input.
 */
export function normalizeDna(bases: string): string {
  let out = '';
  for (let i = 0; i < bases.length; i += 1) {
    const original = bases.charAt(i);
    const upper = original.toUpperCase();
    if (!isDnaBase(upper)) {
      throw new InvalidBaseError(original, i);
    }
    out += upper;
  }
  return out;
}

/**
 * Split a base string into in-frame triplets.
 * Non-ACGT input is rejected. A trailing incomplete codon is dropped —
 * `translate` still ignores a leftover 1–2 nt, while `diffSequences` refuses it.
 */
export function codons(bases: string): string[] {
  const normalized = normalizeDna(bases);
  const out: string[] = [];
  for (let i = 0; i + 3 <= normalized.length; i += 3) {
    out.push(normalized.slice(i, i + 3));
  }
  return out;
}

/**
 * Translate in reading frame 0 using the standard genetic code.
 * Stops at the first stop codon (`*` is included, subsequent codons are not).
 */
export function translate(bases: string): string {
  const residues: string[] = [];
  for (const codon of codons(bases)) {
    const aa = aminoAcid(codon);
    if (aa === null) break;
    residues.push(aa);
    if (aa === '*') break;
  }
  return residues.join('');
}
