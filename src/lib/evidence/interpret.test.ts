import { describe, expect, it } from 'vitest';

import type { AcmgClassification } from '../acmg/types';
import { fakeFetch } from './__fixtures__';
import { compareWithReference, interpret } from './interpret';
import { createEvidenceService } from './service';
import type { ClinvarConsensus, ClinvarRecord, EvidenceBundle, HumanAssertions, Interpretation } from './types';

async function bundle(query: string): Promise<EvidenceBundle> {
  const svc = createEvidenceService({ fetchImpl: fakeFetch().fetchImpl, cacheDir: null, snapshotDir: null });
  return svc.fetchEvidence(await svc.resolveVariant(query));
}

const met = (i: Interpretation) => i.engine.criteria.filter((c) => c.met).map((c) => c.code);

const ALICE = 'Dr Alice';

describe('interpret', () => {
  it('rs334: BS1 + BP4 = -5 -> Uncertain Significance', async () => {
    const { evidence } = await bundle('rs334');
    const i = interpret(evidence);
    expect(met(i).sort()).toEqual(['BP4', 'BS1']);
    expect(i.engine.points).toBe(-5);
    expect(i.points).toBe(-5);
    expect(i.classification).toBe('Uncertain Significance');
    expect(i.inputs.populationFrequency).toBeCloseTo(0.0127, 4);
    expect(i.inputs.inSilicoDeleteriousScore).toBeCloseTo(0.2271, 4);
    expect(i.inputs.isNullVariantInLofGene).toBe(false);
    expect(i.dismissed).toEqual([]);
    expect(i.limitation).toMatch(/not a certified clinical tool/);
    expect(i.inputNotes.inSilicoDeleteriousScore).toMatch(/AlphaMissense score 0\.227/);
  });

  it('BRCA1 c.5266dupC: PVS1 + PM2 = 10 -> Pathogenic', async () => {
    const { evidence } = await bundle('BRCA1 c.5266dupC');
    expect(evidence.consequence).toBe('frameshift');
    const i = interpret(evidence);
    expect(met(i).sort()).toEqual(['PM2', 'PVS1']);
    expect(i.points).toBe(10);
    expect(i.classification).toBe('Pathogenic');
    expect(i.inputs.inSilicoDeleteriousScore).toBe(0.5);
    expect(i.inputNotes.inSilicoDeleteriousScore).toMatch(/not applied/);
  });

  it('dismissing BS1 on rs334 leaves BP4 alone: -1, still VUS, engine untouched', async () => {
    const { evidence } = await bundle('rs334');
    const dismissal = { code: 'BS1' as const, reason: 'Carrier frequency reflects malaria selection.', by: ALICE };
    const i = interpret(evidence, { segregation: null, dismissed: [dismissal] });
    expect(i.points).toBe(-1);
    expect(i.classification).toBe('Uncertain Significance');
    expect(i.engine.points).toBe(-5);
    expect(i.dismissed).toEqual([dismissal]);
  });

  it('dismissing PVS1 on BRCA1 drops it from Pathogenic to VUS', async () => {
    const { evidence } = await bundle('BRCA1 c.5266dupC');
    const i = interpret(evidence, { segregation: null, dismissed: [{ code: 'PVS1', reason: 'r', by: ALICE }] });
    expect(i.points).toBe(2);
    expect(i.classification).toBe('Uncertain Significance');
    expect(i.engine.classification).toBe('Pathogenic');
  });

  it('refuses to dismiss an unmet criterion or the same one twice', async () => {
    const { evidence } = await bundle('rs334');
    expect(() => interpret(evidence, { segregation: null, dismissed: [{ code: 'PVS1', reason: 'r', by: ALICE }] })).toThrow(RangeError);
    const twice: HumanAssertions = {
      segregation: null,
      dismissed: [
        { code: 'BS1', reason: 'r', by: ALICE },
        { code: 'BS1', reason: 'r', by: ALICE },
      ],
    };
    expect(() => interpret(evidence, twice)).toThrow(RangeError);
  });

  it('a human segregation assertion adds PP1 and is attributed in the notes', async () => {
    const { evidence } = await bundle('rs334');
    const i = interpret(evidence, {
      segregation: { value: true, reason: 'Affected siblings both carry it.', by: ALICE },
      dismissed: [],
    });
    expect(met(i)).toContain('PP1');
    expect(i.points).toBe(-4);
    expect(i.inputs.segregatesWithDisease).toBe(true);
    expect(i.inputNotes.segregatesWithDisease).toContain(ALICE);
    expect(i.inputNotes.segregatesWithDisease).toContain('Affected siblings both carry it.');

    const no = interpret(evidence, { segregation: { value: false, reason: 'r', by: ALICE }, dismissed: [] });
    expect(met(no)).not.toContain('PP1');
  });
});

function interpretationAs(classification: AcmgClassification): Interpretation {
  return { classification } as Interpretation;
}

function clinvar(consensus: ClinvarConsensus | null, found = true, stars: ClinvarRecord['stars'] = 2): ClinvarRecord {
  return {
    found,
    consensus,
    significances: [],
    reviewStatus: null,
    stars,
    url: null,
    source: { name: 'ClinVar', url: '', licence: '', licenceUrl: null, retrievedAt: '', cached: false },
  };
}

describe('compareWithReference', () => {
  it('agrees when both sides make the same call', () => {
    const c = compareWithReference(interpretationAs('Pathogenic'), clinvar('Pathogenic'));
    expect(c).toMatchObject({ agrees: true, severity: 'none', agentClassification: 'Pathogenic' });
    expect(c.note).toMatch(/2-star/);
  });

  it('minor when both sit on the same side of the actionable line', () => {
    expect(compareWithReference(interpretationAs('Likely Pathogenic'), clinvar('Pathogenic'))).toMatchObject({
      agrees: false,
      severity: 'minor',
    });
    expect(compareWithReference(interpretationAs('Uncertain Significance'), clinvar('Likely Benign')).severity).toBe('minor');
  });

  it('major when the calls straddle the actionable line', () => {
    expect(compareWithReference(interpretationAs('Uncertain Significance'), clinvar('Pathogenic'))).toMatchObject({
      agrees: false,
      severity: 'major',
    });
    expect(compareWithReference(interpretationAs('Benign'), clinvar('Likely Pathogenic')).severity).toBe('major');
  });

  it('rs334 end to end: the VUS call is a major disagreement with ClinVar Pathogenic', async () => {
    const b = await bundle('rs334');
    const c = compareWithReference(interpret(b.evidence), b.clinvar);
    expect(c.severity).toBe('major');
    expect(c.clinvar.consensus).toBe('Pathogenic');
  });

  it('unavailable when ClinVar has no usable call', () => {
    for (const ref of [clinvar(null, false), clinvar('Conflicting'), clinvar('Other')]) {
      expect(compareWithReference(interpretationAs('Pathogenic'), ref)).toMatchObject({ agrees: null, severity: 'unavailable' });
    }
  });
});
