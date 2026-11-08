# Visual tests (`vgpu`)

Headless frame tests for SigmaFold. The harness takes a **scene-building function**, renders it into an offscreen `rgba8unorm` target, and compares the RGBA buffer to a committed PNG.

It does **not** import `src/components/protein/**` or `src/components/cell3d/**`. Wire those in later by passing a `SceneBuilder` that draws them into `ctx.target`.

## Adapter selection

| `VGPU_VISUAL_ADAPTER` | What you get |
| --- | --- |
| unset / `mock` | `vgpu/mock`. Default. No GPU. CI-safe. |
| `node` / `dawn` / `auto` | `vgpu/node` Dawn auto (Metal on this Mac). |
| `hardware` | Dawn, GPU required. |
| `software` | Dawn portable CPU renderer (after `npx vgpu install-software-renderer`). |

`vgpu/mock` **does not execute shaders**. Textures are zeroed `Uint8Array`s. Mock baselines are therefore all-black frames: they prove encode + readback is stable, not that lighting is correct. Real pixels require `node`, `hardware`, or `software`.

`vgpu/three` is **not** a Three.js renderer. It only wraps WGSL exports as Three TSL `wgslFn`s. This harness talks to vgpu's own `draw` / `scene` / `scene/gpu` APIs.

## Commands

```bash
pnpm test:visual
VGPU_VISUAL_ADAPTER=node pnpm test:visual
VGPU_UPDATE_BASELINES=1 pnpm test:visual
VGPU_VISUAL_ADAPTER=node VGPU_UPDATE_BASELINES=1 pnpm test:visual
```

`VGPU_WRITE_SNAPSHOTS=1` is accepted as an alias of `VGPU_UPDATE_BASELINES=1`.

## Add a scene

1. Author a deterministic builder in `tests/visual/scenes/` (fixed camera, lights, size, no `Math.random()`, no wall-clock time).
2. Implement `SceneBuilder`: draw into `ctx.target` with `frame(ctx.gpu, ...)`.
3. Add a test that calls `renderAndMatchBaseline('your-name', buildYourScene, { width, height })`.
4. Generate the baseline (see above) and commit `tests/visual/baselines/<adapter>/<name>.png`.

Baselines are **per adapter**. Mock and Dawn frames are not interchangeable.

On failure the harness writes:

- `tests/visual/output/<adapter>/<name>.actual.png`
- `tests/visual/output/<adapter>/<name>.diff.png`

Those files are gitignored.

## CI

GitHub `ubuntu-latest` has no GPU. The default mock path is what `pnpm test` / `pnpm test:visual` run there. For shaded snapshots in CI, install the software renderer in the image and set `VGPU_VISUAL_ADAPTER=software`. This repo's workflow was not modified.

Pixel-match defaults: `threshold` 0.1 (pixelmatch), `maxMismatchedPixels` 0. On darwin/arm64 Metal the example scene was byte-identical across processes, so the threshold is unused unless a future GPU introduces variance.
