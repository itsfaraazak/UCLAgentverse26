/**
 * Private locus-fixture helpers for the agent pipeline.
 *
 * `lib/genome` does not exist in this worktree and must not be imported.
 * These lookups are the minimum needed to parse intents and copy curated
 * annotations out of `data/loci.json` — no translation, no variant
 * application, no construct design.
 */

import lociFile from '@/data/loci.json';
import { FLAGGED_LOCI } from '@/lib/safety/policy';

export type LocusFixture = (typeof lociFile.loci)[number];
export type LocusVariant = LocusFixture['variants'][number];
export type LocusGenotype = LocusFixture['genotypes'][number];

const LOCI: readonly LocusFixture[] = lociFile.loci;

export function allLoci(): readonly LocusFixture[] {
  return LOCI;
}

export function findLocus(gene: string): LocusFixture | undefined {
  const key = gene.trim().toUpperCase();
  return LOCI.find((l) => l.gene.toUpperCase() === key);
}

export function findVariant(locus: LocusFixture, id: string): LocusVariant | undefined {
  return locus.variants.find((v) => v.id === id);
}

export function findGenotype(locus: LocusFixture, id: string): LocusGenotype | undefined {
  return locus.genotypes.find((g) => g.id === id);
}

export function referenceGenotype(locus: LocusFixture): LocusGenotype | undefined {
  const empty = locus.genotypes.find((g) => g.appliedVariants.length === 0);
  if (empty) return empty;
  return locus.genotypes[0];
}

/**
 * Gene symbols the intent parser is allowed to emit: curated loci plus the
 * flagged-locus registry. Nothing outside those lists is ever treated as a
 * target.
 */
export function knownGeneSymbols(): readonly string[] {
  const set = new Set<string>();
  for (const locus of LOCI) {
    set.add(locus.gene.toUpperCase());
  }
  for (const flagged of FLAGGED_LOCI) {
    set.add(flagged.gene.toUpperCase());
  }
  return [...set].sort();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
