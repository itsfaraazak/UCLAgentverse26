import { aminoAcid } from './codon-table';

/** Split a base string into in-frame triplets. A trailing incomplete codon is dropped. */
export function codons(bases: string): string[] {
  const normalized = bases.toUpperCase();
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
