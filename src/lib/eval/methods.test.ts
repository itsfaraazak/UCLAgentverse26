import { describe, expect, it } from 'vitest';

import type { Consequence, VariantEvidence } from '../evidence/types';
import { withoutClinvarLabels } from './benchmark';
import { alphaMissenseCall, caddCall, consequenceGroup, frequencyCall } from './methods';
import { seededRandom, shuffle, takeWithGeneCap } from './sample';

function ev(opts: { consequence?: Consequence; am?: number | null; af?: number | null; cadd?: number | null }): VariantEvidence {
  return {
    variant: { id: 'chr1:g.1A>T', assembly: 'GRCh38', rsid: null, gene: 'X', hgvsCoding: null, hgvsProtein: null, query: '', alternates: [] },
    consequence: opts.consequence ?? 'missense',
    consequenceRaw: [],
    protein: null,
    population: { gnomadGenomeAf: null, gnomadExomeAf: null, maxAf: opts.af ?? null },
    predictors: { alphaMissense: opts.am ?? null, alphaMissenseClass: null, caddPhred: opts.cadd ?? null },
    sources: [],
  };
}

describe('baselines', () => {
  it('AlphaMissense uses the Cheng et al. thresholds with strict inequalities', () => {
    expect(alphaMissenseCall(ev({ am: 0.565 }))).toBe('P/LP');
    expect(alphaMissenseCall(ev({ am: 0.564 }))).toBe('VUS');
    expect(alphaMissenseCall(ev({ am: 0.34 }))).toBe('VUS');
    expect(alphaMissenseCall(ev({ am: 0.339 }))).toBe('B/LB');
  });

  it('AlphaMissense makes no call off missense or without a score', () => {
    expect(alphaMissenseCall(ev({ consequence: 'frameshift', am: 0.99 }))).toBe('no-call');
    expect(alphaMissenseCall(ev({ am: null }))).toBe('no-call');
  });

  it('frequency alone can only argue benign', () => {
    expect(frequencyCall(ev({ af: 0.2 }))).toBe('B/LB');
    expect(frequencyCall(ev({ af: 0.011 }))).toBe('B/LB');
    expect(frequencyCall(ev({ af: 0.01 }))).toBe('VUS');
    expect(frequencyCall(ev({ af: null }))).toBe('VUS');
    expect(frequencyCall(ev({ af: 0 }))).toBe('VUS');
  });

  it('CADD splits at PHRED 20 and 10', () => {
    expect(caddCall(ev({ cadd: 20 }))).toBe('P/LP');
    expect(caddCall(ev({ cadd: 15 }))).toBe('VUS');
    expect(caddCall(ev({ cadd: 9.9 }))).toBe('B/LB');
    expect(caddCall(ev({ cadd: null }))).toBe('no-call');
  });

  it('groups null consequences as loss of function', () => {
    expect(consequenceGroup('stop_gained')).toBe('lof');
    expect(consequenceGroup('splice')).toBe('lof');
    expect(consequenceGroup('missense')).toBe('missense');
    expect(consequenceGroup('inframe_indel')).toBe('other');
  });
});

describe('withoutClinvarLabels', () => {
  it('removes significance and review status but keeps nomenclature', () => {
    const hit = {
      _id: 'x',
      clinvar: { variant_id: 1, rcv: [{ clinical_significance: 'Pathogenic', review_status: 'reviewed by expert panel', preferred_name: 'NM_1(G):c.1A>T' }] },
    };
    expect(withoutClinvarLabels(hit)).toEqual({ _id: 'x', clinvar: { variant_id: 1, rcv: [{ preferred_name: 'NM_1(G):c.1A>T' }] } });
    expect(JSON.stringify(withoutClinvarLabels(hit))).not.toMatch(/Pathogenic|expert/);
  });
});

describe('sampling', () => {
  it('is reproducible for a seed', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffle(items, seededRandom(7))).toEqual(shuffle(items, seededRandom(7)));
    expect(shuffle(items, seededRandom(7))).not.toEqual(shuffle(items, seededRandom(8)));
    expect([...shuffle(items, seededRandom(7))].sort((a, b) => a - b)).toEqual(items);
  });

  it('enforces the gene cap across calls', () => {
    const counts = new Map<string, number>();
    const first = takeWithGeneCap(['A', 'A', 'A', 'B'], (g) => g, 10, 2, counts);
    const second = takeWithGeneCap(['A', 'B', 'B', 'C'], (g) => g, 10, 2, counts);
    expect(first).toEqual(['A', 'A', 'B']);
    expect(second).toEqual(['B', 'C']);
  });
});
