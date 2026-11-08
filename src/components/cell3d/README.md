# `components/cell3d` — 3D capillary flow renderer

A Three.js drop-in alternative to a 2D cell canvas. It **renders**
`lib/cellsim`; it does not simulate. Each animation frame runs whole
`CellSim.step()` calls (fixed 60 steps/s, ≤ 4 per frame) and writes every
cell's simulated position, radius, heading and state into two
`InstancedMesh`es (discoid / sickled). Nothing is interpolated or eased.

```tsx
'use client';
import { CellFlow3D, type CellFlowMetrics } from '@/components/cell3d';

const [metrics, setMetrics] = useState<CellFlowMetrics | null>(null);

<CellFlow3D
  pO2={pO2}                                  // slider value, mmHg
  polymerizationTendency={genotype.polymerizationTendency}
  seed={20260308}                            // optional; changing it restarts the sim
  onMetrics={setMetrics}                     // { occlusion, meanFlow, sickledFraction, tick, pO2, polymerizationTendency }
/>
```

Like `ProteinViewer`, it prerenders its text panel and loads three.js only via a
dynamic `import()` after mount (`load-engine.ts`); host pages stay static.

## Props

| prop | default | |
|---|---|---|
| `pO2`, `polymerizationTendency` | required | applied in place via `CellSim.setPO2` / `setPolymerizationTendency` — cells keep their state |
| `seed`, `cellCount`, `capillaryConstriction` | `loci.json` defaults | changing any restarts the simulation |
| `onMetrics` | — | ~4 Hz while playing (every 15 ticks), and on every step while paused |
| `paused` | `prefers-reduced-motion` | initial state; the user's Play/Pause wins afterwards |
| `renderer` | `'auto'` | `'webgl'` forces WebGL 2 |
| `onRendererChange`, `className` | — | |

## Visual encoding

* red biconcave disc — discoid; violet crescent — sickled; amber — sickled and
  stalled inside the constriction (speed relative to the sim's own initial
  centreline speed);
* the vessel is drawn as a cut-away back half whose radius is
  `channelHalfHeight()` from `lib/cellsim`, so the drawn constriction is the
  one cells are confined by; the ring at the neck tints orange with the sim's
  `occlusion` metric.

## Reduced motion / paused

Starts paused under `prefers-reduced-motion`, after settling 120 real ticks so
the still frame is a simulated state, not the seeding grid. While paused,
**Step** / **+120 ticks** advance the real sim, and a pO₂ or genotype change
settles 120 ticks so the still frame reflects it.

## Failure behaviour

The simulation (`driver.ts`) is independent of the renderer. If the three
chunk fails, no GPU renderer is available, or the context is lost, the canvas
is replaced with an alert that says the sim is still running and shows its live
metrics as text, plus **Retry**. The metrics panel below the canvas is always
present and is the text alternative for the canvas.

Depends on `components/protein/runtime` for renderer selection and disposal.
