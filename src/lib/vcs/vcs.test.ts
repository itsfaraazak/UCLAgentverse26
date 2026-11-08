import { describe, expect, it } from 'vitest';

import type { Sequence } from '@/lib/genome';

import { canonicalJson, oidOf, Repo, shortOid } from './index';

const refSeq: Sequence = { bases: 'ATGGTGCATCTGACTCCTGAGGAG', label: 'HbA' };
const altSeq: Sequence = { bases: 'ATGGTGCATCTGACTCCTGTGGAG', label: 'HbS' };
const otherSeq: Sequence = { bases: 'ATGGTGCATCTGACCCCTGAGGAG', label: 'silent probe' };

function seeded(): {
  repo: Repo;
  base: string;
  ours: string;
  theirs: string;
} {
  const repo = new Repo();
  const refBlob = repo.write({ kind: 'blob', sequence: refSeq });
  const baseTree = repo.write({ kind: 'tree', entries: { HBB: refBlob } });

  repo.branch('main');
  repo.checkout('main');
  const base = repo.commit({
    tree: baseTree,
    parents: [],
    author: 'a@example.test',
    message: 'import reference',
    timestamp: 1,
  });

  const altBlob = repo.write({ kind: 'blob', sequence: altSeq });
  const ourTree = repo.write({ kind: 'tree', entries: { HBB: altBlob } });
  repo.branch('ours', base);
  repo.checkout('ours');
  const ours = repo.commit({
    tree: ourTree,
    parents: [base],
    author: 'a@example.test',
    message: 'apply HbS',
    timestamp: 2,
  });

  repo.branch('theirs', base);
  repo.checkout('theirs');
  const theirs = repo.commit({
    tree: baseTree,
    parents: [base],
    author: 'b@example.test',
    message: 'no genotype change',
    timestamp: 3,
  });

  return { repo, base, ours, theirs };
}

describe('canonicalJson', () => {
  it('sorts keys at every level so logically equal objects serialise alike', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it('drops undefined-valued keys rather than emitting them', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('oid determinism', () => {
  it('produces the same oid for the same object across constructions', () => {
    const a = oidOf({ kind: 'blob', sequence: refSeq });
    const b = oidOf({ kind: 'blob', sequence: { label: 'HbA', bases: refSeq.bases } });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same oids across two independently built repos', () => {
    const first = seeded();
    const second = seeded();
    expect(first.base).toBe(second.base);
    expect(first.ours).toBe(second.ours);
    expect(first.theirs).toBe(second.theirs);
  });

  it('changes the oid when any hashed field changes', () => {
    expect(oidOf({ kind: 'blob', sequence: refSeq })).not.toBe(
      oidOf({ kind: 'blob', sequence: altSeq }),
    );
  });

  it('shows the first twelve hex characters in the UI form', () => {
    const oid = oidOf({ kind: 'blob', sequence: refSeq });
    expect(shortOid(oid)).toHaveLength(12);
    expect(oid.startsWith(shortOid(oid))).toBe(true);
  });
});

describe('objects, refs and log', () => {
  it('round-trips a written object', () => {
    const { repo, base } = seeded();
    const commit = repo.read(base);
    expect(commit.kind).toBe('commit');
    if (commit.kind === 'commit') {
      expect(commit.message).toBe('import reference');
      expect(commit.parents).toEqual([]);
    }
  });

  it('throws on an unknown oid rather than returning undefined', () => {
    const { repo } = seeded();
    expect(() => repo.read('f'.repeat(64))).toThrow();
  });

  it('lists branches sorted', () => {
    const { repo } = seeded();
    expect(repo.branches()).toEqual(['main', 'ours', 'theirs']);
  });

  it('walks a branch history newest first', () => {
    const { repo } = seeded();
    const log = repo.log('ours');
    expect(log.map((c) => c.message)).toEqual(['apply HbS', 'import reference']);
  });

  it('refuses to check out a branch that does not exist', () => {
    const { repo } = seeded();
    expect(() => repo.checkout('nope')).toThrow();
  });
});

describe('mergeBase', () => {
  it('finds the common ancestor of two branches', () => {
    const { repo, base, ours, theirs } = seeded();
    expect(repo.mergeBase(ours, theirs)).toBe(base);
  });

  it('returns the commit itself when one side is an ancestor of the other', () => {
    const { repo, base, ours } = seeded();
    expect(repo.mergeBase(ours, base)).toBe(base);
  });
});

describe('three-way merge', () => {
  it('takes the side that changed when only one side changed', () => {
    const { repo, ours, theirs } = seeded();
    const result = repo.merge(ours, theirs);
    expect('oid' in result).toBe(true);
    if ('oid' in result) {
      const tree = repo.readTree(result.oid);
      const blob = repo.readBlob(tree.entries.HBB);
      expect(blob.sequence.bases).toBe(altSeq.bases);
    }
  });

  it('takes the change when both sides made the identical change', () => {
    const repo = new Repo();
    const refBlob = repo.write({ kind: 'blob', sequence: refSeq });
    const baseTree = repo.write({ kind: 'tree', entries: { HBB: refBlob } });
    repo.branch('main');
    repo.checkout('main');
    const base = repo.commit({
      tree: baseTree,
      parents: [],
      author: 'a',
      message: 'base',
      timestamp: 1,
    });

    const altBlob = repo.write({ kind: 'blob', sequence: altSeq });
    const sameTree = repo.write({ kind: 'tree', entries: { HBB: altBlob } });
    repo.branch('ours', base);
    repo.checkout('ours');
    const ours = repo.commit({ tree: sameTree, parents: [base], author: 'a', message: 'x', timestamp: 2 });
    repo.branch('theirs', base);
    repo.checkout('theirs');
    const theirs = repo.commit({ tree: sameTree, parents: [base], author: 'b', message: 'y', timestamp: 3 });

    const result = repo.merge(ours, theirs);
    expect('oid' in result).toBe(true);
    if ('oid' in result) {
      expect(repo.readBlob(repo.readTree(result.oid).entries.HBB).sequence.bases).toBe(altSeq.bases);
    }
  });

  it('CONFLICTS and does not auto-resolve when both sides changed differently', () => {
    const repo = new Repo();
    const refBlob = repo.write({ kind: 'blob', sequence: refSeq });
    const baseTree = repo.write({ kind: 'tree', entries: { HBB: refBlob } });
    repo.branch('main');
    repo.checkout('main');
    const base = repo.commit({
      tree: baseTree,
      parents: [],
      author: 'a',
      message: 'base',
      timestamp: 1,
    });

    const ourTree = repo.write({
      kind: 'tree',
      entries: { HBB: repo.write({ kind: 'blob', sequence: altSeq }) },
    });
    const theirTree = repo.write({
      kind: 'tree',
      entries: { HBB: repo.write({ kind: 'blob', sequence: otherSeq }) },
    });

    repo.branch('ours', base);
    repo.checkout('ours');
    const ours = repo.commit({ tree: ourTree, parents: [base], author: 'a', message: 'x', timestamp: 2 });
    repo.branch('theirs', base);
    repo.checkout('theirs');
    const theirs = repo.commit({ tree: theirTree, parents: [base], author: 'b', message: 'y', timestamp: 3 });

    const result = repo.merge(ours, theirs);
    expect('conflicts' in result).toBe(true);
    if ('conflicts' in result) {
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].gene).toBe('HBB');
      expect(result.conflicts[0].base).not.toBeNull();
      expect(result.conflicts[0].ours).not.toBe(result.conflicts[0].theirs);
    }
  });
});
