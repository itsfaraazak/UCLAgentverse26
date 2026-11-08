import { describe, expect, it } from 'vitest';
import { CODON_TABLE, applyVariant, codons, diffSequences, translate, type Variant } from './index';

const REF = {
  bases: 'ATGGTGCATCTGACTCCTGAGGAGAAGTCTGCC',
  label: 'HbA (reference allele)',
};

describe('genetic code', () => {
  it('covers all 64 codons', () => {
    expect(Object.keys(CODON_TABLE)).toHaveLength(64);
  });

  it('translates the canonical start and stop codons', () => {
    expect(CODON_TABLE.ATG).toBe('M');
    expect(CODON_TABLE.TAA).toBe('*');
    expect(CODON_TABLE.TAG).toBe('*');
    expect(CODON_TABLE.TGA).toBe('*');
    expect(CODON_TABLE.GAG).toBe('E');
    expect(CODON_TABLE.GTG).toBe('V');
  });

  it('translates in frame 0 and stops at a stop codon', () => {
    expect(translate(REF.bases)).toBe('MVHLTPEEKSA');
    expect(translate('ATGTAAATG')).toBe('M');
  });

  it('splits whole codons only', () => {
    expect(codons('ATGGT')).toEqual(['ATG']);
  });
});

describe('applyVariant', () => {
  it('substitutes a codon in 1-based coordinates', () => {
    const v: Variant = {
      gene: 'HBB',
      codonIndex: 7,
      refCodon: 'GAG',
      altCodon: 'GTG',
      kind: 'substitution',
      label: 'HbS',
    };
    const alt = applyVariant(REF, v);
    expect(codons(alt.bases)[6]).toBe('GTG');
    expect(translate(alt.bases)).toBe('MVHLTPVEKSA');
  });

  it('round-trips a substitution', () => {
    const forward = applyVariant(REF, {
      gene: 'HBB',
      codonIndex: 7,
      refCodon: 'GAG',
      altCodon: 'GTG',
      kind: 'substitution',
      label: 'HbS',
    });
    const back = applyVariant(forward, {
      gene: 'HBB',
      codonIndex: 7,
      refCodon: 'GTG',
      altCodon: 'GAG',
      kind: 'substitution',
      label: 'repaired',
    });
    expect(back.bases).toBe(REF.bases);
  });
});

describe('diffSequences', () => {
  it('reports every codon as same for an identical sequence', () => {
    const rows = diffSequences(REF, REF);
    expect(rows).toHaveLength(11);
    expect(rows.every((r) => r.status === 'same')).toBe(true);
  });

  it('marks a missense change and its amino acids', () => {
    const alt = applyVariant(REF, {
      gene: 'HBB',
      codonIndex: 7,
      refCodon: 'GAG',
      altCodon: 'GTG',
      kind: 'substitution',
      label: 'HbS',
    });
    const row = diffSequences(REF, alt).find((r) => r.codonIndex === 7);
    expect(row?.status).toBe('changed');
    expect(row?.silent).toBe(false);
    expect(row?.refAa).toBe('E');
    expect(row?.altAa).toBe('V');
  });

  it('marks a synonymous change as silent', () => {
    const alt = applyVariant(REF, {
      gene: 'HBB',
      codonIndex: 5,
      refCodon: 'ACT',
      altCodon: 'ACC',
      kind: 'substitution',
      label: 'silent demo',
    });
    const row = diffSequences(REF, alt).find((r) => r.codonIndex === 5);
    expect(row?.status).toBe('changed');
    expect(row?.silent).toBe(true);
    expect(row?.refAa).toBe(row?.altAa);
  });

  it('handles indels without throwing and reports added/removed', () => {
    const deleted = applyVariant(REF, {
      gene: 'HBB',
      codonIndex: 3,
      refCodon: 'CAT',
      altCodon: '',
      kind: 'deletion',
      label: 'codon 3 deletion',
    });
    const rows = diffSequences(REF, deleted);
    expect(rows).toHaveLength(11);
    expect(rows[rows.length - 1].status).toBe('removed');
    expect(rows[rows.length - 1].altCodon).toBeNull();

    const inserted = applyVariant(REF, {
      gene: 'HBB',
      codonIndex: 3,
      refCodon: '',
      altCodon: 'AAA',
      kind: 'insertion',
      label: 'codon 3 insertion',
    });
    const insertedRows = diffSequences(REF, inserted);
    expect(insertedRows).toHaveLength(12);
    expect(insertedRows[insertedRows.length - 1].status).toBe('added');
    expect(insertedRows[insertedRows.length - 1].refCodon).toBeNull();
  });

  it('is pure — the inputs are untouched', () => {
    const before = REF.bases;
    diffSequences(REF, { bases: 'ATG', label: 'short' });
    expect(REF.bases).toBe(before);
  });
});
