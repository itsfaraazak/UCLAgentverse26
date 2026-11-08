import { AbortedError, PdbFetchError } from './runtime/errors';

/**
 * Fetches deposited structures from the public RCSB file server (CORS-open).
 * Three-free so the shell can start the download in parallel with the
 * three.js chunk.
 *
 * Successful downloads are memoised per page session: switching variants or
 * toggling 2HBS ↔ 4HHB on conference wifi should not refetch ~0.8 MB.
 */

export type PdbLoader = (pdbId: string, signal: AbortSignal) => Promise<string>;

export const PDB_FETCH_TIMEOUT_MS = 15_000;

const PDB_ID = /^[0-9][A-Za-z0-9]{3}$/;

export function rcsbUrl(pdbId: string): string {
  return `https://files.rcsb.org/download/${pdbId.toUpperCase()}.pdb`;
}

const cache = new Map<string, string>();

/** Test hook — clears the memoised downloads. */
export function clearPdbCache(): void {
  cache.clear();
}

export interface FetchPdbOptions {
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export async function fetchPdbText(
  pdbId: string,
  signal: AbortSignal,
  options: FetchPdbOptions = {},
): Promise<string> {
  if (!PDB_ID.test(pdbId)) {
    throw new PdbFetchError(`"${pdbId}" is not a PDB identifier`);
  }
  const key = pdbId.toUpperCase();
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const { timeoutMs = PDB_FETCH_TIMEOUT_MS, fetchImpl = globalThis.fetch } = options;
  if (typeof fetchImpl !== 'function') {
    throw new PdbFetchError('This browser has no fetch()');
  }
  if (signal.aborted) throw new AbortedError();

  const local = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    local.abort();
  }, timeoutMs);
  const forward = (): void => local.abort();
  signal.addEventListener('abort', forward, { once: true });

  try {
    let response: Response;
    try {
      response = await fetchImpl(rcsbUrl(key), { signal: local.signal });
    } catch (err) {
      if (signal.aborted) throw new AbortedError();
      if (timedOut) {
        throw new PdbFetchError(`Timed out after ${Math.round(timeoutMs / 1000)} s reaching the RCSB file server`);
      }
      const detail = err instanceof Error ? err.message : String(err);
      throw new PdbFetchError(`Could not reach the RCSB file server (${detail})`);
    }
    if (!response.ok) {
      throw new PdbFetchError(
        `RCSB returned HTTP ${response.status} for ${key}`,
        response.status,
      );
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      if (signal.aborted) throw new AbortedError();
      throw new PdbFetchError(`Download of ${key} was interrupted`);
    }
    // A captive portal or proxy can answer 200 with HTML. Don't cache that,
    // or every retry would replay the bad body.
    if (!/^(ATOM  |HETATM)/m.test(text)) {
      throw new PdbFetchError(`The response for ${key} was not a PDB coordinate file`);
    }
    cache.set(key, text);
    return text;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', forward);
  }
}

export const defaultPdbLoader: PdbLoader = (pdbId, signal) => fetchPdbText(pdbId, signal);
