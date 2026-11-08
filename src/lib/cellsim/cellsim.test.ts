import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import lociFile from '@/data/loci.json';
import {
  ASSAY_MODEL_LIMITATION,
  CellSim,
  Mulberry32,
  PO2_RANGE,
  SIMULATION_DEFAULTS,
  SIMULATION_NOTE,
  runAssay,
} from './index';

const HBB = lociFile.loci.find((l) => l.gene === 'HBB');

function genotypePoly(id: string): number {
  const geno = HBB?.genotypes.find((g) => g.id === id);
  if (geno === undefined) {
    throw new Error(`missing HBB genotype ${id}`);
  }
  return geno.polymerizationTendency;
}

const WT = genotypePoly('wildtype');
const SICKLE = genotypePoly('sickle');
const REPAIRED = genotypePoly('repaired');

function throwIfRandom(): () => void {
  const original = Math.random;
  Math.random = () => {
    throw new Error('Math.random() must not be used');
  };
  return () => {
    Math.random = original;
  };
}

describe('Mulberry32', () => {
  it('replays an identical sequence for an identical seed', () => {
    const a = new Mulberry32(20260308);
    const b = new Mulberry32(20260308);
    const seqA = [a.next(), a.next(), a.next(), a.range(-1, 1)];
    const seqB = [b.next(), b.next(), b.next(), b.range(-1, 1)];
    expect(seqA).toEqual(seqB);
  });

  it('diverges when the seed diverges', () => {
    const a = new Mulberry32(1);
    const b = new Mulberry32(2);
    expect(a.next()).not.toBe(b.next());
  });
});

describe('CellSim determinism', () => {
  it('never calls Math.random', () => {
    const restore = throwIfRandom();
    try {
      runAssay({
        polymerizationTendency: SICKLE,
        pO2: PO2_RANGE.min,
        seed: 7,
        steps: 40,
      });
    } finally {
      restore();
    }
  });

  it('yields byte-identical metrics for the same seed and params', () => {
    const restore = throwIfRandom();
    try {
      const input = {
        polymerizationTendency: SICKLE,
        pO2: 25,
        seed: SIMULATION_DEFAULTS.seed,
        steps: 80,
      };
      const a = runAssay(input);
      const b = runAssay(input);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    } finally {
      restore();
    }
  });

  it('replays cell positions identically', () => {
    const params = { polymerizationTendency: SICKLE, pO2: 30, seed: 99 };
    const s1 = new CellSim(params);
    const s2 = new CellSim(params);
    s1.run(50);
    s2.run(50);
    expect(JSON.stringify(s1.snapshot().cells)).toBe(JSON.stringify(s2.snapshot().cells));
    expect(JSON.stringify(s1.metrics())).toBe(JSON.stringify(s2.metrics()));
  });

  it('reads the sickling onset from loci.json rather than a hardcoded constant', () => {
    const src = readFileSync(fileURLToPath(new URL('./simulation.ts', import.meta.url)), 'utf8');
    expect(src).toContain('sicklingOnsetBelow');
    expect(src).not.toContain('Math.random');
    expect(PO2_RANGE.sicklingOnsetBelow).toBe(lociFile.simulation.pO2.sicklingOnsetBelow);
  });
});

describe('CellSim genotype × pO2 behaviour', () => {
  const steps = 220;
  const high = SIMULATION_DEFAULTS.pO2;
  const low = PO2_RANGE.min;
  const seed = SIMULATION_DEFAULTS.seed;

  it('keeps reference occlusion near zero at high pO2', () => {
    const wtHigh = runAssay({ polymerizationTendency: WT, pO2: high, seed, steps });
    expect(wtHigh.occlusion).toBeLessThan(0.05);
    expect(wtHigh.sickledFraction).toBeLessThan(0.05);
  });

  it('occludes the sickle genotype substantially more than reference at low pO2', () => {
    const wtLow = runAssay({ polymerizationTendency: WT, pO2: low, seed, steps });
    const sickleLow = runAssay({ polymerizationTendency: SICKLE, pO2: low, seed, steps });
    expect(sickleLow.occlusion).toBeGreaterThan(wtLow.occlusion);
    expect(sickleLow.sickledFraction).toBeGreaterThan(wtLow.sickledFraction);
    expect(sickleLow.meanFlow).toBeLessThan(wtLow.meanFlow);
  });

  it('keeps the repaired genotype close to the reference, not the sickle allele', () => {
    const wtLow = runAssay({ polymerizationTendency: WT, pO2: low, seed, steps });
    const sickleLow = runAssay({ polymerizationTendency: SICKLE, pO2: low, seed, steps });
    const repairedLow = runAssay({ polymerizationTendency: REPAIRED, pO2: low, seed, steps });
    expect(repairedLow.occlusion).toBeLessThan(sickleLow.occlusion);
    expect(Math.abs(repairedLow.occlusion - wtLow.occlusion)).toBeLessThan(
      Math.abs(sickleLow.occlusion - wtLow.occlusion),
    );
    expect(Math.abs(repairedLow.sickledFraction - wtLow.sickledFraction)).toBeLessThan(
      Math.abs(sickleLow.sickledFraction - wtLow.sickledFraction),
    );
  });

  it('sickles more below the fixture onset than above it, for the sickle genotype', () => {
    const onset = PO2_RANGE.sicklingOnsetBelow;
    const above = runAssay({
      polymerizationTendency: SICKLE,
      pO2: Math.min(PO2_RANGE.max, onset + 20),
      seed,
      steps,
    });
    const below = runAssay({
      polymerizationTendency: SICKLE,
      pO2: Math.max(PO2_RANGE.min, onset - 25),
      seed,
      steps,
    });
    expect(below.sickledFraction).toBeGreaterThan(above.sickledFraction);
  });

  it('runs fully headless', () => {
    expect(typeof globalThis.window).toBe('undefined');
    const snap = new CellSim({ polymerizationTendency: WT, seed: 1 }).run(5);
    expect(snap.cells.length).toBe(SIMULATION_DEFAULTS.cellCount);
    expect(snap.geom.opening).toBeGreaterThan(0);
  });
});

describe('model limits are stated in the module, not per surface', () => {
  it('carries the fixture note on the parameters', () => {
    expect(SIMULATION_NOTE).toContain('not calibrated');
    expect(SIMULATION_NOTE).toContain('illustrative');
  });

  it('carries a short limitation string for a panel', () => {
    expect(ASSAY_MODEL_LIMITATION).toMatch(/illustrative/i);
    expect(ASSAY_MODEL_LIMITATION).toMatch(/not validated/i);
  });
});
