/**
 * The three surfaces, in one list.
 *
 * Shared by the variant switcher on every surface and by the in-app variant switcher, so a route
 * cannot exist in one and be missing from the other. These are three views of
 * one product over the same `lib/` core (SPEC §6) — not three apps.
 */
export interface VariantRoute {
  readonly href: '/ide' | '/bench' | '/graph';
  readonly name: string;
  readonly tagline: string;
  /** What this surface makes primary, and what that costs. */
  readonly concept: string;
  readonly feel: string;
}

export const VARIANTS: readonly VariantRoute[] = [
  {
    href: '/ide',
    name: 'IDE triptych',
    tagline: 'Branch tree ∥ diff ∥ CI',
    concept:
      'Three panes, keyboard first. The diff is the centre of the screen and the agent run reads as a check list, the way a pull request does.',
    feel: 'Reviewing a pull request',
  },
  {
    href: '/bench',
    name: 'Lab bench',
    tagline: 'The cell canvas as the hero',
    concept:
      'The simulation runs full-bleed and the diff becomes a filmstrip of genotypes. Agent checks are gauges and readouts rather than rows.',
    feel: 'Standing at an instrument',
  },
  {
    href: '/graph',
    name: 'Graph first',
    tagline: 'The commit DAG is the canvas',
    concept:
      'Pan and zoom the history graph; clicking a commit opens an inspector with that commit’s diff, its verdicts and the merge gate.',
    feel: 'A git client',
  },
];
