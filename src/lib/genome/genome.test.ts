import { describe, expect, it } from 'vitest';

import {
  applyVariant,
  CODON_TABLE,
  codons,
  diffSequences,
  translate,
  type Sequence,
  type Variant,
} from './index';

const HBA: Sequence = {
  bases: 'ATGGTGCATCTGACTCCTGAGGAGAAGTCTGCCGTTACTGCCCTGTGGGGCAAGGTGAACGTGGATGAAGTTGGTGGTGAGGCCCTGGGCAGG',
  label: 'HbA (reference allele)',
};

describe('CODON_TABLE', () => {
  it('has all 64 codons', () => {
    expect(Object.keys(CODON_TABLE)).toHaveLength(64);
  });

  it('agrees with the textbook at the landmarks', () => {
    expect(CODON_TABLE.ATG).toBe('M');
    expect(CODON_TABLE.GAG).toBe('E'); // Glu — the HBB codon-7 reference
    expect(CODON_TABLE.GTG).toBe('V'); // Val — the sickle substitution
    expect(CODON_TABLE.TGG).toBe('W');
    expect(CODON_TABLE.TAA).toBe('*');
    expect(CODON_TABLE.TAG).toBe('*');
    expect(CODON_TABLE.TGA).toBe('*');
  });

  it('has exactly three stop codons', () => {
    expect(Object.values(CODON_TABLE).filter((aa) => aa === '*')).toHaveLength(3);
  });
});

describe('codons', () => {
  it('splits in frame 0 and discards a trailing partial codon', () => {
    expect(codons('ATGGTGCA')).toEqual(['ATG', 'GTG']);
  });

  it('returns an empty list for a sequence shorter than one codon', () => {
    expect(codons('AT')).toEqual([]);
  });
});

describe('translate', () => {
  it('translates the HBB reference region', () => {
    expect(translate(HBA.bases)).toBe('MVHLTPEEKSAVTALWGKVNVDEVGGEALGR');
  });

  it('stops at the first stop codon, inclusive', () => {
    expect(translate('ATGTAAATG')).toBe('M*');
  });

  it('reports an unknown codon as X rather than throwing', () => {
    expect(translate('ATGNNN')).toBe('MX');
  });
});

describe('applyVariant', () => {
  const sickle: Variant = {
    gene: 'HBB',
    codonIndex: 7,
    refCodon: 'GAG',
    altCodon: 'GTG',
    kind: 'substitution',
    label: 'HbS (Glu7Val)',
  };

  it('substitutes at a 1-based codon index', () => {
    const out = applyVariant(HBA, sickle);
    expect(codons(out.bases)[6]).toBe('GTG');
    expect(codons(out.bases)[5]).toBe(codons(HBA.bases)[5]);
    expect(out.bases).toHaveLength(HBA.bases.length);
  });

  it('is pure — the input is untouched', () => {
    const before = HBA.bases;
    applyVariant(HBA, sickle);
    expect(HBA.bases).toBe(before);
  });

  it('shortens the sequence on a deletion', () => {
    const out = applyVariant(HBA, { ...sickle, kind: 'deletion' });
    expect(codons(out.bases)).toHaveLength(codons(HBA.bases).length - 1);
  });

  it('lengthens the sequence on an insertion', () => {
    const out = applyVariant(HBA, { ...sickle, kind: 'insertion' });
    expect(codons(out.bases)).toHaveLength(codons(HBA.bases).length + 1);
  });

  it('returns the input unchanged for an out-of-range index', () => {
    expect(applyVariant(HBA, { ...sickle, codonIndex: 9999 })).toBe(HBA);
    expect(applyVariant(HBA, { ...sickle, codonIndex: 0 })).toBe(HBA);
  });
});

describe('diffSequences', () => {
  it('marks a non-synonymous substitution as changed and not silent', () => {
    const alt = applyVariant(HBA, {
      gene: 'HBB',
      codonIndex: 7,
      refCodon: 'GAG',
      altCodon: 'GTG',
      kind: 'substitution',
      label: 'HbS',
    });
    const rows = diffSequences(HBA, alt);
    const row = rows[6];
    expect(row.codonIndex).toBe(7);
    expect(row.status).toBe('changed');
    expect(row.silent).toBe(false);
    expect(row.refAa).toBe('E');
    expect(row.altAa).toBe('V');
    expect(rows.filter((r) => r.status !== 'same')).toHaveLength(1);
  });

  it('marks a synonymous substitution as changed AND silent', () => {
    // Codon 5 of the reference region is ACT (Thr); ACC is also Thr.
    const alt = applyVariant(HBA, {
      gene: 'HBB',
      codonIndex: 5,
      refCodon: 'ACT',
      altCodon: 'ACC',
      kind: 'substitution',
      label: 'synthetic silent',
    });
    const row = diffSequences(HBA, alt)[4];
    expect(row.status).toBe('changed');
    expect(row.silent).toBe(true);
    expect(row.refAa).toBe('T');
    expect(row.altAa).toBe('T');
  });

  it('handles an unequal-length pair (deletion) without throwing', () => {
    const shorter = applyVariant(HBA, {
      gene: 'HBB',
      codonIndex: 31,
      refCodon: 'AGG',
      altCodon: '',
      kind: 'deletion',
      label: 'terminal deletion',
    });
    const rows = diffSequences(HBA, shorter);
    expect(rows).toHaveLength(codons(HBA.bases).length);
    expect(rows[rows.length - 1].status).toBe('removed');
    expect(rows[rows.length - 1].altCodon).toBeNull();
  });

  it('handles an insertion without throwing', () => {
    const longer = applyVariant(HBA, {
      gene: 'HBB',
      codonIndex: 32,
      refCodon: '',
      altCodon: 'TTT',
      kind: 'insertion',
      label: 'terminal insertion',
    });
    const rows = diffSequences(HBA, longer);
    expect(rows[rows.length - 1].status).toBe('added');
    expect(rows[rows.length - 1].refCodon).toBeNull();
    expect(rows[rows.length - 1].altAa).toBe('F');
  });

  it('is pure and reports every row as same for identical sequences', () => {
    const rows = diffSequences(HBA, { ...HBA, label: 'copy' });
    expect(rows.every((r) => r.status === 'same' && !r.silent)).toBe(true);
  });
});
