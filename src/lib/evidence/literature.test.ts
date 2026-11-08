import { describe, expect, it } from 'vitest';

import { fakeFetch, loadFixture } from './__fixtures__';
import { literatureQueryFor, literatureUrl, parsePapers } from './literature';
import { createEvidenceService } from './service';
import type { ResolvedVariant, VariantEvidence } from './types';

function evidenceFor(variant: Partial<ResolvedVariant>): VariantEvidence {
  return {
    variant: {
      id: 'chr11:g.5227002T>A',
      assembly: 'GRCh38',
      rsid: null,
      gene: null,
      hgvsCoding: null,
      hgvsProtein: null,
      query: 'q',
      alternates: [],
      ...variant,
    },
  } as VariantEvidence;
}

describe('parsePapers', () => {
  it('decodes entity-escaped markup in titles and strips the tags', () => {
    const papers = parsePapers({
      resultList: {
        result: [
          { pmid: '123', title: 'Founder &lt;i&gt;BRCA1&lt;/i&gt; variants &amp; risk', journalTitle: 'J &amp; G', pubYear: '2020' },
        ],
      },
    });
    expect(papers).toEqual([
      { pmid: '123', title: 'Founder BRCA1 variants & risk', journal: 'J & G', year: 2020, url: 'https://europepmc.org/article/MED/123' },
    ]);
  });

  it('decodes numeric entities and never leaves raw tags behind', () => {
    const [p] = parsePapers({ resultList: { result: [{ pmid: '1', title: '&#946;-globin &#x3B1;&lt;script&gt;x&lt;/script&gt;' }] } });
    expect(p.title).toBe('β-globin αx');
    expect(p.title).not.toMatch(/[<>]/);
  });

  it('builds source/id URLs when there is no PMID and drops untitled or unlinkable results', () => {
    const papers = parsePapers({
      resultList: {
        result: [
          { source: 'PPR', id: 'PPR 1', title: 'Preprint', pubYear: 'n/a' },
          { pmid: '9', title: '' },
          { title: 'No id at all' },
        ],
      },
    });
    expect(papers).toEqual([{ pmid: null, title: 'Preprint', journal: null, year: null, url: 'https://europepmc.org/article/PPR/PPR%201' }]);
  });

  it('parses the recorded Europe PMC response', () => {
    const papers = parsePapers(loadFixture('europepmc-hbb').body);
    expect(papers.length).toBeGreaterThan(0);
    for (const p of papers) {
      expect(p.title).not.toMatch(/&lt;|&gt;|&amp;|<|>/);
      expect(p.url).toMatch(/^https:\/\/europepmc\.org\/article\//);
    }
  });

  it('tolerates malformed bodies', () => {
    expect(parsePapers(null)).toEqual([]);
    expect(parsePapers({ resultList: { result: 'nope' } })).toEqual([]);
  });
});

describe('literatureQueryFor', () => {
  it('ANDs the gene with any of the variant names, transcripts stripped', () => {
    expect(
      literatureQueryFor(
        evidenceFor({ gene: 'HBB', hgvsProtein: 'NP_000509.1:p.Glu7Val', hgvsCoding: 'NM_000518.5:c.20A>T', rsid: 'rs334' }),
      ),
    ).toBe('HBB AND ("p.Glu7Val" OR "c.20A>T" OR "rs334")');
  });

  it('handles a single name, no gene, and no names', () => {
    expect(literatureQueryFor(evidenceFor({ gene: 'CFTR', rsid: 'rs113993960' }))).toBe('CFTR AND "rs113993960"');
    expect(literatureQueryFor(evidenceFor({ rsid: 'rs1' }))).toBe('"rs1"');
    expect(literatureQueryFor(evidenceFor({ gene: 'TP53' }))).toBe('"TP53" variant pathogenicity');
    expect(literatureQueryFor(evidenceFor({}))).toBe('"chr11:g.5227002T>A"');
  });

  it('matches the recorded fixture query, so offline runs hit the shipped cache', async () => {
    const svc = createEvidenceService({ fetchImpl: fakeFetch().fetchImpl, cacheDir: null, snapshotDir: null });
    const { evidence } = await svc.fetchEvidence(await svc.resolveVariant('rs334'));
    const q = literatureQueryFor(evidence);
    expect(literatureUrl(q, 5)).toBe(loadFixture('europepmc-hbb').url);

    const result = await svc.searchLiterature(q);
    expect(result.query).toBe(q);
    expect(result.papers.length).toBeGreaterThan(0);
    expect(result.source.url).toBe(`https://europepmc.org/search?query=${encodeURIComponent(q)}`);
    expect(result.source.cached).toBe(false);
  });

  it('rejects empty queries and out-of-range limits', async () => {
    const svc = createEvidenceService({ fetchImpl: fakeFetch().fetchImpl, cacheDir: null, snapshotDir: null });
    await expect(svc.searchLiterature('  ')).rejects.toThrow(RangeError);
    await expect(svc.searchLiterature('HBB', 0)).rejects.toThrow(RangeError);
    await expect(svc.searchLiterature('HBB', 26)).rejects.toThrow(RangeError);
  });
});
