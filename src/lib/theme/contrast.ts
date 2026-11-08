/**
 * OKLCH → sRGB → WCAG contrast, so the palette's accessibility claim can be
 * checked by a test rather than asserted in a comment (SPEC §5: AA contrast
 * in both themes).
 *
 * Pure and framework-free: no DOM, no CSSOM. The conversion is the standard
 * Oklab matrix pair; it agrees with browsers to well within the precision a
 * 4.5:1 threshold needs.
 */

export type Rgb = readonly [number, number, number];

/** Convert an OKLCH triple (L 0–1, C, h in degrees) to gamma-encoded sRGB. */
export function oklchToSrgb(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const lCbrt = l + 0.3963377774 * a + 0.2158037573 * b;
  const mCbrt = l - 0.1055613458 * a - 0.0638541728 * b;
  const sCbrt = l - 0.0894841775 * a - 1.291485548 * b;

  const lLin = lCbrt ** 3;
  const mLin = mCbrt ** 3;
  const sLin = sCbrt ** 3;

  const r = 4.0767416621 * lLin - 3.3077115913 * mLin + 0.2309699292 * sLin;
  const g = -1.2684380046 * lLin + 2.6097574011 * mLin - 0.3413193965 * sLin;
  const bl = -0.0041960863 * lLin - 0.7034186147 * mLin + 1.707614701 * sLin;

  return [encode(r), encode(g), encode(bl)];
}

function encode(channel: number): number {
  const v = Math.min(1, Math.max(0, channel));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** WCAG 2.x relative luminance of a gamma-encoded sRGB colour. */
export function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (channel: number): number =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours, 1–21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Composite `fg` over `bg` at `alpha`, as a translucent tint renders. */
export function composite(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ];
}

/** Parse `oklch(L C H)` / `oklch(L C H / A)`, returning sRGB and alpha. */
export function parseOklch(value: string): { rgb: Rgb; alpha: number } | null {
  const match = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/.exec(
    value.trim(),
  );
  if (match === null) return null;
  const num = (raw: string | undefined, fallback: number): number => {
    if (raw === undefined) return fallback;
    return raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
  };
  const l = num(match[1], 0);
  const c = num(match[2], 0);
  const h = num(match[3], 0);
  if (!Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(h)) return null;
  return { rgb: oklchToSrgb(l, c, h), alpha: num(match[4], 1) };
}
