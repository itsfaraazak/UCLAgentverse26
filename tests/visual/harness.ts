import { target, type Gpu, type Target } from 'vgpu/mock';
import { createVisualGpu, type VisualAdapterKind, type VisualGpu } from './adapter';
import { assertMatchesBaseline, type DiffOptions } from './compare';

export interface SceneContext {
  readonly gpu: Gpu;
  readonly target: Target;
  readonly width: number;
  readonly height: number;
}

export type SceneBuilder = (ctx: SceneContext) => void | Promise<void>;

export interface RenderOptions {
  readonly width?: number;
  readonly height?: number;
  readonly depth?: boolean;
}

export interface RenderedFrame {
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly adapter: VisualAdapterKind;
  readonly adapterLabel: string;
}

export async function withVisualGpu<T>(fn: (gpu: VisualGpu) => Promise<T>): Promise<T> {
  const gpu = await createVisualGpu();
  try {
    return await fn(gpu);
  } finally {
    gpu.dispose();
  }
}

export async function renderScene(scene: SceneBuilder, options: RenderOptions = {}): Promise<RenderedFrame> {
  const width = options.width ?? 256;
  const height = options.height ?? 256;
  const depth = options.depth ?? true;
  return withVisualGpu(async (gpu) => {
    const colorTarget = target(gpu, {
      size: [width, height],
      format: 'rgba8unorm',
      depth,
      label: 'visual.harness.target',
    });
    await scene({ gpu, target: colorTarget, width, height });
    await gpu.settled();
    const pixels = await colorTarget.color.read({ mipLevel: 0, region: 'all' });
    return {
      pixels,
      width,
      height,
      adapter: gpu.visualAdapter,
      adapterLabel: gpu.adapterLabel,
    };
  });
}

export async function renderAndMatchBaseline(
  name: string,
  scene: SceneBuilder,
  options: RenderOptions & DiffOptions = {},
): Promise<RenderedFrame> {
  const frame = await renderScene(scene, options);
  await assertMatchesBaseline({
    name,
    adapter: frame.adapter,
    pixels: frame.pixels,
    width: frame.width,
    height: frame.height,
    options,
  });
  return frame;
}

export function isSolidRgba(pixels: Uint8Array): boolean {
  if (pixels.length < 4) return true;
  const r = pixels[0];
  const g = pixels[1];
  const b = pixels[2];
  const a = pixels[3];
  if (r === undefined || g === undefined || b === undefined || a === undefined) return true;
  for (let i = 4; i < pixels.length; i += 4) {
    if (pixels[i] !== r || pixels[i + 1] !== g || pixels[i + 2] !== b || pixels[i + 3] !== a) {
      return false;
    }
  }
  return true;
}

export function countNonzeroBytes(pixels: Uint8Array): number {
  let count = 0;
  for (const value of pixels) {
    if (value !== 0) count += 1;
  }
  return count;
}
