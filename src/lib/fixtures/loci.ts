/**
 * Typed, validated access to `src/data/loci.json`.
 *
 * Not a stub: SPEC §4 does not specify a fixture-loading interface, so this is
 * this variant's own module. It is framework-free and pure. If `lib/genome`
 * ships its own loader at integration, consolidate onto that one — this file
 * only ever reads the orchestrator-authored JSON and never mutates it.
 *
 * Every entry carries a `provenance` label (SPEC §7.6) and every structural
 * annotation carries its own `limitation` string, which the UI must surface
 * wherever it shows the derived numbers (SPEC §7.7).
 */

import raw from '@/data/loci.json';
import type { Variant } from '@/lib/genome';

export type Provenance = 'public-reference' | 'synthetic-illustrative';

export interface LocusExon {
  readonly index: number;
  readonly label: string;
  readonly codonStart: number;
  readonly codonEnd: number;
  readonly note: string;
  /** True when any part of this exon lies inside the modelled CDS window. */
  readonly modelled: boolean;
  /** True when the exon straddles the edge of the modelled window. */
  readonly partiallyModelled: boolean;
}

export interface StructuralAnnotation {
  readonly refAa: string;
  readonly altAa: string;
  readonly refAaName: string;
  readonly altAaName: string;
  readonly summary: string;
  readonly consequence: string;
  readonly polymerizationTendency: number;
  readonly confidence: string;
  readonly limitation: string;
}

export interface LocusVariant extends Variant {
  readonly id: string;
  readonly provenance: Provenance;
  readonly hgvs?: string;
  readonly proteinHgvs?: string;
  readonly legacyName?: string;
  readonly numberingNote?: string;
  readonly structural: StructuralAnnotation;
}

export interface LocusGenotype {
  readonly id: string;
  readonly label: string;
  readonly appliedVariants: readonly string[];
  readonly polymerizationTendency: number;
}

export interface Locus {
  readonly gene: string;
  readonly provenance: Provenance;
  readonly name: string;
  readonly chromosome: string;
  readonly note: string;
  readonly cdsReference: {
    readonly label: string;
    readonly startCodon: number;
    /** Derived from `bases`, not read from the file. See the note below. */
    readonly codonCount: number;
    /** The file's own `codonCount`, when it disagrees with the sequence. */
    readonly declaredCodonCount: number | null;
    readonly bases: string;
  };
  readonly exons: readonly LocusExon[];
  readonly variants: readonly LocusVariant[];
  readonly genotypes: readonly LocusGenotype[];
}

export interface SimulationFixture {
  readonly note: string;
  readonly defaults: {
    readonly seed: number;
    readonly cellCount: number;
    readonly pO2: number;
    readonly capillaryConstriction: number;
  };
  readonly pO2: {
    readonly min: number;
    readonly max: number;
    readonly unit: string;
    readonly label: string;
    readonly sicklingOnsetBelow: number;
  };
}

function provenanceOf(value: string, field: string): Provenance {
  if (value === 'public-reference' || value === 'synthetic-illustrative') return value;
  throw new Error(`loci.json: ${field} has an unlabelled provenance`);
}

function kindOf(value: string, field: string): Variant['kind'] {
  if (value === 'substitution' || value === 'deletion' || value === 'insertion') return value;
  throw new Error(`loci.json: ${field} is not a supported variant kind`);
}

/**
 * Three DNA bases, or a load-time fixture error.
 *
 * This reader takes its field types from the JSON import, so a malformed codon
 * would have reached `applyVariant` with no runtime check at all. Nothing
 * downstream catches a bad `altCodon`: it is spliced into the codon list as-is,
 * so a two-base value shifts the reading frame of every codon after it and
 * still translates, to a plausible wrong protein.
 *
 * Kept in step with `lib/genome/loci.ts`, which carries the same rule and the
 * reasoning in full. That this rule now lives in two places is the cost of the
 * two fixture readers GOALS §6 records as duplication worth collapsing — the
 * collapse is the fix, not dropping the check from one of them.
 */
function codonOf(value: string, field: string): string {
  const codon = value.toUpperCase();
  if (!/^[ACGT]{3}$/.test(codon)) {
    throw new Error(
      `loci.json: ${field} must be three DNA bases from A, C, G, T — got ` +
        `${JSON.stringify(codon)}`,
    );
  }
  return codon;
}

const LOCI: readonly Locus[] = Object.freeze(
  raw.loci.map((locus): Locus => {
    const bases = locus.cdsReference.bases.toUpperCase();
    if (bases.length % 3 !== 0) {
      throw new Error(
        `loci.json: ${locus.gene} CDS is ${bases.length} nt, not a whole number of codons`,
      );
    }
    // The sequence is authoritative. The file currently declares 30 codons for
    // a 93 nt (31 codon) region; `diffSequences` and `translate` both work off
    // the bases, so taking the declared value here would make the gene track
    // disagree with the diff about how many codons exist. The declared value
    // is kept so the UI can disclose the discrepancy rather than hide it.
    const codonCount = bases.length / 3;
    const declared = locus.cdsReference.codonCount;
    return {
      gene: locus.gene,
      provenance: provenanceOf(locus.provenance, `${locus.gene}.provenance`),
      name: locus.name,
      chromosome: locus.chromosome,
      note: locus.note,
      cdsReference: {
        label: locus.cdsReference.label,
        startCodon: locus.cdsReference.startCodon,
        codonCount,
        declaredCodonCount: declared === codonCount ? null : declared,
        bases,
      },
      exons: locus.exons.map((exon) => ({
        index: exon.index,
        label: exon.label,
        codonStart: exon.codonStart,
        codonEnd: exon.codonEnd,
        note: exon.note,
        // A genuine overlap test: an exon counts as modelled when any of it
        // falls inside codons 1..codonCount, not merely when it starts there.
        modelled: exon.codonStart <= codonCount && exon.codonEnd >= 1,
        partiallyModelled: exon.codonStart <= codonCount && exon.codonEnd > codonCount,
      })),
      variants: locus.variants.map((variant): LocusVariant => {
        const kind = kindOf(variant.kind, `${variant.id}.kind`);
        const base: LocusVariant = {
          id: variant.id,
          provenance: provenanceOf(variant.provenance, `${variant.id}.provenance`),
          gene: locus.gene,
          codonIndex: variant.codonIndex,
          // An insertion has no reference codon to verify (SPEC §4.6 #15), and
          // a deletion's `altCodon` is unused — neither is shape-checked here.
          refCodon:
            kind === 'insertion'
              ? variant.refCodon.toUpperCase()
              : codonOf(variant.refCodon, `${variant.id}.refCodon`),
          altCodon:
            kind === 'deletion'
              ? variant.altCodon.toUpperCase()
              : codonOf(variant.altCodon, `${variant.id}.altCodon`),
          kind,
          label: variant.label,
          structural: { ...variant.structural },
        };
        // Optional fields are only present on some fixtures; keep them absent
        // rather than `undefined` so object identity stays stable for hashing.
        const extras: {
          hgvs?: string;
          proteinHgvs?: string;
          legacyName?: string;
          numberingNote?: string;
        } = {};
        if ('hgvs' in variant && typeof variant.hgvs === 'string') extras.hgvs = variant.hgvs;
        if ('proteinHgvs' in variant && typeof variant.proteinHgvs === 'string') {
          extras.proteinHgvs = variant.proteinHgvs;
        }
        if ('legacyName' in variant && typeof variant.legacyName === 'string') {
          extras.legacyName = variant.legacyName;
        }
        if ('numberingNote' in variant && typeof variant.numberingNote === 'string') {
          extras.numberingNote = variant.numberingNote;
        }
        return { ...base, ...extras };
      }),
      genotypes: locus.genotypes.map((genotype) => ({
        id: genotype.id,
        label: genotype.label,
        appliedVariants: [...genotype.appliedVariants],
        polymerizationTendency: genotype.polymerizationTendency,
      })),
    };
  }),
);

const BY_GENE = new Map<string, Locus>(LOCI.map((l) => [l.gene.toUpperCase(), l]));

export function allLoci(): readonly Locus[] {
  return LOCI;
}

export function getLocus(gene: string): Locus | undefined {
  return BY_GENE.get(gene.trim().toUpperCase());
}

export function requireLocus(gene: string): Locus {
  const locus = getLocus(gene);
  if (locus === undefined) throw new Error(`no curated locus for ${gene}`);
  return locus;
}

export function getVariant(locus: Locus, id: string): LocusVariant | undefined {
  return locus.variants.find((v) => v.id === id);
}

export function requireVariant(locus: Locus, id: string): LocusVariant {
  const variant = getVariant(locus, id);
  if (variant === undefined) throw new Error(`unknown variant ${id} on ${locus.gene}`);
  return variant;
}

export const SIMULATION: SimulationFixture = Object.freeze({
  note: raw.simulation._note,
  defaults: { ...raw.simulation.defaults },
  pO2: { ...raw.simulation.pO2 },
});

/** The fixture-level disclaimer, surfaced in the UI (SPEC §7.7). */
export const LOCI_DISCLAIMER: string = raw._disclaimer;
