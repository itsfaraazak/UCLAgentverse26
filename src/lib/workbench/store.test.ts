import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../vcs/canonical';
import { createHash } from 'node:crypto';
import { ndjson } from './http';
import { StoreError, WorkbenchStore, slugify } from './store';
import { ALICE, collect, testService } from './test-helpers';
import { parseAssert, parseComment, parsePrompt, parseSignoff } from './validate';
import type { Actor } from './types';

const human: Actor = { kind: 'human', name: 'A', role: null };
const dirs: string[] = [];

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-'));
  dirs.push(dir);
  return join(dir, 'nested', 'workbench.json');
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('WorkbenchStore', () => {
  it('starts with main only', () => {
    const s = new WorkbenchStore({ file: null });
    expect(s.listBranches().map((b) => b.name)).toEqual(['main']);
  });

  it('derives ids from canonical content and freezes deltas', () => {
    const s = new WorkbenchStore({ file: null });
    s.createBranch({ name: 'work/a', title: 'A', from: { branch: 'main', delta: null }, by: human });
    const d = s.append('work/a', { kind: 'message', actor: human, title: 'Hi', data: { markdown: 'x' } });
    const expected = createHash('sha256')
      .update(canonicalJson({ branch: 'work/a', kind: 'message', actor: human, title: 'Hi', body: '', data: { markdown: 'x' }, parents: [], seq: 1 }))
      .digest('hex')
      .slice(0, 16);
    expect(d.id).toBe(expected);
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d.data)).toBe(true);
    const e = s.append('work/a', { kind: 'message', actor: human, title: 'Hi', data: { markdown: 'x' } });
    expect(e.seq).toBe(2);
    expect(e.parents).toEqual([d.id]);
    expect(s.getBranch('work/a')!.head).toBe(e.id);
  });

  it('dedupes branch names', () => {
    const s = new WorkbenchStore({ file: null });
    const a = s.createBranch({ name: 'review/x', title: 'x', from: { branch: 'main', delta: null }, by: human });
    const b = s.createBranch({ name: 'review/x', title: 'x', from: { branch: 'main', delta: null }, by: human });
    expect([a.name, b.name]).toEqual(['review/x', 'review/x-2']);
    expect(slugify('BRCA1 c.5266dupC')).toBe('brca1-c-5266dupc');
  });

  it('rejects forking from a delta outside the parent history', () => {
    const s = new WorkbenchStore({ file: null });
    expect(() => s.createBranch({ name: 'x', title: 'x', from: { branch: 'main', delta: 'nope' }, by: human })).toThrow(StoreError);
  });

  it('round-trips through the JSON file and clears stale running status', async () => {
    const file = tempFile();
    const store = new WorkbenchStore({ file });
    const svc = testService({ store });
    await collect(svc.preparePrompt({ branch: 'main', text: 'Assess rs334', by: ALICE }));
    store.setStatus('review/rs334', 'running');
    const before = store.snapshot({ available: false, model: 'm', reason: '' });

    const reloaded = new WorkbenchStore({ file });
    const after = reloaded.snapshot({ available: false, model: 'm', reason: '' });
    expect(after.deltas).toEqual(before.deltas);
    expect(after.branches.find((b) => b.name === 'review/rs334')?.status).toBe('open');
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1);

    const next = reloaded.append('review/rs334', { kind: 'message', actor: human, title: 'after reload', data: { markdown: '' } });
    expect(next.seq).toBe(before.deltas.length + 1);

    reloaded.reset();
    expect(new WorkbenchStore({ file }).allDeltas()).toHaveLength(0);
  });
});

describe('request validation', () => {
  const by = { name: 'A', role: null };
  it.each([
    () => parsePrompt(null),
    () => parsePrompt({ branch: 'main', text: '', by }),
    () => parsePrompt({ branch: 'main', text: 'x', by, extra: 1 }),
    () => parsePrompt({ branch: 'main', text: 'x', by: { name: '' } }),
    () => parseComment({ branch: 'main', text: 'x', onDelta: null, askAgent: 'yes', by }),
    () => parseAssert({ branch: 'b', assertion: { kind: 'dismiss', code: 'XX1', reason: 'r' }, by }),
    () => parseAssert({ branch: 'b', assertion: { kind: 'other' }, by }),
    () => parseSignoff({ branch: 'b', finalClassification: 'Probably fine', rationale: '', by }),
  ])('rejects malformed body %#', (fn) => {
    expect(fn).toThrow(StoreError);
  });

  it('accepts a valid sign-off', () => {
    expect(parseSignoff({ branch: 'b', finalClassification: 'Benign', rationale: '', by })).toMatchObject({ finalClassification: 'Benign' });
  });
});

describe('ndjson', () => {
  it('streams one event per line and ends with done', async () => {
    const svc = testService();
    const res = ndjson(svc.preparePrompt({ branch: 'main', text: 'Assess rs334', by: ALICE }));
    expect(res.headers.get('Content-Type')).toContain('application/x-ndjson');
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l) as { type: string });
    expect(lines[0]).toEqual({ type: 'status', branch: 'review/rs334', status: 'running' });
    expect(lines.at(-1)?.type).toBe('done');
    expect(lines.filter((l) => l.type === 'delta').length).toBeGreaterThan(5);
  });

  it('returns 409 while the branch is running', async () => {
    const svc = testService();
    await collect(svc.preparePrompt({ branch: 'main', text: 'Assess rs334', by: ALICE }));
    svc.preparePrompt({ branch: 'review/rs334', text: 'Search more literature', by: ALICE });
    expect(() => svc.preparePrompt({ branch: 'review/rs334', text: 'again', by: ALICE })).toThrow(
      expect.objectContaining({ status: 409 }),
    );
  });
});
