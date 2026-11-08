import { describe, expect, it } from 'vitest';
import { getLocus, referenceSequence } from '@/lib/genome';
import { UPLOAD_LIMITS, validateUpload } from './validate';

/**
 * `validateUpload` is the presentational wrapper around `lib/genome`'s
 * parser. These tests cover the wrapper's contract — never throws, returns a
 * discriminated result, writes one friendly sentence per failure with no
 * stack trace — and the warnings layer, which is the only logic that lives
 * here. The parser itself is tested in `src/lib/genome/fasta.test.ts`.
 */

const locus = getLocus('HBB');
if (locus === undefined) throw new Error('HBB fixture missing from loci.json');
const REFERENCE = referenceSequence(locus).bases;

describe('validateUpload — the happy path on the real reference', () => {
  it('accepts the curated HBB coding sequence and reports its real codon count', () => {
    const result = validateUpload(REFERENCE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sequence.bases).toBe(REFERENCE);
    expect(result.sequence.codonCount).toBe(locus.cdsReference.codonCount);
    expect(result.sequence.protein.startsWith('MVHLTPEEK')).toBe(true);
    expect(result.sequence.wasFasta).toBe(false);
    expect(result.sequence.warnings.map((w) => w.code)).not.toContain('no-start-codon');
  });

  it('normalises lowercase and accepts a FASTA record, taking its header as the label', () => {
    const result = validateUpload(`>HBB NM_000518.5\n${REFERENCE.toLowerCase()}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sequence.bases).toBe(REFERENCE);
    expect(result.sequence.wasFasta).toBe(true);
    expect(result.sequence.label).toContain('HBB');
  });

  it('uses the fallback label only when there is no header', () => {
    const result = validateUpload(REFERENCE, { fallbackLabel: 'my-upload.fasta' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sequence.label).toBe('my-upload.fasta');
  });
});

describe('validateUpload — failures are friendly, never a stack trace', () => {
  function errorOf(raw: string) {
    const result = validateUpload(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    return result.error;
  }

  it('names a non-ACGT character and its 1-based position (SPEC §4.6 #13)', () => {
    const error = errorOf('ATGNNNCCC');
    expect(error.code).toBe('invalid-base');
    expect(error.char).toBe('N');
    expect(error.offset).toBe(3);
    expect(error.position).toBe(4);
    expect(error.message).toContain('position 4');
    // lib/genome explains *why* an N is refused; the wrapper must surface it.
    expect(error.message).toMatch(/ambiguous/i);
    // And it must say which coordinate system the position is in.
    expect(error.message).toMatch(/assembled sequence/i);
  });

  it('explains a trailing partial codon and promises nothing was trimmed (SPEC §4.6 #14)', () => {
    const error = errorOf('ATGGTGCA');
    expect(error.code).toBe('partial-codon');
    expect(error.length).toBe(8);
    expect(error.remainder).toBe(2);
    expect(error.message).toMatch(/whole number of codons/i);
    expect(error.message).toMatch(/Nothing was trimmed/i);
  });

  it('checks the alphabet before the frame, so ATGN is a bad character not a bad length', () => {
    expect(errorOf('ATGN').code).toBe('invalid-base');
  });

  it('reports empty input', () => {
    expect(errorOf('   \n  ').code).toBe('empty');
  });

  it('refuses more than one record rather than silently using the first', () => {
    const error = errorOf('>one\nATGGTG\n>two\nATGGTG');
    expect(error.code).toBe('multiple-records');
    expect(error.message).toMatch(/one coding sequence at a time/i);
  });

  it('refuses input over the base cap', () => {
    const error = errorOf('ATG'.repeat(UPLOAD_LIMITS.maxBases));
    expect(error.code).toBe('too-large');
  });

  it('never leaks an error class name or a file path into a message', () => {
    for (const raw of ['ATGN', 'ATGGTGCA', '', '>a\nATG\n>b\nATG']) {
      const result = validateUpload(raw);
      if (result.ok) continue;
      expect(result.error.message).not.toMatch(/Error:|\.ts:|at Object|InvalidBaseError/);
    }
  });

  it('never throws, whatever it is handed', () => {
    const hostile = ['', '   ', '\u0000', '123456', 'N'.repeat(1000), 'ATG-GTG', 'U'.repeat(9), '>'.repeat(50)];
    for (const raw of hostile) {
      expect(() => validateUpload(raw)).not.toThrow();
    }
  });
});

describe('validateUpload — non-fatal warnings', () => {
  function warn(raw: string, referenceCodonCount?: number): readonly string[] {
    const result = validateUpload(
      raw,
      referenceCodonCount === undefined ? {} : { referenceCodonCount },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return [];
    return result.sequence.warnings.map((w) => w.code);
  }

  it('flags a missing ATG start', () => {
    expect(warn('GTGGTGTAA')).toContain('no-start-codon');
  });

  it('flags a stop codon before the end, naming its position', () => {
    const result = validateUpload('ATGTAAGTGTAA');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const internal = result.sequence.warnings.find((w) => w.code === 'internal-stop');
    expect(internal?.message).toContain('codon 2');
  });

  it('notes a missing stop codon mildly, since a partial CDS legitimately has none', () => {
    const codes = warn('ATGGTGCAT');
    expect(codes).toContain('no-stop-codon');
    const result = validateUpload('ATGGTGCAT');
    if (!result.ok) return;
    const w = result.sequence.warnings.find((x) => x.code === 'no-stop-codon');
    expect(w?.message).toMatch(/expected for a partial coding region/i);
  });

  it('reports a codon-count difference in both directions', () => {
    expect(warn('ATGGTGTAA', 50)).toContain('length-differs');
    expect(warn('ATGGTGTAA', 1)).toContain('length-differs');
    expect(warn('ATGGTGTAA', 3)).not.toContain('length-differs');
  });

  it('still returns ok: true when warnings are present', () => {
    const result = validateUpload('GTGGTGCAT');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sequence.warnings.length).toBeGreaterThan(0);
  });
});

describe('validateUpload — the caps it advertises are the ones lib/genome enforces', () => {
  it('re-exports lib/genome limits rather than inventing its own', async () => {
    const lib = await import('@/lib/genome');
    expect(UPLOAD_LIMITS.maxRawChars).toBe(lib.MAX_UPLOAD_CHARS);
    expect(UPLOAD_LIMITS.maxBases).toBe(lib.MAX_SEQUENCE_BASES);
  });
});
