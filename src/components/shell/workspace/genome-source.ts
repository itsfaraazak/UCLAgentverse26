/**
 * Which genome the Genome 3D tab draws for a branch.
 *
 * Pure and framework-free so the choice is tested in a plain node
 * environment; `genome-panel.tsx` only renders what this returns.
 *
 * The obvious wiring — `<GenomeHelix3D variantId={branch.tipEdit.variantId} />`
 * — is wrong for two kinds of branch, and both exist in the fixture:
 *
 * - **A line with no edit** (`main`). `GenomeHelix3D` with no `variantId`
 *   falls back to the locus's *first* curated variant, so the reference line
 *   would be drawn carrying an edit it does not contain.
 * - **A line whose tip edit sits on top of earlier ones** (the `repaired`
 *   genotype applies `HBB_HbS` then `HBB_repair`; a user-created branch can
 *   stack on any line). `buildLocusModel` applies the variant to the
 *   *reference*, so the drawing would be of a sequence the branch does not
 *   hold — or, where the variant's `refCodon` only matches after the earlier
 *   edit, a failure panel for a perfectly good branch.
 *
 * So the curated path is taken only when it provably draws the branch's own
 * sequence: applying the tip variant to the reference yields exactly the
 * branch's bases. That path carries the variant's curated annotation and its
 * `limitation` text. Every other branch is drawn as its net change from the
 * reference — the branch's real bases against the locus reference, through
 * `buildGenomeModel` — with no curated annotation attached, because no single
 * fixture entry describes a compound line.
 */

import { applyVariant, getLocus, referenceSequence, variantById } from '@/lib/genome';
import { buildGenomeModel, type GenomeModel } from '@/components/genome-3d';

import type { BranchView, LocusView } from '../model/types';

export type HelixSource =
  /** Draw the curated fixture: annotation and `limitation` included. */
  | { readonly kind: 'curated'; readonly gene: string; readonly variantId: string }
  /** Draw the branch's own bases against the reference. */
  | {
      readonly kind: 'net';
      readonly model: GenomeModel;
      /** Edit-bearing commits in the branch's history. */
      readonly editCount: number;
    }
  /** The branch's sequence could not be modelled; carries the reason. */
  | { readonly kind: 'unavailable'; readonly detail: string };

export function helixSourceFor(locus: LocusView, branch: BranchView): HelixSource {
  const editCount = branch.commits.filter((c) => c.edit !== null).length;
  const curatedLocus = getLocus(locus.gene);
  const variantId = branch.tipEdit?.variantId ?? null;

  if (curatedLocus !== undefined && variantId !== null) {
    const variant = variantById(curatedLocus, variantId);
    if (variant !== undefined) {
      try {
        const alone = applyVariant(referenceSequence(curatedLocus), variant);
        if (alone.bases === branch.sequence.bases) {
          return { kind: 'curated', gene: curatedLocus.gene, variantId };
        }
      } catch {
        // The variant does not apply to the bare reference (its refCodon only
        // matches after an earlier edit). Fall through to the net view.
      }
    }
  }

  try {
    const model = buildGenomeModel({
      ref: { bases: locus.reference.bases, label: locus.reference.label },
      alt: { bases: branch.sequence.bases, label: branch.sequence.label },
      locus: curatedLocus ?? null,
      ...(branch.tipEdit === null ? {} : { preferredCodonIndex: branch.tipEdit.codonIndex }),
    });
    return { kind: 'net', model, editCount };
  } catch (cause) {
    return {
      kind: 'unavailable',
      detail:
        cause instanceof Error
          ? cause.message
          : 'This branch could not be compared with the reference allele.',
    };
  }
}
