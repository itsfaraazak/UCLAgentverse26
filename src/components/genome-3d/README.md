# `components/genome-3d` — 3D view of the locus

A Three.js view of **the gene itself** — a schematic B-form double helix
running the coding region, one bead per codon, with the edited codon ringed
and focusable. Distinct from `components/protein`, which draws a deposited
*protein* structure.

```tsx
import { GenomeHelix3D } from '@/components/genome-3d';

<GenomeHelix3D />                                  // HBB, first curated variant
<GenomeHelix3D variantId="HBB_repair" />           // the reverse substitution
<GenomeHelix3D variantId="HBB_silent_demo" />      // silent change: codon differs, AA does not
<GenomeHelix3D renderer="webgl" />                 // rehearse the WebGL 2 fallback on stage
<GenomeHelix3D model={uploadedModel} />            // an uploaded genome (see components/genome-upload)
```

It is a `'use client'` component that is safe to render from a server
component or page: the full text alternative prerenders, and `three` arrives
only through a dynamic `import()` after mount (`load-engine.ts`), so host
pages stay statically prerenderable and three never lands in the initial
chunk. You do **not** need `next/dynamic`.

Props-driven and layout-agnostic — it fills whatever box it is given, works
down to roughly 320px wide, and assumes nothing about the page around it.
Drop it in a resizable panel and it tracks the container, not the window.

## Props

| prop | default | |
|---|---|---|
| `gene` | `HBB` | gene symbol in `loci.json` |
| `variantId` | first variant | which curated variant to diff against the reference |
| `model` | — | a prebuilt `GenomeModel`, which overrides `gene`/`variantId` |
| `renderer` | `'auto'` | `'webgl'` forces WebGL 2 |
| `autoRotate` | `false` | idle rotation; forced off under `prefers-reduced-motion` |
| `onRendererChange` | — | `({ kind, label, fallbackReason }) \| null` |
| `className` | — | merged onto the outer `<section>` |

## Everything drawn comes from `lib/genome`

`model.ts` is the only data path, and it holds no geometry and no sequences:

- the loci loader and `referenceSequence()` give the reference allele,
- `applyVariant()` produces the alternate — the edit semantics and the
  `refCodon` check stay in `lib/genome` rather than being re-implemented here,
- `diffSequences()` produces one row per codon, which becomes one bead,
- `translate()` gives the two protein strings shown in the text alternative.

`layout.ts` turns a codon *count* into helix coordinates. It is pure numbers
with no `three` import, so the geometry is unit-tested in a plain node
environment and the renderer holds no maths.

### The unsequenced tail is drawn as unsequenced

The helix runs the locus's full annotated extent. Where a locus is annotated
further than it is sequenced, the codons past the modelled region are emitted
with `status: 'unsequenced'` and `refCodon: null` — drawn dim, with no
base-pair rungs, and called out in the legend. Nothing is invented to fill
the gap.

This mattered more than it does today: `loci.json` used to carry a 31-codon
excerpt inside a locus annotated to codon 147. It now carries the real
NM_000518.5 CDS (148 codons including the stop), so HBB has no unsequenced
tail and the legend row for it does not render. The path is kept, and
covered by a test on a synthetic short locus, because it is what stops a
future partial fixture from being drawn as though it were sequenced.

### Indels and coordinates

`DiffRow.codonIndex` is an *alignment row*, not a CDS coordinate, once an
indel has shifted the two sequences apart (SPEC §4.5 #2). When that happens
the model sets `coordinatesDiverge`, the UI switches the word "codon" to
"alignment row", and a note explains that the two sequences no longer share
one coordinate system. It is not silently papered over.

The same rule governs exons. `loci.json` annotates exons in CDS coordinates,
and an alignment row only *is* a CDS codon while the two sequences are still
in step — so from the first indel onward `exonIndex` is `null` rather than a
confident lookup by a row number that no longer names a CDS position. No
curated locus currently carries an indel (SPEC §4.8 records that gap), so
this only bites once one is added; it is pinned by a test on a synthetic
deletion so it cannot regress silently.

## Instancing

Every codon and base pair is drawn from a handful of geometries:

| mesh | instances (HBB) |
|---|---|
| codon core beads | one per annotated codon (148 for the current fixture), coloured by diff status |
| base-pair rungs | one per *modelled* base only (444) |
| edit halo + axis ring | one per edited codon |
| backbone ribbons | 2 plain meshes (`TubeGeometry` along each strand) |

`engine.test.ts` asserts the tracked-resource count stays **under 20** while
the whole locus is on screen — the real figure is in the teens, against 148
codons — which is what proves these are instanced rather than a mesh per
codon. Counts are derived from `loci.json` in the tests rather than
hardcoded: the genome refresh above broke ten assertions that had the old
numbers baked in.

## Disposal

Every geometry, material and instanced mesh goes through the shared
`ResourceTracker` at creation, and `dispose()` frees the lot, cancels any
pending animation frame, removes the `OrbitControls` listener, detaches the
viewport (dropping the `ResizeObserver` and the context-lost listener) and
releases the GPU context. It is idempotent.

`engine.test.ts` asserts `trackedResourceCount()` drops to **0** after
`dispose()`, that the renderer's `release()` ran exactly once, that the canvas
left the DOM, and that the auto-rotate loop is dead rather than merely paused.
A separate test fails the mount partway — after the context is acquired —
and asserts the same teardown runs, because a throw there used to strand the
context with no reference left to free it.

What is **not** covered: the real `forceContextLoss()` inside
`runtime/renderer.ts`. Every test substitutes a fake renderer whose `release`
only counts calls, so that line is exercised by no test in the repo. A leaked
WebGL context across route switches would eventually evict the live one, so
this is the gap worth closing next.

## Failure behaviour

Every failure replaces the canvas with an alert carrying the codon change in
words, the structural summary, the technical reason and a working **Retry**:
three chunk failed to load (`library`), no WebGPU *and* no WebGL 2
(`renderer`), unusable model (`data`), context lost (`context-lost`). The
full text description renders below the view regardless, so a viewer with no
GPU still learns what changed. Never a blank box, never an unhandled
rejection.

## Accessibility

The canvas is `aria-hidden`; the host element carries `role="img"` with a
real text alternative and `aria-describedby` pointing at the description
below. Keyboard: arrows orbit, `+`/`-` zoom, `0`/`Home` fit,
`F` jumps to the edit site. Every toolbar control is a labelled button with a
visible focus ring. `prefers-reduced-motion` forces rotation off and hides
the rotation toggle.

## Honesty

The helix is a **schematic** at textbook B-form proportions (≈3.4 Å rise,
≈10.5 bp/turn) drawn to place codons in space. It is not a predicted or
deposited structure and models nothing about the physical effect of the edit.
The component says that next to the view, and surfaces the variant's own
`limitation` text from `loci.json` wherever a structural claim appears.

## Shared runtime

Renderer selection (WebGPU → WebGL 2), resource tracking, viewport sizing,
the error vocabulary and the status pill all come from
`@/components/protein/runtime/`. This directory adds no renderer code of its
own and forks nothing.
