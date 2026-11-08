/**
 * Commit-DAG layout: lane assignment and edge routing.
 *
 * Framework-free and pure (SPEC §8) — no React, no DOM, no SVG elements, just
 * numbers and path strings. The renderer in `src/components/graph/` consumes
 * this and adds nothing of its own to the geometry.
 *
 * The layout is the one that `git log --graph`, Tower and GitKraken all
 * converge on. Three rules keep it from turning into spaghetti:
 *
 * 1. **A branch's line stays in the branch's own lane.** An edge from a commit
 *    down to its *first* parent in another lane runs vertically in the CHILD's
 *    lane and bends only at the bottom, just above the parent. So one branch =
 *    one column of one colour, all the way down to where it forked.
 *
 * 2. **A merge edge bends at the top.** An edge to a *second* parent leaves the
 *    merge commit immediately and then runs down inside the PARENT's lane, so
 *    the merged-in branch reads as its own column too.
 *
 * 3. **A lane is held, not recycled, while an edge is still using it.** When a
 *    commit's lane is not inherited by its first parent — which is exactly what
 *    happens at a branch tip or a rejoin — the lane is held until that parent
 *    has been placed, because the commit's own edge runs down it until then.
 *    Two concurrently open branch tips therefore never share a column and read
 *    as a chain, while the graph still stays as narrow as it safely can.
 *
 * Together these make the drawing provably clean. Every vertical leg sits in a
 * lane that, over the rows it spans, contains no other node and no other
 * vertical leg: a parent's lane is reserved for it from its first child until
 * it is placed, and a child's lane is dead from the moment it is abandoned. The
 * only lines that can cross are the short diagonals of the bends themselves,
 * and those nest rather than cross because a wider lane jump starts bending
 * earlier. Lane-based graphs do still cross a *lane* when a bend passes over
 * it; that is inherent to the form and is what every git client does.
 */

export interface LayoutCommit {
  readonly oid: string;
  readonly parents: readonly string[];
  readonly timestamp: number;
}

export interface LayoutOptions {
  readonly rowHeight?: number;
  readonly laneWidth?: number;
  readonly paddingX?: number;
  readonly paddingY?: number;
  /** Vertical half-height of the S-bend on a cross-lane edge. */
  readonly cornerRadius?: number;
}

export interface LayoutNode {
  readonly oid: string;
  /** 0-based, top to bottom. Newest commit is row 0. */
  readonly row: number;
  /** 0-based, left to right. */
  readonly lane: number;
  readonly x: number;
  readonly y: number;
  /** True when this commit has two or more parents. */
  readonly isMerge: boolean;
  /** True when this commit has no parents inside the graph. */
  readonly isRoot: boolean;
}

export interface LayoutEdge {
  readonly id: string;
  /** Child oid — the upper end. */
  readonly from: string;
  /** Parent oid — the lower end. */
  readonly to: string;
  readonly fromLane: number;
  readonly toLane: number;
  /** `first` is parent[0]; `merge` is any later parent. */
  readonly kind: 'first' | 'merge';
  /**
   * SVG path data. Monotonically descending in y for well-formed (acyclic)
   * input; a cycle has no consistent top-to-bottom order, so an edge inside
   * one degrades to a straight segment that may ascend.
   */
  readonly path: string;
  /**
   * The lane whose colour this edge takes. A `first` edge belongs to the
   * child's branch; a `merge` edge belongs to the branch being merged in.
   */
  readonly lane: number;
}

export interface GraphLayout {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
  readonly laneCount: number;
  readonly rowCount: number;
  readonly width: number;
  readonly height: number;
  /** Oids in row order, newest first. */
  readonly order: readonly string[];
  readonly metrics: Required<LayoutOptions>;
}

const DEFAULTS: Required<LayoutOptions> = {
  rowHeight: 74,
  laneWidth: 46,
  paddingX: 38,
  paddingY: 44,
  cornerRadius: 16,
};

/**
 * Marker for a lane being held open for an edge that is still in flight. It can
 * never equal an oid, so the lane is neither free nor matched by any commit.
 */
const HELD_LANE = '\u0000held';

function firstFreeLane(lanes: Array<string | null>): number {
  for (let i = 0; i < lanes.length; i += 1) {
    if (lanes[i] === null) return i;
  }
  lanes.push(null);
  return lanes.length - 1;
}

interface Assignment {
  readonly ordered: LayoutCommit[];
  readonly laneOf: Map<string, number>;
  readonly laneCount: number;
  readonly inGraph: ReadonlySet<string>;
}

/**
 * Single pass that both orders the commits and assigns lanes, because the two
 * decisions inform each other: when several commits are ready to be placed, we
 * take the one already reserved in the leftmost lane. That is what keeps the
 * mainline pinned to lane 0 instead of letting whichever side branch happens
 * to be newest shunt it rightwards.
 *
 * Ordering is Kahn's algorithm over child→parent edges, so every commit is
 * emitted before all of its parents. It always terminates: each commit is
 * emitted at most once, and a cyclic remainder is appended in sorted order
 * rather than spun on.
 */
function assignLanes(commits: readonly LayoutCommit[]): Assignment {
  const byOid = new Map<string, LayoutCommit>();
  for (const commit of commits) {
    // Later duplicates are ignored so malformed input cannot double-place.
    if (!byOid.has(commit.oid)) byOid.set(commit.oid, commit);
  }

  const parentsOf = (commit: LayoutCommit): string[] =>
    [...new Set(commit.parents)].filter((p) => byOid.has(p));

  const remainingChildren = new Map<string, number>();
  for (const oid of byOid.keys()) remainingChildren.set(oid, 0);
  for (const commit of byOid.values()) {
    for (const parent of parentsOf(commit)) {
      remainingChildren.set(parent, (remainingChildren.get(parent) ?? 0) + 1);
    }
  }

  const lanes: Array<string | null> = [];
  /** lane index → the parent oid whose placement releases that lane. */
  const held = new Map<number, string>();
  const laneOf = new Map<string, number>();
  const ordered: LayoutCommit[] = [];
  const placed = new Set<string>();
  let laneCount = 0;

  const ready: LayoutCommit[] = [];
  for (const commit of byOid.values()) {
    if ((remainingChildren.get(commit.oid) ?? 0) === 0) ready.push(commit);
  }

  /** Leftmost lane currently reserved for `oid`, or +∞ when unreserved. */
  const reservedLane = (oid: string): number => {
    const index = lanes.indexOf(oid);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };

  const takeNext = (): LayoutCommit | undefined => {
    if (ready.length === 0) return undefined;
    let bestIndex = 0;
    for (let i = 1; i < ready.length; i += 1) {
      const candidate = ready[i];
      const best = ready[bestIndex];
      const byLane = reservedLane(candidate.oid) - reservedLane(best.oid);
      if (byLane < 0) {
        bestIndex = i;
        continue;
      }
      if (byLane > 0) continue;
      const byTime = best.timestamp - candidate.timestamp;
      if (byTime < 0) {
        bestIndex = i;
        continue;
      }
      if (byTime > 0) continue;
      if (candidate.oid.localeCompare(best.oid) < 0) bestIndex = i;
    }
    return ready.splice(bestIndex, 1)[0];
  };

  for (;;) {
    const commit = takeNext();
    if (commit === undefined) break;
    if (placed.has(commit.oid)) continue;
    placed.add(commit.oid);

    let lane = lanes.indexOf(commit.oid);
    if (lane === -1) lane = firstFreeLane(lanes);
    lanes[lane] = null; // the commit has arrived; its reservation is consumed
    laneOf.set(commit.oid, lane);
    laneCount = Math.max(laneCount, lane + 1);
    ordered.push(commit);

    // Release any lane whose in-flight edge has now landed: its corridor ended
    // at the parent we just placed, so anything below is free to use it.
    for (const [heldLane, blocker] of held) {
      if (!placed.has(blocker)) continue;
      if (lanes[heldLane] === HELD_LANE) lanes[heldLane] = null;
      held.delete(heldLane);
    }

    const parents = parentsOf(commit);
    const firstParent = parents[0];

    // Settle this commit's own lane FIRST — either the first parent inherits
    // it, or it is held for the edge running down it — before any other parent
    // is given a lane. Reserving a merge parent first would let it claim this
    // very lane (just vacated above), and the hold below would then be skipped,
    // leaving a later commit free to land inside the corridor this commit's
    // first-parent edge still occupies.
    if (firstParent !== undefined) {
      if (lanes.includes(firstParent)) {
        lanes[lane] = HELD_LANE; // rejoin: the edge needs the lane until then
        held.set(lane, firstParent);
      } else {
        lanes[lane] = firstParent; // the first parent inherits this lane
      }
    }

    // Remaining parents (merge parents) each take a lane of their own.
    parents.forEach((parent, index) => {
      if (index === 0 || lanes.includes(parent)) return;
      lanes[firstFreeLane(lanes)] = parent;
    });

    for (const parent of parents) {
      if (placed.has(parent)) continue;
      const left = (remainingChildren.get(parent) ?? 0) - 1;
      remainingChildren.set(parent, left);
      if (left <= 0) {
        const next = byOid.get(parent);
        if (next !== undefined) ready.push(next);
      }
    }
  }

  if (ordered.length < byOid.size) {
    // Cycle, or an unreachable remainder. Place what is left deterministically
    // so the layout always terminates and always draws every node it was given.
    const leftovers = [...byOid.values()]
      .filter((c) => !placed.has(c.oid))
      .sort((a, b) => b.timestamp - a.timestamp || a.oid.localeCompare(b.oid));
    for (const commit of leftovers) {
      placed.add(commit.oid);
      const lane = firstFreeLane(lanes);
      lanes[lane] = null;
      laneOf.set(commit.oid, lane);
      laneCount = Math.max(laneCount, lane + 1);
      ordered.push(commit);
    }
  }

  return { ordered, laneOf, laneCount: Math.max(laneCount, lanes.length), inGraph: new Set(byOid.keys()) };
}

/**
 * Order commits so that every commit precedes all of its parents: children
 * above parents, newest at the top, mainline kept leftmost. Deterministic and
 * guaranteed to terminate, including on cyclic input.
 */
export function topologicalOrder(commits: readonly LayoutCommit[]): LayoutCommit[] {
  return assignLanes(commits).ordered;
}

/** Where a cross-lane edge makes its turn. */
export type Bend = 'top' | 'bottom';

/**
 * SVG path for an edge from a child at `(x1, y1)` to a parent at `(x2, y2)`.
 *
 * Same lane → a straight vertical line. Different lanes → exactly one smooth
 * S-bend with vertical tangents at both ends, plus a straight run for the rest.
 * `bend: 'bottom'` keeps the line in the child's lane and turns just above the
 * parent (a branch descending to its fork point); `bend: 'top'` turns straight
 * out of the child and then runs down the parent's lane (a merge).
 *
 * The turn is given more vertical room the further it has to travel sideways,
 * so several edges converging on one commit nest instead of knotting.
 */
export function edgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cornerRadius: number,
  bend: Bend = 'top',
): string {
  const ax = round(x1);
  const bx = round(x2);
  if (ax === bx) return `M ${ax} ${round(y1)} L ${ax} ${round(y2)}`;

  const dy = y2 - y1;
  if (dy <= 0) return `M ${ax} ${round(y1)} L ${bx} ${round(y2)}`;

  const spread = Math.abs(x2 - x1);
  const scaled = cornerRadius * (1 + 0.012 * spread);
  const r = Math.min(scaled, dy / 2);

  if (bend === 'bottom') {
    const turnStart = y2 - r * 2;
    const tail =
      `C ${ax} ${round(y2 - r)} ${bx} ${round(y2 - r)} ${bx} ${round(y2)}`;
    if (turnStart <= y1 + 0.5) return `M ${ax} ${round(y1)} ${tail}`;
    return `M ${ax} ${round(y1)} L ${ax} ${round(turnStart)} ${tail}`;
  }

  const turnEnd = y1 + r * 2;
  const head =
    `M ${ax} ${round(y1)} ` +
    `C ${ax} ${round(y1 + r)} ${bx} ${round(y1 + r)} ${bx} ${round(turnEnd)}`;
  if (turnEnd >= y2 - 0.5) return head;
  return `${head} L ${bx} ${round(y2)}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Lay out a commit DAG. Deterministic: the same commits in any input order
 * produce the same layout.
 */
export function layoutGraph(
  commits: readonly LayoutCommit[],
  options: LayoutOptions = {},
): GraphLayout {
  // A non-finite metric would propagate into every coordinate and every path
  // string, so fall back to the default rather than emitting `NaN` geometry.
  const finite = (value: number | undefined, fallback: number): number =>
    value !== undefined && Number.isFinite(value) ? value : fallback;
  const metrics: Required<LayoutOptions> = {
    rowHeight: finite(options.rowHeight, DEFAULTS.rowHeight),
    laneWidth: finite(options.laneWidth, DEFAULTS.laneWidth),
    paddingX: finite(options.paddingX, DEFAULTS.paddingX),
    paddingY: finite(options.paddingY, DEFAULTS.paddingY),
    cornerRadius: finite(options.cornerRadius, DEFAULTS.cornerRadius),
  };
  const { ordered, laneOf, laneCount, inGraph } = assignLanes(commits);

  const xOf = (lane: number): number => metrics.paddingX + lane * metrics.laneWidth;
  const yOf = (row: number): number => metrics.paddingY + row * metrics.rowHeight;

  const parentsOf = (commit: LayoutCommit): string[] =>
    [...new Set(commit.parents)].filter((p) => inGraph.has(p));

  const nodes: LayoutNode[] = ordered.map((commit, row) => {
    const lane = laneOf.get(commit.oid) ?? 0;
    const parents = parentsOf(commit);
    return {
      oid: commit.oid,
      row,
      lane,
      x: xOf(lane),
      y: yOf(row),
      isMerge: parents.length > 1,
      isRoot: parents.length === 0,
    };
  });

  const nodeByOid = new Map(nodes.map((n) => [n.oid, n]));
  const edges: LayoutEdge[] = [];
  ordered.forEach((commit) => {
    const node = nodeByOid.get(commit.oid);
    if (node === undefined) return;
    parentsOf(commit).forEach((parentOid, index) => {
      const parentNode = nodeByOid.get(parentOid);
      if (parentNode === undefined) return;
      const isFirst = index === 0;
      edges.push({
        id: `${node.oid}->${parentOid}`,
        from: node.oid,
        to: parentOid,
        fromLane: node.lane,
        toLane: parentNode.lane,
        kind: isFirst ? 'first' : 'merge',
        path: edgePath(
          node.x,
          node.y,
          parentNode.x,
          parentNode.y,
          metrics.cornerRadius,
          isFirst ? 'bottom' : 'top',
        ),
        // A first-parent edge is the child's own branch line; a merge edge
        // belongs to the branch being merged in.
        lane: isFirst ? node.lane : parentNode.lane,
      });
    });
  });

  return {
    nodes,
    edges,
    laneCount,
    rowCount: nodes.length,
    width: metrics.paddingX * 2 + Math.max(0, laneCount - 1) * metrics.laneWidth,
    height: metrics.paddingY * 2 + Math.max(0, nodes.length - 1) * metrics.rowHeight,
    order: nodes.map((n) => n.oid),
    metrics,
  };
}

/**
 * A plain-text rendering of the same structure, used as the graph's text
 * alternative for screen readers (SPEC §5: no mouse-only canvas).
 */
export function describeGraph(
  layout: GraphLayout,
  label: (oid: string) => string,
): string[] {
  const rowOf = new Map(layout.nodes.map((n) => [n.oid, n.row]));
  return layout.nodes.map((node) => {
    const parents = layout.edges
      .filter((e) => e.from === node.oid)
      .map((e) => `${label(e.to)} (row ${(rowOf.get(e.to) ?? 0) + 1})`);
    const kind = node.isRoot ? 'root commit' : node.isMerge ? 'merge commit' : 'commit';
    const lineage =
      parents.length === 0 ? 'no parents' : `parent${parents.length > 1 ? 's' : ''}: ${parents.join(' and ')}`;
    return `Row ${node.row + 1} of ${layout.rowCount}, lane ${node.lane + 1}: ${kind} ${label(node.oid)}; ${lineage}.`;
  });
}
