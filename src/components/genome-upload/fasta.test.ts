import { describe, expect, it } from 'vitest';
import {
  FastaParseError,
  UPLOAD_LIMITS,
  parseFasta,
} from './fasta';

describe('parseFasta', () => {
  it('cleans a bare pasted sequence with spaces, newlines and lowercase', () => {
    const parsed = parseFasta(' atg\n cca\t t ');

    expect(parsed.bases).toBe('ATGCCAT');
    expect(parsed.hadHeader).toBe(false);
    expect(parsed.label).toBe('Pasted sequence');
    expect(parsed.description).toBeNull();
  });

  it('uses fallbackLabel when provided for a bare sequence', () => {
    const parsed = parseFasta('atgc', { fallbackLabel: 'HBB exon 1' });

    expect(parsed.bases).toBe('ATGC');
    expect(parsed.label).toBe('HBB exon 1');
    expect(parsed.hadHeader).toBe(false);
    expect(parsed.description).toBeNull();
  });

  it('parses a single FASTA record into label, description and joined sequence', () => {
    const parsed = parseFasta('>HBB human beta globin\natggtg\nCACCTG');

    expect(parsed.hadHeader).toBe(true);
    expect(parsed.label).toBe('HBB');
    expect(parsed.description).toBe('HBB human beta globin');
    expect(parsed.bases).toBe('ATGGTGCACCTG');
  });

  it('accepts CRLF and bare CR line endings', () => {
    const crlf = parseFasta('>seq1\r\nATGC\r\nGGTT');
    expect(crlf.bases).toBe('ATGCGGTT');
    expect(crlf.label).toBe('seq1');
    expect(crlf.hadHeader).toBe(true);

    const cr = parseFasta('>seq1\rATGC\rGGTT');
    expect(cr.bases).toBe('ATGCGGTT');
    expect(cr.label).toBe('seq1');
    expect(cr.hadHeader).toBe(true);
  });

  it('ignores legacy semicolon comment lines', () => {
    const parsed = parseFasta('>seq1\n; ignored comment\natgc\n; another\ngg');

    expect(parsed.bases).toBe('ATGCGG');
    expect(parsed.label).toBe('seq1');
  });

  it('rejects multiple FASTA records', () => {
    expect.assertions(3);
    try {
      parseFasta('>one\nATGC\n>two\nGGTT');
    } catch (error) {
      expect(error).toBeInstanceOf(FastaParseError);
      if (error instanceof FastaParseError) {
        expect(error.code).toBe('multiple-records');
        expect(error.message).toContain('2');
      }
    }
  });

  it('rejects a header with no sequence', () => {
    expect.assertions(2);
    try {
      parseFasta('>empty-header\n; only a comment\n\n');
    } catch (error) {
      expect(error).toBeInstanceOf(FastaParseError);
      if (error instanceof FastaParseError) {
        expect(error.code).toBe('no-sequence');
      }
    }
  });

  it('rejects empty or whitespace-only input', () => {
    expect.assertions(6);
    for (const input of ['', '   ', '\n\t\r\n']) {
      try {
        parseFasta(input);
      } catch (error) {
        expect(error).toBeInstanceOf(FastaParseError);
        if (error instanceof FastaParseError) {
          expect(error.code).toBe('empty');
        }
      }
    }
  });

  it('enforces raw and cleaned size caps, in that order', () => {
    expect.assertions(5);

    try {
      parseFasta('A'.repeat(UPLOAD_LIMITS.maxRawChars + 1));
    } catch (error) {
      expect(error).toBeInstanceOf(FastaParseError);
      if (error instanceof FastaParseError) {
        expect(error.code).toBe('too-large-raw');
      }
    }

    const overBases = UPLOAD_LIMITS.maxBases + 1;
    expect(overBases).toBeLessThan(UPLOAD_LIMITS.maxRawChars);
    try {
      parseFasta('A'.repeat(overBases));
    } catch (error) {
      expect(error).toBeInstanceOf(FastaParseError);
      if (error instanceof FastaParseError) {
        expect(error.code).toBe('too-large-bases');
      }
    }
  });

  it('preserves non-ACGT characters so lib/genome can validate them', () => {
    const parsed = parseFasta('ATGN-U');
    expect(parsed.bases).toBe('ATGN-U');
  });
});

describe('FastaParseError', () => {
  it('is an Error and carries code and detail', () => {
    const error = new FastaParseError(
      'multiple-records',
      'Found 2 FASTA records. Please provide a single coding sequence.',
      '2',
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(FastaParseError);
    expect(error.name).toBe('FastaParseError');
    expect(error.code).toBe('multiple-records');
    expect(error.detail).toBe('2');
    expect(error.message).toContain('2');
  });
});

describe('parseFasta — stray sequence above the header', () => {
  it('refuses to silently drop sequence text that precedes the header', () => {
    const error = (() => {
      try {
        parseFasta('ATGGTGCAT\n>HBB test\nATGGTG');
        return null;
      } catch (e: unknown) {
        return e instanceof FastaParseError ? e : null;
      }
    })();
    expect(error).not.toBeNull();
    expect(error?.code).toBe('stray-sequence');
  });

  it('still accepts legacy ";" comment lines above the header', () => {
    const parsed = parseFasta('; a comment\n>HBB test\nATGGTG');
    expect(parsed.bases).toBe('ATGGTG');
    expect(parsed.label).toBe('HBB');
  });
});
