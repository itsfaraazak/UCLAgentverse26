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

`loci.json` annotates HBB's exons out to codon **147**, but only the first
**31** codons carry real bases. So the helix runs the locus's full annotated
extent, and codons past the modelled region are emitted with
`status: 'unsequenced'` and `refCodon: null` — drawn dim, with no base-pair
rungs, and called out in the legend. Nothing is invented to fill the gap.
This matches the gene track, which already greys that region for context.

### Indels and coordinates

`DiffRow.codonIndex` is an *alignment row*, not a CDS coordinate, once an
indel has shifted the two sequences apart (SPEC §4.5 #2). When that happens
the model sets `coordinatesDiverge`, the UI switches the word "codon" to
"alignment row", and a note explains that the two sequences no longer share
one coordinate system. It is not silently papered over.

## Instancing

147 codons and 93 base pairs are drawn from a handful of geometries:

| mesh | instances (HBB) |
|---|---|
| codon core beads | 147 — one per annotated codon, coloured by diff status |
| base-pair rungs | 93 — one per *modelled* base only |
| edit halo + axis ring | one per edited codon |
| backbone ribbons | 2 plain meshes (`TubeGeometry` along each strand) |

`engine.test.ts` asserts the tracked-resource count stays under 20 while 147
codons are on screen, which is what proves these are instanced rather than a
mesh per codon.

## Disposal

Every geometry, material and instanced mesh goes through the shared
`ResourceTracker` at creation, and `dispose()` frees the lot, cancels any
pending animation frame, removes the `OrbitControls` listener, detaches the
viewport (dropping the `ResizeObserver` and the context-lost listener) and
releases the GPU context. It is idempotent.

`engine.test.ts` asserts `trackedResourceCount()` drops to **0** after
`dispose()`, that `forceContextLoss` ran, that the canvas left the DOM, and
that the auto-rotate loop is dead rather than merely paused. A leaked WebGL
context across route switches would eventually evict the live one, so this is
tested rather than assumed.

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
