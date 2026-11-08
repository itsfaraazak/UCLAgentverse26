# `components/protein` — 3D protein structure viewer

Three.js view of a deposited haemoglobin structure with the edited residue
highlighted. Client-side only; rendering runs on the viewer's own GPU.

```tsx
import { ProteinViewer } from '@/components/protein';

<ProteinViewer />                                   // HBB_HbS, PDB 2HBS ↔ 4HHB
<ProteinViewer variantId="HBB_repair" />            // same position, reverse change
<ProteinViewer renderer="webgl" />                  // rehearse the WebGL fallback on stage
<ProteinViewer loadPdb={(id, signal) => fetch(`/pdb/${id}.pdb`, { signal }).then((r) => r.text())} />
```

It is a `'use client'` component that is safe to render from a server component
or page: it prerenders its full text alternative, and three.js arrives only via
a dynamic `import()` after mount (`load-engine.ts`), so host pages stay
statically prerenderable and three never lands in the initial chunk. You do
**not** need `next/dynamic`.

## Props

| prop | default | |
|---|---|---|
| `variantId` | `HBB_HbS` | `loci.json` variant for position, residues and annotation |
| `codonIndex`, `refAa`, `altAa` | from fixture | overrides; if they differ from the fixture, its prose is hidden |
| `pdbId` | `2HBS` | structure carrying the **alternate** residue |
| `referencePdbId` | `4HHB` | structure carrying the **reference** residue (toggle); `null` hides it |
| `renderer` | `'auto'` | `'webgl'` forces WebGL 2 |
| `loadPdb` | RCSB download | `(id, signal) => Promise<string>`, e.g. a same-origin copy for offline demos |
| `onRendererChange` | — | `({ kind, label, fallbackReason }) \| null` |
| `className` | — | merged onto the outer `<section>` |

## Numbering

`loci.json` uses CDS codons (codon 7). Deposited globin structures number the
mature chain, initiator Met removed, so the viewer looks for **residue 6**
(`fixture.ts`, `INITIATOR_MET_OFFSET`). It highlights only chains where that
residue *is* the expected amino acid (Val in 2HBS, Glu in 4HHB); if none
matches, nothing is highlighted and the panel says so.

## Failure behaviour

Every failure replaces the canvas with an alert containing the residue change
in words, the fixture summary, the technical reason, and **Retry**:
download failed / timed out / non-PDB body (`network`), three chunk failed
(`library`), file unusable (`data`), no WebGPU *and* no WebGL 2 (`renderer`),
context lost (`context-lost`). The full text description is always rendered
below the canvas regardless.

## Shared runtime

`runtime/` (renderer selection, resource tracking, viewport, error vocabulary,
status UI) is also used by `components/cell3d`. It lives here only because this
task allowed files in these two directories; it has no protein-specific code.
