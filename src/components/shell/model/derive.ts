/**
 * Derivations that turn fixture data into the strings and shapes the shell
 * needs. Every function here is a pure projection of `data/loci.json` or of a
 * `lib/*` return value — none of them invents a value.
 *
 * The one thing that looks like authored content is `requestFor()`, which
 * builds the free-text request a branch's check run screened. It is assembled
 * from the locus's own gene symbol, codon index and variant id, and the shell
 * displays it verbatim next to the run, so a reviewer can see exactly what the
 * pipeline was given rather than having to trust it.
 */

import type { Locus, LocusVariant, Sequence } from '@/lib/genome';
import { translate, variantById } from '@/lib/genome';
import type { EditView, ExonView, LocusView, SequenceView } from './types';

/**
 * How the request text for a branch's check run is derived.
 *
 * `lib/agents`' `IntentAgent` parses an operation keyword and a variant hint
 * out of free text, so the derived sentence has to carry both. The operation
 * word is chosen from the variant's own fields:
 *
 *   - reference and alternate amino acid identical  → `Silent`
 *   - alternate codon restores the reference codon  → `Repair`
 *   - otherwise                                     → `Introduce`
 *
 * and the variant id is included so `resolveVariantHint` pins the exact
 * fixture entry instead of falling back to the planner's default.
 */
export function operationWordFor(locus: Locus, variant: LocusVariant): string {
  if (variant.structural.refAa === variant.structural.altAa) return 'Silent';
  const referenceCodon = codonAt(locus.cdsReference.bases, variant.codonIndex);
  if (referenceCodon !== null && referenceCodon === variant.altCodon) return 'Repair';
  return 'Introduce';
}

export function requestFor(locus: Locus, variant: LocusVariant): string {
  const op = operationWordFor(locus, variant);
  return `${op} ${locus.gene} at codon ${variant.codonIndex} using variant ${variant.id}`;
}

/** The 1-based codon at `index`, or null when the index is out of range. */
export function codonAt(bases: string, index: number): string | null {
  if (!Number.isInteger(index) || index < 1) return null;
  const start = (index - 1) * 3;
  if (start + 3 > bases.length) return null;
  return bases.slice(start, start + 3);
}

export function sequenceView(sequence: Sequence): SequenceView {
  return {
    bases: sequence.bases,
    label: sequence.label,
    protein: translate(sequence.bases),
  };
}

export function editViewOf(locus: Locus, variant: LocusVariant): EditView {
  return {
    gene: variant.gene,
    codonIndex: variant.codonIndex,
    refCodon: variant.refCodon,
    altCodon: variant.altCodon,
    kind: variant.kind,
    label: variant.label,
    variantId: variant.id,
    hgvs: variant.hgvs ?? null,
    proteinHgvs: variant.proteinHgvs ?? null,
    legacyName: variant.legacyName ?? null,
    numberingNote: variant.numberingNote ?? null,
    refAa: variant.structural.refAa,
    altAa: variant.structural.altAa,
  };
}

/**
 * Branch naming. `main` carries the imported reference; every proposed
 * genotype line is `line/<slug>`, where the slug comes from the genotype id,
 * or — for a curated variant no genotype covers — from the variant id with
 * its gene prefix stripped.
 */
export function branchNameForGenotype(genotypeId: string): string {
  return `line/${slug(genotypeId)}`;
}

export function branchNameForVariant(gene: string, variantId: string): string {
  const prefix = `${gene.toUpperCase()}_`;
  const bare = variantId.toUpperCase().startsWith(prefix)
    ? variantId.slice(prefix.length)
    : variantId;
  return `line/${slug(bare)}`;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function locusView(locus: Locus): LocusView {
  const lastModelledCodon = locus.cdsReference.startCodon + locus.cdsReference.codonCount - 1;
  const exons: ExonView[] = locus.exons.map((exon) => ({
    index: exon.index,
    label: exon.label,
    codonStart: exon.codonStart,
    codonEnd: exon.codonEnd,
    note: exon.note,
    // An exon is "modelled" when any of it falls inside the CDS window the
    // app can actually diff and translate.
    //
    // Computed rather than asserted, because the window is fixture data and
    // has already changed once: it was the first 31 codons, and is now the
    // whole NM_000518.5 CDS, which makes every exon modelled. A hardcoded
    // flag would have silently kept greying exons 2 and 3 as "context" after
    // they became fully modelled.
    modelled:
      exon.codonStart <= lastModelledCodon &&
      exon.codonEnd >= locus.cdsReference.startCodon,
  }));
  return {
    gene: locus.gene,
    name: locus.name,
    chromosome: locus.chromosome,
    provenance: locus.provenance,
    note: locus.note,
    reference: sequenceView({
      bases: locus.cdsReference.bases,
      label: locus.cdsReference.label,
    }),
    codonCount: locus.cdsReference.codonCount,
    startCodon: locus.cdsReference.startCodon,
    exons,
  };
}

/** Variant ids no genotype in the locus applies. */
export function uncoveredVariants(locus: Locus): readonly LocusVariant[] {
  const covered = new Set<string>();
  for (const genotype of locus.genotypes) {
    for (const id of genotype.appliedVariants) covered.add(id);
  }
  return locus.variants.filter((variant) => !covered.has(variant.id));
}

export function requireVariant(locus: Locus, variantId: string): LocusVariant {
  const variant = variantById(locus, variantId);
  if (variant === undefined) {
    throw new Error(
      `shell/model: genotype references variant '${variantId}', which is not in data/loci.json`,
    );
  }
  return variant;
}

export function short(oid: string): string {
  return oid.slice(0, 12);
}

/** Fixed-precision formatting for metric readouts, so rows do not jitter. */
export function fixed(value: number, places = 3): string {
  return value.toFixed(places);
}

export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
