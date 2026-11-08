import path from 'node:path';

import { createHttpClient, type FetchImpl, type HttpClient } from './http';
import { parseVariantQuery } from './hgvs';
import { compareWithReference, interpret } from './interpret';
import { searchLiterature } from './literature';
import {
  GENOMIC_HGVS,
  RSID,
  hitMatchesQuery,
  hitsOf,
  queryPlan,
  queryUrl,
  rankHits,
  rsidQuery,
  toClinvarRecord,
  toEvidence,
  toResolvedVariant,
  variantUrl,
} from './myvariant';
import { asArray, isObject, type Json } from './normalise';
import { MYVARIANT } from './sources';
import { VariantNotFoundError, type EvidenceService, type ResolvedVariant } from './types';

export interface EvidenceServiceOptions {
  readonly fetchImpl?: FetchImpl;
  /** Live-response cache; null disables. Default `<cwd>/.cache/evidence`. */
  readonly cacheDir?: string | null;
  /** Committed snapshots used when live and local cache both fail. Default `<cwd>/src/data/evidence-cache`. */
  readonly snapshotDir?: string | null;
  /** Also write every live response into `snapshotDir` (used by `pnpm snapshot:evidence`). */
  readonly recordSnapshots?: boolean;
  /** Serve from disk only, never the network. */
  readonly offline?: boolean;
  readonly myVariantTimeoutMs?: number;
  readonly europePmcTimeoutMs?: number;
  readonly now?: () => Date;
}

export const DEFAULT_MYVARIANT_TIMEOUT_MS = 10_000;
export const DEFAULT_EUROPE_PMC_TIMEOUT_MS = 20_000;
export const DEFAULT_LITERATURE_LIMIT = 5;

function firstDoc(body: unknown): Json | null {
  return asArray(body).find(isObject) ?? null;
}

export function createEvidenceService(opts: EvidenceServiceOptions = {}): EvidenceService {
  const fetchImpl = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const http: HttpClient = createHttpClient({
    fetchImpl,
    cacheDir: opts.cacheDir === undefined ? path.join(process.cwd(), '.cache', 'evidence') : opts.cacheDir,
    snapshotDir:
      opts.snapshotDir === undefined ? path.join(process.cwd(), 'src', 'data', 'evidence-cache') : opts.snapshotDir,
    recordSnapshots: opts.recordSnapshots,
    offline: opts.offline,
    now: opts.now,
  });
  const mvTimeout = opts.myVariantTimeoutMs ?? DEFAULT_MYVARIANT_TIMEOUT_MS;
  const epmcTimeout = opts.europePmcTimeoutMs ?? DEFAULT_EUROPE_PMC_TIMEOUT_MS;
  const getMyVariant = (url: string) => http.getJson(url, { sourceName: MYVARIANT.name, timeoutMs: mvTimeout });

  async function resolveFromQuery(q: string, query: string, verify: boolean): Promise<ResolvedVariant | null> {
    const hits = hitsOf((await getMyVariant(queryUrl(q))).body);
    const candidates = verify ? hits.filter((h) => hitMatchesQuery(h, query)) : hits;
    if (candidates.length === 0) return null;
    const [best, ...rest] = rankHits(candidates);
    const alternates = [...new Set(rest.map((h) => String(h._id)))].filter((id) => id !== String(best._id));
    return toResolvedVariant(best, query, alternates);
  }

  return {
    async resolveVariant(query) {
      const q = query.trim();
      if (q === '') throw new VariantNotFoundError(query);

      if (RSID.test(q)) {
        const found = await resolveFromQuery(rsidQuery(q), q, false);
        if (found) return found;
        throw new VariantNotFoundError(query);
      }

      if (GENOMIC_HGVS.test(q)) {
        const doc = firstDoc((await getMyVariant(variantUrl(q))).body);
        if (doc && typeof doc._id === 'string') return toResolvedVariant(doc, q, []);
        throw new VariantNotFoundError(query);
      }

      const parsed = parseVariantQuery(q);
      if (parsed.coding === null && parsed.protein === null) {
        const rs = /\brs\d+\b/i.exec(q);
        if (rs) {
          const found = await resolveFromQuery(rsidQuery(rs[0]), q, false);
          if (found) return found;
        }
        throw new VariantNotFoundError(query);
      }

      for (const step of queryPlan(q)) {
        const found = await resolveFromQuery(step.q, q, step.verify);
        if (found) return found;
      }
      throw new VariantNotFoundError(query);
    },

    async fetchEvidence(variant) {
      const res = await getMyVariant(variantUrl(variant.id));
      const doc = firstDoc(res.body);
      if (!doc) throw new VariantNotFoundError(variant.query);
      return {
        evidence: toEvidence(doc, variant, res),
        clinvar: toClinvarRecord(doc, variant.rsid, res),
      };
    },

    interpret,
    compareWithReference,

    searchLiterature(query, limit = DEFAULT_LITERATURE_LIMIT) {
      return searchLiterature(http, query, limit, epmcTimeout);
    },
  };
}

const SINGLETON_KEY = Symbol.for('deltagene.evidenceService');

/**
 * Process-wide service on global fetch, held on `globalThis` so dev-server
 * module reloads keep its in-memory memo. `EVIDENCE_OFFLINE=1` serves from
 * the on-disk caches only.
 */
export function getEvidenceService(): EvidenceService {
  const store = globalThis as typeof globalThis & { [SINGLETON_KEY]?: EvidenceService };
  store[SINGLETON_KEY] ??= createEvidenceService({ offline: process.env.EVIDENCE_OFFLINE === '1' });
  return store[SINGLETON_KEY];
}
