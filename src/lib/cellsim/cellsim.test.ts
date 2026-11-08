import { describe, expect, it } from 'vitest';
import { CellSim, lumenHalfWidth, run, sicklingRate } from './index';

const BASE = {
  seed: 20260308,
  cellCount: 140,
  pO2: 95,
  polymerizationTendency: 0,
  capillaryConstriction: 0.42,
};

describe('cellsim determinism', () => {
  it('same seed and params produce identical metrics', () => {
    const a = run({ ...BASE, polymerizationTendency: 0.85, pO2: 20 }, 400);
    const b = run({ ...BASE, polymerizationTendency: 0.85, pO2: 20 }, 400);
    expect(a).toEqual(b);
  });

  it('a different seed produces different metrics', () => {
    const a = run({ ...BASE, seed: 1, polymerizationTendency: 0.85, pO2: 20 }, 400);
    const b = run({ ...BASE, seed: 2, polymerizationTendency: 0.85, pO2: 20 }, 400);
    expect(a).not.toEqual(b);
  });

  it('step() advances the tick count and stays headless', () => {
    const sim = new CellSim(BASE);
    expect(sim.state().tick).toBe(0);
    sim.step();
    sim.step();
    expect(sim.state().tick).toBe(2);
  });
});

describe('genotype separation', () => {
  it('the reference allele does not sickle at any oxygen tension', () => {
    const low = run({ ...BASE, polymerizationTendency: 0, pO2: 10 }, 600);
    expect(low.sickledFraction).toBe(0);
    expect(low.occlusion).toBeLessThan(0.25);
  });

  it('a high-tendency genotype sickles and occludes under hypoxia', () => {
    const sickle = run({ ...BASE, polymerizationTendency: 0.85, pO2: 15 }, 600);
    expect(sickle.sickledFraction).toBeGreaterThan(0.5);
    expect(sickle.occlusion).toBeGreaterThan(0.25);
  });

  it('a repaired genotype behaves close to the reference under hypoxia', () => {
    const repaired = run({ ...BASE, polymerizationTendency: 0.05, pO2: 15 }, 600);
    const reference = run({ ...BASE, polymerizationTendency: 0, pO2: 15 }, 600);
    expect(repaired.sickledFraction).toBeLessThan(0.2);
    expect(repaired.meanFlow).toBeGreaterThan(reference.meanFlow * 0.6);
  });

  it('lowering oxygen tension raises the sickled fraction', () => {
    const high = run({ ...BASE, polymerizationTendency: 0.85, pO2: 95 }, 600);
    const low = run({ ...BASE, polymerizationTendency: 0.85, pO2: 15 }, 600);
    expect(low.sickledFraction).toBeGreaterThan(high.sickledFraction);
  });
});

describe('model shape', () => {
  it('the lumen is narrowest at the constriction', () => {
    expect(lumenHalfWidth(0.5, 0.42)).toBeLessThan(lumenHalfWidth(0.1, 0.42));
    expect(lumenHalfWidth(0.5, 0)).toBeCloseTo(0.5, 6);
  });

  it('sickling rate rises monotonically as oxygen tension falls', () => {
    expect(sicklingRate(20, 0.85)).toBeGreaterThan(sicklingRate(60, 0.85));
    expect(sicklingRate(60, 0.85)).toBeGreaterThan(sicklingRate(95, 0.85));
    expect(sicklingRate(20, 0)).toBe(0);
  });

  it('metrics stay inside their declared ranges', () => {
    const m = run({ ...BASE, polymerizationTendency: 1, pO2: 10 }, 500);
    expect(m.occlusion).toBeGreaterThanOrEqual(0);
    expect(m.occlusion).toBeLessThanOrEqual(1);
    expect(m.sickledFraction).toBeGreaterThanOrEqual(0);
    expect(m.sickledFraction).toBeLessThanOrEqual(1);
    expect(m.meanFlow).toBeGreaterThanOrEqual(0);
  });
});
