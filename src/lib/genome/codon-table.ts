/**
 * Standard genetic code (NCBI translation table 1).
 * All 64 codons; '*' for TAA, TAG, TGA.
 */
export const CODON_TABLE: Readonly<Record<string, string>> = Object.freeze({
  TTT: 'F',
  TTC: 'F',
  TTA: 'L',
  TTG: 'L',
  TCT: 'S',
  TCC: 'S',
  TCA: 'S',
  TCG: 'S',
  TAT: 'Y',
  TAC: 'Y',
  TAA: '*',
  TAG: '*',
  TGT: 'C',
  TGC: 'C',
  TGA: '*',
  TGG: 'W',
  CTT: 'L',
  CTC: 'L',
  CTA: 'L',
  CTG: 'L',
  CCT: 'P',
  CCC: 'P',
  CCA: 'P',
  CCG: 'P',
  CAT: 'H',
  CAC: 'H',
  CAA: 'Q',
  CAG: 'Q',
  CGT: 'R',
  CGC: 'R',
  CGA: 'R',
  CGG: 'R',
  ATT: 'I',
  ATC: 'I',
  ATA: 'I',
  ATG: 'M',
  ACT: 'T',
  ACC: 'T',
  ACA: 'T',
  ACG: 'T',
  AAT: 'N',
  AAC: 'N',
  AAA: 'K',
  AAG: 'K',
  AGT: 'S',
  AGC: 'S',
  AGA: 'R',
  AGG: 'R',
  GTT: 'V',
  GTC: 'V',
  GTA: 'V',
  GTG: 'V',
  GCT: 'A',
  GCC: 'A',
  GCA: 'A',
  GCG: 'A',
  GAT: 'D',
  GAC: 'D',
  GAA: 'E',
  GAG: 'E',
  GGT: 'G',
  GGC: 'G',
  GGA: 'G',
  GGG: 'G',
});

const STOP_CODONS = new Set(['TAA', 'TAG', 'TGA']);

export function aminoAcid(codon: string): string | null {
  const key = codon.toUpperCase();
  if (key.length !== 3) return null;
  if (!Object.prototype.hasOwnProperty.call(CODON_TABLE, key)) return null;
  const aa = CODON_TABLE[key];
  return aa === undefined ? null : aa;
}

export function isStopCodon(codon: string): boolean {
  return STOP_CODONS.has(codon.toUpperCase());
}
