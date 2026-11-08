import { describe, expect, it } from 'vitest';
import { lookupTherapies, THERAPY_TABLE_DISCLAIMER } from './therapy';
import type { AcmgClassification } from './types';

const DISCLAIMER =
  'Illustrative lookup table, not a real-time clinical database and not a substitute for a clinician or genetic counselor. Entries describe publicly documented, regulator-approved therapies only.';

const CASGEVY_NAME = 'Casgevy (exagamglogene autotemcel)';
const CASGEVY_APPROVED_FOR =
  'Sickle cell disease with recurrent vaso-occlusive crises (FDA approval 8 Dec 2023; age extensions since)';
const CASGEVY_CITATION = 'FDA approval letter, https://fda.gov/media/175179/download';

const NON_ACTIONABLE: readonly AcmgClassification[] = [
  'Uncertain Significance',
  'Likely Benign',
  'Benign',
];

describe('lookupTherapies', () => {
  it('matches HBB + Likely Pathogenic to the Casgevy public-reference entry', () => {
    const result = lookupTherapies('HBB', 'Likely Pathogenic');
    expect(result.kind).toBe('matched');
    expect(result.therapies).toHaveLength(1);
    const [entry] = result.therapies;
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    expect(entry.provenance).toBe('public-reference');
    expect(entry.name).toBe(CASGEVY_NAME);
    expect(entry.approvedFor).toBe(CASGEVY_APPROVED_FOR);
    expect(entry.citation).toBe(CASGEVY_CITATION);
    expect(result.disclaimer).toBe(DISCLAIMER);
  });

  it('matches HBB + Pathogenic', () => {
    const result = lookupTherapies('HBB', 'Pathogenic');
    expect(result.kind).toBe('matched');
    expect(result.therapies).toHaveLength(1);
    expect(result.disclaimer).toBe(DISCLAIMER);
  });

  it.each(NON_ACTIONABLE)('returns not-actionable for HBB + %s', (classification) => {
    const result = lookupTherapies('HBB', classification);
    expect(result.kind).toBe('not-actionable');
    expect(result.therapies).toEqual([]);
    expect(result.note).toBe(
      `Classification is '${classification}' -- not actionable, no lookup performed.`,
    );
    expect(result.disclaimer).toBe(DISCLAIMER);
  });

  it('looks up HBB case-insensitively', () => {
    const result = lookupTherapies('hbb', 'Pathogenic');
    expect(result.kind).toBe('matched');
    expect(result.gene).toBe('HBB');
    expect(result.therapies).toHaveLength(1);
    expect(result.disclaimer).toBe(DISCLAIMER);
  });

  it('returns no-entry for an unknown gene without inventing a therapy', () => {
    const result = lookupTherapies('MYMADEUPGENE', 'Pathogenic');
    expect(result.kind).toBe('no-entry');
    expect(result.therapies).toEqual([]);
    expect(result.note).toBe(
      'No approved therapy on record for MYMADEUPGENE in therapy-table.json.',
    );
    expect(result.disclaimer).toBe(DISCLAIMER);
  });

  it('exports the fixture disclaimer verbatim', () => {
    expect(THERAPY_TABLE_DISCLAIMER).toBe(DISCLAIMER);
  });

  it('does not let callers mutate the table through a returned array', () => {
    const first = lookupTherapies('HBB', 'Pathogenic');
    expect(Object.isFrozen(first.therapies)).toBe(true);
    const mutable = first.therapies as unknown as { name: string }[];
    expect(() => {
      mutable.push({ name: 'invented' });
    }).toThrow();
    const second = lookupTherapies('HBB', 'Pathogenic');
    expect(second.therapies).toHaveLength(1);
    expect(second.therapies[0]?.name).toBe(CASGEVY_NAME);
  });
});
