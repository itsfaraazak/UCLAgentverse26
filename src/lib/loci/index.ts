// Variant-local glue — NOT a stub. A typed, validated reader over the
// orchestrator-authored fixture at `src/data/loci.json`.
//
// Why this exists: SPEC §4 does not define a loader for `data/loci.json`, but
// both `lib/agents` (EditPlannerAgent resolves "target locus + edit against
// data/loci.json") and the UI need the fixture as typed data rather than as
// `resolveJsonModule`'s inferred shape. Keeping it here, outside the four
// modules being written in parallel, means replacing those modules does not
// break this variant's rendering. Pure, framework-free, no DOM.
//
// This module reads the fixture. It never invents entries, and every record it
// exposes carries the fixture's own `provenance` label through to the UI.

import rawLoci from '@/data/loci.json';

import type { Variant } from '@/lib/genome';

export type Provenance = 'public-reference' | 'synthetic-illustrative';

export interface StructuralAnnotation {
  readonly refAa: string;
  readonly altAa: string;
  readonly refAaName: string;
  readonly altAaName: string;
  readonly summary: string;
  readonly consequence: string;
  readonly polymerizationTendency: number;
  readonly confidence: string;
  /** The fixture's own statement of what this annotation does not claim. */
  readonly limitation: string;
}

export interface LocusVariant {
  readonly id: string;
  readonly provenance: Provenance;
  readonly label: string;
  readonly hgvs?: string;
  readonly proteinHgvs?: string;
  readonly legacyName?: string;
  readonly numberingNote?: string;
  readonly codonIndex: number;
  readonly refCodon: string;
  readonly altCodon: string;
  readonly kind: Variant['kind'];
  readonly structural: StructuralAnnotation;
}

export interface Exon {
  readonly index: number;
  readonly label: string;
  readonly codonStart: number;
  readonly codonEnd: number;
  readonly note: string;
}

export interface Genotype {
  readonly id: string;
  readonly label: string;
  readonly appliedVariants: readonly string[];
  readonly polymerizationTendency: number;
}

export interface CdsReference {
  readonly label: string;
  readonly startCodon: number;
  readonly codonCount: number;
  readonly bases: string;
}

export interface Locus {
  readonly gene: string;
  readonly provenance: Provenance;
  readonly name: string;
  readonly chromosome: string;
  readonly note: string;
  readonly cdsReference: CdsReference;
  readonly exons: readonly Exon[];
  readonly variants: readonly LocusVariant[];
  readonly genotypes: readonly Genotype[];
}

export interface SimulationDefaults {
  readonly seed: number;
  readonly cellCount: number;
  readonly pO2: number;
  readonly capillaryConstriction: number;
}

export interface PO2Control {
  readonly min: number;
  readonly max: number;
  readonly unit: string;
  readonly label: string;
  readonly sicklingOnsetBelow: number;
}

interface LociFile {
  readonly _disclaimer: string;
  readonly loci: readonly Locus[];
  readonly simulation: {
    readonly _note: string;
    readonly defaults: SimulationDefaults;
    readonly pO2: PO2Control;
  };
}

// `resolveJsonModule` widens `kind` and `provenance` to `string`. The fixture
// is authored by the orchestrator and is checked in, so this is a one-time
// narrowing of known-good data rather than an assertion about user input.
const FILE = rawLoci as unknown as LociFile;

/** The fixture's own disclaimer. Rendered verbatim in the UI (SPEC §7.7). */
export const FIXTURE_DISCLAIMER: string = FILE._disclaimer;

/** The fixture's own note on the simulation parameters. Rendered verbatim. */
export const SIMULATION_NOTE: string = FILE.simulation._note;

export const LOCI: readonly Locus[] = FILE.loci;
export const SIMULATION_DEFAULTS: SimulationDefaults = FILE.simulation.defaults;
export const PO2_CONTROL: PO2Control = FILE.simulation.pO2;

export function findLocus(gene: string): Locus | undefined {
  const key = gene.trim().toUpperCase();
  return LOCI.find((l) => l.gene.toUpperCase() === key);
}

export function findVariant(gene: string, variantId: string): LocusVariant | undefined {
  return findLocus(gene)?.variants.find((v) => v.id === variantId);
}

/** The fixture variant as a `lib/genome` Variant. */
export function toGenomeVariant(gene: string, v: LocusVariant): Variant {
  return {
    gene,
    codonIndex: v.codonIndex,
    refCodon: v.refCodon,
    altCodon: v.altCodon,
    kind: v.kind,
    label: v.label,
  };
}

/**
 * Which of `candidates` appear as whole words in `text`. Case-insensitive,
 * order-stable, de-duplicated. Used to turn a free-text request into the
 * `targets` list that `lib/safety`'s `screen()` expects — it deliberately
 * matches only against a supplied allow-list of known gene symbols, so no
 * fragment of the request itself is ever carried forward.
 */
export function matchGeneSymbols(
  text: string,
  candidates: readonly string[],
): string[] {
  const upper = text.toUpperCase();
  const hits: string[] = [];
  for (const gene of candidates) {
    const symbol = gene.trim().toUpperCase();
    if (symbol === '' || hits.includes(symbol)) continue;
    if (new RegExp(`(^|[^A-Z0-9])${symbol}([^A-Z0-9]|$)`).test(upper)) hits.push(symbol);
  }
  return hits;
}

/** Gene symbols mentioned in free text, restricted to curated loci. */
export function mentionedGenes(text: string): string[] {
  return matchGeneSymbols(
    text,
    LOCI.map((l) => l.gene),
  );
}
