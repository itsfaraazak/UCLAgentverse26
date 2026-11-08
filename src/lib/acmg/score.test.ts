import { describe, expect, it } from 'vitest';
import { ACMG_SCOPE_LIMITATION, bandForPoints, scoreAcmg } from './score';
import type { AcmgCode, AcmgInputs, AcmgResult } from './types';

/**
 * A baseline that meets no criterion at all: frequency sits between PM2's
 * ceiling and BS1's floor, and the in-silico score sits between BP4 and PP3.
 */
const NEUTRAL: AcmgInputs = {
  populationFrequency: 0.001,
  isNullVariantInLofGene: false,
  matchesKnownPathogenicAaChange: false,
  inSilicoDeleteriousScore: 0.5,
  segregatesWithDisease: false,
};

function with_(overrides: Partial<AcmgInputs>): AcmgInputs {
  return { ...NEUTRAL, ...overrides };
}

function criterion(result: AcmgResult, code: AcmgCode) {
  const found = result.criteria.find((c) => c.code === code);
  if (found === undefined) throw new Error(`missing criterion ${code}`);
  return found;
}

function metCodes(result: AcmgResult): AcmgCode[] {
  return result.criteria.filter((c) => c.met).map((c) => c.code);
}

describe('scoreAcmg trail', () => {
  it('records all eight criteria, in the source order, even when none is met', () => {
    const result = scoreAcmg(NEUTRAL);
    expect(result.criteria.map((c) => c.code)).toEqual([
      'PVS1',
      'PS1',
      'PM2',
      'PP3',
      'PP1',
      'BA1',
      'BS1',
      'BP4',
    ]);
    expect(metCodes(result)).toEqual([]);
    expect(result.points).toBe(0);
    expect(result.classification).toBe('Uncertain Significance');
  });

  it('records weight 0 for an unmet criterion and the sum equals the points', () => {
    const result = scoreAcmg(with_({ isNullVariantInLofGene: true, inSilicoDeleteriousScore: 0.1 }));
    for (const c of result.criteria) {
      if (!c.met) expect(c.weight).toBe(0);
    }
    expect(result.criteria.reduce((s, c) => s + c.weight, 0)).toBe(result.points);
  });

  it('is deterministic', () => {
    const inputs = with_({ matchesKnownPathogenicAaChange: true, populationFrequency: 0.0001 });
    expect(JSON.stringify(scoreAcmg(inputs))).toBe(JSON.stringify(scoreAcmg(inputs)));
  });
});

describe('each criterion in isolation', () => {
  const cases: ReadonlyArray<{
    readonly code: AcmgCode;
    readonly inputs: AcmgInputs;
    readonly weight: number;
  }> = [
    { code: 'PVS1', inputs: with_({ isNullVariantInLofGene: true }), weight: 8 },
    { code: 'PS1', inputs: with_({ matchesKnownPathogenicAaChange: true }), weight: 4 },
    { code: 'PM2', inputs: with_({ populationFrequency: 0.0001 }), weight: 2 },
    { code: 'PP3', inputs: with_({ inSilicoDeleteriousScore: 0.9 }), weight: 1 },
    { code: 'PP1', inputs: with_({ segregatesWithDisease: true }), weight: 1 },
    { code: 'BS1', inputs: with_({ populationFrequency: 0.03 }), weight: -4 },
    { code: 'BP4', inputs: with_({ inSilicoDeleteriousScore: 0.1 }), weight: -1 },
  ];

  for (const c of cases) {
    it(`${c.code} alone contributes ${c.weight}`, () => {
      const result = scoreAcmg(c.inputs);
      expect(metCodes(result)).toEqual([c.code]);
      expect(criterion(result, c.code).weight).toBe(c.weight);
      expect(result.points).toBe(c.weight);
    });
  }

  it('BA1 alone contributes no points but classifies Benign', () => {
    const result = scoreAcmg(with_({ populationFrequency: 0.08 }));
    expect(metCodes(result)).toEqual(['BA1']);
    expect(criterion(result, 'BA1').weight).toBe(0);
    expect(result.points).toBe(0);
    expect(result.classification).toBe('Benign');
    expect(criterion(result, 'BA1').note).toContain('OVERRIDES');
  });
});

describe('criterion thresholds are inclusive/exclusive exactly as the source', () => {
  it('PM2 needs freq strictly below 0.0005', () => {
    expect(criterion(scoreAcmg(with_({ populationFrequency: 0.0004999 })), 'PM2').met).toBe(true);
    expect(criterion(scoreAcmg(with_({ populationFrequency: 0.0005 })), 'PM2').met).toBe(false);
    expect(criterion(scoreAcmg(with_({ populationFrequency: 0 })), 'PM2').met).toBe(true);
  });

  it('BS1 is the half-open band (0.01, 0.05]', () => {
    expect(criterion(scoreAcmg(with_({ populationFrequency: 0.01 })), 'BS1').met).toBe(false);
    expect(criterion(scoreAcmg(with_({ populationFrequency: 0.0100001 })), 'BS1').met).toBe(true);
    expect(criterion(scoreAcmg(with_({ populationFrequency: 0.05 })), 'BS1').met).toBe(true);
    expect(criterion(scoreAcmg(with_({ populationFrequency: 0.0500001 })), 'BS1').met).toBe(false);
  });

  it('BA1 needs freq strictly above 0.05, and never co-fires with BS1', () => {
    const at = scoreAcmg(with_({ populationFrequency: 0.05 }));
    expect(criterion(at, 'BA1').met).toBe(false);
    expect(at.classification).toBe('Uncertain Significance');
    const above = scoreAcmg(with_({ populationFrequency: 0.0500001 }));
    expect(criterion(above, 'BA1').met).toBe(true);
    expect(criterion(above, 'BS1').met).toBe(false);
  });

  it('PP3 is inclusive at 0.7; BP4 is exclusive at 0.3', () => {
    expect(criterion(scoreAcmg(with_({ inSilicoDeleteriousScore: 0.7 })), 'PP3').met).toBe(true);
    expect(criterion(scoreAcmg(with_({ inSilicoDeleteriousScore: 0.6999 })), 'PP3').met).toBe(false);
    expect(criterion(scoreAcmg(with_({ inSilicoDeleteriousScore: 0.3 })), 'BP4').met).toBe(false);
    expect(criterion(scoreAcmg(with_({ inSilicoDeleteriousScore: 0.2999 })), 'BP4').met).toBe(true);
  });
});

describe('band boundaries through scoreAcmg', () => {
  it('5 is Uncertain Significance, 6 is Likely Pathogenic', () => {
    const five = scoreAcmg(with_({ matchesKnownPathogenicAaChange: true, segregatesWithDisease: true }));
    expect(five.points).toBe(5);
    expect(five.classification).toBe('Uncertain Significance');
    const six = scoreAcmg(with_({ matchesKnownPathogenicAaChange: true, populationFrequency: 0.0001 }));
    expect(six.points).toBe(6);
    expect(six.classification).toBe('Likely Pathogenic');
  });

  it('9 is Likely Pathogenic, 10 is Pathogenic', () => {
    const nine = scoreAcmg(with_({ isNullVariantInLofGene: true, segregatesWithDisease: true }));
    expect(nine.points).toBe(9);
    expect(nine.classification).toBe('Likely Pathogenic');
    const ten = scoreAcmg(with_({ isNullVariantInLofGene: true, populationFrequency: 0.0001 }));
    expect(ten.points).toBe(10);
    expect(ten.classification).toBe('Pathogenic');
  });

  it('-5 (the most negative reachable total) is Uncertain Significance', () => {
    const minus5 = scoreAcmg(with_({ populationFrequency: 0.03, inSilicoDeleteriousScore: 0.1 }));
    expect(minus5.points).toBe(-5);
    expect(minus5.classification).toBe('Uncertain Significance');
  });

  it('documents a scope limit: no input reaches -6, so Likely Benign is unreachable by points', () => {
    // The only negative weights in this subset are BS1 (-4) and BP4 (-1).
    // Exhaustively enumerate every criterion combination the inputs allow.
    const freqs = [0.0001, 0.001, 0.03, 0.08];
    const scores = [0.1, 0.5, 0.9];
    const bools = [false, true];
    let min = Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    for (const populationFrequency of freqs)
      for (const inSilicoDeleteriousScore of scores)
        for (const isNullVariantInLofGene of bools)
          for (const matchesKnownPathogenicAaChange of bools)
            for (const segregatesWithDisease of bools) {
              const r = scoreAcmg({
                populationFrequency,
                inSilicoDeleteriousScore,
                isNullVariantInLofGene,
                matchesKnownPathogenicAaChange,
                segregatesWithDisease,
              });
              min = Math.min(min, r.points);
              seen.add(r.classification);
              const ba1 = r.criteria.some((c) => c.code === 'BA1' && c.met);
              expect(r.classification).toBe(ba1 ? 'Benign' : bandForPoints(r.points));
            }
    expect(min).toBe(-5);
    expect(seen.has('Likely Benign')).toBe(false);
  });
});

describe('bandForPoints at every published boundary', () => {
  it.each([
    [11, 'Pathogenic'],
    [10, 'Pathogenic'],
    [9, 'Likely Pathogenic'],
    [6, 'Likely Pathogenic'],
    [5, 'Uncertain Significance'],
    [0, 'Uncertain Significance'],
    [-5, 'Uncertain Significance'],
    [-6, 'Likely Benign'],
    [-9, 'Likely Benign'],
    [-10, 'Benign'],
    [-11, 'Benign'],
  ] as const)('%i -> %s', (points, band) => {
    expect(bandForPoints(points)).toBe(band);
  });

  it('rejects a non-integer total rather than guessing a band', () => {
    expect(() => bandForPoints(5.5)).toThrow(RangeError);
    expect(() => bandForPoints(Number.NaN)).toThrow(RangeError);
  });
});

describe('BA1 override', () => {
  it('forces Benign over a total that would otherwise be Pathogenic', () => {
    const result = scoreAcmg({
      populationFrequency: 0.08,
      isNullVariantInLofGene: true,
      matchesKnownPathogenicAaChange: true,
      inSilicoDeleteriousScore: 0.9,
      segregatesWithDisease: true,
    });
    // PVS1 8 + PS1 4 + PP3 1 + PP1 1 = 14; PM2 cannot fire at this frequency.
    expect(result.points).toBe(14);
    expect(bandForPoints(result.points)).toBe('Pathogenic');
    expect(result.classification).toBe('Benign');
    expect(criterion(result, 'BA1').met).toBe(true);
  });

  it('applies at the smallest frequency above 0.05 with maximal pathogenic evidence', () => {
    const result = scoreAcmg({
      populationFrequency: 0.050001,
      isNullVariantInLofGene: true,
      matchesKnownPathogenicAaChange: true,
      inSilicoDeleteriousScore: 1,
      segregatesWithDisease: true,
    });
    expect(result.classification).toBe('Benign');
  });
});

describe('input validation (fail closed)', () => {
  it.each([Number.NaN, -0.1, 1.1, Number.POSITIVE_INFINITY])(
    'rejects populationFrequency %s',
    (populationFrequency) => {
      expect(() => scoreAcmg(with_({ populationFrequency }))).toThrow(RangeError);
    },
  );

  it.each([Number.NaN, -0.1, 1.1])('rejects inSilicoDeleteriousScore %s', (inSilicoDeleteriousScore) => {
    expect(() => scoreAcmg(with_({ inSilicoDeleteriousScore }))).toThrow(RangeError);
  });
});

describe("reproduces the source prototype's documented results", () => {
  it('HBB c.20A>T (HbS, rs334) lands on Likely Pathogenic at 8 points', () => {
    // acmg_inputs copied verbatim from the source's public-reference fixture.
    // Its README: "On the headline HBB example this scoped rubric lands on
    // 'Likely Pathogenic,' one notch below the 'Pathogenic' call real ClinVar
    // gives HbS."
    const result = scoreAcmg({
      populationFrequency: 0.0003,
      isNullVariantInLofGene: false,
      matchesKnownPathogenicAaChange: true,
      inSilicoDeleteriousScore: 0.91,
      segregatesWithDisease: true,
    });
    expect(result.classification).toBe('Likely Pathogenic');
    expect(result.points).toBe(8);
    expect(metCodes(result)).toEqual(['PS1', 'PM2', 'PP3', 'PP1']);
  });

  it('synthetic-illustrative DEMO1 (source fixture) is Likely Pathogenic', () => {
    const result = scoreAcmg({
      populationFrequency: 0.0003,
      isNullVariantInLofGene: false,
      matchesKnownPathogenicAaChange: true,
      inSilicoDeleteriousScore: 0.78,
      segregatesWithDisease: true,
    });
    expect(result.classification).toBe('Likely Pathogenic');
  });

  it('synthetic-illustrative DEMO2 (source fixture) is Benign via BA1', () => {
    const result = scoreAcmg({
      populationFrequency: 0.08,
      isNullVariantInLofGene: false,
      matchesKnownPathogenicAaChange: false,
      inSilicoDeleteriousScore: 0.1,
      segregatesWithDisease: false,
    });
    expect(result.classification).toBe('Benign');
    expect(criterion(result, 'BA1').met).toBe(true);
  });
});

describe('caveat', () => {
  it('states the PS1/BS1/PP1 approximation and that this is not a clinical tool', () => {
    expect(ACMG_SCOPE_LIMITATION).toMatch(/PS1, BS1 and PP1/);
    expect(ACMG_SCOPE_LIMITATION).toMatch(/not a certified clinical tool/);
  });
});
