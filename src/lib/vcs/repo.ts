import { canonicalJson, oidOfCanonical } from './canonical';
import type {
  Blob,
  Commit,
  CommitInput,
  GitObject,
  MergeConflict,
  MergeResult,
  Oid,
  Tree,
} from './types';

const DEFAULT_BRANCH = 'main';

function entryOf(tree: Tree, gene: string): Oid | null {
  const oid = tree.entries[gene];
  return oid === undefined ? null : oid;
}

function pickThreeWay(
  base: Oid | null,
  ours: Oid | null,
  theirs: Oid | null,
): Oid | null | 'conflict' {
  if (ours === theirs) return ours;
  if (ours === base) return theirs;
  if (theirs === base) return ours;
  return 'conflict';
}

/**
 * In-memory content-addressed repository. Oids are sha256(canonicalJson(obj)).
 */
export class Repo {
  private readonly objects = new Map<Oid, GitObject>();
  private readonly refs = new Map<string, Oid>();
  private currentBranch: string = DEFAULT_BRANCH;

  write(obj: GitObject): Oid {
    const json = canonicalJson(obj);
    const oid = oidOfCanonical(json);
    if (!this.objects.has(oid)) {
      this.objects.set(oid, cloneObject(obj));
    }
    return oid;
  }

  read(oid: Oid): Blob | Tree | Commit {
    const obj = this.objects.get(oid);
    if (obj === undefined) {
      throw new Error(`unknown object ${oid}`);
    }
    return obj;
  }

  commit(opts: CommitInput): Oid {
    this.requireTree(opts.tree);
    const parents = opts.parents === undefined ? this.defaultParents() : [...opts.parents];
    for (const parent of parents) {
      this.requireCommit(parent);
    }
    const timestamp = opts.timestamp === undefined ? Date.now() : opts.timestamp;
    const commit: Commit = {
      kind: 'commit',
      tree: opts.tree,
      parents,
      author: opts.author,
      message: opts.message,
      timestamp,
      ...(opts.edit === undefined ? {} : { edit: opts.edit }),
      ...(opts.checkRunId === undefined ? {} : { checkRunId: opts.checkRunId }),
    };
    const oid = this.write(commit);
    this.refs.set(this.currentBranch, oid);
    return oid;
  }

  branch(name: string, at?: Oid): void {
    if (name.length === 0) {
      throw new Error('branch name must be non-empty');
    }
    const target = at === undefined ? this.head() : at;
    this.requireCommit(target);
    this.refs.set(name, target);
  }

  checkout(name: string): void {
    if (!this.refs.has(name)) {
      throw new Error(`unknown branch ${name}`);
    }
    this.currentBranch = name;
  }

  branches(): string[] {
    return [...this.refs.keys()].sort();
  }

  head(): Oid {
    const oid = this.refs.get(this.currentBranch);
    if (oid === undefined) {
      throw new Error(`branch '${this.currentBranch}' has no commits`);
    }
    return oid;
  }

  log(ref?: string): Commit[] {
    const start = this.resolve(ref);
    const result: Commit[] = [];
    const visited = new Set<Oid>();
    const queue: Oid[] = [start];
    while (queue.length > 0) {
      const oid = queue.shift();
      if (oid === undefined || visited.has(oid)) continue;
      visited.add(oid);
      const commit = this.requireCommit(oid);
      result.push(commit);
      for (const parent of commit.parents) {
        if (!visited.has(parent)) queue.push(parent);
      }
    }
    return result;
  }

  /**
   * Best common ancestor of `a` and `b`, or null if the histories are disjoint.
   *
   * Walk both ancestor sets (O(V+E)), intersect, then discard any common
   * ancestor that is a parent of another common ancestor. The common set is
   * ancestor-closed along paths between its members, so marking immediate
   * parents is enough to drop every dominated node. Among what remains, pick
   * the lowest oid.
   *
   * Criss-cross histories can have several equally-good common ancestors.
   * Git resolves that with recursive merge; this prototype does not. Lowest-oid
   * makes the choice deterministic and symmetric, not correct in the full
   * sense.
   */
  mergeBase(a: Oid, b: Oid): Oid | null {
    this.requireCommit(a);
    this.requireCommit(b);
    if (a === b) return a;

    const ancestorsOfA = this.ancestorSet(a);
    const ancestorsOfB = this.ancestorSet(b);
    const common = new Set<Oid>();
    for (const oid of ancestorsOfA) {
      if (ancestorsOfB.has(oid)) common.add(oid);
    }
    if (common.size === 0) return null;

    const dominated = new Set<Oid>();
    for (const oid of common) {
      const commit = this.requireCommit(oid);
      for (const parent of commit.parents) {
        if (common.has(parent)) dominated.add(parent);
      }
    }

    let best: Oid | null = null;
    for (const oid of common) {
      if (dominated.has(oid)) continue;
      if (best === null || oid < best) best = oid;
    }
    return best;
  }

  /**
   * Three-way merge of genotype trees. Per gene:
   *  - changed on one side only    → take that side
   *  - changed identically on both → take it
   *  - changed differently on both → CONFLICT, do not auto-resolve
   *
   * `merge(a, a)` is a no-op: return the existing oid and do not write a
   * merge commit with `parents: [a, a]`. SPEC §4.5 #4's metadata rules apply
   * only to merges that combine two distinct commits.
   */
  merge(ours: Oid, theirs: Oid): MergeResult {
    const oursCommit = this.requireCommit(ours);
    const theirsCommit = this.requireCommit(theirs);
    if (ours === theirs) {
      return { oid: ours };
    }
    const baseOid = this.mergeBase(ours, theirs);
    const baseTree =
      baseOid === null
        ? { kind: 'tree' as const, entries: {} }
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
      const base = entryOf(baseTree, gene);
      const ourOid = entryOf(oursTree, gene);
      const theirOid = entryOf(theirsTree, gene);
      const picked = pickThreeWay(base, ourOid, theirOid);
      if (picked === 'conflict') {
        conflicts.push({ gene, base, ours: ourOid, theirs: theirOid });
        continue;
      }
      if (picked !== null) {
        entries[gene] = picked;
      }
    }

    if (conflicts.length > 0) {
      return { conflicts };
    }

    const treeOid = this.write({ kind: 'tree', entries });
    const timestamp = Math.max(oursCommit.timestamp, theirsCommit.timestamp) + 1;
    const mergeCommit: Commit = {
      kind: 'commit',
      tree: treeOid,
      parents: [ours, theirs],
      author: 'sigmafold-merge',
      message: `Merge ${theirs.slice(0, 12)} into ${ours.slice(0, 12)}`,
      timestamp,
    };
    const oid = this.write(mergeCommit);
    if (this.refs.get(this.currentBranch) === ours) {
      this.refs.set(this.currentBranch, oid);
    }
    return { oid };
  }

  private defaultParents(): Oid[] {
    const oid = this.refs.get(this.currentBranch);
    return oid === undefined ? [] : [oid];
  }

  private resolve(ref?: string): Oid {
    if (ref === undefined) return this.head();
    const branchOid = this.refs.get(ref);
    if (branchOid !== undefined) return branchOid;
    if (this.objects.has(ref)) return ref;
    throw new Error(`unknown ref ${ref}`);
  }

  private ancestorSet(oid: Oid): Set<Oid> {
    const found = new Set<Oid>([oid]);
    const queue: Oid[] = [oid];
    for (let i = 0; i < queue.length; i += 1) {
      const current = queue[i];
      if (current === undefined) continue;
      const commit = this.requireCommit(current);
      for (const parent of commit.parents) {
        if (found.has(parent)) continue;
        found.add(parent);
        queue.push(parent);
      }
    }
    return found;
  }

  private requireCommit(oid: Oid): Commit {
    const obj = this.read(oid);
    if (obj.kind !== 'commit') {
      throw new Error(`expected commit at ${oid}, got ${obj.kind}`);
    }
    return obj;
  }

  private requireTree(oid: Oid): Tree {
    const obj = this.read(oid);
    if (obj.kind !== 'tree') {
      throw new Error(`expected tree at ${oid}, got ${obj.kind}`);
    }
    return obj;
  }
}

function cloneObject(obj: GitObject): GitObject {
  switch (obj.kind) {
    case 'blob':
      return {
        kind: 'blob',
        sequence: { bases: obj.sequence.bases, label: obj.sequence.label },
      };
    case 'tree':
      return { kind: 'tree', entries: { ...obj.entries } };
    case 'commit':
      return {
        kind: 'commit',
        tree: obj.tree,
        parents: [...obj.parents],
        author: obj.author,
        message: obj.message,
        timestamp: obj.timestamp,
        ...(obj.edit === undefined ? {} : { edit: { ...obj.edit } }),
        ...(obj.checkRunId === undefined ? {} : { checkRunId: obj.checkRunId }),
      };
  }
}
