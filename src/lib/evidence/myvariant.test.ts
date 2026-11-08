import { describe, expect, it } from 'vitest';

import { fakeFetch, fixtureDoc, loadFixture } from './__fixtures__';
import { mapEffects, mostSevere } from './hgvs';
import {
  alphaMissenseClass,
  clinvarConsensus,
  hitsOf,
  queryPlan,
  rankHits,
  starsFor,
  toClinvarRecord,
  toEvidence,
  toResolvedVariant,
  type ClinvarSubmission,
} from './myvariant';
import { asArray, firstString, maxNumber, pick, strings } from './normalise';
import { createEvidenceService } from './service';
import { ALPHAMISSENSE, CLINVAR, DBSNP, GNOMAD, MYVARIANT, SNPEFF } from './sources';
import { VariantNotFoundError, type ResolvedVariant } from './types';

const FETCHED = { retrievedAt: '2026-11-08T00:00:00.000Z', cached: false };

function service(extra: Readonly<Record<string, unknown>> = {}) {
  const fake = fakeFetch(extra);
  const svc = createEvidenceService({ fetchImpl: fake.fetchImpl, cacheDir: null, snapshotDir: null });
  return { svc, requests: fake.requests };
}

describe('resolveVariant', () => {
  it('rs334 picks the T>A allele that has a ClinVar record and lists the other alleles', async () => {
    const { svc, requests } = service();
    const v = await svc.resolveVariant('rs334');

    expect(v.id).toBe('chr11:g.5227002T>A');
    expect(v.rsid).toBe('rs334');
    expect(v.gene).toBe('HBB');
    expect(v.assembly).toBe('GRCh38');
    expect(v.query).toBe('rs334');
    expect(v.hgvsCoding).toMatch(/^NM_000518\.\d+:c\.20A>T$/);
    expect(v.hgvsProtein).toMatch(/p\.Glu7Val$/);
    expect(v.alternates.length).toBeGreaterThan(0);
    expect(v.alternates).not.toContain(v.id);
    expect(v.alternates.every((id) => id.startsWith('chr11:g.5227002'))).toBe(true);
    expect(requests).toEqual(['mv:q:dbsnp.rsid:rs334 OR clinvar.rsid:rs334']);
  });

  it('ranks ClinVar-curated alleles above higher-scoring alleles without a record', () => {
    const hits = hitsOf(loadFixture('myvariant-query-rs334').body);
    const withoutClinvar = hits.find((h) => pick(h, 'clinvar').length === 0);
    expect(withoutClinvar).toBeDefined();
    const boosted = { ...withoutClinvar!, _score: 1e9 };
    const ranked = rankHits([boosted, ...hits.filter((h) => h !== withoutClinvar)]);
    expect(ranked[0]._id).toBe('chr11:g.5227002T>A');
    expect(ranked[ranked.length - 1]).toBe(boosted);
  });

  it("'BRCA1 c.5266dupC' resolves rs80357906", async () => {
    const { svc } = service();
    const v = await svc.resolveVariant('BRCA1 c.5266dupC');
    expect(v.rsid).toBe('rs80357906');
    expect(v.gene).toBe('BRCA1');
    expect(v.id).toBe('chr17:g.43057062_43057063dup');
    expect(v.hgvsCoding).toMatch(/c\.5266dup/);
  });

  it('CFTR p.Phe508del resolves to the 3 bp deletion', async () => {
    const { svc } = service();
    const v = await svc.resolveVariant('CFTR p.Phe508del');
    expect(v.gene).toBe('CFTR');
    expect(v.id).toBe('chr7:g.117559591_117559593del');
    expect(v.rsid).toBe('rs113993960');
  });

  it('falls back to fielded queries when the free-text query returns no hits', async () => {
    const brcaHits = loadFixture('myvariant-query-brca1-c5266dupc').body;
    const fielded = 'clinvar.gene.symbol:BRCA1 AND clinvar.hgvs.coding:*c.5266dupC';
    const { svc, requests } = service({
      'mv:q:BRCA1 c.5266dupC': { took: 1, total: 0, max_score: null, hits: [] },
      [`mv:q:${fielded}`]: brcaHits,
    });
    const v = await svc.resolveVariant('BRCA1 c.5266dupC');
    expect(v.rsid).toBe('rs80357906');
    expect(requests).toEqual(['mv:q:BRCA1 c.5266dupC', `mv:q:${fielded}`]);
  });

  it('builds the fallback plan with verified free text first and exact fielded queries after', () => {
    expect(queryPlan('BRCA1 c.5266dupC')).toEqual([
      { q: 'BRCA1 c.5266dupC', verify: true },
      { q: 'clinvar.gene.symbol:BRCA1 AND clinvar.hgvs.coding:*c.5266dupC', verify: false },
      { q: 'snpeff.ann.genename:BRCA1 AND snpeff.ann.hgvs_c:"c.5266dupC"', verify: false },
    ]);
    const plan = queryPlan('HBB c.20A>T').map((s) => s.q);
    expect(plan.some((q) => q.includes('clinvar.hgvs.coding:*'))).toBe(false);
  });

  it('throws VariantNotFoundError when every step comes back empty', async () => {
    const { svc, requests } = service();
    await expect(svc.resolveVariant('FAKE1 c.123A>G')).rejects.toBeInstanceOf(VariantNotFoundError);
    expect(requests.length).toBeGreaterThan(1);
    await expect(svc.resolveVariant('rs999999999999')).rejects.toBeInstanceOf(VariantNotFoundError);
    await expect(svc.resolveVariant('   ')).rejects.toBeInstanceOf(VariantNotFoundError);
    await expect(svc.resolveVariant('hello world')).rejects.toThrow(/No variant matched "hello world"/);
  });

  it('throws VariantNotFoundError for a genomic id MyVariant answers 404 for', async () => {
    const { svc } = service();
    await expect(svc.resolveVariant('chr1:g.1A>G')).rejects.toBeInstanceOf(VariantNotFoundError);
  });
});

describe('normalisation helpers', () => {
  it('treats scalars and (nested) arrays the same', () => {
    expect(asArray(undefined)).toEqual([]);
    expect(asArray(null)).toEqual([]);
    expect(asArray(0.5)).toEqual([0.5]);
    expect(asArray([[1, 2], [3]])).toEqual([1, 2, 3]);

    const scalar = { dbnsfp: { alphamissense: { score: 0.2 } } };
    const array = { dbnsfp: [{ alphamissense: { score: [0.1, 0.4] } }, { alphamissense: { score: 0.3 } }] };
    expect(pick(scalar, 'dbnsfp.alphamissense.score')).toEqual([0.2]);
    expect(pick(array, 'dbnsfp.alphamissense.score')).toEqual([0.1, 0.4, 0.3]);
    expect(maxNumber(array, 'dbnsfp.alphamissense.score')).toBe(0.4);
    expect(maxNumber({}, 'dbnsfp.alphamissense.score')).toBeNull();
  });

  it('drops blanks and dbNSFP "." placeholders and parses numeric strings', () => {
    expect(strings(['', ' . ', '.', ' HBB ', 7, null, {}])).toEqual(['HBB', '7']);
    expect(maxNumber({ x: ['.', '0.25', 0.1] }, 'x')).toBe(0.25);
    expect(firstString({ a: { b: [] }, c: 'x' }, 'a.b', 'c')).toBe('x');
  });

  it('picks the most severe consequence across compound effects', () => {
    expect(mapEffects(['missense_variant', 'splice_region_variant&intron_variant'])).toBe('missense');
    expect(mapEffects(['missense_variant', 'stop_gained'])).toBe('stop_gained');
    expect(mapEffects(['NON_SYNONYMOUS', 'SYNONYMOUS'])).toBe('missense');
    expect(mapEffects(['frameshift_variant', 'stop_gained'])).toBe('frameshift');
    expect(mapEffects(['splice_acceptor_variant&intron_variant', 'missense_variant'])).toBe('splice');
    expect(mostSevere([])).toBe('unknown');
  });

  it('classifies AlphaMissense with the 0.34 / 0.564 thresholds', () => {
    expect(alphaMissenseClass(null)).toBeNull();
    expect(alphaMissenseClass(0.3399)).toBe('likely_benign');
    expect(alphaMissenseClass(0.34)).toBe('ambiguous');
    expect(alphaMissenseClass(0.564)).toBe('ambiguous');
    expect(alphaMissenseClass(0.5641)).toBe('likely_pathogenic');
  });
});

describe('toEvidence', () => {
  const rs334Doc = fixtureDoc('myvariant-variant-hbb-rs334');

  function rs334(): ResolvedVariant {
    return toResolvedVariant(rs334Doc, 'rs334', []);
  }

  it('normalises the rs334 document', () => {
    const e = toEvidence(rs334Doc, rs334(), FETCHED);
    expect(e.consequence).toBe('missense');
    expect(e.population.maxAf).toBeCloseTo(0.0127, 4);
    expect(e.population.maxAf).toBe(
      Math.max(...[e.population.gnomadGenomeAf, e.population.gnomadExomeAf].filter((x): x is number => x !== null)),
    );
    expect(e.predictors.alphaMissense).toBeCloseTo(0.2271, 4);
    expect(e.predictors.alphaMissense).toBe(maxNumber(rs334Doc, 'dbnsfp.alphamissense.score'));
    expect(e.predictors.alphaMissenseClass).toBe('likely_benign');
    expect(e.protein).toMatchObject({ refAa: 'E', altAa: 'V', position: 7, refCodon: 'GAG', altCodon: 'GTG' });
    expect(e.sources.map((s) => s.name)).toEqual([MYVARIANT.name, GNOMAD.name, ALPHAMISSENSE.name, SNPEFF.name, DBSNP.name]);
    expect(e.sources.every((s) => s.cached === false && s.retrievedAt === FETCHED.retrievedAt)).toBe(true);
  });

  it('takes the max AlphaMissense score across transcripts', () => {
    const doc = { ...rs334Doc, dbnsfp: { ...(rs334Doc.dbnsfp as object), alphamissense: { score: [0.1, 0.9, '.', 0.5] } } };
    const e = toEvidence(doc, rs334(), FETCHED);
    expect(e.predictors.alphaMissense).toBe(0.9);
    expect(e.predictors.alphaMissenseClass).toBe('likely_pathogenic');
  });

  it('reports null frequency and no AlphaMissense source when the fields are absent', () => {
    const v = rs334();
    const e = toEvidence({ _id: v.id }, v, FETCHED);
    expect(e.population).toEqual({ gnomadGenomeAf: null, gnomadExomeAf: null, maxAf: null });
    expect(e.predictors.alphaMissense).toBeNull();
    expect(e.predictors.alphaMissenseClass).toBeNull();
    expect(e.sources.map((s) => s.name)).toEqual([MYVARIANT.name, GNOMAD.name, DBSNP.name]);
  });

  it('infers the consequence from HGVS when no annotator describes the variant', () => {
    const v: ResolvedVariant = { ...rs334(), hgvsProtein: 'NP_009225.1:p.Gln1756fs', hgvsCoding: 'NM_007294.4:c.5266dup' };
    const e = toEvidence({ _id: v.id }, v, FETCHED);
    expect(e.consequence).toBe('frameshift');
    expect(e.consequenceRaw).toEqual(['hgvs:NP_009225.1:p.Gln1756fs']);
  });
});

describe('ClinVar consensus', () => {
  const sub = (significance: string, reviewStatus: string | null = 'criteria provided, single submitter'): ClinvarSubmission => ({
    significance,
    reviewStatus,
  });

  it('calls Pathogenic on a Pathogenic majority of the pathogenic side', () => {
    expect(clinvarConsensus([sub('Pathogenic'), sub('Pathogenic'), sub('Likely pathogenic')], true)).toBe('Pathogenic');
  });

  it('calls Likely Pathogenic when LP is not outvoted by P', () => {
    expect(clinvarConsensus([sub('Likely pathogenic'), sub('Pathogenic')], true)).toBe('Likely Pathogenic');
    expect(clinvarConsensus([sub('Likely pathogenic')], true)).toBe('Likely Pathogenic');
  });

  it('calls Conflicting when submissions fall on different sides', () => {
    expect(clinvarConsensus([sub('Pathogenic'), sub('Benign')], true)).toBe('Conflicting');
    expect(clinvarConsensus([sub('Pathogenic'), sub('Uncertain significance')], true)).toBe('Conflicting');
    expect(clinvarConsensus([sub('Conflicting interpretations of pathogenicity')], true)).toBe('Conflicting');
  });

  it('ignores not provided / other / protective', () => {
    expect(clinvarConsensus([sub('Pathogenic'), sub('not provided'), sub('other'), sub('protective')], true)).toBe('Pathogenic');
    expect(clinvarConsensus([sub('not provided'), sub('protective')], true)).toBe('Other');
    expect(clinvarConsensus([], false)).toBeNull();
  });

  it('only counts the highest review tier that voted', () => {
    expect(
      clinvarConsensus([sub('Pathogenic', 'reviewed by expert panel'), sub('Uncertain significance', 'no assertion criteria provided')], true),
    ).toBe('Pathogenic');
  });

  it('maps review status to stars', () => {
    expect(starsFor('practice guideline')).toBe(4);
    expect(starsFor('reviewed by expert panel')).toBe(3);
    expect(starsFor('criteria provided, multiple submitters, no conflicts')).toBe(2);
    expect(starsFor('criteria provided, single submitter')).toBe(1);
    expect(starsFor('criteria provided, conflicting classifications')).toBe(1);
    expect(starsFor('no assertion criteria provided')).toBe(0);
    expect(starsFor('no assertion provided')).toBe(0);
  });

  it('builds the rs334 record: found, a consensus, best review status and a variation URL', () => {
    const doc = fixtureDoc('myvariant-variant-hbb-rs334');
    const r = toClinvarRecord(doc, 'rs334', FETCHED);
    expect(r.found).toBe(true);
    expect(r.consensus).toBe('Pathogenic');
    expect(r.significances.length).toBeGreaterThan(0);
    expect(r.stars).toBe(Math.max(...strings(pick(doc, 'clinvar.rcv.review_status')).map(starsFor)));
    expect(r.url).toMatch(/^https:\/\/www\.ncbi\.nlm\.nih\.gov\/clinvar\/variation\/\d+\/$/);
    expect(r.source.name).toBe(CLINVAR.name);
  });

  it('takes stars from the pathogenicity calls, not a better-reviewed drug-response record', () => {
    const doc = {
      _id: 'x',
      clinvar: {
        variant_id: 1,
        rcv: [
          { clinical_significance: 'drug response', review_status: 'reviewed by expert panel' },
          { clinical_significance: 'Pathogenic', review_status: 'criteria provided, single submitter' },
        ],
      },
    };
    const r = toClinvarRecord(doc, null, FETCHED);
    expect(r.stars).toBe(1);
    expect(r.consensus).toBe('Pathogenic');
  });

  it('reports not found with a search URL when the hit has no ClinVar data', () => {
    const r = toClinvarRecord({ _id: 'x' }, 'rs1', FETCHED);
    expect(r).toMatchObject({ found: false, consensus: null, stars: 0, url: 'https://www.ncbi.nlm.nih.gov/clinvar/?term=rs1' });
  });
});
