import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { EvidenceSourceError } from './types';

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpResult {
  /** Parsed JSON body; null when the server answered 404. */
  readonly body: unknown;
  /** ISO time of the live fetch, or of the snapshot when served from disk. */
  readonly retrievedAt: string;
  readonly cached: boolean;
}

export interface HttpClientOptions {
  readonly fetchImpl: FetchImpl;
  /** Live responses are written here; read back when the network fails. null disables. */
  readonly cacheDir: string | null;
  /** Shipped, committed snapshots; read-only unless `recordSnapshots`. null disables. */
  readonly snapshotDir: string | null;
  readonly recordSnapshots?: boolean;
  /** Never touch the network; serve from disk only. */
  readonly offline?: boolean;
  readonly now?: () => Date;
}

export interface HttpClient {
  getJson(url: string, opts: { readonly sourceName: string; readonly timeoutMs: number }): Promise<HttpResult>;
}

interface CacheEntry {
  readonly url: string;
  readonly fetchedAt: string;
  readonly status: number;
  readonly body: unknown;
}

/** Cache files are keyed by the exact URL, so callers must build URLs with a stable parameter order. */
export function cacheKey(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

async function readEntry(dir: string | null, url: string): Promise<CacheEntry | null> {
  if (dir === null) return null;
  try {
    const raw = await readFile(path.join(dir, `${cacheKey(url)}.json`), 'utf8');
    const entry = JSON.parse(raw) as CacheEntry;
    return entry.url === url ? entry : null;
  } catch {
    return null;
  }
}

async function writeEntry(dir: string, entry: CacheEntry): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${cacheKey(entry.url)}.json`), `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const now = options.now ?? (() => new Date());
  const memo = new Map<string, HttpResult>();

  async function live(url: string, sourceName: string, timeoutMs: number): Promise<HttpResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await options.fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (res.status !== 404 && !res.ok) {
        throw new EvidenceSourceError(sourceName, `${sourceName} answered HTTP ${String(res.status)} for ${url}`);
      }
      const body: unknown = res.status === 404 ? null : await res.json();
      const entry: CacheEntry = { url, fetchedAt: now().toISOString(), status: res.status, body };
      const writes: Promise<void>[] = [];
      if (options.cacheDir !== null) writes.push(writeEntry(options.cacheDir, entry));
      if (options.recordSnapshots && options.snapshotDir !== null) writes.push(writeEntry(options.snapshotDir, entry));
      // A read-only or full disk must not turn a good live answer into a failure.
      await Promise.allSettled(writes);
      return { body, retrievedAt: entry.fetchedAt, cached: false };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async getJson(url, { sourceName, timeoutMs }) {
      const hit = memo.get(url);
      if (hit) return hit;

      let failure: unknown = null;
      if (!options.offline) {
        try {
          const result = await live(url, sourceName, timeoutMs);
          memo.set(url, result);
          return result;
        } catch (err) {
          failure = err;
        }
      }

      const entry = (await readEntry(options.cacheDir, url)) ?? (await readEntry(options.snapshotDir, url));
      if (entry) {
        const result: HttpResult = {
          body: entry.status === 404 ? null : entry.body,
          retrievedAt: entry.fetchedAt,
          cached: true,
        };
        memo.set(url, result);
        return result;
      }

      const reason =
        failure === null
          ? 'offline mode and no cached copy'
          : failure instanceof Error && failure.name === 'AbortError'
            ? `timed out after ${String(timeoutMs)} ms and no cached copy`
            : `${failure instanceof Error ? failure.message : String(failure)}; no cached copy`;
      throw new EvidenceSourceError(sourceName, `${sourceName} unavailable: ${reason}.`);
    },
  };
}
