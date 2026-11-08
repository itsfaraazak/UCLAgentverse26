import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Repo, canonicalJson, oidOf, isCleanMerge, shortOid, SHORT_OID_LENGTH } from './index';
import type { Oid } from './index';
import type { Sequence } from '../genome';

function seq(bases: string, label: string): Sequence {
  return { bases, label };
}

function blobTree(repo: Repo, entries: Record<string, Sequence>): Oid {
  const treeEntries: Record<string, Oid> = {};
  for (const gene of Object.keys(entries)) {
    const sequence = entries[gene];
    if (sequence === undefined) continue;
    treeEntries[gene] = repo.write({ kind: 'blob', sequence });
  }
  return repo.write({ kind: 'tree', entries: treeEntries });
}

describe('canonicalJson / oid determinism', () => {
  it('sorts keys recursively and emits no incidental whitespace', () => {
    expect(canonicalJson({ z: 1, a: { b: 2, a: 3 } })).toBe('{"a":{"a":3,"b":2},"z":1}');
    expect(canonicalJson({ kind: 'blob', sequence: { label: 'x', bases: 'ATG' } })).toBe(
      '{"kind":"blob","sequence":{"bases":"ATG","label":"x"}}',
    );
  });

  it('hashes the canonical encoding with sha256', () => {
    const json = canonicalJson({ kind: 'tree', entries: { HBB: 'abc' } });
    const expected = createHash('sha256').update(json, 'utf8').digest('hex');
    expect(oidOf({ kind: 'tree', entries: { HBB: 'abc' } })).toBe(expected);
    expect(oidOf({ entries: { HBB: 'abc' }, kind: 'tree' })).toBe(expected);
  });

  it('is stable across key insertion order and across Repo instances', () => {
    const a = new Repo();
    const b = new Repo();
    const oidA = a.write({
      kind: 'blob',
      sequence: { bases: 'ATGGTG', label: 'HbA' },
    });
    const oidB = b.write({
      sequence: { label: 'HbA', bases: 'ATGGTG' },
      kind: 'blob',
    });
    expect(oidA).toBe(oidB);
    expect(oidA).toHaveLength(64);
    expect(a.read(oidA)).toEqual(b.read(oidB));
  });

  it('changes the oid when any hashed field changes', () => {
    const repo = new Repo();
    const x = repo.write({ kind: 'blob', sequence: seq('ATG', 'a') });
    const y = repo.write({ kind: 'blob', sequence: seq('ATG', 'b') });
    expect(x).not.toBe(y);
  });
});

describe('Repo write/read/commit/branch', () => {
  it('round-trips blobs, trees, and commits and moves HEAD', () => {
    const repo = new Repo();
    const tree = blobTree(repo, { HBB: seq('ATGGTG', 'wt') });
    const oid = repo.commit({
      tree,
      author: 'tester',
      message: 'init',
      timestamp: 1,
    });
    expect(repo.head()).toBe(oid);
    expect(repo.branches()).toEqual(['main']);
    const commit = repo.read(oid);
    expect(commit.kind).toBe('commit');
    if (commit.kind !== 'commit') return;
    expect(commit.parents).toEqual([]);
    expect(commit.tree).toBe(tree);
    expect(repo.read(tree).kind).toBe('tree');
  });

  it('records a linear log in reverse-chronological ancestry order', () => {
    const repo = new Repo();
    const t1 = blobTree(repo, { HBB: seq('AAA', 'a') });
    const c1 = repo.commit({ tree: t1, author: 'a', message: 'one', timestamp: 10 });
    const t2 = blobTree(repo, { HBB: seq('CCC', 'b') });
    const c2 = repo.commit({ tree: t2, author: 'a', message: 'two', timestamp: 20 });
    const t3 = blobTree(repo, { HBB: seq('GGG', 'c') });
    const c3 = repo.commit({ tree: t3, author: 'a', message: 'three', timestamp: 30 });
    const log = repo.log();
    expect(log.map((c) => c.message)).toEqual(['three', 'two', 'one']);
    expect(log.map((c) => (c.kind === 'commit' ? c.timestamp : 0))).toEqual([30, 20, 10]);
    expect(repo.read(c3).kind).toBe('commit');
    expect(repo.log(c1)).toHaveLength(1);
    expect(repo.log('main')[0]?.message).toBe('three');
    expect(c2).toHaveLength(64);
  });

  it('isolates commits onto a named branch', () => {
    const repo = new Repo();
    const root = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'root') }),
      author: 'a',
      message: 'root',
      timestamp: 1,
    });
    repo.branch('experiment');
    repo.checkout('experiment');
    const feat = repo.commit({
      tree: blobTree(repo, { HBB: seq('CCC', 'feat') }),
      author: 'a',
      message: 'feat',
      timestamp: 2,
    });
    expect(repo.head()).toBe(feat);
    repo.checkout('main');
    expect(repo.head()).toBe(root);
    expect(repo.branches()).toEqual(['experiment', 'main']);
  });
});

describe('mergeBase and three-way merge', () => {
  function diverged() {
    const repo = new Repo();
    const rootTree = blobTree(repo, {
      HBB: seq('ATG', 'hbb-root'),
      SYN: seq('AAA', 'syn-root'),
    });
    const root = repo.commit({
      tree: rootTree,
      author: 'a',
      message: 'root',
      timestamp: 1,
    });
    repo.branch('theirs');
    const oursTree = blobTree(repo, {
      HBB: seq('GTG', 'hbb-ours'),
      SYN: seq('AAA', 'syn-root'),
    });
    const ours = repo.commit({
      tree: oursTree,
      author: 'a',
      message: 'ours: HBB',
      timestamp: 2,
    });
    repo.checkout('theirs');
    return { repo, root, ours };
  }

  it('walks real ancestry to the fork point', () => {
    const { repo, root, ours } = diverged();
    const theirsTree = blobTree(repo, {
      HBB: seq('ATG', 'hbb-root'),
      SYN: seq('TTT', 'syn-theirs'),
    });
    const theirs = repo.commit({
      tree: theirsTree,
      author: 'a',
      message: 'theirs: SYN',
      timestamp: 3,
    });
    expect(repo.mergeBase(ours, theirs)).toBe(root);
    expect(repo.mergeBase(ours, ours)).toBe(ours);
    expect(repo.mergeBase(root, theirs)).toBe(root);
  });

  it('takes a change that landed on one side only (clean merge)', () => {
    const { repo, ours } = diverged();
    const theirsTree = blobTree(repo, {
      HBB: seq('ATG', 'hbb-root'),
      SYN: seq('TTT', 'syn-theirs'),
    });
    const theirs = repo.commit({
      tree: theirsTree,
      author: 'a',
      message: 'theirs: SYN',
      timestamp: 3,
    });
    repo.checkout('main');
    const result = repo.merge(ours, theirs);
    expect(isCleanMerge(result)).toBe(true);
    if (!isCleanMerge(result)) return;
    const mergeCommit = repo.read(result.oid);
    expect(mergeCommit.kind).toBe('commit');
    if (mergeCommit.kind !== 'commit') return;
    expect(mergeCommit.parents).toEqual([ours, theirs]);
    const tree = repo.read(mergeCommit.tree);
    expect(tree.kind).toBe('tree');
    if (tree.kind !== 'tree') return;
    const hbb = repo.read(tree.entries.HBB ?? '');
    const syn = repo.read(tree.entries.SYN ?? '');
    expect(hbb.kind === 'blob' && hbb.sequence.bases).toBe('GTG');
    expect(syn.kind === 'blob' && syn.sequence.bases).toBe('TTT');
    expect(repo.head()).toBe(result.oid);
  });

  it('takes a change made identically on both sides', () => {
    const { repo, ours } = diverged();
    const theirsTree = blobTree(repo, {
      HBB: seq('GTG', 'hbb-ours'),
      SYN: seq('AAA', 'syn-root'),
    });
    const theirs = repo.commit({
      tree: theirsTree,
      author: 'a',
      message: 'theirs: same HBB',
      timestamp: 3,
    });
    const result = repo.merge(ours, theirs);
    expect(isCleanMerge(result)).toBe(true);
    if (!isCleanMerge(result)) return;
    const mergeCommit = repo.read(result.oid);
    expect(mergeCommit.kind).toBe('commit');
    if (mergeCommit.kind !== 'commit') return;
    const tree = repo.read(mergeCommit.tree);
    expect(tree.kind).toBe('tree');
    if (tree.kind !== 'tree') return;
    const hbb = repo.read(tree.entries.HBB ?? '');
    expect(hbb.kind === 'blob' && hbb.sequence.bases).toBe('GTG');
    expect(Object.keys(tree.entries).sort()).toEqual(['HBB', 'SYN']);
  });

  it('reports a conflict when the same gene changed differently, and does not auto-resolve', () => {
    const { repo, ours } = diverged();
    const theirsTree = blobTree(repo, {
      HBB: seq('TTT', 'hbb-theirs'),
      SYN: seq('AAA', 'syn-root'),
    });
    const theirs = repo.commit({
      tree: theirsTree,
      author: 'a',
      message: 'theirs: other HBB',
      timestamp: 3,
    });
    repo.checkout('main');
    const result = repo.merge(ours, theirs);
    expect(isCleanMerge(result)).toBe(false);
    if (!('conflicts' in result)) {
      throw new Error('expected a conflict result');
    }
    expect(result.conflicts).toEqual([
      expect.objectContaining({ gene: 'HBB' }),
    ]);
    const conflict = result.conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.ours).not.toBe(conflict.theirs);
    expect(conflict.ours).not.toBe(conflict.base);
    expect(conflict.theirs).not.toBe(conflict.base);
    expect(repo.head()).toBe(ours);
  });

  it('terminates log on a diamond (merge commit) and visits each oid once', () => {
    const { repo, root, ours } = diverged();
    const theirsTree = blobTree(repo, {
      HBB: seq('ATG', 'hbb-root'),
      SYN: seq('TTT', 'syn-theirs'),
    });
    const theirs = repo.commit({
      tree: theirsTree,
      author: 'a',
      message: 'theirs: SYN',
      timestamp: 3,
    });
    repo.checkout('main');
    const result = repo.merge(ours, theirs);
    expect(isCleanMerge(result)).toBe(true);
    if (!isCleanMerge(result)) return;
    const log = repo.log(result.oid);
    expect(log).toHaveLength(4);
    const messages = log.map((c) => c.message);
    expect(messages[0]?.startsWith('Merge ')).toBe(true);
    expect(new Set(messages).size).toBe(4);
    expect(messages).toContain('root');
    expect(messages).toContain('ours: HBB');
    expect(messages).toContain('theirs: SYN');
    expect(repo.mergeBase(result.oid, theirs)).toBe(theirs);
    expect(root).toHaveLength(64);
  });

  it('merge(a, a) returns the existing oid and does not write a merge commit', () => {
    const repo = new Repo();
    const oid = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'h') }),
      author: 'a',
      message: 'root',
      timestamp: 1,
    });
    repo.branch('other', oid);
    const result = repo.merge(oid, oid);
    expect(isCleanMerge(result)).toBe(true);
    if (!isCleanMerge(result)) return;
    expect(result.oid).toBe(oid);
    expect(repo.head()).toBe(oid);
    expect(repo.log()).toHaveLength(1);
    repo.checkout('other');
    expect(repo.head()).toBe(oid);
  });

  it('a dominated merge-base no longer produces a spurious both-sides conflict (SPEC §4.6 #17)', () => {
    // W -- M -- A (HBB: AAA → CCC → GGG)
    //  \     \- B  parents [W, M], tree still CCC
    // The old BFS-from-b returned W when walking B first (W is B's first
    // parent). Three-way vs W saw CCC vs GGG as both changed from AAA →
    // conflict. The BCA is M, so B matches the base and A's edit is one-sided.
    const repo = new Repo();
    const w = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'w') }),
      author: 'a',
      message: 'W',
      timestamp: 1,
      parents: [],
    });
    const m = repo.commit({
      tree: blobTree(repo, { HBB: seq('CCC', 'm') }),
      author: 'a',
      message: 'M',
      timestamp: 2,
      parents: [w],
    });
    const a = repo.commit({
      tree: blobTree(repo, { HBB: seq('GGG', 'a') }),
      author: 'a',
      message: 'A',
      timestamp: 3,
      parents: [m],
    });
    const b = repo.commit({
      tree: blobTree(repo, { HBB: seq('CCC', 'm') }),
      author: 'a',
      message: 'B',
      timestamp: 4,
      parents: [w, m],
    });
    expect(repo.mergeBase(a, b)).toBe(m);
    expect(repo.mergeBase(b, a)).toBe(m);
    repo.checkout('main');
    const result = repo.merge(a, b);
    expect(isCleanMerge(result)).toBe(true);
    if (!isCleanMerge(result)) {
      throw new Error(
        `spurious conflict from a dominated base: ${JSON.stringify(result)}`,
      );
    }
    const mergeCommit = repo.read(result.oid);
    expect(mergeCommit.kind).toBe('commit');
    if (mergeCommit.kind !== 'commit') return;
    const tree = repo.read(mergeCommit.tree);
    expect(tree.kind).toBe('tree');
    if (tree.kind !== 'tree') return;
    const hbb = repo.read(tree.entries.HBB ?? '');
    expect(hbb.kind === 'blob' && hbb.sequence.bases).toBe('GGG');
  });
});

describe('shortOid', () => {
  it('abbreviates to the width SPEC §4.2 displays', () => {
    const oid = oidOf({ kind: 'blob', sequence: { bases: 'ATG', label: 'x' } });
    expect(oid).toHaveLength(64);
    expect(shortOid(oid)).toBe(oid.slice(0, 12));
    expect(shortOid(oid)).toHaveLength(SHORT_OID_LENGTH);
  });

  it('accepts an explicit width and rejects a nonsensical one', () => {
    const oid = 'a'.repeat(64);
    expect(shortOid(oid, 7)).toBe('aaaaaaa');
    expect(() => shortOid(oid, 0)).toThrow(/positive integer/);
    expect(() => shortOid(oid, 1.5)).toThrow(/positive integer/);
  });

  it('leaves an oid shorter than the width alone', () => {
    expect(shortOid('abc')).toBe('abc');
  });
});
