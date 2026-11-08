import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPixelmatch, loadPng, type PngImage } from './deps';

const visualRoot = fileURLToPath(new URL('.', import.meta.url));
const baselinesRoot = join(visualRoot, 'baselines');
const outputRoot = join(visualRoot, 'output');

export interface DiffOptions {
  readonly threshold?: number;
  readonly maxMismatchedPixels?: number;
}

export interface RgbaDiff {
  readonly mismatchedPixels: number;
  readonly ratio: number;
  readonly diff: Uint8Array;
}

export interface BaselineMatch {
  readonly status: 'matched' | 'created' | 'updated';
  readonly mismatchedPixels: number;
  readonly ratio: number;
  readonly baselinePath: string;
}

function shouldUpdateBaselines(): boolean {
  const value = process.env.VGPU_UPDATE_BASELINES ?? process.env.VGPU_WRITE_SNAPSHOTS;
  return value === '1' || value === 'true';
}

export function baselinePath(adapter: string, name: string): string {
  return join(baselinesRoot, adapter, `${name}.png`);
}

export function artifactPaths(adapter: string, name: string): {
  actualPath: string;
  diffPath: string;
} {
  return {
    actualPath: join(outputRoot, adapter, `${name}.actual.png`),
    diffPath: join(outputRoot, adapter, `${name}.diff.png`),
  };
}

export async function encodePng(pixels: Uint8Array, width: number, height: number): Promise<Buffer> {
  const { PNG } = await loadPng();
  const png = new PNG({ width, height });
  png.data.set(pixels);
  return PNG.sync.write(png);
}

export async function decodePng(bytes: Buffer): Promise<PngImage> {
  const { PNG } = await loadPng();
  return PNG.sync.read(bytes);
}

export async function diffRgba(
  expected: Uint8Array,
  actual: Uint8Array,
  width: number,
  height: number,
  options: DiffOptions = {},
): Promise<RgbaDiff> {
  const pixelmatch = (await loadPixelmatch()).default;
  const diff = new Uint8Array(width * height * 4);
  const mismatchedPixels = pixelmatch(expected, actual, diff, width, height, {
    threshold: options.threshold ?? 0.1,
  });
  return {
    mismatchedPixels,
    ratio: mismatchedPixels / (width * height),
    diff,
  };
}

async function writePngFile(path: string, pixels: Uint8Array, width: number, height: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, await encodePng(pixels, width, height));
}

/**
 * Compare a rendered RGBA buffer to the committed baseline for this adapter.
 * Set `VGPU_UPDATE_BASELINES=1` (or `VGPU_WRITE_SNAPSHOTS=1`) to write the baseline.
 */
export async function assertMatchesBaseline(args: {
  readonly name: string;
  readonly adapter: string;
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly options?: DiffOptions;
}): Promise<BaselineMatch> {
  const path = baselinePath(args.adapter, args.name);
  const maxMismatched = args.options?.maxMismatchedPixels ?? 0;
  const update = shouldUpdateBaselines();

  if (!existsSync(path)) {
    if (!update) {
      throw new Error(
        `Missing visual baseline ${path}. Render once with VGPU_UPDATE_BASELINES=1 and commit the PNG.`,
      );
    }
    await writePngFile(path, args.pixels, args.width, args.height);
    return { status: 'created', mismatchedPixels: 0, ratio: 0, baselinePath: path };
  }

  const expectedPng = await decodePng(await readFile(path));
  if (expectedPng.width !== args.width || expectedPng.height !== args.height) {
    throw new Error(
      `${path} is ${expectedPng.width}x${expectedPng.height}; render was ${args.width}x${args.height}.`,
    );
  }

  const expected = new Uint8Array(expectedPng.data.buffer, expectedPng.data.byteOffset, expectedPng.data.byteLength);
  const { mismatchedPixels, ratio, diff } = await diffRgba(
    expected,
    args.pixels,
    args.width,
    args.height,
    args.options,
  );

  if (mismatchedPixels <= maxMismatched) {
    return { status: 'matched', mismatchedPixels, ratio, baselinePath: path };
  }

  if (update) {
    await writePngFile(path, args.pixels, args.width, args.height);
    return { status: 'updated', mismatchedPixels, ratio, baselinePath: path };
  }

  const { actualPath, diffPath } = artifactPaths(args.adapter, args.name);
  await writePngFile(actualPath, args.pixels, args.width, args.height);
  await writePngFile(diffPath, diff, args.width, args.height);
  throw new Error(
    [
      `Visual baseline mismatch for ${args.name} (${args.adapter}).`,
      `mismatchedPixels=${mismatchedPixels} ratio=${ratio.toFixed(6)} allowed=${maxMismatched}`,
      `Baseline: ${path}`,
      `Actual: ${actualPath}`,
      `Diff: ${diffPath}`,
      'Regenerate deliberately with VGPU_UPDATE_BASELINES=1.',
    ].join('\n'),
  );
}
