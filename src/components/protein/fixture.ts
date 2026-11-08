import lociFile from '@/data/loci.json';

/**
 * Everything the viewer says about the residue change comes from
 * `data/loci.json`. Nothing structural is authored here: the only additions
 * are the standard amino-acid name table (so prop overrides can be named)
 * and the CDS → PDB numbering offset, which `loci.json` itself documents in
 * the variant's `numberingNote`.
 */

export const DEFAULT_VARIANT_ID = 'HBB_HbS';

/**
 * CDS codon numbering counts the initiator methionine; deposited globin
 * structures number the mature chain, which has that methionine removed
 * (see `numberingNote` on HBB_HbS: "Codon 7 in CDS numbering. The legacy
 * 'Glu6Val' name counts from the mature protein"). So CDS codon 7 is PDB
 * residue 6.
 */
export const INITIATOR_MET_OFFSET = 1;

/** Standard one-letter → [three-letter, name] table (IUPAC). */
export const AMINO_ACIDS: Readonly<Record<string, readonly [string, string]>> = {
  A: ['ALA', 'Alanine'],
  R: ['ARG', 'Arginine'],
  N: ['ASN', 'Asparagine'],
  D: ['ASP', 'Aspartate'],
  C: ['CYS', 'Cysteine'],
  E: ['GLU', 'Glutamate'],
  Q: ['GLN', 'Glutamine'],
  G: ['GLY', 'Glycine'],
  H: ['HIS', 'Histidine'],
  I: ['ILE', 'Isoleucine'],
  L: ['LEU', 'Leucine'],
  K: ['LYS', 'Lysine'],
  M: ['MET', 'Methionine'],
  F: ['PHE', 'Phenylalanine'],
  P: ['PRO', 'Proline'],
  S: ['SER', 'Serine'],
  T: ['THR', 'Threonine'],
  W: ['TRP', 'Tryptophan'],
  Y: ['TYR', 'Tyrosine'],
  V: ['VAL', 'Valine'],
};

export function aminoAcid(oneLetter: string): { code: string; three: string; name: string } {
  const code = oneLetter.trim().toUpperCase();
  const entry = AMINO_ACIDS[code];
  if (entry === undefined) {
    return { code, three: code, name: `Unknown residue (${code})` };
  }
  const [three, name] = entry;
  return { code, three, name };
}

/** PDB three-letter codes are upper-case; prose wants "Glu". */
export function titleCase3(three: string): string {
  return three.charAt(0) + three.slice(1).toLowerCase();
}

export interface ResidueChange {
  readonly gene: string;
  readonly geneName: string;
  readonly variantId: string;
  readonly variantLabel: string;
  readonly provenance: string;
  readonly codonIndex: number;
  /** Position in mature-chain (PDB) numbering. */
  readonly pdbResidueNumber: number;
  readonly ref: { code: string; three: string; name: string };
  readonly alt: { code: string; three: string; name: string };
  readonly proteinHgvs: string | null;
  readonly legacyName: string | null;
  readonly numberingNote: string | null;
  readonly summary: string | null;
  readonly consequence: string | null;
  readonly confidence: string | null;
  readonly limitation: string | null;
  /** True when a prop override changed the position or residues, so the
   *  fixture's prose may no longer describe what is shown. */
  readonly overridden: boolean;
}

export interface ResidueOverrides {
  readonly variantId?: string;
  readonly codonIndex?: number;
  readonly refAa?: string;
  readonly altAa?: string;
}

function findVariant(variantId: string) {
  for (const locus of lociFile.loci) {
    for (const variant of locus.variants) {
      if (variant.id === variantId) return { locus, variant };
    }
  }
  return null;
}

export function resolveResidueChange(overrides: ResidueOverrides = {}): ResidueChange {
  const variantId = overrides.variantId ?? DEFAULT_VARIANT_ID;
  const found = findVariant(variantId);
  const fixtureCodon = found?.variant.codonIndex ?? null;
  const fixtureRef = found?.variant.structural.refAa ?? null;
  const fixtureAlt = found?.variant.structural.altAa ?? null;

  const codonIndex = overrides.codonIndex ?? fixtureCodon ?? 1;
  const refCode = overrides.refAa ?? fixtureRef ?? 'X';
  const altCode = overrides.altAa ?? fixtureAlt ?? 'X';
  const overridden =
    found === null ||
    codonIndex !== fixtureCodon ||
    refCode.toUpperCase() !== fixtureRef ||
    altCode.toUpperCase() !== fixtureAlt;

  const structural = found?.variant.structural;
  return {
    gene: found?.locus.gene ?? 'unknown',
    geneName: found?.locus.name ?? 'Unknown gene',
    variantId,
    variantLabel: found?.variant.label ?? variantId,
    provenance: found?.variant.provenance ?? 'unknown',
    codonIndex,
    pdbResidueNumber: codonIndex - INITIATOR_MET_OFFSET,
    ref: aminoAcid(refCode),
    alt: aminoAcid(altCode),
    proteinHgvs: found?.variant.proteinHgvs ?? null,
    legacyName: found?.variant.legacyName ?? null,
    numberingNote: found?.variant.numberingNote ?? null,
    // When overridden we keep the fixture prose out: it describes a different
    // change and showing it would be a fabricated structural claim.
    summary: overridden ? null : (structural?.summary ?? null),
    consequence: overridden ? null : (structural?.consequence ?? null),
    confidence: overridden ? null : (structural?.confidence ?? null),
    limitation: overridden ? null : (structural?.limitation ?? null),
    overridden,
  };
}

/** One line, suitable for a fallback panel or an aria-label. */
export function describeChange(change: ResidueChange): string {
  const { ref, alt } = change;
  return (
    `${ref.name} (${titleCase3(ref.three)}, ${ref.code}) → ${alt.name} ` +
    `(${titleCase3(alt.three)}, ${alt.code}) at codon ${change.codonIndex} ` +
    `(residue ${change.pdbResidueNumber} in mature-chain numbering)`
  );
}

export type StructureState = 'alt' | 'ref';

export interface StructureOption {
  readonly pdbId: string;
  /** Which side of the change this deposited structure carries. */
  readonly carries: StructureState;
}
