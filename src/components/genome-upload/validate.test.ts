import { describe, expect, it } from 'vitest';
import { validateSequence } from './validate';
import type { SequenceError, SequenceWarningCode } from './validate';

const HBB_31 =
  'ATGGTGCATCTGACTCCTGAGGAGAAGTCTGCCGTTACTGCCCTGTGGGGCAAGGTGAACGTGGATGAAGTTGGTGGTGAGGCCCTGGGCAGG';
const HBB_PROTEIN = 'MVHLTPEEKSAVTALWGKVNVDEVGGEALGR';

function warningCodes(
  warnings: readonly { readonly code: SequenceWarningCode }[],
): SequenceWarningCode[] {
  return warnings.map((warning) => warning.code);
}

function expectError(
  result: ReturnType<typeof validateSequence>,
): SequenceError {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('expected a validation error');
  }
  return result.error;
}

describe('validateSequence', () => {
  it('accepts the HBB 31-codon reference with a mild no-stop-codon warning', () => {
    const result = validateSequence(HBB_31, 'HBB exon 1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sequence.bases).toBe(HBB_31);
    expect(result.sequence.label).toBe('HBB exon 1');
    expect(result.sequence.codonCount).toBe(31);
    expect(result.sequence.protein).toBe(HBB_PROTEIN);
    expect(warningCodes(result.sequence.warnings)).toEqual(['no-stop-codon']);
    expect(result.sequence.warnings[0]?.message).not.toMatch(/error/i);
  });

  it('normalises lowercase input to uppercase', () => {
    const result = validateSequence('atggagtga', 'lower');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sequence.bases).toBe('ATGGAGTGA');
    expect(result.sequence.protein).toBe('ME*');
    expect(result.sequence.codonCount).toBe(3);
  });

  it('returns empty for empty or whitespace-only cleaned input', () => {
    for (const input of ['', '   ', '\n\t']) {
      const error = expectError(validateSequence(input, 'empty'));
      expect(error.code).toBe('empty');
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.message).not.toMatch(/Error|at Object|stack/i);
    }
  });

  it('maps a bad base to invalid-base with char, offset and 1-based position', () => {
    const error = expectError(validateSequence('ATGCGTN', 'ambig'));

    expect(error.code).toBe('invalid-base');
    expect(error.char).toBe('N');
    expect(error.offset).toBe(6);
    expect(error.position).toBe(7);
    expect(error.message).toContain('"N"');
    expect(error.message).toContain('position 7');
    expect(error.message).toMatch(/cleaned sequence/i);
    expect(error.message).not.toContain('InvalidBaseError');
  });

  it('rejects a trailing partial codon without truncating', () => {
    const error = expectError(validateSequence('ATGGA', 'partial'));

    expect(error.code).toBe('partial-codon');
    expect(error.length).toBe(5);
    expect(error.remainder).toBe(2);
    expect(error.message).toMatch(/whole codon/i);
    expect(error.message).toContain('2 extra bases');
    expect(error.message).not.toContain('PartialCodonError');
  });

  it('reports a leftover single base as 1 extra base', () => {
    const error = expectError(validateSequence('ATGGAGT', 'partial-1'));

    expect(error.code).toBe('partial-codon');
    expect(error.length).toBe(7);
    expect(error.remainder).toBe(1);
    expect(error.message).toContain('1 extra base');
  });

  it('checks the alphabet before the frame length so ATGN names the bad character', () => {
    const error = expectError(validateSequence('ATGN', 'order'));

    expect(error.code).toBe('invalid-base');
    expect(error.char).toBe('N');
    expect(error.offset).toBe(3);
    expect(error.position).toBe(4);
    expect(error.message).toContain('"N"');
    expect(error.message).toContain('position 4');
    expect(error.code).not.toBe('partial-codon');
  });

  it('warns no-start-codon when the first codon is not ATG', () => {
    const result = validateSequence('GTGGAGTAA', 'no-start');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warningCodes(result.sequence.warnings)).toEqual(['no-start-codon']);
    expect(result.sequence.warnings[0]?.message).toMatch(/ATG/);
  });

  it('warns internal-stop with a 1-based codon position', () => {
    const result = validateSequence('ATGTAATAA', 'internal-stop');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warningCodes(result.sequence.warnings)).toEqual(['internal-stop']);
    expect(result.sequence.warnings[0]?.message).toContain('codon 2');
    expect(result.sequence.protein).toBe('M*');
  });

  it('warns no-stop-codon as an observation when the last codon is not a stop', () => {
    const result = validateSequence('ATGGAG', 'no-stop');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warningCodes(result.sequence.warnings)).toEqual(['no-stop-codon']);
    expect(result.sequence.warnings[0]?.message).toMatch(/partial/i);
    expect(result.sequence.warnings[0]?.message).not.toMatch(/\berror\b/i);
  });

  it('warns length-differs in both directions and still returns ok', () => {
    const shorter = validateSequence('ATGGAGTAA', 'shorter', {
      referenceCodonCount: 4,
    });
    expect(shorter.ok).toBe(true);
    if (!shorter.ok) return;
    expect(warningCodes(shorter.sequence.warnings)).toContain('length-differs');
    expect(shorter.sequence.warnings.find((w) => w.code === 'length-differs')?.message).toMatch(
      /3 codons.*4/,
    );
    expect(shorter.sequence.warnings.find((w) => w.code === 'length-differs')?.message).toMatch(
      /inserted or deleted/,
    );

    const longer = validateSequence('ATGGAGAAATAA', 'longer', {
      referenceCodonCount: 3,
    });
    expect(longer.ok).toBe(true);
    if (!longer.ok) return;
    expect(warningCodes(longer.sequence.warnings)).toContain('length-differs');
    expect(longer.sequence.warnings.find((w) => w.code === 'length-differs')?.message).toMatch(
      /4 codons.*3/,
    );
  });

  it('keeps ok true when warnings are present', () => {
    const result = validateSequence(HBB_31, 'HBB', { referenceCodonCount: 30 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sequence.warnings.length).toBeGreaterThan(0);
    expect(warningCodes(result.sequence.warnings)).toEqual([
      'no-stop-codon',
      'length-differs',
    ]);
  });

  it('never throws for hostile or awkward inputs', () => {
    const inputs = [
      '',
      '   ',
      '123',
      'N',
      'U',
      'ATG' + 'GAG'.repeat(4000),
      'ATG-GAG',
      'nnn',
      'TAA',
    ];
    for (const input of inputs) {
      expect(() => validateSequence(input, 'hostile')).not.toThrow();
      const result = validateSequence(input, 'hostile');
      expect(result).toHaveProperty('ok');
      if (!result.ok) {
        expect(result.error.message).not.toMatch(/InvalidBaseError|PartialCodonError|at Object/);
      }
    }
  });
});
