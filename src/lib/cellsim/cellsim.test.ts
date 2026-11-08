import { describe, expect, it } from 'vitest';

import {
  channelHalfHeight,
  CONSTRICTION_X,
  createSim,
  metrics,
  runHeadless,
  sicklingProbability,
  SICKLING_ONSET_PO2,
  step,
  type SimParams,
} from './index';

const base: SimParams = {
  seed: 20260308,
  cellCount: 140,
  pO2: 95,
  constriction: 0.42,
  polymerizationTendency: 0,
};

describe('determinism', () => {
  it('same seed + same params ⇒ identical metrics', () => {
    const a = runHeadless({ ...base, pO2: 24, polymerizationTendency: 0.85 }, 200);
    const b = runHeadless({ ...base, pO2: 24, polymerizationTendency: 0.85 }, 200);
    expect(a).toEqual(b);
  });

  it('a different seed gives a different trajectory', () => {
    const a = runHeadless({ ...base, seed: 1, pO2: 24, polymerizationTendency: 0.85 }, 200);
    const b = runHeadless({ ...base, seed: 2, pO2: 24, polymerizationTendency: 0.85 }, 200);
    expect(a.occlusion).not.toBe(b.occlusion);
  });

  it('step is a pure function of state', () => {
    const start = createSim({ ...base, pO2: 24, polymerizationTendency: 0.85 });
    const first = step(start);
    const second = step(start);
    expect(first.cells).toEqual(second.cells);
    expect(first.metrics).toEqual(second.metrics);
    // The input state was not mutated.
    expect(start.tick).toBe(0);
  });

  it('runs headless — no canvas, no DOM', () => {
    expect(typeof document).toBe('undefined');
    expect(() => runHeadless({ ...base, pO2: 20, polymerizationTendency: 0.9 }, 50)).not.toThrow();
  });
});

describe('genotype separates the two cases', () => {
  it('a reference genotype never sickles, at any pO2', () => {
    for (const pO2 of [10, 24, 60, 95, 100]) {
      const m = runHeadless({ ...base, pO2, polymerizationTendency: 0 }, 400);
      expect(m.sickledFraction).toBe(0);
      // Occlusion is pathological blockage, not geometric narrowing: with no
      // sickled cells it must read exactly zero, however tight the channel.
      expect(m.occlusion).toBe(0);
    }
  });

  it('a high-tendency genotype sickles and occludes at low pO2', () => {
    const m = runHeadless({ ...base, pO2: 20, polymerizationTendency: 0.85 }, 400);
    expect(m.sickledFraction).toBeGreaterThan(0.5);
    expect(m.occlusion).toBeGreaterThan(0.4);
  });

  it('the repaired genotype behaves close to reference, not to sickle', () => {
    const repaired = runHeadless({ ...base, pO2: 20, polymerizationTendency: 0.05 }, 400);
    const sickle = runHeadless({ ...base, pO2: 20, polymerizationTendency: 0.85 }, 400);
    expect(repaired.occlusion).toBeLessThan(sickle.occlusion);
    expect(repaired.sickledFraction).toBeLessThan(sickle.sickledFraction);
  });

  it('a high-tendency genotype stays largely discoid at high pO2', () => {
    const m = runHeadless({ ...base, pO2: 100, polymerizationTendency: 0.85 }, 400);
    expect(m.sickledFraction).toBeLessThan(0.2);
  });
});

describe('sicklingProbability', () => {
  it('is zero without a polymerisation tendency', () => {
    expect(sicklingProbability(10, 0)).toBe(0);
  });

  it('is zero at or above the onset tension', () => {
    expect(sicklingProbability(SICKLING_ONSET_PO2, 0.85)).toBe(0);
    expect(sicklingProbability(100, 0.85)).toBe(0);
  });

  it('rises monotonically as pO2 falls', () => {
    const high = sicklingProbability(50, 0.85);
    const mid = sicklingProbability(30, 0.85);
    const low = sicklingProbability(10, 0.85);
    expect(high).toBeLessThan(mid);
    expect(mid).toBeLessThan(low);
  });
});

describe('channel geometry', () => {
  it('is unconstricted away from the constriction', () => {
    expect(channelHalfHeight(0.05, 0.42)).toBe(1);
    expect(channelHalfHeight(0.95, 0.42)).toBe(1);
  });

  it('is narrowest at the constriction', () => {
    const atNarrow = channelHalfHeight(CONSTRICTION_X, 0.42);
    expect(atNarrow).toBeLessThan(1);
    expect(atNarrow).toBeGreaterThan(0);
    expect(atNarrow).toBeLessThan(channelHalfHeight(CONSTRICTION_X + 0.05, 0.42));
  });
});

describe('metrics bounds', () => {
  it('keeps occlusion and sickledFraction inside [0,1]', () => {
    let state = createSim({ ...base, pO2: 10, polymerizationTendency: 1 });
    for (let i = 0; i < 300; i += 1) state = step(state);
    const m = metrics(state);
    expect(m.occlusion).toBeGreaterThanOrEqual(0);
    expect(m.occlusion).toBeLessThanOrEqual(1);
    expect(m.sickledFraction).toBeGreaterThanOrEqual(0);
    expect(m.sickledFraction).toBeLessThanOrEqual(1);
    expect(m.meanFlow).toBeGreaterThanOrEqual(0);
  });
});
