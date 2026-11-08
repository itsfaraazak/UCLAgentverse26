// TEMP STUB — replaced at integration. Signatures must match SPEC.md §4.
//
// SPEC.md §4.2 `lib/vcs` — git for genomes. Content-addressed:
// `oid = sha256(canonicalJson(object))`, hex, first 12 chars shown in the UI.
//
// Ambiguities in SPEC §4.2, resolved by the most literal reading and flagged
// in the final report:
//   * `MergeConflict` is referenced but never defined. Defined here as the
//     per-gene three-way tuple the merge rules imply.
//   * `commit(opts)` leaves `opts` unspecified. Taken literally as the Commit
//     record minus its `kind` tag, with `parents` defaulting to the current
//     HEAD so the common case reads naturally.
//   * `write(obj)` / `read(oid)` parameter types are elided in the spec; they
//     are the Blob | Tree | Commit union.
//
// Node's crypto is used for sha256, so this module is server/Node only by
// construction — the UI reads repository state through a server component.

import { createHash } from 'node:crypto';

import type { Sequence, Variant } from '@/lib/genome';

export type Oid = string;

export interface Blob {
  kind: 'blob';
  sequence: Sequence;
}

/** A genotype: gene symbol → blob oid. */
export interface Tree {
  kind: 'tree';
  entries: Record<string, Oid>;
}

export interface Commit {
  kind: 'commit';
  tree: Oid;
  parents: Oid[]; // 0 = root, 1 = normal, 2 = merge
  author: string;
  message: string;
  timestamp: number;
  edit?: Variant; // the edit this commit introduces, if any
  checkRunId?: string; // link to the CI result
}

export type GitObject = Blob | Tree | Commit;

/** A gene changed differently on both sides of a three-way merge. */
export interface MergeConflict {
  gene: string;
  /** Blob oid at the merge base, or null if the gene is new on both sides. */
  base: Oid | null;
  ours: Oid | null;
  theirs: Oid | null;
}

export interface CommitOptions {
  tree: Oid;
  parents?: Oid[];
  author: string;
  message: string;
  timestamp: number;
  edit?: Variant;
  checkRunId?: string;
}

export type MergeResult = { oid: Oid } | { conflicts: MergeConflict[] };

/** Short form shown in the UI. */
export function shortOid(oid: Oid): string {
  return oid.slice(0, 12);
}

/**
 * Deterministic JSON with keys sorted at every level, so the same logical
 * object always hashes to the same oid across runs and across machines.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
}

export function oidOf(obj: GitObject): Oid {
  return createHash('sha256').update(canonicalJson(obj), 'utf8').digest('hex');
}

export class Repo {
  private readonly objects = new Map<Oid, GitObject>();
  private readonly refs = new Map<string, Oid>();
  private currentBranch: string | null = null;

  write(obj: GitObject): Oid {
    const oid = oidOf(obj);
    if (!this.objects.has(oid)) this.objects.set(oid, obj);
    return oid;
  }

  read(oid: Oid): GitObject {
    const obj = this.objects.get(oid);
    if (obj === undefined) throw new Error(`unknown object ${shortOid(oid)}`);
    return obj;
  }

  readBlob(oid: Oid): Blob {
    const obj = this.read(oid);
    if (obj.kind !== 'blob') throw new Error(`${shortOid(oid)} is not a blob`);
    return obj;
  }

  readTree(oid: Oid): Tree {
    const obj = this.read(oid);
    if (obj.kind !== 'tree') throw new Error(`${shortOid(oid)} is not a tree`);
    return obj;
  }

  readCommit(oid: Oid): Commit {
    const obj = this.read(oid);
    if (obj.kind !== 'commit') throw new Error(`${shortOid(oid)} is not a commit`);
    return obj;
  }

  commit(opts: CommitOptions): Oid {
    const head = this.currentBranch === null ? undefined : this.refs.get(this.currentBranch);
    const parents = opts.parents ?? (head === undefined ? [] : [head]);
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
    if (this.currentBranch !== null) this.refs.set(this.currentBranch, oid);
    return oid;
  }

  branch(name: string, at?: Oid): void {
    const target = at ?? (this.currentBranch === null ? undefined : this.refs.get(this.currentBranch));
    if (target === undefined) {
      // A branch with no commit yet: record the name so `branches()` is honest.
      this.refs.set(name, '');
      if (this.currentBranch === null) this.currentBranch = name;
      return;
    }
    this.refs.set(name, target);
  }

  checkout(name: string): void {
    if (!this.refs.has(name)) throw new Error(`no such branch: ${name}`);
    this.currentBranch = name;
  }

  branches(): string[] {
    return [...this.refs.keys()].sort();
  }

  /** The branch HEAD currently points at, or null before the first checkout. */
  currentBranchName(): string | null {
    return this.currentBranch;
  }

  head(): Oid {
    if (this.currentBranch === null) throw new Error('no branch checked out');
    const oid = this.refs.get(this.currentBranch);
    if (oid === undefined || oid === '') throw new Error(`branch ${this.currentBranch} has no commits`);
    return oid;
  }

  resolve(ref: string): Oid | null {
    const byName = this.refs.get(ref);
    if (byName !== undefined && byName !== '') return byName;
    return this.objects.has(ref) ? ref : null;
  }

  /** First-parent-first topological walk, newest first. */
  log(ref?: string): Commit[] {
    const start = ref === undefined ? this.head() : this.resolve(ref);
    if (start === null) return [];
    const seen = new Set<Oid>();
    const out: Commit[] = [];
    const queue: Oid[] = [start];
    while (queue.length > 0) {
      const oid = queue.shift();
      if (oid === undefined || seen.has(oid)) continue;
      seen.add(oid);
      const commit = this.readCommit(oid);
      out.push(commit);
      queue.push(...commit.parents);
    }
    return out.sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Oid for each commit returned by `log`, in the same order. */
  logOids(ref?: string): Oid[] {
    return this.log(ref).map((c) => oidOf(c));
  }

  private ancestors(oid: Oid): Set<Oid> {
    const seen = new Set<Oid>();
    const queue: Oid[] = [oid];
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined || seen.has(next)) continue;
      seen.add(next);
      queue.push(...this.readCommit(next).parents);
    }
    return seen;
  }

  mergeBase(a: Oid, b: Oid): Oid | null {
    const ancestorsOfA = this.ancestors(a);
    // Breadth-first from b: the first commit also reachable from a is the
    // lowest common ancestor for the shapes this prototype builds.
    const seen = new Set<Oid>();
    const queue: Oid[] = [b];
    while (queue.length > 0) {
      const oid = queue.shift();
      if (oid === undefined || seen.has(oid)) continue;
      seen.add(oid);
      if (ancestorsOfA.has(oid)) return oid;
      queue.push(...this.readCommit(oid).parents);
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
    const baseOid = this.mergeBase(ours, theirs);
    const ourTree = this.readTree(this.readCommit(ours).tree);
    const theirTree = this.readTree(this.readCommit(theirs).tree);
    const baseTree = baseOid === null ? { kind: 'tree' as const, entries: {} } : this.readTree(this.readCommit(baseOid).tree);

    const genes = [
      ...new Set([
        ...Object.keys(baseTree.entries),
        ...Object.keys(ourTree.entries),
        ...Object.keys(theirTree.entries),
      ]),
    ].sort();

    const merged: Record<string, Oid> = {};
    const conflicts: MergeConflict[] = [];

    for (const gene of genes) {
      const base = baseTree.entries[gene] ?? null;
      const mine = ourTree.entries[gene] ?? null;
      const yours = theirTree.entries[gene] ?? null;

      if (mine === yours) {
        if (mine !== null) merged[gene] = mine;
        continue;
      }
      if (mine === base) {
        if (yours !== null) merged[gene] = yours;
        continue;
      }
      if (yours === base) {
        if (mine !== null) merged[gene] = mine;
        continue;
      }
      conflicts.push({ gene, base, ours: mine, theirs: yours });
    }

    if (conflicts.length > 0) return { conflicts };

    const treeOid = this.write({ kind: 'tree', entries: merged });
    return { oid: treeOid };
  }
}
