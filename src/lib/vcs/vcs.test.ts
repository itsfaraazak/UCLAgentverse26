import { describe, expect, it } from 'vitest';
import { Repo, canonicalJson, oidOf, shortOid, type Oid } from './index';

const SEQ = { bases: 'ATGGTGCATCTG', label: 'HbA (reference allele)' };
const ALT = { bases: 'ATGGTGCATCTC', label: 'variant' };
const OTHER = { bases: 'ATGGTGCATCTA', label: 'other variant' };

function seeded(): { repo: Repo; root: Oid } {
  const repo = new Repo();
  const blob = repo.write({ kind: 'blob', sequence: SEQ });
  const tree = repo.write({ kind: 'tree', entries: { HBB: blob } });
  const root = repo.commit({ tree, parents: [], author: 'a', message: 'root', timestamp: 1 });
  return { repo, root };
}

describe('content addressing', () => {
  it('canonical json sorts keys so hashing is stable', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('the same object yields the same oid across runs and repos', () => {
    const a = oidOf({ kind: 'blob', sequence: SEQ });
    const b = oidOf({ kind: 'blob', sequence: { label: SEQ.label, bases: SEQ.bases } });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different content yields a different oid', () => {
    expect(oidOf({ kind: 'blob', sequence: SEQ })).not.toBe(
      oidOf({ kind: 'blob', sequence: ALT }),
    );
  });

  it('shows the first twelve characters in the UI form', () => {
    expect(shortOid('a'.repeat(64))).toHaveLength(12);
  });
});

describe('branches and log', () => {
  it('records branches and reads back commits', () => {
    const { repo, root } = seeded();
    repo.branch('feature', root);
    repo.checkout('feature');
    const blob = repo.write({ kind: 'blob', sequence: ALT });
    const tree = repo.write({ kind: 'tree', entries: { HBB: blob } });
    const tip = repo.commit({ tree, author: 'a', message: 'edit', timestamp: 2 });

    expect(repo.branches()).toEqual(['feature', 'main']);
    expect(repo.head()).toBe(tip);
    expect(repo.log('feature').map((c) => c.message)).toEqual(['edit', 'root']);
    const commit = repo.read(tip);
    expect(commit.kind).toBe('commit');
  });

  it('finds the merge base of two branches', () => {
    const { repo, root } = seeded();
    repo.branch('ours', root);
    repo.branch('theirs', root);

    repo.checkout('ours');
    const ourBlob = repo.write({ kind: 'blob', sequence: ALT });
    const ourTree = repo.write({ kind: 'tree', entries: { HBB: ourBlob } });
    const ours = repo.commit({ tree: ourTree, author: 'a', message: 'ours', timestamp: 2 });

    repo.checkout('theirs');
    const theirBlob = repo.write({ kind: 'blob', sequence: OTHER });
    const theirTree = repo.write({ kind: 'tree', entries: { HBB: theirBlob } });
    const theirs = repo.commit({ tree: theirTree, author: 'b', message: 'theirs', timestamp: 3 });

    expect(repo.mergeBase(ours, theirs)).toBe(root);
  });
});

describe('three-way merge', () => {
  it('takes the side that changed when only one side changed', () => {
    const { repo, root } = seeded();
    repo.branch('theirs', root);
    repo.checkout('theirs');
    const blob = repo.write({ kind: 'blob', sequence: ALT });
    const tree = repo.write({ kind: 'tree', entries: { HBB: blob } });
    const theirs = repo.commit({ tree, author: 'b', message: 'theirs', timestamp: 2 });

    repo.checkout('main');
    const result = repo.merge(root, theirs);
    expect('oid' in result).toBe(true);
    if ('oid' in result) {
      const merged = repo.read(result.oid);
      expect(merged.kind).toBe('commit');
      if (merged.kind === 'commit') {
        const mergedTree = repo.read(merged.tree);
        expect(mergedTree.kind).toBe('tree');
        if (mergedTree.kind === 'tree') expect(mergedTree.entries.HBB).toBe(blob);
        expect(merged.parents).toHaveLength(2);
      }
    }
  });

  it('takes the shared result when both sides changed identically', () => {
    const { repo, root } = seeded();
    const blob = repo.write({ kind: 'blob', sequence: ALT });
    const tree = repo.write({ kind: 'tree', entries: { HBB: blob } });

    repo.branch('ours', root);
    repo.checkout('ours');
    const ours = repo.commit({ tree, author: 'a', message: 'ours', timestamp: 2 });
    repo.branch('theirs', root);
    repo.checkout('theirs');
    const theirs = repo.commit({ tree, author: 'b', message: 'theirs', timestamp: 3 });

    const result = repo.merge(ours, theirs);
    expect('oid' in result).toBe(true);
  });

  it('reports a conflict when both sides changed differently and does not auto-resolve', () => {
    const { repo, root } = seeded();

    repo.branch('ours', root);
    repo.checkout('ours');
    const ourBlob = repo.write({ kind: 'blob', sequence: ALT });
    const ourTree = repo.write({ kind: 'tree', entries: { HBB: ourBlob } });
    const ours = repo.commit({ tree: ourTree, author: 'a', message: 'ours', timestamp: 2 });

    repo.branch('theirs', root);
    repo.checkout('theirs');
    const theirBlob = repo.write({ kind: 'blob', sequence: OTHER });
    const theirTree = repo.write({ kind: 'tree', entries: { HBB: theirBlob } });
    const theirs = repo.commit({ tree: theirTree, author: 'b', message: 'theirs', timestamp: 3 });

    const result = repo.merge(ours, theirs);
    expect('conflicts' in result).toBe(true);
    if ('conflicts' in result) {
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].gene).toBe('HBB');
      expect(result.conflicts[0].ours).toBe(ourBlob);
      expect(result.conflicts[0].theirs).toBe(theirBlob);
    }
  });
});
