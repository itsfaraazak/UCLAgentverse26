import type { AcmgClassification } from '@/lib/acmg/types';
import type {
  AnyDelta,
  WbBranch,
  WbDelta,
  WbDeltaKind,
  WorkspaceSnapshot,
} from '@/lib/workbench/types';
import { MAIN_BRANCH } from '@/lib/workbench/types';

export const MAIN = MAIN_BRANCH;

export interface TimelineItem {
  readonly delta: AnyDelta;
  /** True for deltas that belong to an ancestor branch, up to the fork point. */
  readonly inherited: boolean;
}

export interface Timeline {
  readonly items: readonly TimelineItem[];
  /** Index of the first delta that belongs to this branch itself. */
  readonly ownStart: number;
  readonly fork: { readonly branch: string; readonly delta: string | null } | null;
}

function bySeq(a: AnyDelta, b: AnyDelta): number {
  return (a?.seq ?? 0) - (b?.seq ?? 0);
}

function ownDeltas(snapshot: WorkspaceSnapshot, branch: string): AnyDelta[] {
  return (snapshot.deltas ?? []).filter((d) => d && d.branch === branch).sort(bySeq);
}

function lineage(snapshot: WorkspaceSnapshot, branch: string, seen: Set<string>): AnyDelta[] {
  if (seen.has(branch)) return [];
  seen.add(branch);
  const own = ownDeltas(snapshot, branch);
  const meta = (snapshot.branches ?? []).find((b) => b.name === branch);
  const parent = meta?.parent;
  if (!parent || !parent.branch) return own;
  const upstream = lineage(snapshot, parent.branch, seen);
  if (parent.delta === null) return own;
  const cut = upstream.findIndex((d) => d.id === parent.delta);
  return cut === -1 ? own : [...upstream.slice(0, cut + 1), ...own];
}

/** A branch's history: its ancestry up to the fork point, then its own deltas. */
export function branchTimeline(snapshot: WorkspaceSnapshot | null, branch: string): Timeline {
  if (!snapshot) return { items: [], ownStart: 0, fork: null };
  const all = lineage(snapshot, branch, new Set());
  const items = all.map((delta) => ({ delta, inherited: delta.branch !== branch }));
  const firstOwn = items.findIndex((item) => !item.inherited);
  const meta = (snapshot.branches ?? []).find((b) => b.name === branch);
  return {
    items,
    ownStart: firstOwn === -1 ? items.length : firstOwn,
    fork: meta?.parent ?? null,
  };
}

export function latestOfKind<K extends WbDeltaKind>(
  items: readonly TimelineItem[],
  kind: K,
): WbDelta<K> | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const delta = items[i].delta;
    if (delta.kind === kind) return delta as WbDelta<K>;
  }
  return null;
}

export function shortId(id: string | null | undefined): string {
  return (id ?? '').slice(0, 8) || '????????';
}

/** Resolve a full id or an unambiguous prefix (>= 6 chars) to a known delta id. */
export function resolveDeltaRef(ref: string, ids: Iterable<string>): string | null {
  const needle = ref.toLowerCase();
  if (needle.length < 6) return null;
  let match: string | null = null;
  for (const id of ids) {
    if (id.toLowerCase().startsWith(needle)) {
      if (match !== null && match !== id) return null;
      match = id;
    }
  }
  return match;
}

export function formatPercent(af: number): string {
  const pct = af * 100;
  if (pct >= 10) return `${pct.toFixed(1)}%`;
  if (pct >= 0.1) return `${pct.toFixed(2)}%`;
  return `${pct.toPrecision(2)}%`;
}

export function formatOneIn(af: number): string {
  if (af <= 0) return '—';
  const n = Math.round(1 / af);
  return `1 in ${n.toLocaleString('en-GB')}`;
}

export function formatTime(iso: string | null | undefined): { short: string; full: string } {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return { short: '', full: '' };
  return {
    short: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    full: date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }),
  };
}

export type Tone = 'pass' | 'escalate' | 'block' | 'neutral';

export function classTone(c: AcmgClassification | string | null | undefined): Tone {
  switch (c) {
    case 'Pathogenic':
    case 'Likely Pathogenic':
      return 'block';
    case 'Uncertain Significance':
      return 'escalate';
    case 'Likely Benign':
    case 'Benign':
      return 'pass';
    default:
      return 'neutral';
  }
}

export const CLASS_SHORT: Readonly<Record<AcmgClassification, string>> = {
  Pathogenic: 'P',
  'Likely Pathogenic': 'LP',
  'Uncertain Significance': 'VUS',
  'Likely Benign': 'LB',
  Benign: 'B',
};

export const CLASS_MEANING: Readonly<Record<AcmgClassification, string>> = {
  Pathogenic: 'Causes disease. The evidence is strong enough to act on clinically.',
  'Likely Pathogenic': 'Probably causes disease (over 90% certain). Usually acted on clinically.',
  'Uncertain Significance':
    'Not enough evidence either way. It must not drive a clinical decision until more evidence arrives.',
  'Likely Benign': 'Probably harmless (over 90% certain). Not expected to cause disease.',
  Benign: 'Harmless. Not a cause of disease.',
};

export function classMeaning(c: string | null | undefined): string {
  return (c && CLASS_MEANING[c as AcmgClassification]) || 'No classification yet.';
}

export interface GraphRow {
  readonly branch: WbBranch;
  readonly lane: number;
  readonly row: number;
  /** Row index of the parent branch, or -1 for main / orphans. */
  readonly parentRow: number;
}

/**
 * Rows for the commit graph: `main` on the trunk, then each branch depth-first
 * (newest first) so a branch's descendants sit directly beneath it.
 */
export function branchRows(branches: readonly WbBranch[]): GraphRow[] {
  const byParent = new Map<string, WbBranch[]>();
  const names = new Set(branches.map((b) => b.name));
  const roots: WbBranch[] = [];
  for (const b of branches) {
    if (b.name === MAIN) continue;
    const parent = b.parent?.branch;
    if (!parent || !names.has(parent) || parent === b.name) {
      roots.push(b);
      continue;
    }
    const list = byParent.get(parent) ?? [];
    list.push(b);
    byParent.set(parent, list);
  }
  const newestFirst = (a: WbBranch, b: WbBranch) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
  const rows: GraphRow[] = [];
  const seen = new Set<string>();

  function visit(b: WbBranch, lane: number, parentRow: number) {
    if (seen.has(b.name)) return;
    seen.add(b.name);
    const row = rows.length;
    rows.push({ branch: b, lane, row, parentRow });
    for (const child of (byParent.get(b.name) ?? []).sort(newestFirst)) visit(child, lane + 1, row);
  }

  const main = branches.find((b) => b.name === MAIN);
  if (main) visit(main, 0, -1);
  else
    visit(
      { name: MAIN, title: 'Case record', parent: null, createdBy: { kind: 'agent', name: 'system', model: null }, createdAt: '', status: 'open', head: null },
      0,
      -1,
    );
  for (const b of roots.sort(newestFirst)) visit(b, 1, 0);
  return rows;
}

export function deltaCount(snapshot: WorkspaceSnapshot | null, branch: string): number {
  return (snapshot?.deltas ?? []).filter((d) => d?.branch === branch).length;
}
