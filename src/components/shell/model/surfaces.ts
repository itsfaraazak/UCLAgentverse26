/**
 * The product's alternative surfaces.
 *
 * SPEC §6 specifies three variants over the same core — a code-editor
 * triptych, a lab bench and a commit-graph client, routed at `/ide`, `/bench`
 * and `/graph`. All three are present and reachable in the integrated build;
 * this comment previously said they 404 here, which was true only before the
 * variants were merged in.
 *
 * This is a route table, not domain data. Everything describing a *genotype*
 * is derived from `data/loci.json` and `lib/*` — but which URLs this
 * application serves is a fact about the application, and there is nothing to
 * derive it from. Keeping it in one typed list means the rail and the command
 * palette cannot drift apart, and adding a surface is a one-line change.
 */

import type { CommandIconName } from './commands';

/**
 * Narrowed to the icons the surface list actually uses, so the icon lookup in
 * `branch-rail.tsx` is total and cannot return undefined.
 */
export type SurfaceIconName = Extract<
  CommandIconName,
  'Columns3' | 'Activity' | 'GitBranch'
>;

export interface Surface {
  readonly href: string;
  readonly label: string;
  /** How SPEC §6 describes the take, shortened for a dense row. */
  readonly concept: string;
  readonly icon: SurfaceIconName;
}

export const SURFACES: readonly Surface[] = Object.freeze([
  {
    href: '/ide',
    label: 'IDE triptych',
    concept: 'Reviewing a pull request',
    icon: 'Columns3',
  },
  {
    href: '/bench',
    label: 'Lab bench',
    concept: 'Standing at an instrument',
    icon: 'Activity',
  },
  {
    href: '/graph',
    label: 'Graph first',
    concept: 'A git client over the commit DAG',
    icon: 'GitBranch',
  },
]);
