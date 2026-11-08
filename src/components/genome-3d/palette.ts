/**
 * Scene palette, in its own three-free module.
 *
 * Both the engine (to colour instances) and the React legend (to label the
 * exact colours drawn) need these numbers, so they cannot live in `engine.ts`
 * — importing that from the shell would pull `three` into the host page's
 * initial chunk and defeat the dynamic `import()` in `load-engine.ts`.
 *
 * Hex, because WebGL needs numbers rather than CSS custom properties, but
 * chosen to sit beside the theme tokens in `globals.css` rather than
 * inventing a second palette: `codonEdited` tracks `--verdict-escalate` (an
 * edit is a thing to review, not a pass or a failure), `codonSilent` tracks
 * `--chart-5`, and the rest are the neutral greys. One source of truth, so
 * the legend cannot drift from the scene.
 */
export const GENOME_PALETTE = {
  strandA: 0x6b7a90,
  strandB: 0x4a5668,
  rung: 0x8c99ab,
  codonSame: 0x7c8899,
  codonSilent: 0xa07bc8,
  codonEdited: 0xe0a33a,
  codonUnsequenced: 0x3d4654,
  highlight: 0xf0b542,
} as const;
