import type { HttpClient } from './http';
import { asArray, isObject } from './normalise';
import { EUROPE_PMC } from './sources';
import type { LiteratureResult, Paper, VariantEvidence } from './types';

export const EUROPE_PMC_SEARCH = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
export const MAX_LITERATURE_LIMIT = 25;

function stripTranscript(hgvs: string | null): string | null {
  return hgvs ? hgvs.slice(hgvs.lastIndexOf(':') + 1) : null;
}

/**
 * The one literature query per variant: gene AND any of its names. Shared by
 * the agent and the snapshot script so offline runs hit the shipped cache.
 */
export function literatureQueryFor(evidence: VariantEvidence): string {
  const v = evidence.variant;
  const names = [stripTranscript(v.hgvsProtein), stripTranscript(v.hgvsCoding), v.rsid].filter(
    (x): x is string => x !== null && x !== '',
  );
  const quoted = [...new Set(names)].map((n) => `"${n.replace(/"/g, '')}"`);
  if (quoted.length === 0) return v.gene ? `"${v.gene}" variant pathogenicity` : `"${v.id}"`;
  const anyName = quoted.length === 1 ? quoted[0] : `(${quoted.join(' OR ')})`;
  return v.gene ? `${v.gene} AND ${anyName}` : anyName;
}

export function literatureUrl(query: string, limit: number): string {
  const params = new URLSearchParams();
  params.set('query', query);
  params.set('format', 'json');
  params.set('pageSize', String(limit));
  params.set('resultType', 'lite');
  return `${EUROPE_PMC_SEARCH}?${params.toString()}`;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

export function parsePapers(body: unknown): Paper[] {
  const list = isObject(body) && isObject(body.resultList) ? asArray(body.resultList.result) : [];
  return list.filter(isObject).flatMap((r): Paper[] => {
    const title = text(r.title);
    if (!title) return [];
    const pmid = text(r.pmid);
    const source = text(r.source);
    const id = text(r.id);
    const year = Number(text(r.pubYear));
    const url = pmid
      ? `https://europepmc.org/article/MED/${pmid}`
      : source && id
        ? `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(id)}`
        : null;
    if (!url) return [];
    return [{ pmid, title, journal: text(r.journalTitle), year: Number.isInteger(year) ? year : null, url }];
  });
}

export async function searchLiterature(
  http: HttpClient,
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<LiteratureResult> {
  const q = query.trim();
  if (q === '') throw new RangeError('searchLiterature: query must not be empty.');
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LITERATURE_LIMIT) {
    throw new RangeError(`searchLiterature: limit must be an integer from 1 to ${String(MAX_LITERATURE_LIMIT)}, got ${String(limit)}.`);
  }
  const url = literatureUrl(q, limit);
  const res = await http.getJson(url, { sourceName: EUROPE_PMC.name, timeoutMs });
  return {
    query: q,
    papers: parsePapers(res.body).slice(0, limit),
    source: {
      name: EUROPE_PMC.name,
      url: `https://europepmc.org/search?query=${encodeURIComponent(q)}`,
      licence: EUROPE_PMC.licence,
      licenceUrl: EUROPE_PMC.licenceUrl,
      retrievedAt: res.retrievedAt,
      cached: res.cached,
    },
  };
}
