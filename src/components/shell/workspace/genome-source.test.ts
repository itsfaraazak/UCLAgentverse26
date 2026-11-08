/**
 * Which genome the Genome 3D tab draws, per branch.
 *
 * Every expectation is derived from `data/loci.json` through `lib/genome` or
 * from the real workspace, never typed in: the point is that the tab draws
 * the branch's own sequence, so the test recomputes that sequence
 * independently and compares.
 */

import { describe, expect, it } from 'vitest';

import {
  applyVariant,
  diffSequences,
  loadLoci,
  referenceSequence,
  variantById,
} from '@/lib/genome';
import { buildWorkspace } from '../model/workspace';
import { branchNameForGenotype, branchNameForVariant } from '../model/derive';
import type { BranchView } from '../model/types';
import { helixSourceFor } from './genome-source';

const locus = (() => {
  const first = loadLoci()[0];
  if (first === undefined) throw new Error('fixture has no loci');
  return first;
})();
const reference = referenceSequence(locus);

function branchNamed(branches: readonly BranchView[], name: string): BranchView {
  const branch = branches.find((b) => b.name === name);
  if (branch === undefined) throw new Error(`no branch ${name}`);
  return branch;
}

/** Codons that differ between the reference and `bases`, per `lib/genome`. */
function changedCodons(bases: string): number[] {
  return diffSequences(reference, { bases, label: 'expected' })
    .filter((r) => r.status !== 'same')
    .map((r) => r.codonIndex);
}

describe('helixSourceFor — the reference line', () => {
  it('draws main as itself, with no edit marked, rather than the first curated variant', () => {
    const workspace = buildWorkspace();
    const main = branchNamed(workspace.branches, workspace.defaultBranch);

    const source = helixSourceFor(workspace.locus, main);

    // GenomeHelix3D with no variantId would fall back to variants[0]; this is
    // the regression the source selection exists to prevent.
    expect(source.kind).toBe('net');
    if (source.kind !== 'net') return;
    expect(source.editCount).toBe(0);
    expect(source.model.editedCodonIndices).toEqual([]);
    expect(source.model.primaryEditedCodon).toBeNull();
    expect(source.model.annotation).toBeNull();
  });
});

describe('helixSourceFor — single-edit lines use the curated fixture', () => {
  it('takes the curated path exactly when the tip variant alone reproduces the branch', () => {
    const workspace = buildWorkspace();
    let curated = 0;

    for (const branch of workspace.branches) {
      const variantId = branch.tipEdit?.variantId ?? null;
      if (variantId === null) continue;
      const variant = variantById(locus, variantId);
      if (variant === undefined) throw new Error(`fixture lost ${variantId}`);

      let alone: string | null = null;
      try {
        alone = applyVariant(reference, variant).bases;
      } catch {
        alone = null;
      }
      const reproduces = alone === branch.sequence.bases;

      const source = helixSourceFor(workspace.locus, branch);
      expect(source.kind).toBe(reproduces ? 'curated' : 'net');
      if (source.kind === 'curated') {
        curated += 1;
        expect(source.variantId).toBe(variantId);
        expect(source.gene).toBe(locus.gene);
      }
    }

    // The fixture has single-edit lines; if none took the curated path the
    // annotation and its limitation text would never reach this tab.
    expect(curated).toBeGreaterThan(0);
  });

  it('uses the curated path for a variant line no genotype covers', () => {
    const workspace = buildWorkspace();
    const covered = new Set(locus.genotypes.flatMap((g) => [...g.appliedVariants]));
    const uncovered = locus.variants.filter((v) => !covered.has(v.id));
    for (const variant of uncovered) {
      const branch = branchNamed(
        workspace.branches,
        branchNameForVariant(locus.gene, variant.id),
      );
      expect(helixSourceFor(workspace.locus, branch)).toEqual({
        kind: 'curated',
        gene: locus.gene,
        variantId: variant.id,
      });
    }
  });
});

describe('helixSourceFor — compound lines are drawn as their net change', () => {
  it('draws every multi-edit genotype from its own bases, not from its tip variant', () => {
    const workspace = buildWorkspace();
    const compound = locus.genotypes.filter((g) => g.appliedVariants.length > 1);
    expect(compound.length).toBeGreaterThan(0);

    for (const genotype of compound) {
      const branch = branchNamed(workspace.branches, branchNameForGenotype(genotype.id));
      const source = helixSourceFor(workspace.locus, branch);

      expect(source.kind).toBe('net');
      if (source.kind !== 'net') continue;
      expect(source.editCount).toBe(genotype.appliedVariants.length);
      expect(source.model.altLabel).toBe(branch.sequence.label);
      // Whatever the branch's net change is — including none, for a repair
      // that undoes the edit before it — that is what is marked.
      expect([...source.model.editedCodonIndices]).toEqual(
        changedCodons(branch.sequence.bases),
      );
      expect(source.model.annotation).toBeNull();
    }
  });

  it('draws a user-created branch stacked on an edited line with both edits marked', () => {
    const base = locus.genotypes.find((g) => g.appliedVariants.length === 1);
    const baseVariant =
      base === undefined ? undefined : variantById(locus, base.appliedVariants[0] ?? '');
    // A variant at a different codon, so stacking it adds an edit rather than
    // undoing the one already there.
    const stacked = locus.variants.find(
      (v) => baseVariant !== undefined && v.codonIndex !== baseVariant.codonIndex,
    );
    if (base === undefined || baseVariant === undefined || stacked === undefined) {
      throw new Error('fixture needs a single-edit genotype and a variant at another codon');
    }
    const from = branchNameForGenotype(base.id);
    const expectedBases = applyVariant(applyVariant(reference, baseVariant), stacked).bases;

    const workspace = buildWorkspace([{ name: 'stacked-line', from, variantId: stacked.id }]);
    const branch = branchNamed(workspace.branches, 'stacked-line');
    expect(branch.sequence.bases).toBe(expectedBases);

    const source = helixSourceFor(workspace.locus, branch);
    expect(source.kind).toBe('net');
    if (source.kind !== 'net') return;
    expect([...source.model.editedCodonIndices]).toEqual(changedCodons(expectedBases));
    expect(source.model.editedCodonIndices.length).toBeGreaterThan(1);
    // Focus lands on the tip edit, the one this commit introduced.
    expect(source.model.primaryEditedCodon).toBe(branch.tipEdit?.codonIndex);
  });
});
