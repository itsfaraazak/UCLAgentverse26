import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SourceRef } from '../evidence/types';
import { canonicalJson } from '../vcs/canonical';
import { computeMergeStatus } from './merge';
import {
  MAIN_BRANCH,
  type Actor,
  type AiStatus,
  type AnyDelta,
  type BranchStatus,
  type DeltaDataMap,
  type MergeStatus,
  type WbBranch,
  type WbDeltaKind,
  type WorkspaceSnapshot,
} from './types';

export const WORKSPACE_ID = 'case-001';
export const WORKSPACE_TITLE = 'Variant review workspace';

const SYSTEM_ACTOR: Actor = { kind: 'agent', name: 'Workbench', model: null };

export interface AppendInput<K extends WbDeltaKind = WbDeltaKind> {
  readonly kind: K;
  readonly actor: Actor;
  readonly title: string;
  readonly body?: string;
  readonly data: DeltaDataMap[K];
  /** Defaults to the branch head, or the fork point when the branch is empty. */
  readonly parents?: readonly string[];
  readonly sources?: readonly SourceRef[];
}

interface PersistedState {
  readonly version: 1;
  readonly seq: number;
  readonly branches: WbBranch[];
  readonly deltas: AnyDelta[];
}

export interface StoreOptions {
  /** JSON file for write-through persistence; `null` keeps the store in memory only. */
  readonly file?: string | null;
  readonly now?: () => Date;
}

export class StoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Plain-data copy: drops `undefined`, class instances and functions before hashing. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function deltaId(content: {
  branch: string;
  kind: WbDeltaKind;
  actor: Actor;
  title: string;
  body: string;
  data: unknown;
  parents: readonly string[];
  seq: number;
}): string {
  return createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex').slice(0, 16);
}

export function slugify(text: string, max = 40): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'work';
}

/**
 * Append-only workspace history. Deltas are frozen on append and never
 * mutated or removed; branch heads and statuses are the only mutable state.
 */
export class WorkbenchStore {
  private seq = 0;
  private branches = new Map<string, WbBranch>();
  private deltas: AnyDelta[] = [];
  private byId = new Map<string, AnyDelta>();
  private readonly file: string | null;
  private readonly now: () => Date;

  constructor(options: StoreOptions = {}) {
    this.file = options.file ?? null;
    this.now = options.now ?? (() => new Date());
    if (!this.load()) this.init();
  }

  private init(): void {
    this.seq = 0;
    this.deltas = [];
    this.byId = new Map();
    this.branches = new Map([
      [
        MAIN_BRANCH,
        {
          name: MAIN_BRANCH,
          title: 'Signed-off record',
          parent: null,
          createdBy: SYSTEM_ACTOR,
          createdAt: this.now().toISOString(),
          status: 'open',
          head: null,
        },
      ],
    ]);
  }

  private load(): boolean {
    if (this.file === null || !existsSync(this.file)) return false;
    try {
      const state = JSON.parse(readFileSync(this.file, 'utf8')) as PersistedState;
      if (state.version !== 1 || !Array.isArray(state.deltas) || !Array.isArray(state.branches)) return false;
      this.seq = state.seq;
      this.deltas = state.deltas.map((d) => deepFreeze(d));
      this.byId = new Map(this.deltas.map((d) => [d.id, d]));
      // A run cannot survive a restart, so a persisted 'running' is stale.
      this.branches = new Map(
        state.branches.map((b) => [b.name, b.status === 'running' ? { ...b, status: 'open' as const } : b]),
      );
      if (!this.branches.has(MAIN_BRANCH)) return false;
      return true;
    } catch {
      return false;
    }
  }

  private persist(): void {
    if (this.file === null) return;
    const state: PersistedState = {
      version: 1,
      seq: this.seq,
      branches: [...this.branches.values()],
      deltas: this.deltas,
    };
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), 'utf8');
    renameSync(tmp, this.file);
  }

  reset(): void {
    this.init();
    this.persist();
  }

  getBranch(name: string): WbBranch | undefined {
    return this.branches.get(name);
  }

  requireBranch(name: string): WbBranch {
    const b = this.branches.get(name);
    if (b === undefined) throw new StoreError(404, `No branch named "${name}".`);
    return b;
  }

  listBranches(): readonly WbBranch[] {
    return [...this.branches.values()];
  }

  getDelta(id: string): AnyDelta | undefined {
    return this.byId.get(id);
  }

  allDeltas(): readonly AnyDelta[] {
    return this.deltas;
  }

  uniqueBranchName(base: string): string {
    if (!this.branches.has(base)) return base;
    for (let i = 2; ; i++) {
      const candidate = `${base}-${i}`;
      if (!this.branches.has(candidate)) return candidate;
    }
  }

  createBranch(input: {
    name: string;
    title: string;
    from: { branch: string; delta: string | null };
    by: Actor;
  }): WbBranch {
    const parent = this.requireBranch(input.from.branch);
    let forkDelta = input.from.delta;
    if (forkDelta === null) {
      forkDelta = parent.head;
    } else if (!this.ancestry(parent.name).some((d) => d.id === forkDelta)) {
      throw new StoreError(400, `Delta ${forkDelta} is not in the history of ${parent.name}.`);
    }
    const name = this.uniqueBranchName(input.name);
    const branch: WbBranch = {
      name,
      title: input.title,
      parent: { branch: parent.name, delta: forkDelta },
      createdBy: input.by,
      createdAt: this.now().toISOString(),
      status: 'open',
      head: null,
    };
    this.branches.set(name, branch);
    this.persist();
    return branch;
  }

  setStatus(name: string, status: BranchStatus): WbBranch {
    const b = this.requireBranch(name);
    const next = { ...b, status };
    this.branches.set(name, next);
    this.persist();
    return next;
  }

  append<K extends WbDeltaKind>(branchName: string, input: AppendInput<K>): AnyDelta {
    const branch = this.requireBranch(branchName);
    const defaultParent = branch.head ?? branch.parent?.delta ?? null;
    const parents = input.parents ?? (defaultParent === null ? [] : [defaultParent]);
    const seq = this.seq + 1;
    const content = plain({
      branch: branchName,
      kind: input.kind,
      actor: input.actor,
      title: input.title,
      body: input.body ?? '',
      data: input.data,
      parents: [...parents],
      seq,
    });
    const delta = deepFreeze({
      id: deltaId(content),
      ...content,
      at: this.now().toISOString(),
      sources: plain([...(input.sources ?? [])]),
    }) as AnyDelta;
    this.seq = seq;
    this.deltas.push(delta);
    this.byId.set(delta.id, delta);
    this.branches.set(branchName, { ...branch, head: delta.id });
    this.persist();
    return delta;
  }

  /**
   * Deltas visible from `branch`: its own, plus each ancestor's up to and
   * including the fork delta. Ordered by `seq`.
   */
  ancestry(branchName: string, uptoSeq = Number.POSITIVE_INFINITY): AnyDelta[] {
    const branch = this.requireBranch(branchName);
    const own = this.deltas.filter((d) => d.branch === branchName && d.seq <= uptoSeq);
    if (branch.parent === null || branch.parent.delta === null) return own;
    const fork = this.byId.get(branch.parent.delta);
    if (fork === undefined) return own;
    const inherited = this.ancestry(branch.parent.branch, Math.min(fork.seq, uptoSeq));
    return [...inherited, ...own].sort((a, b) => a.seq - b.seq);
  }

  mergeStatus(name: string): MergeStatus {
    return computeMergeStatus(this.ancestry(name), this.requireBranch(name).status);
  }

  snapshot(ai: AiStatus): WorkspaceSnapshot {
    const branches = this.listBranches();
    const merge: Record<string, MergeStatus> = {};
    for (const b of branches) {
      if (b.name !== MAIN_BRANCH) merge[b.name] = this.mergeStatus(b.name);
    }
    return {
      id: WORKSPACE_ID,
      title: WORKSPACE_TITLE,
      branches,
      deltas: [...this.deltas],
      merge,
      ai,
    };
  }
}

const GLOBAL_KEY = Symbol.for('sigmafold.workbench.store');

export function defaultStoreFile(): string {
  return join(process.cwd(), '.data', 'workbench.json');
}

/** Process-wide store, kept on `globalThis` so it survives dev-server HMR. */
export function getStore(): WorkbenchStore {
  const g = globalThis as unknown as Record<symbol, WorkbenchStore | undefined>;
  let store = g[GLOBAL_KEY];
  if (store === undefined) {
    store = new WorkbenchStore({ file: defaultStoreFile() });
    g[GLOBAL_KEY] = store;
  }
  return store;
}
