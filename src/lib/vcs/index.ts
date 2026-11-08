// TEMP STUB — replaced at integration. Signatures must match SPEC.md §4.

import { createHash } from 'node:crypto';
import type { Sequence } from '@/lib/genome';
import type { Variant } from '@/lib/genome';

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
  parents: Oid[];
  author: string;
  message: string;
  timestamp: number;
  edit?: Variant;
  checkRunId?: string;
}

export type GitObject = Blob | Tree | Commit;

export interface MergeConflict {
  gene: string;
  base: Oid | null;
  ours: Oid;
  theirs: Oid;
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

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(',')}}`;
}

export function canonicalJson(value: unknown): string {
  return canonical(value);
}

export function oidOf(obj: GitObject): Oid {
  return createHash('sha256').update(canonicalJson(obj), 'utf8').digest('hex');
}

export class Repo {
  private readonly objects = new Map<Oid, GitObject>();
  private readonly refs = new Map<string, Oid>();
  private current = 'main';

  write(obj: GitObject): Oid {
    const oid = oidOf(obj);
    if (!this.objects.has(oid)) this.objects.set(oid, obj);
    return oid;
  }

  read(oid: Oid): GitObject {
    const obj = this.objects.get(oid);
    if (obj === undefined) throw new Error(`unknown object: ${oid}`);
    return obj;
  }

  commit(opts: CommitOptions): Oid {
    const parents = opts.parents ?? (this.refs.has(this.current) ? [this.headOrThrow()] : []);
    const commit: Commit = {
      kind: 'commit',
      tree: opts.tree,
      parents,
      author: opts.author,
      message: opts.message,
      timestamp: opts.timestamp,
      ...(opts.edit ? { edit: opts.edit } : {}),
      ...(opts.checkRunId ? { checkRunId: opts.checkRunId } : {}),
    };
    const oid = this.write(commit);
    this.refs.set(this.current, oid);
    return oid;
  }

  branch(name: string, at?: Oid): void {
    const target = at ?? this.headOrThrow();
    this.refs.set(name, target);
  }

  checkout(name: string): void {
    if (!this.refs.has(name)) throw new Error(`unknown branch: ${name}`);
    this.current = name;
  }

  currentBranch(): string {
    return this.current;
  }

  branches(): string[] {
    return [...this.refs.keys()].sort();
  }

  head(): Oid {
    return this.headOrThrow();
  }

  resolve(ref: string): Oid | null {
    return this.refs.get(ref) ?? (this.objects.has(ref) ? ref : null);
  }

  log(ref?: string): Commit[] {
    const start = ref === undefined ? this.headOrThrow() : this.resolve(ref);
    if (start === null) return [];
    const out: Commit[] = [];
    const seen = new Set<Oid>();
    const stack: Oid[] = [start];
    while (stack.length > 0) {
      const oid = stack.pop();
      if (oid === undefined || seen.has(oid)) continue;
      seen.add(oid);
      const obj = this.objects.get(oid);
      if (obj === undefined || obj.kind !== 'commit') continue;
      out.push(obj);
      for (const p of obj.parents) stack.push(p);
    }
    return out.sort((a, b) => b.timestamp - a.timestamp);
  }

  mergeBase(a: Oid, b: Oid): Oid | null {
    const ancestors = (oid: Oid): Set<Oid> => {
      const set = new Set<Oid>();
      const stack = [oid];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (cur === undefined || set.has(cur)) continue;
        set.add(cur);
        const obj = this.objects.get(cur);
        if (obj !== undefined && obj.kind === 'commit') stack.push(...obj.parents);
      }
      return set;
    };
    const aAnc = ancestors(a);
    const bAnc = [...ancestors(b)];
    const shared = bAnc.filter((oid) => aAnc.has(oid));
    if (shared.length === 0) return null;
    let best: Oid | null = null;
    let bestTime = -Infinity;
    for (const oid of shared) {
      const obj = this.objects.get(oid);
      if (obj === undefined || obj.kind !== 'commit') continue;
      if (obj.timestamp > bestTime) {
        bestTime = obj.timestamp;
        best = oid;
      }
    }
    return best;
  }

  merge(ours: Oid, theirs: Oid): { oid: Oid } | { conflicts: MergeConflict[] } {
    const base = this.mergeBase(ours, theirs);
    const treeOf = (oid: Oid): Record<string, Oid> => {
      const commit = this.objects.get(oid);
      if (commit === undefined || commit.kind !== 'commit') return {};
      const tree = this.objects.get(commit.tree);
      if (tree === undefined || tree.kind !== 'tree') return {};
      return tree.entries;
    };
    const baseTree = base === null ? {} : treeOf(base);
    const ourTree = treeOf(ours);
    const theirTree = treeOf(theirs);

    const genes = [...new Set([...Object.keys(ourTree), ...Object.keys(theirTree)])].sort();
    const merged: Record<string, Oid> = {};
    const conflicts: MergeConflict[] = [];

    for (const gene of genes) {
      const b = baseTree[gene];
      const o = ourTree[gene];
      const t = theirTree[gene];
      if (o === t) {
        if (o !== undefined) merged[gene] = o;
        continue;
      }
      if (o === undefined) {
        if (t !== undefined) merged[gene] = t;
        continue;
      }
      if (t === undefined) {
        merged[gene] = o;
        continue;
      }
      if (o === b) merged[gene] = t;
      else if (t === b) merged[gene] = o;
      else conflicts.push({ gene, base: b ?? null, ours: o, theirs: t });
    }

    if (conflicts.length > 0) return { conflicts };

    const treeOid = this.write({ kind: 'tree', entries: merged });
    const ourCommit = this.objects.get(ours);
    const timestamp =
      ourCommit !== undefined && ourCommit.kind === 'commit' ? ourCommit.timestamp + 1 : 0;
    const oid = this.write({
      kind: 'commit',
      tree: treeOid,
      parents: [ours, theirs],
      author: 'sigmafold',
      message: 'merge',
      timestamp,
    });
    this.refs.set(this.current, oid);
    return { oid };
  }

  private headOrThrow(): Oid {
    const oid = this.refs.get(this.current);
    if (oid === undefined) throw new Error(`branch has no commits: ${this.current}`);
    return oid;
  }
}

export function shortOid(oid: Oid): string {
  return oid.slice(0, 12);
}
