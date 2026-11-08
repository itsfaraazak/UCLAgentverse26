// TEMP STUB — replaced at integration. Signatures must match SPEC.md §4.
//
// Content-addressed object store + three-way merge, per SPEC §4.2.
// `oid = sha256(canonicalJson(object))`, hex; the UI shows the first 12 chars.
// Keys are sorted before hashing so the same inputs yield the same oids across
// runs. Pure and framework-free, but it uses `node:crypto`, so callers must
// stay on the server (see src/app/page.tsx and src/app/actions.ts).

import { createHash } from 'node:crypto';
import type { Sequence, Variant } from '@/lib/genome';

export type Oid = string;

export interface Blob {
  readonly kind: 'blob';
  readonly sequence: Sequence;
}

/** A genotype: gene symbol → blob oid. */
export interface Tree {
  readonly kind: 'tree';
  readonly entries: Record<string, Oid>;
}

export interface Commit {
  readonly kind: 'commit';
  readonly tree: Oid;
  readonly parents: Oid[];
  readonly author: string;
  readonly message: string;
  readonly timestamp: number;
  readonly edit?: Variant;
  readonly checkRunId?: string;
}

export type GitObject = Blob | Tree | Commit;

export interface MergeConflict {
  readonly gene: string;
  readonly base: Oid | null;
  readonly ours: Oid | null;
  readonly theirs: Oid | null;
}

export type MergeResult = { readonly oid: Oid } | { readonly conflicts: MergeConflict[] };

/** Narrowing helper for `merge()`'s union return. */
export function isCleanMerge(result: MergeResult): result is { readonly oid: Oid } {
  return 'oid' in result;
}

export interface CommitOptions {
  readonly tree: Oid;
  readonly author: string;
  readonly message: string;
  readonly timestamp: number;
  readonly parents?: readonly Oid[];
  readonly edit?: Variant;
  readonly checkRunId?: string;
}

/** Recursively key-sorted JSON with no incidental whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error('canonicalJson: non-finite numbers cannot be hashed');
      }
      return JSON.stringify(value);
    case 'object': {
      const record = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const field = record[key];
        if (field === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${canonicalJson(field)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new Error(`canonicalJson: cannot encode ${typeof value}`);
  }
}

export function oidOf(value: unknown): Oid {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** Short form shown in the UI. */
export function shortOid(oid: Oid): string {
  return oid.slice(0, 12);
}

function pickThreeWay(
  base: Oid | null,
  ours: Oid | null,
  theirs: Oid | null,
): Oid | null | 'conflict' {
  if (ours === theirs) return ours; // identical change on both sides, or untouched
  if (ours === base) return theirs; // changed on their side only
  if (theirs === base) return ours; // changed on our side only
  return 'conflict'; // changed differently on both sides
}

export class Repo {
  private readonly objects = new Map<Oid, GitObject>();
  private readonly refs = new Map<string, Oid>();
  private current = 'main';

  write(obj: GitObject): Oid {
    const json = canonicalJson(obj);
    const oid = createHash('sha256').update(json, 'utf8').digest('hex');
    if (!this.objects.has(oid)) {
      this.objects.set(oid, JSON.parse(json) as GitObject);
    }
    return oid;
  }

  read(oid: Oid): Blob | Tree | Commit {
    const obj = this.objects.get(oid);
    if (obj === undefined) throw new Error(`unknown object ${oid}`);
    return obj;
  }

  commit(opts: CommitOptions): Oid {
    this.requireTree(opts.tree);
    const parents =
      opts.parents === undefined
        ? (() => {
            const tip = this.refs.get(this.current);
            return tip === undefined ? [] : [tip];
          })()
        : [...opts.parents];
    for (const parent of parents) this.requireCommit(parent);

    const commit: Commit = {
      kind: 'commit',
      tree: opts.tree,
      parents,
      author: opts.author,
      message: opts.message,
      timestamp: opts.timestamp,
      ...(opts.edit === undefined ? {} : { edit: opts.edit }),
      ...(opts.checkRunId === undefined ? {} : { checkRunId: opts.checkRunId }),
    };
    const oid = this.write(commit);
    this.refs.set(this.current, oid);
    return oid;
  }

  branch(name: string, at?: Oid): void {
    if (name.length === 0) throw new Error('branch name must be non-empty');
    const target = at === undefined ? this.head() : at;
    this.requireCommit(target);
    this.refs.set(name, target);
  }

  checkout(name: string): void {
    if (!this.refs.has(name)) throw new Error(`unknown branch ${name}`);
    this.current = name;
  }

  branches(): string[] {
    return [...this.refs.keys()].sort();
  }

  head(): Oid {
    const oid = this.refs.get(this.current);
    if (oid === undefined) throw new Error(`branch '${this.current}' has no commits`);
    return oid;
  }

  /**
   * Reachable commits, newest first. Ordering is deterministic: timestamp
   * descending, ties broken by oid so repeated runs agree.
   */
  log(ref?: string): Commit[] {
    const start = this.resolve(ref);
    const seen = new Set<Oid>();
    const found: Array<{ oid: Oid; commit: Commit }> = [];
    const queue: Oid[] = [start];
    while (queue.length > 0) {
      const oid = queue.shift();
      if (oid === undefined || seen.has(oid)) continue;
      seen.add(oid);
      const commit = this.requireCommit(oid);
      found.push({ oid, commit });
      for (const parent of commit.parents) {
        if (!seen.has(parent)) queue.push(parent);
      }
    }
    found.sort(
      (a, b) => b.commit.timestamp - a.commit.timestamp || a.oid.localeCompare(b.oid),
    );
    return found.map((entry) => entry.commit);
  }

  mergeBase(a: Oid, b: Oid): Oid | null {
    this.requireCommit(a);
    this.requireCommit(b);
    const ancestorsOfA = this.ancestors(a);
    // Breadth-first from b so the first hit is the nearest common ancestor.
    const seen = new Set<Oid>();
    const queue: Oid[] = [b];
    while (queue.length > 0) {
      const oid = queue.shift();
      if (oid === undefined || seen.has(oid)) continue;
      seen.add(oid);
      if (ancestorsOfA.has(oid)) return oid;
      for (const parent of this.requireCommit(oid).parents) queue.push(parent);
    }
    return null;
  }

  /**
   * Three-way merge of genotype trees. Per gene:
   *  - changed on one side only        → take that side
   *  - changed identically on both     → take it
   *  - changed differently on both     → CONFLICT, do not auto-resolve
   */
  merge(ours: Oid, theirs: Oid): MergeResult {
    const oursCommit = this.requireCommit(ours);
    const theirsCommit = this.requireCommit(theirs);
    const baseOid = this.mergeBase(ours, theirs);
    const baseTree: Tree =
      baseOid === null
        ? { kind: 'tree', entries: {} }
        : this.requireTree(this.requireCommit(baseOid).tree);
    const oursTree = this.requireTree(oursCommit.tree);
    const theirsTree = this.requireTree(theirsCommit.tree);

    const genes = new Set<string>([
      ...Object.keys(baseTree.entries),
      ...Object.keys(oursTree.entries),
      ...Object.keys(theirsTree.entries),
    ]);

    const entries: Record<string, Oid> = {};
    const conflicts: MergeConflict[] = [];

    for (const gene of [...genes].sort()) {
      const base = baseTree.entries[gene] ?? null;
      const ourSide = oursTree.entries[gene] ?? null;
      const theirSide = theirsTree.entries[gene] ?? null;
      const picked = pickThreeWay(base, ourSide, theirSide);
      if (picked === 'conflict') {
        conflicts.push({ gene, base, ours: ourSide, theirs: theirSide });
        continue;
      }
      if (picked !== null) entries[gene] = picked;
    }

    if (conflicts.length > 0) return { conflicts };

    const treeOid = this.write({ kind: 'tree', entries });
    const mergeCommit: Commit = {
      kind: 'commit',
      tree: treeOid,
      parents: [ours, theirs],
      author: 'sigmafold-merge',
      message: `Merge ${shortOid(theirs)} into ${shortOid(ours)}`,
      // Deterministic: derived from the parents, never from the wall clock.
      timestamp: Math.max(oursCommit.timestamp, theirsCommit.timestamp) + 1000,
    };
    const oid = this.write(mergeCommit);
    if (this.refs.get(this.current) === ours) this.refs.set(this.current, oid);
    return { oid };
  }

  private resolve(ref?: string): Oid {
    if (ref === undefined) return this.head();
    const byBranch = this.refs.get(ref);
    if (byBranch !== undefined) return byBranch;
    if (this.objects.has(ref)) return ref;
    throw new Error(`unknown ref ${ref}`);
  }

  private ancestors(oid: Oid): Set<Oid> {
    const found = new Set<Oid>();
    const queue: Oid[] = [oid];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || found.has(current)) continue;
      found.add(current);
      for (const parent of this.requireCommit(current).parents) queue.push(parent);
    }
    return found;
  }

  private requireCommit(oid: Oid): Commit {
    const obj = this.read(oid);
    if (obj.kind !== 'commit') throw new Error(`expected commit at ${oid}, got ${obj.kind}`);
    return obj;
  }

  private requireTree(oid: Oid): Tree {
    const obj = this.read(oid);
    if (obj.kind !== 'tree') throw new Error(`expected tree at ${oid}, got ${obj.kind}`);
    return obj;
  }
}
