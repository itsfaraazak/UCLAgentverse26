import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  composite,
  contrastRatio,
  oklchToSrgb,
  parseOklch,
  relativeLuminance,
  type Rgb,
} from './contrast';

/**
 * Reads the real stylesheet, so darkening a token back below AA fails here
 * rather than shipping. SPEC §5 requires AA contrast in both themes, and the
 * verdict colours are the ones that carry blocked / escalated state.
 */
const CSS = readFileSync(
  fileURLToPath(new URL('../../app/globals.css', import.meta.url)),
  'utf8',
);

/** Pull the `:root` and `.dark` blocks out of globals.css. */
function block(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `missing ${selector} block`).toBeGreaterThan(-1);
  const end = CSS.indexOf('\n}', start);
  return CSS.slice(start, end);
}

function token(source: string, name: string): Rgb {
  const match = new RegExp(`${name}:\\s*(oklch\\([^)]*\\))`).exec(source);
  expect(match, `missing ${name}`).not.toBeNull();
  const parsed = match === null ? null : parseOklch(match[1]);
  expect(parsed, `could not parse ${name}: ${match?.[1] ?? ''}`).not.toBeNull();
  return parsed === null ? [0, 0, 0] : parsed.rgb;
}

const THEMES = [
  { name: 'light', selector: ':root' },
  { name: 'dark', selector: '.dark' },
] as const;

/** The four verdict tones, each rendered on `card` and on its own soft tint. */
const TONES = ['pass', 'escalate', 'block', 'conflict'] as const;

/** Alphas the components actually use for a `-soft` background. */
const SOFT_ALPHAS = [0.5, 0.6, 1];

const AA = 4.5;

describe('OKLCH conversion', () => {
  it('maps the achromatic ends to black and white', () => {
    expect(oklchToSrgb(0, 0, 0)).toEqual([0, 0, 0]);
    const white = oklchToSrgb(1, 0, 0);
    for (const channel of white) expect(channel).toBeCloseTo(1, 3);
  });

  it('agrees with known sRGB luminances', () => {
    expect(relativeLuminance([1, 1, 1])).toBeCloseTo(1, 5);
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
    expect(contrastRatio([1, 1, 1], [0, 0, 0])).toBeCloseTo(21, 2);
  });

  it('parses both plain and alpha oklch syntax', () => {
    expect(parseOklch('oklch(0.5 0.1 120)')?.alpha).toBe(1);
    expect(parseOklch('oklch(0.5 0.1 120 / 0.74)')?.alpha).toBeCloseTo(0.74);
    expect(parseOklch('oklch(52% 0.1 120)')?.rgb).toBeDefined();
    expect(parseOklch('rgb(1 2 3)')).toBeNull();
  });
});

describe('verdict colours meet WCAG AA in both themes', () => {
  for (const theme of THEMES) {
    const source = block(theme.selector);
    const card = token(source, '--card');

    for (const tone of TONES) {
      const fg = token(source, `--verdict-${tone}`);
      const soft = token(source, `--verdict-${tone}-soft`);

      it(`${theme.name}: --verdict-${tone} on --card`, () => {
        expect(contrastRatio(fg, card)).toBeGreaterThanOrEqual(AA);
      });

      for (const alpha of SOFT_ALPHAS) {
        it(`${theme.name}: --verdict-${tone} on its soft tint at ${alpha * 100}%`, () => {
          expect(contrastRatio(fg, composite(soft, card, alpha))).toBeGreaterThanOrEqual(AA);
        });
      }
    }

    it(`${theme.name}: muted-foreground on card`, () => {
      expect(contrastRatio(token(source, '--muted-foreground'), card)).toBeGreaterThanOrEqual(AA);
    });

    it(`${theme.name}: foreground on background`, () => {
      expect(
        contrastRatio(token(source, '--foreground'), token(source, '--background')),
      ).toBeGreaterThanOrEqual(AA);
    });
  }
});
