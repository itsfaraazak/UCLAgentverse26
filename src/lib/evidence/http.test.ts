import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { loadFixture } from './__fixtures__';
import { cacheKey, createHttpClient, type FetchImpl } from './http';
import { createEvidenceService } from './service';
import { EvidenceSourceError } from './types';

const SNAPSHOT_DIR = fileURLToPath(new URL('../../data/evidence-cache', import.meta.url));
const OPTS = { sourceName: 'Test', timeoutMs: 1000 };

const offlineFetch: FetchImpl = () => Promise.reject(new TypeError('fetch failed: network down'));

const tmpDirs: string[] = [];
async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'evidence-http-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('HTTP cache', () => {
  it('falls back to the shipped snapshot when fetch throws and marks every SourceRef cached', async () => {
    const svc = createEvidenceService({ fetchImpl: offlineFetch, cacheDir: null, snapshotDir: SNAPSHOT_DIR });
    const variant = await svc.resolveVariant('rs334');
    expect(variant.id).toBe('chr11:g.5227002T>A');

    const { evidence, clinvar } = await svc.fetchEvidence(variant);
    const snapshot = loadFixture('myvariant-variant-hbb-rs334');
    expect(evidence.sources.length).toBeGreaterThan(0);
    for (const s of [...evidence.sources, clinvar.source]) {
      expect(s.cached).toBe(true);
      expect(s.retrievedAt).toBe(snapshot.fetchedAt);
    }
    expect(evidence.population.maxAf).toBeCloseTo(0.0127, 4);
  });

  it('retries once on a 5xx but not on a 4xx', async () => {
    const statuses = [503, 200];
    let calls = 0;
    const flaky = createHttpClient({
      fetchImpl: () => {
        const status = statuses[calls++] ?? 200;
        return Promise.resolve(new Response(JSON.stringify({ ok: status }), { status }));
      },
      cacheDir: null,
      snapshotDir: null,
    });
    expect((await flaky.getJson('https://example.test/flaky', OPTS)).body).toEqual({ ok: 200 });
    expect(calls).toBe(2);

    let badCalls = 0;
    const bad = createHttpClient({
      fetchImpl: () => {
        badCalls += 1;
        return Promise.resolve(new Response('{}', { status: 400 }));
      },
      cacheDir: null,
      snapshotDir: null,
    });
    await expect(bad.getJson('https://example.test/bad', OPTS)).rejects.toThrow('Test answered HTTP 400');
    expect(badCalls).toBe(1);
  });

  it('serves a live answer uncached, then the local copy when the network later fails', async () => {
    const cacheDir = await tmp();
    const url = 'https://example.test/a?b=1';
    const live = createHttpClient({
      fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ ok: 1 }), { status: 200 })),
      cacheDir,
      snapshotDir: null,
      now: () => new Date('2026-11-08T01:02:03.000Z'),
    });
    expect(await live.getJson(url, OPTS)).toEqual({ body: { ok: 1 }, retrievedAt: '2026-11-08T01:02:03.000Z', cached: false });
    expect(await readdir(cacheDir)).toEqual([`${cacheKey(url)}.json`]);

    const down = createHttpClient({ fetchImpl: offlineFetch, cacheDir, snapshotDir: null });
    expect(await down.getJson(url, OPTS)).toEqual({ body: { ok: 1 }, retrievedAt: '2026-11-08T01:02:03.000Z', cached: true });
  });

  it('treats an HTTP error status as a failure and falls back', async () => {
    const cacheDir = await tmp();
    const url = 'https://example.test/x';
    await createHttpClient({
      fetchImpl: () => Promise.resolve(new Response('{"v":1}', { status: 200 })),
      cacheDir,
      snapshotDir: null,
    }).getJson(url, OPTS);
    const erroring = createHttpClient({
      fetchImpl: () => Promise.resolve(new Response('busy', { status: 503 })),
      cacheDir,
      snapshotDir: null,
    });
    expect(await erroring.getJson(url, OPTS)).toMatchObject({ body: { v: 1 }, cached: true });
  });

  it('returns a null body for 404 without throwing', async () => {
    const client = createHttpClient({
      fetchImpl: () => Promise.resolve(new Response('{}', { status: 404 })),
      cacheDir: null,
      snapshotDir: null,
    });
    expect(await client.getJson('https://example.test/missing', OPTS)).toMatchObject({ body: null, cached: false });
  });

  it('throws EvidenceSourceError when the network fails and nothing is cached', async () => {
    const client = createHttpClient({ fetchImpl: offlineFetch, cacheDir: null, snapshotDir: SNAPSHOT_DIR });
    const err = await client.getJson('https://example.test/never-cached', OPTS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EvidenceSourceError);
    expect((err as Error).message).toMatch(/network down; no cached copy/);
  });

  it('offline mode never calls fetch', async () => {
    let calls = 0;
    const client = createHttpClient({
      fetchImpl: () => {
        calls++;
        return Promise.reject(new Error('should not be called'));
      },
      cacheDir: null,
      snapshotDir: SNAPSHOT_DIR,
      offline: true,
    });
    const url = loadFixture('myvariant-query-rs334').url;
    expect(await client.getJson(url, OPTS)).toMatchObject({ cached: true });
    expect(calls).toBe(0);
  });
});
