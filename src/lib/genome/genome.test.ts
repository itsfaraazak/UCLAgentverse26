import { describe, it, expect } from 'vitest';
import {
  CODON_TABLE,
  aminoAcid,
  translate,
  codons,
  applyVariant,
  diffSequences,
  loadLoci,
  getLocus,
  getLocusVariant,
  getGenotype,
  referenceSequence,
  sequenceForGenotype,
  GenomeInputError,
  InvalidBaseError,
  PartialCodonError,
  InsertionRefCodonError,
} from './index';
import type { Sequence, Variant } from './types';

const seq = (bases: string, label = 'test'): Sequence => ({ bases, label });

describe('CODON_TABLE', () => {
  it('has all 64 codons of the standard genetic code', () => {
    expect(Object.keys(CODON_TABLE)).toHaveLength(64);
    const bases = ['A', 'C', 'G', 'T'];
    for (const a of bases) {
      for (const b of bases) {
        for (const c of bases) {
          expect(CODON_TABLE[`${a}${b}${c}`]).toBeDefined();
        }
      }
    }
  });

  it('maps the three stop codons to *', () => {
    expect(CODON_TABLE.TAA).toBe('*');
    expect(CODON_TABLE.TAG).toBe('*');
    expect(CODON_TABLE.TGA).toBe('*');
  });

  it('maps start and the sickle-example residues', () => {
    expect(aminoAcid('ATG')).toBe('M');
    expect(aminoAcid('GAG')).toBe('E');
    expect(aminoAcid('GTG')).toBe('V');
    expect(aminoAcid('ACT')).toBe('T');
    expect(aminoAcid('ACC')).toBe('T');
  });
});

describe('codons / translate', () => {
  it('chunks complete triplets and drops a trailing incomplete codon', () => {
    expect(codons('ATGGGTTA')).toEqual(['ATG', 'GGT']);
    expect(codons('atg')).toEqual(['ATG']);
  });

  it('translates frame 0 and includes the stop, then halts', () => {
    expect(translate('ATGGAGTAAATG')).toBe('ME*');
    expect(translate('ATGTAG')).toBe('M*');
  });

  it('translates the HBB reference CDS used in the fixture', () => {
    const hbb = getLocus('HBB');
    expect(hbb).toBeDefined();
    if (hbb === undefined) return;
    const protein = translate(hbb.cdsReference.bases);
    expect(protein.startsWith('MVHLTPEEK')).toBe(true);
    // Fixture `codonCount` is 148, matching `bases` at 444 nt = 148 complete
    // codons: 147 residues plus the terminator. The loader cross-checks the
    // two, so translation length and codon count cannot drift apart.
    expect(protein).toHaveLength(codons(hbb.cdsReference.bases).length);
    // The fixture now holds the whole coding sequence, so it *does* contain a
    // stop — exactly one, as the last codon. Before the real NM_000518.5
    // sequence replaced the hand-typed 31-codon region this asserted no stop
    // was present, which only held because the region stopped short of one.
    expect(protein.endsWith('*')).toBe(true);
    expect(protein.indexOf('*')).toBe(protein.length - 1);
  });
});

describe('applyVariant', () => {
  it('applies the HbS substitution at codon 7', () => {
    const locus = getLocus('HBB');
    const hbs = getLocusVariant('HBB', 'HBB_HbS');
    expect(locus).toBeDefined();
    expect(hbs).toBeDefined();
    if (locus === undefined || hbs === undefined) return;
    const result = applyVariant(referenceSequence(locus), hbs);
    const resultCodons = codons(result.bases);
    expect(resultCodons[6]).toBe('GTG');
    expect(translate(result.bases)[6]).toBe('V');
    expect(result.label).toBe(hbs.label);
  });

  it('rejects a substitution whose refCodon does not match', () => {
    const v: Variant = {
      gene: 'HBB',
      codonIndex: 1,
      refCodon: 'GAG',
      altCodon: 'GTG',
      kind: 'substitution',
      label: 'mismatch',
    };
    expect(() => applyVariant(seq('ATGGTG'), v)).toThrow(/refCodon mismatch/);
  });

  it('inserts a codon and shifts the remainder', () => {
    const v: Variant = {
      gene: 'X',
      codonIndex: 2,
      refCodon: '',
      altCodon: 'GGG',
      kind: 'insertion',
      label: 'ins',
    };
    const result = applyVariant(seq('AAATTTCCC'), v);
    expect(codons(result.bases)).toEqual(['AAA', 'GGG', 'TTT', 'CCC']);
  });

  it('deletes a codon and closes the gap', () => {
    const v: Variant = {
      gene: 'X',
      codonIndex: 2,
      refCodon: 'TTT',
      altCodon: '',
      kind: 'deletion',
      label: 'del',
    };
    const result = applyVariant(seq('AAATTTCCC'), v);
    expect(codons(result.bases)).toEqual(['AAA', 'CCC']);
  });
});

describe('diffSequences', () => {
  it('marks a missense substitution as changed and not silent', () => {
    const locus = getLocus('HBB');
    const sickle = getGenotype('HBB', 'sickle');
    expect(locus).toBeDefined();
    expect(sickle).toBeDefined();
    if (locus === undefined || sickle === undefined) return;
    const rows = diffSequences(referenceSequence(locus), sequenceForGenotype(locus, sickle));
    const edited = rows.find((r) => r.codonIndex === 7);
    expect(edited).toMatchObject({
      refCodon: 'GAG',
      altCodon: 'GTG',
      refAa: 'E',
      altAa: 'V',
      status: 'changed',
      silent: false,
    });
    expect(rows.filter((r) => r.status === 'changed')).toHaveLength(1);
  });

  it('flags a synonymous codon change as silent', () => {
    const silent: Variant = {
      gene: 'HBB',
      codonIndex: 5,
      refCodon: 'ACT',
      altCodon: 'ACC',
      kind: 'substitution',
      label: 'silent',
    };
    const locus = getLocus('HBB');
    expect(locus).toBeDefined();
    if (locus === undefined) return;
    const alt = applyVariant(referenceSequence(locus), silent);
    const row = diffSequences(referenceSequence(locus), alt).find((r) => r.codonIndex === 5);
    expect(row).toMatchObject({
      refCodon: 'ACT',
      altCodon: 'ACC',
      refAa: 'T',
      altAa: 'T',
      status: 'changed',
      silent: true,
    });
  });

  it('aligns through an insertion so subsequent codons stay same, not truncated', () => {
    const ref = seq('AAATTTCCC');
    const alt = seq('AAAGGGTTTCCC');
    const rows = diffSequences(ref, alt);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ refCodon: 'AAA', altCodon: 'AAA', status: 'same', silent: false });
    expect(rows[1]).toMatchObject({
      refCodon: null,
      altCodon: 'GGG',
      refAa: null,
      altAa: 'G',
      status: 'added',
      silent: false,
    });
    expect(rows[2]).toMatchObject({ refCodon: 'TTT', altCodon: 'TTT', status: 'same' });
    expect(rows[3]).toMatchObject({ refCodon: 'CCC', altCodon: 'CCC', status: 'same' });
  });

  it('aligns through a deletion so later codons remain matched', () => {
    const ref = seq('AAATTTCCC');
    const alt = seq('AAACCC');
    const rows = diffSequences(ref, alt);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ refCodon: 'AAA', altCodon: 'AAA', status: 'same' });
    expect(rows[1]).toMatchObject({
      refCodon: 'TTT',
      altCodon: null,
      status: 'removed',
      silent: false,
    });
    expect(rows[2]).toMatchObject({ refCodon: 'CCC', altCodon: 'CCC', status: 'same' });
  });

  it('does not throw on unequal lengths, including empty vs non-empty', () => {
    expect(() => diffSequences(seq(''), seq('ATGAAATTT'))).not.toThrow();
    expect(() => diffSequences(seq('ATGAAATTT'), seq(''))).not.toThrow();
    const added = diffSequences(seq(''), seq('ATGAAATTT'));
    expect(added.every((r) => r.status === 'added')).toBe(true);
    expect(added).toHaveLength(3);
    const removed = diffSequences(seq('ATGAAATTT'), seq(''));
    expect(removed.every((r) => r.status === 'removed')).toBe(true);
  });

  it('treats a same-length missense as changed, not as an indel pair', () => {
    const rows = diffSequences(seq('ATGGAGCCC'), seq('ATGGTGCCC'));
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      refCodon: 'GAG',
      altCodon: 'GTG',
      status: 'changed',
      silent: false,
    });
    expect(rows.filter((r) => r.status === 'added' || r.status === 'removed')).toHaveLength(0);
  });
});

describe('loci loader', () => {
  it('exposes the HBB locus, its variants, and its genotypes', () => {
    const loci = loadLoci();
    expect(loci.map((l) => l.gene)).toEqual(['HBB']);
    const hbb = getLocus('hbb');
    expect(hbb?.name).toBe('Haemoglobin subunit beta');
    expect(hbb?.provenance).toBe('public-reference');
    expect(hbb?.variants.map((v) => v.id)).toEqual(['HBB_HbS', 'HBB_repair', 'HBB_silent_demo']);
    expect(hbb?.genotypes.map((g) => g.id)).toEqual(['wildtype', 'sickle', 'repaired']);
    expect(getLocusVariant('HBB', 'HBB_HbS')?.gene).toBe('HBB');
    expect(getGenotype('HBB', 'sickle')?.appliedVariants).toEqual(['HBB_HbS']);
  });

  it('builds genotype sequences by applying variants in order', () => {
    const locus = getLocus('HBB');
    const wildtype = getGenotype('HBB', 'wildtype');
    const sickle = getGenotype('HBB', 'sickle');
    const repaired = getGenotype('HBB', 'repaired');
    expect(locus && wildtype && sickle && repaired).toBeTruthy();
    if (locus === undefined || wildtype === undefined || sickle === undefined || repaired === undefined) {
      return;
    }
    const wt = sequenceForGenotype(locus, wildtype);
    const sc = sequenceForGenotype(locus, sickle);
    const rp = sequenceForGenotype(locus, repaired);
    expect(wt.bases).toBe(locus.cdsReference.bases);
    expect(codons(sc.bases)[6]).toBe('GTG');
    expect(codons(rp.bases)[6]).toBe('GAG');
    expect(rp.bases).toBe(wt.bases);
    expect(sc.label).toBe('HbS / HbS');
  });
});

describe('SPEC §4.6 sequence and variant validation', () => {
  it('rejects non-ACGT and names the offending character and 0-based offset (#13)', () => {
    const cases: Array<{ input: string; char: string; offset: number }> = [
      { input: 'ATGNNNCCC', char: 'N', offset: 3 },
      { input: 'ATGUGC', char: 'U', offset: 3 },
      { input: 'ATG CCC', char: ' ', offset: 3 },
      { input: 'nATG', char: 'n', offset: 0 },
    ];
    for (const { input, char, offset } of cases) {
      try {
        translate(input);
        throw new Error(`expected translate(${JSON.stringify(input)}) to throw`);
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidBaseError);
        expect(err).toBeInstanceOf(GenomeInputError);
        if (!(err instanceof InvalidBaseError)) return;
        expect(err.char).toBe(char);
        expect(err.offset).toBe(offset);
        expect(err.message).toContain(JSON.stringify(char));
        expect(err.message).toContain(`offset ${offset}`);
      }
    }
    expect(() => diffSequences(seq('ATGNNN'), seq('ATGCCC'))).toThrow(InvalidBaseError);
    expect(() => applyVariant(seq('ATGNNN'), {
      gene: 'X',
      codonIndex: 1,
      refCodon: 'ATG',
      altCodon: 'AAA',
      kind: 'substitution',
      label: 'bad',
    })).toThrow(InvalidBaseError);
  });

  it('still accepts lowercase ACGT and normalises it (#13 must not over-reject)', () => {
    expect(codons('atg')).toEqual(['ATG']);
    expect(translate('atgtaa')).toBe('M*');
    const rows = diffSequences(seq('atggagttt'), seq('ATGGAGTTT'));
    expect(rows.every((row) => row.status === 'same')).toBe(true);
    const result = applyVariant(seq('atggag'), {
      gene: 'X',
      codonIndex: 2,
      refCodon: 'gag',
      altCodon: 'gtg',
      kind: 'substitution',
      label: 'lower',
    });
    expect(codons(result.bases)).toEqual(['ATG', 'GTG']);
  });

  it('rejects a trailing partial codon in diffSequences (#14)', () => {
    expect(() => diffSequences(seq('ATGAA', 'left'), seq('ATGAA', 'right'))).toThrow(
      PartialCodonError,
    );
    try {
      diffSequences(seq('ATGAA', 'left'), seq('ATGCCC', 'right'));
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PartialCodonError);
      expect(err).toBeInstanceOf(GenomeInputError);
      if (!(err instanceof PartialCodonError)) return;
      expect(err.length).toBe(5);
      expect(err.message).toContain('left');
      expect(err.message).toContain('5');
      expect(err.message).toContain('multiple of 3');
    }
    expect(() => diffSequences(seq('ATG'), seq('AT'))).toThrow(/multiple of 3/);
  });

  it('still diffs unequal codon counts — indels, not unequal remainders (#14)', () => {
    const rows = diffSequences(seq('AAATTT'), seq('AAATTTCCC'));
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ refCodon: null, altCodon: 'CCC', status: 'added' });
    expect(() => diffSequences(seq(''), seq('ATGAAATTT'))).not.toThrow();
    expect(() => diffSequences(seq('ATGAAATTT'), seq('ATGAAA'))).not.toThrow();
  });

  it('rejects a non-empty refCodon on insertion and still inserts when it is empty (#15)', () => {
    const host = seq('AAATTTCCC');
    expect(() =>
      applyVariant(host, {
        gene: 'X',
        codonIndex: 2,
        refCodon: 'TTT',
        altCodon: 'GGG',
        kind: 'insertion',
        label: 'ins',
      }),
    ).toThrow(InsertionRefCodonError);
    try {
      applyVariant(host, {
        gene: 'X',
        codonIndex: 1,
        refCodon: 'GGG',
        altCodon: 'CCC',
        kind: 'insertion',
        label: 'ins',
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InsertionRefCodonError);
      expect(err).toBeInstanceOf(GenomeInputError);
      if (!(err instanceof InsertionRefCodonError)) return;
      expect(err.refCodon).toBe('GGG');
      expect(err.message).toContain('GGG');
      expect(err.message).toMatch(/invalid variant/);
      expect(err.message).not.toMatch(/refCodon mismatch/);
    }
    const result = applyVariant(host, {
      gene: 'X',
      codonIndex: 2,
      refCodon: '',
      altCodon: 'GGG',
      kind: 'insertion',
      label: 'ins',
    });
    expect(codons(result.bases)).toEqual(['AAA', 'GGG', 'TTT', 'CCC']);
  });
});
