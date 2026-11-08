import { describe, it, expect } from 'vitest';
import { Repo, canonicalJson, oidOf, isCleanMerge } from './index';
import type { Oid } from './index';
import type { Sequence } from '../genome';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function failSeed(seed: number, detail: string): never {
  throw new Error(`property failed (seed=${seed}): ${detail}`);
}

function withSeed(seed: number, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('property failed (seed=')) throw err;
    throw new Error(`property failed (seed=${seed}): ${msg}`);
  }
}

function pickIndex(rng: () => number, length: number): number {
  if (length <= 0) throw new Error('pickIndex: empty');
  return Math.floor(rng() * length);
}

function pickOne<T>(rng: () => number, items: readonly T[]): T {
  const item = items[pickIndex(rng, items.length)];
  if (item === undefined) throw new Error('pickOne: missing item');
  return item;
}

function shuffleInPlace<T>(rng: () => number, items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = pickIndex(rng, i + 1);
    const a = items[i];
    const b = items[j];
    if (a === undefined || b === undefined) throw new Error('shuffle: missing item');
    items[i] = b;
    items[j] = a;
  }
}

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

function logOids(repo: Repo, ref?: string): Oid[] {
  return repo.log(ref).map((commit) => oidOf(commit));
}

function ancestors(repo: Repo, start: Oid): Set<Oid> {
  const found = new Set<Oid>();
  const queue: Oid[] = [start];
  while (queue.length > 0) {
    const oid = queue.shift();
    if (oid === undefined || found.has(oid)) continue;
    found.add(oid);
    const obj = repo.read(oid);
    if (obj.kind !== 'commit') {
      throw new Error(`expected commit at ${oid}`);
    }
    for (const parent of obj.parents) queue.push(parent);
  }
  return found;
}

function isBestCommonAncestor(repo: Repo, candidate: Oid, a: Oid, b: Oid): boolean {
  const common = new Set([...ancestors(repo, a)].filter((oid) => ancestors(repo, b).has(oid)));
  if (!common.has(candidate)) return false;
  for (const other of common) {
    if (other === candidate) continue;
    if (ancestors(repo, other).has(candidate) && other !== candidate) {
      return false;
    }
  }
  return true;
}

const UNICODE_KEYS = ['a', 'A', 'α', 'β', '😀', 'n\u0000', '', ' a', 'a ', 'constructor'];

function randomLeaf(rng: () => number): string | number | boolean | null {
  const roll = rng();
  if (roll < 0.15) return null;
  if (roll < 0.3) return rng() < 0.5;
  if (roll < 0.55) {
    const numbers = [0, -0, 1, -1, 3.14159, 1e-8, 1e21, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER];
    return pickOne(rng, numbers);
  }
  const fragments = ['x', 'y', 'café', 'cafe\u0301', '한', '𐍈', '"\\\n', 'a/b'];
  return `${pickOne(rng, fragments)}-${Math.floor(rng() * 8)}`;
}

function randomValue(rng: () => number, depth: number): unknown {
  if (depth <= 0) return randomLeaf(rng);
  const roll = rng();
  if (roll < 0.35) return randomLeaf(rng);
  if (roll < 0.6) {
    const n = pickIndex(rng, 4);
    return Array.from({ length: n }, () => randomValue(rng, depth - 1));
  }
  const obj: Record<string, unknown> = {};
  const nKeys = pickIndex(rng, 5);
  for (let i = 0; i < nKeys; i += 1) {
    const key = rng() < 0.4 ? pickOne(rng, UNICODE_KEYS) : `k${pickIndex(rng, 6)}`;
    if (rng() < 0.12) {
      obj[key] = undefined;
    } else {
      obj[key] = randomValue(rng, depth - 1);
    }
  }
  return obj;
}

function rebuildWithShuffledKeys(rng: () => number, value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rebuildWithShuffledKeys(rng, item));
  }
  if (value === null || typeof value !== 'object') return value;
  const keys = Object.keys(value);
  shuffleInPlace(rng, keys);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[key] = rebuildWithShuffledKeys(rng, (value as Record<string, unknown>)[key]);
  }
  return out;
}

function dropUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropUndefined);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const field = (value as Record<string, unknown>)[key];
    if (field === undefined) continue;
    out[key] = dropUndefined(field);
  }
  return out;
}

describe('property: canonical JSON / oid determinism', () => {
  it('hashes logically identical objects identically regardless of key insertion order', () => {
    const iterations = 120;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x10 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const value = randomValue(rng, 4);
        const shuffled = rebuildWithShuffledKeys(rng, value);
        const a = oidOf(value);
        const b = oidOf(shuffled);
        if (a !== b) {
          failSeed(seed, `oid mismatch ${a} vs ${b} for ${canonicalJson(dropUndefined(value))}`);
        }
        expect(a).toHaveLength(64);
      });
    }
  });

  it('treats null as distinct from an absent field, and omits undefined', () => {
    expect(oidOf({ a: 1, b: null })).not.toBe(oidOf({ a: 1 }));
    expect(oidOf({ a: 1, b: undefined })).toBe(oidOf({ a: 1 }));
    expect(canonicalJson({ b: undefined, a: 1 })).toBe('{"a":1}');
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });

  it('keeps array order, unicode strings, and numeric edge values stable', () => {
    expect(oidOf([1, 2])).not.toBe(oidOf([2, 1]));
    expect(oidOf({ '😀': 'café' })).toBe(oidOf({ '😀': 'café' }));
    expect(oidOf({ x: 'é' })).toBe(oidOf({ x: '\u00e9' }));
    expect(oidOf({ x: 'é' })).not.toBe(oidOf({ x: 'e\u0301' }));
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson(0)).toBe('0');
    expect(canonicalJson(1e21)).toBe('1e+21');
    expect(oidOf({ n: Number.MAX_SAFE_INTEGER })).toBe(oidOf({ n: Number.MAX_SAFE_INTEGER }));
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    expect(() => canonicalJson([undefined])).toThrow(/cannot encode/);
    expect(() => canonicalJson({ k: Number.NEGATIVE_INFINITY })).toThrow(/non-finite/);
  });

  it('does not collide distinct nested payloads', () => {
    const seen = new Map<string, string>();
    const iterations = 80;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x200 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const value = randomValue(rng, 3);
        const json = canonicalJson(value);
        const oid = oidOf(value);
        const prev = seen.get(oid);
        if (prev !== undefined && prev !== json) {
          failSeed(seed, `oid collision ${oid} for ${prev} vs ${json}`);
        }
        seen.set(oid, json);
        expect(oidOf({ a: { b: 1 } })).not.toBe(oidOf({ a: { b: 2 } }));
      });
    }
    expect(oidOf({ ab: 1 })).not.toBe(oidOf({ a: { b: 1 } }));
    expect(oidOf({ a: 1, b: 2 })).not.toBe(oidOf({ a: 12 }));
  });

  it('sorts keys that would collide if insertion order were hashed', () => {
    const a = { z: 1, a: 2, m: { y: 1, x: 2 } };
    const b = { a: 2, m: { x: 2, y: 1 }, z: 1 };
    expect(canonicalJson(a)).toBe('{"a":2,"m":{"x":2,"y":1},"z":1}');
    expect(oidOf(a)).toBe(oidOf(b));
  });
});

describe('property: merge algebra', () => {
  it('a one-sided gene add or delete is taken and never conflicts', () => {
    const iterations = 30;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x360 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const repo = new Repo();
        const root = repo.commit({
          tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('CCC', 's') }),
          author: 'a',
          message: 'root',
          timestamp: 1,
        });
        repo.branch('theirs', root);
        const add = rng() < 0.5;
        const oursTree = add
          ? blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('CCC', 's'), NEW: seq('TTT', 'n') })
          : blobTree(repo, { HBB: seq('AAA', 'h') });
        const ours = repo.commit({
          tree: oursTree,
          author: 'a',
          message: 'ours',
          timestamp: 2,
        });
        repo.checkout('theirs');
        const theirs = repo.commit({
          tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('CCC', 's') }),
          author: 'a',
          message: 'theirs-base',
          timestamp: 3,
          parents: [root],
        });
        repo.checkout('main');
        const result = repo.merge(ours, theirs);
        if (!isCleanMerge(result)) {
          failSeed(seed, `one-sided ${add ? 'add' : 'delete'} conflicted`);
        }
        const mergeCommit = repo.read(result.oid);
        if (mergeCommit.kind !== 'commit') failSeed(seed, 'expected commit');
        const tree = repo.read(mergeCommit.tree);
        if (tree.kind !== 'tree') failSeed(seed, 'expected tree');
        const genes = Object.keys(tree.entries).sort();
        const want = add ? ['HBB', 'NEW', 'SYN'] : ['HBB'];
        if (genes.join(',') !== want.join(',')) {
          failSeed(seed, `genes ${genes.join(',')} want ${want.join(',')}`);
        }
      });
    }
  });

  it('a one-sided gene change always takes that side', () => {
    const iterations = 40;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x300 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const repo = new Repo();
        const genes = ['HBB', 'SYN', 'FOO', 'BAR'];
        const baseSeqs: Record<string, Sequence> = {};
        for (const gene of genes) {
          baseSeqs[gene] = seq('AAA', `${gene}-base`);
        }
        const root = repo.commit({
          tree: blobTree(repo, baseSeqs),
          author: 'a',
          message: 'root',
          timestamp: 1,
        });
        repo.branch('theirs', root);
        const oursSeqs: Record<string, Sequence> = { ...baseSeqs };
        const changed = pickOne(rng, genes);
        oursSeqs[changed] = seq('TTT', `${changed}-ours`);
        const ours = repo.commit({
          tree: blobTree(repo, oursSeqs),
          author: 'a',
          message: 'ours',
          timestamp: 2,
        });
        repo.checkout('theirs');
        const theirs = repo.commit({
          tree: blobTree(repo, baseSeqs),
          author: 'a',
          message: 'theirs-noop',
          timestamp: 3,
          parents: [root],
        });
        repo.checkout('main');
        const result = repo.merge(ours, theirs);
        if (!isCleanMerge(result)) {
          failSeed(seed, `one-sided change conflicted on ${changed}`);
        }
        const mergeCommit = repo.read(result.oid);
        if (mergeCommit.kind !== 'commit') failSeed(seed, 'expected merge commit');
        const tree = repo.read(mergeCommit.tree);
        if (tree.kind !== 'tree') failSeed(seed, 'expected tree');
        const blob = repo.read(tree.entries[changed] ?? '');
        if (!(blob.kind === 'blob' && blob.sequence.bases === 'TTT')) {
          failSeed(seed, `did not take ours for ${changed}`);
        }
        if (repo.head() !== result.oid) {
          failSeed(seed, 'HEAD should move when it points at ours');
        }
      });
    }
  });

  it('a one-sided change on theirs is taken when ours matches the base', () => {
    const repo = new Repo();
    const root = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('CCC', 's') }),
      author: 'a',
      message: 'root',
      timestamp: 1,
    });
    repo.branch('theirs', root);
    const ours = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('CCC', 's') }),
      author: 'a',
      message: 'ours-noop',
      timestamp: 2,
    });
    repo.checkout('theirs');
    const theirs = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('TTT', 's') }),
      author: 'a',
      message: 'theirs',
      timestamp: 3,
      parents: [root],
    });
    repo.checkout('main');
    const result = repo.merge(ours, theirs);
    expect(isCleanMerge(result)).toBe(true);
    if (!isCleanMerge(result)) return;
    const mergeCommit = repo.read(result.oid);
    expect(mergeCommit.kind).toBe('commit');
    if (mergeCommit.kind !== 'commit') return;
    const tree = repo.read(mergeCommit.tree);
    expect(tree.kind).toBe('tree');
    if (tree.kind !== 'tree') return;
    const syn = repo.read(tree.entries.SYN ?? '');
    expect(syn.kind === 'blob' && syn.sequence.bases).toBe('TTT');
  });

  it('an identical both-sides change never conflicts', () => {
    const iterations = 30;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x400 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const repo = new Repo();
        const gene = pickOne(rng, ['HBB', 'SYN']);
        const root = repo.commit({
          tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('CCC', 's') }),
          author: 'a',
          message: 'root',
          timestamp: 1,
        });
        repo.branch('theirs', root);
        const same = seq('GGG', `${gene}-same`);
        const oursSeqs = { HBB: seq('AAA', 'h'), SYN: seq('CCC', 's'), [gene]: same };
        const ours = repo.commit({
          tree: blobTree(repo, oursSeqs),
          author: 'a',
          message: 'ours',
          timestamp: 2,
        });
        repo.checkout('theirs');
        const theirs = repo.commit({
          tree: blobTree(repo, oursSeqs),
          author: 'a',
          message: 'theirs',
          timestamp: 3,
          parents: [root],
        });
        const result = repo.merge(ours, theirs);
        if (!isCleanMerge(result)) {
          failSeed(seed, `identical both-sides change conflicted on ${gene}`);
        }
      });
    }
  });

  it('adding different genes on each side merges cleanly into the union', () => {
    const repo = new Repo();
    const root = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'h') }),
      author: 'a',
      message: 'root',
      timestamp: 1,
    });
    repo.branch('theirs', root);
    const ours = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'h'), FOO: seq('TTT', 'f') }),
      author: 'a',
      message: 'ours',
      timestamp: 2,
    });
    repo.checkout('theirs');
    const theirs = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'h'), BAR: seq('GGG', 'b') }),
      author: 'a',
      message: 'theirs',
      timestamp: 3,
      parents: [root],
    });
    repo.checkout('main');
    const result = repo.merge(ours, theirs);
    expect(isCleanMerge(result)).toBe(true);
    if (!isCleanMerge(result)) return;
    const mergeCommit = repo.read(result.oid);
    expect(mergeCommit.kind).toBe('commit');
    if (mergeCommit.kind !== 'commit') return;
    const tree = repo.read(mergeCommit.tree);
    expect(tree.kind).toBe('tree');
    if (tree.kind !== 'tree') return;
    expect(Object.keys(tree.entries).sort()).toEqual(['BAR', 'FOO', 'HBB']);
  });

  it('a differing both-sides change always conflicts and never mutates HEAD or log', () => {
    const iterations = 40;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x500 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const repo = new Repo();
        const gene = pickOne(rng, ['HBB', 'SYN']);
        const root = repo.commit({
          tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('CCC', 's') }),
          author: 'a',
          message: 'root',
          timestamp: 1,
        });
        repo.branch('theirs', root);
        const oursSeqs = {
          HBB: seq('AAA', 'h'),
          SYN: seq('CCC', 's'),
          [gene]: seq('TTT', `${gene}-ours`),
        };
        const ours = repo.commit({
          tree: blobTree(repo, oursSeqs),
          author: 'a',
          message: 'ours',
          timestamp: 2,
        });
        repo.checkout('theirs');
        const theirsSeqs = {
          HBB: seq('AAA', 'h'),
          SYN: seq('CCC', 's'),
          [gene]: seq('GGG', `${gene}-theirs`),
        };
        const theirs = repo.commit({
          tree: blobTree(repo, theirsSeqs),
          author: 'a',
          message: 'theirs',
          timestamp: 3,
          parents: [root],
        });
        repo.checkout('main');
        const beforeHead = repo.head();
        const beforeLog = logOids(repo).join(',');
        const result = repo.merge(ours, theirs);
        if (isCleanMerge(result)) {
          failSeed(seed, `expected conflict on ${gene}`);
        }
        if (!('conflicts' in result) || result.conflicts.length === 0) {
          failSeed(seed, 'missing conflicts array');
        }
        const hit = result.conflicts.some((c) => c.gene === gene && c.ours !== c.theirs);
        if (!hit) failSeed(seed, `conflict did not name ${gene}`);
        if (repo.head() !== beforeHead) failSeed(seed, 'HEAD mutated on conflict');
        if (logOids(repo).join(',') !== beforeLog) {
          failSeed(seed, 'log mutated on conflict — a merge commit was written');
        }
        if (beforeHead !== ours) failSeed(seed, 'precondition: HEAD should be ours');
      });
    }
  });

  it('HEAD moves only if it currently points at ours (SPEC §4.5 #4)', () => {
    const repo = new Repo();
    const root = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('CCC', 's') }),
      author: 'a',
      message: 'root',
      timestamp: 1,
    });
    repo.branch('theirs', root);
    const ours = repo.commit({
      tree: blobTree(repo, { HBB: seq('TTT', 'h'), SYN: seq('CCC', 's') }),
      author: 'a',
      message: 'ours',
      timestamp: 2,
    });
    repo.checkout('theirs');
    const theirs = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('GGG', 's') }),
      author: 'a',
      message: 'theirs',
      timestamp: 3,
      parents: [root],
    });
    const result = repo.merge(ours, theirs);
    expect(isCleanMerge(result)).toBe(true);
    expect(repo.head()).toBe(theirs);
    repo.checkout('main');
    expect(repo.head()).toBe(ours);
    if (!isCleanMerge(result)) return;
    const again = repo.merge(ours, theirs);
    expect(isCleanMerge(again)).toBe(true);
    if (!isCleanMerge(again)) return;
    expect(again.oid).toBe(result.oid);
    expect(repo.head()).toBe(result.oid);
  });

  it('merge(a, a) is a no-op (SPEC §4.6 #16)', () => {
    // Decided: return the existing oid; do not write a merge commit with
    // parents [a, a]. §4.5 #4's metadata rules apply only to merges that
    // combine two distinct commits.
    const repo = new Repo();
    const oid = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'h') }),
      author: 'a',
      message: 'root',
      timestamp: 1,
    });
    const result = repo.merge(oid, oid);
    expect(isCleanMerge(result)).toBe(true);
    if (!isCleanMerge(result)) return;
    expect(result.oid).toBe(oid);
    expect(repo.head()).toBe(oid);
    expect(repo.log()).toHaveLength(1);
  });
});

describe('property: mergeBase on DAGs', () => {
  function randomDag(seed: number, n: number): { repo: Repo; commits: Oid[] } {
    const rng = mulberry32(seed);
    const repo = new Repo();
    const commits: Oid[] = [];
    const tree = blobTree(repo, { HBB: seq('AAA', 'h') });
    for (let i = 0; i < n; i += 1) {
      let parents: Oid[] = [];
      if (commits.length > 0) {
        const roll = rng();
        if (roll < 0.12) {
          parents = [];
        } else if (roll < 0.65 || commits.length === 1) {
          parents = [pickOne(rng, commits)];
        } else {
          const p1 = pickOne(rng, commits);
          let p2 = pickOne(rng, commits);
          for (let g = 0; g < 6 && p2 === p1; g += 1) p2 = pickOne(rng, commits);
          parents = p1 === p2 ? [p1] : [p1, p2];
        }
      }
      commits.push(
        repo.commit({
          tree,
          author: 'fuzz',
          message: `c${i}`,
          timestamp: i + 1,
          parents,
        }),
      );
    }
    return { repo, commits };
  }

  it('returns a common ancestor, or null iff the histories are disjoint', () => {
    const iterations = 50;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x600 + i;
      withSeed(seed, () => {
        const n = 6 + (seed % 5);
        const { repo, commits } = randomDag(seed, n);
        const rng = mulberry32(seed ^ 0x9e37);
        const a = pickOne(rng, commits);
        const b = pickOne(rng, commits);
        const got = repo.mergeBase(a, b);
        const common = [...ancestors(repo, a)].filter((oid) => ancestors(repo, b).has(oid));
        if (common.length === 0) {
          if (got !== null) failSeed(seed, `unrelated histories returned ${got}`);
          return;
        }
        if (got === null) failSeed(seed, 'shared history returned null');
        if (!common.includes(got)) {
          failSeed(seed, `mergeBase ${got} is not an ancestor of both`);
        }
      });
    }
  });

  it('finds the fork of a diamond and returns null for unrelated roots', () => {
    const repo = new Repo();
    const root = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('CCC', 's') }),
      author: 'a',
      message: 'root',
      timestamp: 1,
    });
    repo.branch('theirs', root);
    const ours = repo.commit({
      tree: blobTree(repo, { HBB: seq('TTT', 'h'), SYN: seq('CCC', 's') }),
      author: 'a',
      message: 'ours',
      timestamp: 2,
    });
    repo.checkout('theirs');
    const theirs = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('GGG', 's') }),
      author: 'a',
      message: 'theirs',
      timestamp: 3,
      parents: [root],
    });
    expect(repo.mergeBase(ours, theirs)).toBe(root);
    const other = new Repo();
    const r1 = other.commit({
      tree: blobTree(other, { HBB: seq('AAA', 'a') }),
      author: 'a',
      message: 'r1',
      timestamp: 1,
      parents: [],
    });
    const r2 = other.commit({
      tree: blobTree(other, { HBB: seq('TTT', 'b') }),
      author: 'a',
      message: 'r2',
      timestamp: 2,
      parents: [],
    });
    expect(other.mergeBase(r1, r2)).toBe(null);
  });

  it('returns a common ancestor on a criss-cross merge (two merge commits sharing both parents)', () => {
    const repo = new Repo();
    const root = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('CCC', 's') }),
      author: 'a',
      message: 'root',
      timestamp: 1,
    });
    repo.branch('c', root);
    const b = repo.commit({
      tree: blobTree(repo, { HBB: seq('TTT', 'h'), SYN: seq('CCC', 's') }),
      author: 'a',
      message: 'B',
      timestamp: 2,
    });
    repo.checkout('c');
    const c = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('GGG', 's') }),
      author: 'a',
      message: 'C',
      timestamp: 3,
      parents: [root],
    });
    repo.checkout('main');
    const mergedBc = repo.merge(b, c);
    expect(isCleanMerge(mergedBc)).toBe(true);
    if (!isCleanMerge(mergedBc)) return;
    repo.checkout('c');
    const mergedCb = repo.merge(c, b);
    expect(isCleanMerge(mergedCb)).toBe(true);
    if (!isCleanMerge(mergedCb)) return;
    const base = repo.mergeBase(mergedBc.oid, mergedCb.oid);
    expect(base).not.toBe(null);
    if (base === null) return;
    expect(ancestors(repo, mergedBc.oid).has(base)).toBe(true);
    expect(ancestors(repo, mergedCb.oid).has(base)).toBe(true);
  });

  it('returns a best common ancestor and is symmetric (SPEC §4.6 #17)', () => {
    // BFS-from-b used to return W (dominated) for mergeBase(A, B) because B
    // lists W as its first parent, and disagreed with mergeBase(B, A).
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
    expect(repo.mergeBase(a, b)).toBe(repo.mergeBase(b, a));
    expect(isBestCommonAncestor(repo, m, a, b)).toBe(true);
    expect(isBestCommonAncestor(repo, w, a, b)).toBe(false);
  });

  it('is symmetric and never returns a dominated ancestor on random DAGs, including criss-cross', () => {
    const iterations = 40;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x610 + i;
      withSeed(seed, () => {
        const n = 8 + (seed % 5);
        const { repo, commits } = randomDag(seed, n);
        const rng = mulberry32(seed ^ 0x51ed);
        for (let p = 0; p < 4; p += 1) {
          const a = pickOne(rng, commits);
          const b = pickOne(rng, commits);
          const forward = repo.mergeBase(a, b);
          const reverse = repo.mergeBase(b, a);
          if (forward !== reverse) {
            failSeed(seed, `mergeBase not symmetric: ${forward} vs ${reverse}`);
          }
          const common = [...ancestors(repo, a)].filter((oid) => ancestors(repo, b).has(oid));
          if (common.length === 0) {
            if (forward !== null) failSeed(seed, `unrelated histories returned ${forward}`);
            continue;
          }
          if (forward === null) failSeed(seed, 'shared history returned null');
          if (!isBestCommonAncestor(repo, forward, a, b)) {
            failSeed(seed, `mergeBase ${forward} is dominated`);
          }
          const bcas = common.filter((oid) => isBestCommonAncestor(repo, oid, a, b));
          bcas.sort();
          const want = bcas[0];
          if (forward !== want) {
            failSeed(seed, `mergeBase ${forward} is not lowest-oid BCA ${want ?? 'none'}`);
          }
        }
      });
    }
  });

  it('picks the lowest oid among equally-good common ancestors on a criss-cross merge', () => {
    const repo = new Repo();
    const root = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('CCC', 's') }),
      author: 'a',
      message: 'root',
      timestamp: 1,
    });
    repo.branch('c', root);
    const b = repo.commit({
      tree: blobTree(repo, { HBB: seq('TTT', 'h'), SYN: seq('CCC', 's') }),
      author: 'a',
      message: 'B',
      timestamp: 2,
    });
    repo.checkout('c');
    const c = repo.commit({
      tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('GGG', 's') }),
      author: 'a',
      message: 'C',
      timestamp: 3,
      parents: [root],
    });
    repo.checkout('main');
    const mergedBc = repo.merge(b, c);
    expect(isCleanMerge(mergedBc)).toBe(true);
    if (!isCleanMerge(mergedBc)) return;
    repo.checkout('c');
    const mergedCb = repo.merge(c, b);
    expect(isCleanMerge(mergedCb)).toBe(true);
    if (!isCleanMerge(mergedCb)) return;
    const forward = repo.mergeBase(mergedBc.oid, mergedCb.oid);
    const reverse = repo.mergeBase(mergedCb.oid, mergedBc.oid);
    expect(forward).toBe(reverse);
    expect(forward).not.toBe(null);
    if (forward === null) return;
    expect(isBestCommonAncestor(repo, forward, mergedBc.oid, mergedCb.oid)).toBe(true);
    const common = [...ancestors(repo, mergedBc.oid)].filter((oid) =>
      ancestors(repo, mergedCb.oid).has(oid),
    );
    const bcas = common.filter((oid) =>
      isBestCommonAncestor(repo, oid, mergedBc.oid, mergedCb.oid),
    );
    bcas.sort();
    expect(forward).toBe(bcas[0]);
    expect(bcas.length).toBeGreaterThanOrEqual(2);
  });
});

describe('property: log termination and completeness', () => {
  it('terminates, does not revisit, and includes every reachable commit on random DAGs', () => {
    const iterations = 40;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x700 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const n = 5 + pickIndex(rng, 7);
        const repo = new Repo();
        const commits: Oid[] = [];
        const tree = blobTree(repo, { HBB: seq('AAA', 'h') });
        for (let k = 0; k < n; k += 1) {
          let parents: Oid[] = [];
          if (commits.length > 0) {
            if (rng() < 0.2) parents = [];
            else if (rng() < 0.7 || commits.length === 1) parents = [pickOne(rng, commits)];
            else {
              const p1 = pickOne(rng, commits);
              let p2 = pickOne(rng, commits);
              if (p2 === p1 && commits.length > 1) {
                p2 = pickOne(rng, commits.filter((c) => c !== p1));
              }
              parents = p1 === p2 ? [p1] : [p1, p2];
            }
          }
          commits.push(
            repo.commit({
              tree,
              author: 'fuzz',
              message: `c${k}`,
              timestamp: k + 1,
              parents,
            }),
          );
        }
        const start = pickOne(rng, commits);
        const got = logOids(repo, start);
        if (got.length > n) failSeed(seed, `log longer than DAG (${got.length} > ${n})`);
        if (new Set(got).size !== got.length) {
          failSeed(seed, 'log revisited an oid');
        }
        const want = ancestors(repo, start);
        if (got.length !== want.size) {
          failSeed(seed, `log size ${got.length} !== reachable ${want.size}`);
        }
        for (const oid of got) {
          if (!want.has(oid)) failSeed(seed, `log contains unreachable ${oid}`);
        }
      });
    }
  });
});

describe('property: merge commit determinism (SPEC §4.5 #4)', () => {
  it('the same merge performed twice, including in a fresh Repo, yields the same oid', () => {
    const iterations = 25;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x800 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const oursBases = pickOne(rng, ['TTT', 'AAA']);
        const theirsBases = pickOne(rng, ['GGG', 'CCC']);
        const run = (): Oid => {
          const repo = new Repo();
          const root = repo.commit({
            tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq('CCC', 's') }),
            author: 'a',
            message: 'root',
            timestamp: 10,
          });
          repo.branch('theirs', root);
          const ours = repo.commit({
            tree: blobTree(repo, { HBB: seq(oursBases, 'h'), SYN: seq('CCC', 's') }),
            author: 'a',
            message: 'ours',
            timestamp: 20,
          });
          repo.checkout('theirs');
          const theirs = repo.commit({
            tree: blobTree(repo, { HBB: seq('AAA', 'h'), SYN: seq(theirsBases, 's') }),
            author: 'a',
            message: 'theirs',
            timestamp: 30,
            parents: [root],
          });
          repo.checkout('main');
          const first = repo.merge(ours, theirs);
          const second = repo.merge(ours, theirs);
          if (!isCleanMerge(first) || !isCleanMerge(second)) {
            failSeed(seed, 'expected a clean merge');
          }
          if (first.oid !== second.oid) {
            failSeed(seed, 'second merge in the same repo produced a different oid');
          }
          const mergeCommit = repo.read(first.oid);
          if (mergeCommit.kind !== 'commit') failSeed(seed, 'expected commit');
          if (mergeCommit.parents[0] !== ours || mergeCommit.parents[1] !== theirs) {
            failSeed(seed, 'parents are not [ours, theirs]');
          }
          if (mergeCommit.author !== 'sigmafold-merge') {
            failSeed(seed, `author ${mergeCommit.author}`);
          }
          if (mergeCommit.timestamp !== 31) {
            failSeed(seed, `timestamp ${mergeCommit.timestamp} want max+1=31`);
          }
          return first.oid;
        };
        const a = run();
        const b = run();
        if (a !== b) failSeed(seed, 'fresh Repo produced a different merge oid');
      });
    }
  });
});
