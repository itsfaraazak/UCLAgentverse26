import { describe, expect, it } from 'vitest';
import { diffRgba, encodePng, decodePng } from './compare';

function fillRgba(width: number, height: number, rgba: readonly [number, number, number, number]): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = rgba[0];
    pixels[i + 1] = rgba[1];
    pixels[i + 2] = rgba[2];
    pixels[i + 3] = rgba[3];
  }
  return pixels;
}

describe('visual frame comparison', () => {
  it('reports zero mismatches for identical buffers', async () => {
    const a = fillRgba(8, 8, [12, 34, 56, 255]);
    const b = fillRgba(8, 8, [12, 34, 56, 255]);
    const { mismatchedPixels, ratio } = await diffRgba(a, b, 8, 8, { threshold: 0.1 });
    expect(mismatchedPixels).toBe(0);
    expect(ratio).toBe(0);
  });

  it('reports every pixel when two solid frames differ', async () => {
    const a = fillRgba(4, 4, [0, 0, 0, 255]);
    const b = fillRgba(4, 4, [255, 0, 0, 255]);
    const { mismatchedPixels, diff } = await diffRgba(a, b, 4, 4, { threshold: 0.1 });
    expect(mismatchedPixels).toBe(16);
    expect(diff.length).toBe(4 * 4 * 4);
  });

  it('round-trips RGBA through pngjs', async () => {
    const pixels = fillRgba(2, 2, [10, 20, 30, 255]);
    const encoded = await encodePng(pixels, 2, 2);
    const decoded = await decodePng(encoded);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(Array.from(decoded.data.subarray(0, 4))).toEqual([10, 20, 30, 255]);
  });
});
