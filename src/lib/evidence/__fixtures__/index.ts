/**
 * Recorded live responses (MyVariant.info, Europe PMC; recorded 2026-11-08)
 * served through a fake fetch. Requests are matched on what identifies them
 * (MyVariant `q` or variant id, Europe PMC `query`), not the full URL, so the
 * tests survive field-list changes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FetchImpl } from '../http';

export interface Fixture {
  readonly url: string;
  readonly fetchedAt: string;
  readonly status: number;
  readonly body: unknown;
}

const DIR = fileURLToPath(new URL('.', import.meta.url));

export function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(path.join(DIR, `${name}.json`), 'utf8')) as Fixture;
}

/** First hit of a query fixture, or the document of a variant fixture. */
export function fixtureDoc(name: string): Record<string, unknown> {
  const body = loadFixture(name).body as { hits?: Record<string, unknown>[] } & Record<string, unknown>;
  return Array.isArray(body.hits) ? body.hits[0] : body;
}

export function requestKey(url: string): string {
  const u = new URL(url);
  if (u.hostname === 'myvariant.info') {
    if (u.pathname.endsWith('/query')) return `mv:q:${u.searchParams.get('q') ?? ''}`;
    return `mv:v:${decodeURIComponent(u.pathname.slice(u.pathname.lastIndexOf('/') + 1))}`;
  }
  return `epmc:${u.searchParams.get('query') ?? ''}`;
}

export interface FakeFetch {
  readonly fetchImpl: FetchImpl;
  readonly requests: string[];
}

/**
 * Serves every fixture in this directory plus `extra` (keyed like
 * `requestKey`). Unknown MyVariant queries answer with zero hits, unknown
 * variant ids with 404, anything else throws as a network failure would.
 */
export function fakeFetch(extra: Readonly<Record<string, unknown>> = {}): FakeFetch {
  const bodies = new Map<string, unknown>();
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
    const fx = JSON.parse(readFileSync(path.join(DIR, file), 'utf8')) as Fixture;
    bodies.set(requestKey(fx.url), fx.body);
  }
  for (const [k, v] of Object.entries(extra)) bodies.set(k, v);

  const requests: string[] = [];
  const fetchImpl: FetchImpl = async (url) => {
    const key = requestKey(url);
    requests.push(key);
    if (bodies.has(key)) return new Response(JSON.stringify(bodies.get(key)), { status: 200 });
    if (key.startsWith('mv:q:')) return new Response(JSON.stringify({ took: 1, total: 0, max_score: null, hits: [] }), { status: 200 });
    if (key.startsWith('mv:v:')) return new Response(JSON.stringify({ success: false, error: 'Not Found.' }), { status: 404 });
    throw new TypeError(`fetch failed: no fixture for ${key}`);
  };
  return { fetchImpl, requests };
}
