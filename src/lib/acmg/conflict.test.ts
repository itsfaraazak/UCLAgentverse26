import { describe, expect, it } from 'vitest';
import { assessConflict, crossesActionableThreshold, isActionable } from './conflict';
import { ACMG_CLASSIFICATIONS } from './types';

describe('crossesActionableThreshold', () => {
  it('flags non-actionable -> actionable (the Oliver et al. 2020 pattern)', () => {
    expect(crossesActionableThreshold('Uncertain Significance', 'Likely Pathogenic')).toBe(true);
    expect(crossesActionableThreshold('Likely Benign', 'Pathogenic')).toBe(true);
  });

  it('flags actionable -> non-actionable', () => {
    expect(crossesActionableThreshold('Likely Pathogenic', 'Uncertain Significance')).toBe(true);
    expect(crossesActionableThreshold('Pathogenic', 'Benign')).toBe(true);
  });

  it('does not flag a disagreement that stays on one side', () => {
    expect(crossesActionableThreshold('Pathogenic', 'Likely Pathogenic')).toBe(false);
    expect(crossesActionableThreshold('Benign', 'Likely Benign')).toBe(false);
    expect(crossesActionableThreshold('Uncertain Significance', 'Benign')).toBe(false);
  });

  it('never flags when there is no prior call', () => {
    for (const c of ACMG_CLASSIFICATIONS) {
      expect(crossesActionableThreshold(null, c)).toBe(false);
    }
  });

  it('matches the actionable-side definition for every ordered pair', () => {
    for (const prior of ACMG_CLASSIFICATIONS) {
      for (const next of ACMG_CLASSIFICATIONS) {
        expect(crossesActionableThreshold(prior, next)).toBe(
          isActionable(prior) !== isActionable(next),
        );
        expect(crossesActionableThreshold(prior, next)).toBe(
          crossesActionableThreshold(next, prior),
        );
      }
    }
  });

  it('treats only Pathogenic and Likely Pathogenic as actionable', () => {
    expect(ACMG_CLASSIFICATIONS.filter(isActionable)).toEqual(['Pathogenic', 'Likely Pathogenic']);
  });
});

describe('assessConflict', () => {
  it('no prior: no conflict, no crossing', () => {
    const a = assessConflict(null, 'Likely Pathogenic');
    expect(a.conflict).toBe(false);
    expect(a.crossesActionableThreshold).toBe(false);
    expect(a.priorClassification).toBeNull();
    expect(a.note).toMatch(/No prior classification/);
  });

  it('agreement: no conflict', () => {
    const a = assessConflict('Benign', 'Benign');
    expect(a.conflict).toBe(false);
    expect(a.crossesActionableThreshold).toBe(false);
    expect(a.note).toMatch(/Agrees/);
  });

  it('same-side disagreement: conflict without crossing', () => {
    const a = assessConflict('Pathogenic', 'Likely Pathogenic');
    expect(a.conflict).toBe(true);
    expect(a.crossesActionableThreshold).toBe(false);
    expect(a.note).toMatch(/same side/);
  });

  it('crossing disagreement in both directions', () => {
    const up = assessConflict('Uncertain Significance', 'Likely Pathogenic');
    expect(up.conflict && up.crossesActionableThreshold).toBe(true);
    const down = assessConflict('Likely Pathogenic', 'Uncertain Significance');
    expect(down.conflict && down.crossesActionableThreshold).toBe(true);
    expect(down.note).toMatch(/crosses the actionable/);
  });
});
