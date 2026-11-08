/**
 * The honest-limits panel. It sits with the numbers, not in a footer, because
 * this variant foregrounds simulation output (SPEC.md §7.7).
 */

import { FileWarning } from 'lucide-react';

export interface LimitsNoteProps {
  disclaimer: string;
  seed: number;
  cellCount: number;
  constriction: number;
  onsetBelow: number;
  unit: string;
}

export function LimitsNote({
  disclaimer,
  seed,
  cellCount,
  constriction,
  onsetBelow,
  unit,
}: LimitsNoteProps) {
  return (
    <section
      aria-labelledby="limits-heading"
      className="rounded-lg border border-border p-4"
    >
      <h2
        id="limits-heading"
        className="flex items-center gap-2 text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
      >
        <FileWarning className="size-3.5" aria-hidden="true" />
        What these numbers are, and are not
      </h2>

      <p className="mt-2 text-xs text-muted-foreground">{disclaimer}</p>

      <ul className="mt-2 divide-y divide-border text-xs leading-relaxed text-muted-foreground">
        <li className="py-1.5 last:pb-0">
          <span>
            The capillary view is a 2D particle model: {cellCount} cells, seed{' '}
            <span className="tnum text-foreground">{seed}</span>, constriction{' '}
            <span className="tnum text-foreground">{constriction}</span> of the lumen, sickling onset
            below{' '}
            <span className="tnum text-foreground">
              {onsetBelow} {unit}
            </span>
            . Occlusion, mean flow and sickled fraction are properties of that model only. They
            are not predictions about a patient, a cell line or a therapy.
          </span>
        </li>
        <li className="py-1.5 last:pb-0">
          <span>
            The structural annotations are public, textbook teaching summaries of a
            well-documented mechanism. They are not output from a structure-prediction model, and
            carry no clinical performance claim.
          </span>
        </li>
        <li className="py-1.5 last:pb-0">
          <span>
            The biosafety screen is a deterministic keyword-and-registry check, chosen so a
            reviewer can re-derive every verdict by hand. It over-blocks on innocent phrasing and
            can be evaded by paraphrase, and it belongs in front of an institutional biosafety
            review, never in place of one.
          </span>
        </li>
        <li className="py-1.5 last:pb-0">
          <span>
            This tool models edits at the sequence-diff level. It contains no guide, primer,
            vector or protocol detail, and will not produce any.
          </span>
        </li>
      </ul>
    </section>
  );
}
