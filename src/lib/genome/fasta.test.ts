import { describe, it, expect } from 'vitest';
import {
  parseSequenceUpload,
  MAX_SEQUENCE_BASES,
  SequenceTooLargeError,
  EmptySequenceError,
  MultipleRecordsError,
  ExplainedInvalidBaseError,
  InvalidBaseError,
  PartialCodonError,
  GenomeInputError,
  translate,
} from './index';

describe('parseSequenceUpload — accepted shapes', () => {
  it('parses a bare sequence', () => {
    const r = parseSequenceUpload('ATGGTGCAT');
    expect(r.sequence.bases).toBe('ATGGTGCAT');
    expect(r.wasFasta).toBe(false);
    expect(r.lengthNt).toBe(9);
    expect(r.codonCount).toBe(3);
    expect(r.header).toBeUndefined();
    expect(r.sequence.label).toBe('Uploaded sequence');
  });

  it('parses single-record FASTA and takes the label from the header', () => {
    const r = parseSequenceUpload('>my construct-free test record\nATGGTG\nCATCTG\n');
    expect(r.sequence.bases).toBe('ATGGTGCATCTG');
    expect(r.wasFasta).toBe(true);
    expect(r.header).toBe('my construct-free test record');
    expect(r.sequence.label).toBe('my construct-free test record');
  });

  it('normalises lowercase, which is meaning-preserving (SPEC §4.6 #13)', () => {
    expect(parseSequenceUpload('atgGTGcat').sequence.bases).toBe('ATGGTGCAT');
  });

  it('strips wrapping whitespace and sequence-viewer line numbers', () => {
    const pasted = '   1 ATG GTG\n   7 CAT CTG\n';
    expect(parseSequenceUpload(pasted).sequence.bases).toBe('ATGGTGCATCTG');
  });

  it('round-trips through translate', () => {
    const r = parseSequenceUpload('>x\nATGGAGTAA');
    expect(translate(r.sequence.bases)).toBe('ME*');
  });

  it('truncates an over-long header rather than rendering it whole', () => {
    const r = parseSequenceUpload(`>${'z'.repeat(400)}\nATG`);
    expect(r.header).toHaveLength(120);
  });
});

describe('parseSequenceUpload — strict rejection', () => {
  it('rejects a non-ACGT character naming it and its offset (§4.6 #13)', () => {
    expect(() => parseSequenceUpload('ATGQQQ')).toThrow(InvalidBaseError);
    try {
      parseSequenceUpload('ATGQQQ');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidBaseError);
      if (!(err instanceof InvalidBaseError)) throw err;
      expect(err.char).toBe('Q');
      expect(err.offset).toBe(3);
      expect(err.message).toContain('offset 3');
    }
  });

  it('explains RNA uracil and ambiguity codes, still as an InvalidBaseError', () => {
    for (const [input, char] of [
      ['AUGGUG', 'U'],
      ['ATGNNN', 'N'],
      ['ATG---', '-'],
    ] as const) {
      try {
        parseSequenceUpload(input);
        expect.unreachable(`should have rejected ${input}`);
      } catch (err) {
        expect(err).toBeInstanceOf(ExplainedInvalidBaseError);
        expect(err).toBeInstanceOf(InvalidBaseError);
        expect(err).toBeInstanceOf(GenomeInputError);
        if (!(err instanceof ExplainedInvalidBaseError)) throw err;
        expect(err.char).toBe(char);
        expect(err.explanation.length).toBeGreaterThan(0);
      }
    }
  });

  it('rejects a trailing partial codon (§4.6 #14)', () => {
    expect(() => parseSequenceUpload('ATGG')).toThrow(PartialCodonError);
  });

  it('can be asked not to require whole codons', () => {
    const r = parseSequenceUpload('ATGG', { requireWholeCodons: false });
    expect(r.lengthNt).toBe(4);
    expect(r.codonCount).toBe(1);
  });

  it('rejects empty and header-only input', () => {
    expect(() => parseSequenceUpload('')).toThrow(EmptySequenceError);
    expect(() => parseSequenceUpload('   \n\n  ')).toThrow(EmptySequenceError);
    expect(() => parseSequenceUpload('>just a header\n')).toThrow(EmptySequenceError);
  });

  it('rejects multi-record FASTA rather than silently taking the first', () => {
    expect(() => parseSequenceUpload('>a\nATG\n>b\nGTG\n')).toThrow(MultipleRecordsError);
  });

  it('caps the size of accepted input', () => {
    const tooMany = 'ATG'.repeat(MAX_SEQUENCE_BASES);
    expect(() => parseSequenceUpload(tooMany)).toThrow(SequenceTooLargeError);
  });

  it('every rejection is a GenomeInputError, so UI can branch on one type', () => {
    for (const bad of ['', 'ATGG', 'ATGQ', '>a\nATG\n>b\nGTG\n']) {
      try {
        parseSequenceUpload(bad);
        expect.unreachable(`should have rejected ${JSON.stringify(bad)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(GenomeInputError);
      }
    }
  });
});
