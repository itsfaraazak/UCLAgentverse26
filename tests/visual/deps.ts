import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ShaderSource } from 'vgpu/mock';

const requireFromRoot = createRequire(join(process.cwd(), 'package.json'));
const requireFromVgpu = createRequire(requireFromRoot.resolve('vgpu/package.json'));

function vgpuDepHref(specifier: string): string {
  return pathToFileURL(requireFromVgpu.resolve(specifier)).href;
}

export type PixelmatchFn = (
  img1: Uint8Array | Uint8ClampedArray,
  img2: Uint8Array | Uint8ClampedArray,
  output: Uint8Array | Uint8ClampedArray | undefined,
  width: number,
  height: number,
  options?: { readonly threshold?: number },
) => number;

export interface PngImage {
  width: number;
  height: number;
  data: Buffer;
}

export interface PngConstructor {
  new (options: { readonly width: number; readonly height: number }): PngImage;
  sync: {
    write(png: PngImage): Buffer;
    read(data: Buffer): PngImage;
  };
}

type PixelmatchModule = { default: PixelmatchFn };
type PngModule = { PNG: PngConstructor };
type PrepareModule = {
  prepareShader: (source: string, path?: string) => ShaderSource;
};

let pixelmatchMod: Promise<PixelmatchModule> | undefined;
let pngMod: Promise<PngModule> | undefined;
let prepareMod: Promise<PrepareModule> | undefined;

export function loadPixelmatch(): Promise<PixelmatchModule> {
  pixelmatchMod ??= import(vgpuDepHref('pixelmatch')) as Promise<PixelmatchModule>;
  return pixelmatchMod;
}

export function loadPng(): Promise<PngModule> {
  pngMod ??= import(vgpuDepHref('pngjs')) as Promise<PngModule>;
  return pngMod;
}

export async function prepareWgsl(source: string, path?: string): Promise<ShaderSource> {
  prepareMod ??= import(vgpuDepHref('@vgpu/wgsl/prepare')) as Promise<PrepareModule>;
  const { prepareShader } = await prepareMod;
  return prepareShader(source, path);
}
