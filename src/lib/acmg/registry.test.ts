import { describe, expect, it } from 'vitest';
import { ACMG_FIXTURE_DISCLAIMER, ACMG_VARIANT_RECORDS, parseAcmgRecord } from './registry';
import { scoreAcmg } from './score';

const VALID = {
  variantId: 'X',
  provenance: 'synthetic-illustrative',
  gene: 'X',
  hgvs: 'X',
  note: 'X',
  acmgInputs: {
    populationFrequency: 0.1,
    isNullVariantInLofGene: false,
    matchesKnownPathogenicAaChange: false,
    inSilicoDeleteriousScore: 0.5,
    segregatesWithDisease: false,
  },
  priorClassification: null,
};

describe('the shipped fixture', () => {
  it('holds only labelled records and no record for an unmodelled gene', () => {
    expect(ACMG_VARIANT_RECORDS.length).toBeGreaterThan(0);
    for (const r of ACMG_VARIANT_RECORDS) {
      expect(['public-reference', 'synthetic-illustrative']).toContain(r.provenance);
      expect(r.gene).toBe('HBB');
    }
  });

  it('keeps the no-patient-data disclaimer', () => {
    expect(ACMG_FIXTURE_DISCLAIMER).toMatch(/never real patient data/);
    expect(ACMG_FIXTURE_DISCLAIMER).toMatch(/real ClinVar accession number/);
  });

  it('scores the HBB record without throwing', () => {
    for (const r of ACMG_VARIANT_RECORDS) {
      expect(scoreAcmg(r.acmgInputs).classification).toBeTypeOf('string');
    }
  });
});

describe('parseAcmgRecord refuses malformed input', () => {
  it('accepts a well-formed record', () => {
    expect(parseAcmgRecord(VALID).variantId).toBe('X');
  });

  it.each([
    ['no provenance label', { ...VALID, provenance: undefined }],
    ['an unknown provenance label', { ...VALID, provenance: 'trust-me' }],
    ['a missing variantId', { ...VALID, variantId: '' }],
    ['an unknown prior classification', { ...VALID, priorClassification: 'Probably Fine' }],
    ['a missing input field', { ...VALID, acmgInputs: { populationFrequency: 0.1 } }],
    ['a non-object', 'nope'],
  ])('throws on %s', (_label, value) => {
    expect(() => parseAcmgRecord(value)).toThrow();
  });
});
