import { describe, expect, it } from 'vitest';

import { collapse, computeMetrics, rate, wilson, type Call, type Outcome, type Truth } from './metrics';

function outcomes(spec: readonly [Truth, Call, number][]): Outcome[] {
  return spec.flatMap(([truth, call, n]) => Array.from({ length: n }, () => ({ truth, call })));
}

describe('collapse', () => {
  it('maps the five ACMG classes onto three sides', () => {
    expect(collapse('Pathogenic')).toBe('P/LP');
    expect(collapse('Likely Pathogenic')).toBe('P/LP');
    expect(collapse('Uncertain Significance')).toBe('VUS');
    expect(collapse('Likely Benign')).toBe('B/LB');
    expect(collapse('Benign')).toBe('B/LB');
  });
});

describe('wilson', () => {
  it('matches the textbook interval for 8/10', () => {
    const [lo, hi] = wilson(8, 10)!;
    expect(lo).toBeCloseTo(0.4902, 3);
    expect(hi).toBeCloseTo(0.9433, 3);
  });

  it('stays inside [0, 1] at the extremes and is null for n = 0', () => {
    expect(wilson(0, 5)![0]).toBe(0);
    expect(wilson(5, 5)![1]).toBe(1);
    expect(wilson(0, 0)).toBeNull();
  });

  it('rejects impossible counts', () => {
    expect(() => wilson(3, 2)).toThrow(RangeError);
    expect(() => wilson(-1, 2)).toThrow(RangeError);
  });

  it('rate reports null value on an empty denominator', () => {
    expect(rate(0, 0)).toEqual({ k: 0, n: 0, value: null, ci95: null });
  });
});

describe('computeMetrics', () => {
  const m = computeMetrics(
    outcomes([
      ['P/LP', 'P/LP', 6],
      ['P/LP', 'VUS', 2],
      ['P/LP', 'B/LB', 1],
      ['P/LP', 'no-call', 1],
      ['B/LB', 'B/LB', 4],
      ['B/LB', 'P/LP', 2],
      ['B/LB', 'VUS', 4],
    ]),
  );

  it('counts abstentions against coverage, not accuracy', () => {
    expect(m.n).toBe(20);
    expect(m.coverage).toMatchObject({ k: 13, n: 20 });
    expect(m.accuracy).toMatchObject({ k: 10, n: 13 });
  });

  it('counts abstentions as misses in sensitivity and specificity', () => {
    expect(m.sensitivity).toMatchObject({ k: 6, n: 10, value: 0.6 });
    expect(m.specificity).toMatchObject({ k: 4, n: 10, value: 0.4 });
  });

  it('separates false reassurance from false alarm', () => {
    expect(m.falseReassurance).toMatchObject({ k: 1, n: 10 });
    expect(m.falseAlarm).toMatchObject({ k: 2, n: 10 });
  });

  it('fills every confusion cell, including zeros', () => {
    expect(m.confusion['P/LP']).toEqual({ 'P/LP': 6, VUS: 2, 'B/LB': 1, 'no-call': 1 });
    expect(m.confusion['B/LB']).toEqual({ 'P/LP': 2, VUS: 4, 'B/LB': 4, 'no-call': 0 });
  });

  it('a method that never commits has zero coverage and undefined accuracy', () => {
    const none = computeMetrics(outcomes([['P/LP', 'VUS', 3], ['B/LB', 'no-call', 3]]));
    expect(none.coverage.value).toBe(0);
    expect(none.accuracy.value).toBeNull();
    expect(none.falseReassurance.k).toBe(0);
  });
});
