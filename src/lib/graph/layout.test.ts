import { describe, expect, it } from 'vitest';
import {
  describeGraph,
  edgePath,
  layoutGraph,
  topologicalOrder,
  type GraphLayout,
  type LayoutCommit,
} from './layout';

function c(oid: string, parents: string[], timestamp: number): LayoutCommit {
  return { oid, parents, timestamp };
}

/** root → a, root → b, then m merges a and b. */
const DIAMOND: LayoutCommit[] = [
  c('root', [], 1000),
  c('a', ['root'], 2000),
  c('b', ['root'], 3000),
  c('m', ['a', 'b'], 4000),
];

function nodeOf(layout: GraphLayout, oid: string) {
  const node = layout.nodes.find((n) => n.oid === oid);
  if (node === undefined) throw new Error(`missing node ${oid}`);
  return node;
}

/**
 * The invariant the whole drawing rests on: the lane an edge's vertical leg
 * runs down holds no other node between the two endpoints' rows, so a line
 * never passes through an unrelated commit.
 *
 * A `first` edge runs down the CHILD's lane and turns at the bottom; a `merge`
 * edge turns at the top and runs down the PARENT's lane.
 */
function assertNoNodeInEdgeCorridor(layout: GraphLayout): void {
  const rowOf = new Map(layout.nodes.map((n) => [n.oid, n.row]));
  for (const edge of layout.edges) {
    const childRow = rowOf.get(edge.from);
    const parentRow = rowOf.get(edge.to);
    expect(childRow).toBeTypeOf('number');
    expect(parentRow).toBeTypeOf('number');
    if (childRow === undefined || parentRow === undefined) continue;
    const corridorLane = edge.kind === 'first' ? edge.fromLane : edge.toLane;
    for (const node of layout.nodes) {
      if (node.oid === edge.from || node.oid === edge.to) continue;
      if (node.lane !== corridorLane) continue;
      expect(
        node.row > childRow && node.row < parentRow,
        `node ${node.oid} sits in lane ${node.lane} inside the corridor of edge ${edge.id}`,
      ).toBe(false);
    }
  }
}

/** Two vertical legs must never share a lane over overlapping rows. */
function assertNoOverlappingLegs(layout: GraphLayout): void {
  const rowOf = new Map(layout.nodes.map((n) => [n.oid, n.row]));
  const legs = layout.edges.map((edge) => ({
    id: edge.id,
    lane: edge.kind === 'first' ? edge.fromLane : edge.toLane,
    top: rowOf.get(edge.from) ?? 0,
    bottom: rowOf.get(edge.to) ?? 0,
  }));
  for (let i = 0; i < legs.length; i += 1) {
    for (let j = i + 1; j < legs.length; j += 1) {
      const a = legs[i];
      const b = legs[j];
      if (a.lane !== b.lane) continue;
      const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      // Touching at a shared endpoint row is fine; genuine overlap is not.
      expect(overlap, `legs ${a.id} and ${b.id} overlap in lane ${a.lane}`).toBeLessThanOrEqual(0);
    }
  }
}

describe('topologicalOrder', () => {
  it('places every commit before all of its parents', () => {
    const ordered = topologicalOrder(DIAMOND);
    const rowOf = new Map(ordered.map((commit, i) => [commit.oid, i]));
    for (const commit of DIAMOND) {
      for (const parent of commit.parents) {
        const childRow = rowOf.get(commit.oid);
        const parentRow = rowOf.get(parent);
        expect(childRow).toBeDefined();
        expect(parentRow).toBeDefined();
        if (childRow === undefined || parentRow === undefined) continue;
        expect(childRow).toBeLessThan(parentRow);
      }
    }
  });

  it('puts the newest commit first and the root last', () => {
    const ordered = topologicalOrder(DIAMOND);
    expect(ordered[0].oid).toBe('m');
    expect(ordered[ordered.length - 1].oid).toBe('root');
  });

  it('is independent of input order', () => {
    const shuffled = [DIAMOND[2], DIAMOND[0], DIAMOND[3], DIAMOND[1]];
    expect(topologicalOrder(shuffled).map((x) => x.oid)).toEqual(
      topologicalOrder(DIAMOND).map((x) => x.oid),
    );
  });

  it('ignores parents that are not in the input set', () => {
    const ordered = topologicalOrder([c('only', ['missing'], 1)]);
    expect(ordered.map((x) => x.oid)).toEqual(['only']);
  });

  it('terminates on a cycle instead of looping, and still emits every node', () => {
    const cyclic = [c('x', ['y'], 2), c('y', ['x'], 1)];
    const ordered = topologicalOrder(cyclic);
    expect(ordered.map((o) => o.oid).sort()).toEqual(['x', 'y']);
  });

  it('terminates on a self-referencing commit', () => {
    const ordered = topologicalOrder([c('loop', ['loop'], 1)]);
    expect(ordered.map((o) => o.oid)).toEqual(['loop']);
  });

  it('drops duplicate oids rather than placing them twice', () => {
    const ordered = topologicalOrder([c('dup', [], 1), c('dup', [], 2)]);
    expect(ordered).toHaveLength(1);
  });

  it('handles several disconnected roots deterministically', () => {
    const ordered = topologicalOrder([c('r1', [], 10), c('r2', [], 20)]);
    expect(ordered.map((o) => o.oid)).toEqual(['r2', 'r1']);
  });
});

/** `M x y` / `L x y` / final `C … x y` endpoints, in order. */
function pathPoints(path: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const commands = path.match(/[MLC][^MLC]*/g) ?? [];
  for (const command of commands) {
    const numbers = (command.slice(1).match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const x = numbers[numbers.length - 2];
    const y = numbers[numbers.length - 1];
    if (x !== undefined && y !== undefined) points.push([x, y]);
  }
  return points;
}

describe('edgePath', () => {
  it('draws a straight vertical line within one lane', () => {
    expect(edgePath(40, 10, 40, 110, 16)).toBe('M 40 10 L 40 110');
    expect(edgePath(40, 10, 40, 110, 16, 'bottom')).toBe('M 40 10 L 40 110');
  });

  it('turns at the top and then runs down the parent lane for a merge', () => {
    const path = edgePath(40, 10, 100, 410, 16, 'top');
    // Leaves the child immediately, so the long straight run is at the parent's x.
    expect(path).toMatch(/^M 40 10 C 40 /);
    expect(path).toMatch(/L 100 410$/);
    expect(path.match(/C/g)).toHaveLength(1);
  });

  it('runs down the child lane and turns at the bottom for a branch line', () => {
    const path = edgePath(40, 10, 100, 410, 16, 'bottom');
    // Stays in the child's lane, so the long straight run is at the child's x.
    expect(path).toMatch(/^M 40 10 L 40 /);
    expect(path).toMatch(/100 410$/);
    expect(path.match(/C/g)).toHaveLength(1);
  });

  it('starts at the child and ends at the parent, for both bends', () => {
    for (const bend of ['top', 'bottom'] as const) {
      const points = pathPoints(edgePath(40, 10, 180, 410, 16, bend));
      expect(points[0]).toEqual([40, 10]);
      expect(points[points.length - 1]).toEqual([180, 410]);
    }
  });

  it('descends monotonically, for both bends and any lane distance', () => {
    for (const bend of ['top', 'bottom'] as const) {
      for (const x2 of [0, 46, 92, 460]) {
        const ys = pathPoints(edgePath(138, 44, x2, 488, 16, bend)).map(([, y]) => y);
        for (let i = 1; i < ys.length; i += 1) {
          expect(ys[i], `${bend} ${x2}`).toBeGreaterThanOrEqual(ys[i - 1]);
        }
      }
    }
  });

  it('clamps the turn and omits the straight run when the rows are close', () => {
    expect(edgePath(40, 0, 100, 10, 16, 'top')).toBe('M 40 0 C 40 5 100 5 100 10');
    expect(edgePath(40, 0, 100, 10, 16, 'bottom')).toBe('M 40 0 C 40 5 100 5 100 10');
  });

  it('gives a wider lane jump more room to turn, so fans nest', () => {
    const near = edgePath(40, 0, 86, 400, 16, 'bottom');
    const far = edgePath(40, 0, 500, 400, 16, 'bottom');
    const nearTurn = pathPoints(near)[1]?.[1] ?? 0;
    const farTurn = pathPoints(far)[1]?.[1] ?? 0;
    expect(farTurn).toBeLessThan(nearTurn);
  });

  it('never produces NaN', () => {
    for (const r of [0, 1, 16, 1000]) {
      for (const bend of ['top', 'bottom'] as const) {
        expect(edgePath(0, 0, 50, 70, r, bend)).not.toContain('NaN');
      }
    }
  });

  it('degrades to a line when the parent is not below the child', () => {
    expect(edgePath(0, 100, 50, 100, 16)).toBe('M 0 100 L 50 100');
    expect(edgePath(0, 100, 50, 40, 16, 'bottom')).toBe('M 0 100 L 50 40');
  });
});

describe('layoutGraph', () => {
  it('assigns the mainline to lane 0 and a diverged branch to lane 1', () => {
    const layout = layoutGraph(DIAMOND);
    expect(nodeOf(layout, 'm').lane).toBe(0);
    expect(nodeOf(layout, 'a').lane).toBe(0);
    expect(nodeOf(layout, 'b').lane).toBe(1);
    expect(nodeOf(layout, 'root').lane).toBe(0);
    expect(layout.laneCount).toBe(2);
  });

  it('marks merges and roots', () => {
    const layout = layoutGraph(DIAMOND);
    expect(nodeOf(layout, 'm').isMerge).toBe(true);
    expect(nodeOf(layout, 'a').isMerge).toBe(false);
    expect(nodeOf(layout, 'root').isRoot).toBe(true);
    expect(nodeOf(layout, 'm').isRoot).toBe(false);
  });

  it('emits one edge per in-graph parent, tagged first vs merge', () => {
    const layout = layoutGraph(DIAMOND);
    expect(layout.edges).toHaveLength(4);
    const fromMerge = layout.edges.filter((e) => e.from === 'm');
    expect(fromMerge.map((e) => e.kind)).toEqual(['first', 'merge']);
    expect(fromMerge.find((e) => e.kind === 'merge')?.to).toBe('b');
  });

  it('colours each edge by its parent lane', () => {
    const layout = layoutGraph(DIAMOND);
    const mergeEdge = layout.edges.find((e) => e.id === 'm->b');
    expect(mergeEdge?.lane).toBe(1);
    expect(mergeEdge?.toLane).toBe(1);
  });

  it('never routes an edge through an unrelated node', () => {
    assertNoNodeInEdgeCorridor(layoutGraph(DIAMOND));
    assertNoOverlappingLegs(layoutGraph(DIAMOND));
  });

  it('gives every node a unique row and a unique row/lane cell', () => {
    const layout = layoutGraph(DIAMOND);
    const rows = new Set(layout.nodes.map((n) => n.row));
    const cells = new Set(layout.nodes.map((n) => `${n.row}:${n.lane}`));
    expect(rows.size).toBe(layout.nodes.length);
    expect(cells.size).toBe(layout.nodes.length);
  });

  it('places parents strictly below their children', () => {
    const layout = layoutGraph(DIAMOND);
    const rowOf = new Map(layout.nodes.map((n) => [n.oid, n.row]));
    for (const edge of layout.edges) {
      expect(rowOf.get(edge.from)).toBeLessThan(rowOf.get(edge.to) ?? -1);
    }
  });

  it('is deterministic under input reordering', () => {
    const shuffled = [DIAMOND[3], DIAMOND[1], DIAMOND[2], DIAMOND[0]];
    expect(layoutGraph(shuffled)).toEqual(layoutGraph(DIAMOND));
  });

  it('keeps a linear history in a single lane', () => {
    const chain = [c('c3', ['c2'], 3), c('c2', ['c1'], 2), c('c1', [], 1)];
    const layout = layoutGraph(chain);
    expect(layout.laneCount).toBe(1);
    expect(layout.nodes.map((n) => n.lane)).toEqual([0, 0, 0]);
    expect(layout.edges.every((e) => e.path.includes('L') && !e.path.includes('C'))).toBe(true);
  });

  it('reuses a lane once its branch has rejoined', () => {
    // Two successive diamonds: the second should reuse lane 1, not open lane 2.
    const commits = [
      c('r', [], 1),
      c('a1', ['r'], 2),
      c('b1', ['r'], 3),
      c('m1', ['a1', 'b1'], 4),
      c('a2', ['m1'], 5),
      c('b2', ['m1'], 6),
      c('m2', ['a2', 'b2'], 7),
    ];
    const layout = layoutGraph(commits);
    expect(layout.laneCount).toBe(2);
    assertNoNodeInEdgeCorridor(layout);
    assertNoOverlappingLegs(layout);
  });

  it('gives each concurrently open tip its own column', () => {
    // Four tips off one root. None may share a lane: two tips stacked in one
    // column with no edge between them would read as a chain.
    const commits = [
      c('r', [], 1),
      c('t1', ['r'], 2),
      c('t2', ['r'], 3),
      c('t3', ['r'], 4),
      c('t4', ['r'], 5),
    ];
    const layout = layoutGraph(commits);
    expect(layout.laneCount).toBe(4);
    expect(nodeOf(layout, 'r').lane).toBe(0);
    const tipLanes = ['t1', 't2', 't3', 't4'].map((o) => nodeOf(layout, o).lane);
    expect(new Set(tipLanes).size).toBe(4);
    assertNoNodeInEdgeCorridor(layout);
    assertNoOverlappingLegs(layout);
  });

  it('keeps each branch whole and in one column', () => {
    // Three independent two-commit branches off one root. Because the ordering
    // prefers the leftmost reserved lane, each branch is drawn from tip to fork
    // before the next one starts, and each gets a column of its own.
    const commits = [
      c('r', [], 1),
      c('a1', ['r'], 2),
      c('a2', ['a1'], 3),
      c('b1', ['r'], 4),
      c('b2', ['b1'], 5),
      c('d1', ['r'], 6),
      c('d2', ['d1'], 7),
    ];
    const layout = layoutGraph(commits);
    expect(layout.laneCount).toBe(3);
    expect(nodeOf(layout, 'r').lane).toBe(0);
    // Each branch's two commits share a lane and sit on adjacent rows.
    for (const [tip, base] of [
      ['a2', 'a1'],
      ['b2', 'b1'],
      ['d2', 'd1'],
    ] as const) {
      expect(nodeOf(layout, tip).lane).toBe(nodeOf(layout, base).lane);
      expect(nodeOf(layout, base).row - nodeOf(layout, tip).row).toBe(1);
    }
    // The three branches occupy three different columns.
    expect(new Set(['a1', 'b1', 'd1'].map((o) => nodeOf(layout, o).lane)).size).toBe(3);
    assertNoNodeInEdgeCorridor(layout);
    assertNoOverlappingLegs(layout);
  });

  it('opens a lane per parent when branches are genuinely concurrent', () => {
    // An octopus whose parents each have their own chain forces three lanes to
    // stay open simultaneously.
    const commits = [
      c('r', [], 1),
      c('p1', ['r'], 2),
      c('q1', ['p1'], 3),
      c('p2', ['r'], 4),
      c('q2', ['p2'], 5),
      c('p3', ['r'], 6),
      c('q3', ['p3'], 7),
      c('oct', ['q1', 'q2', 'q3'], 8),
    ];
    const layout = layoutGraph(commits);
    expect(layout.laneCount).toBe(3);
    expect(nodeOf(layout, 'oct').lane).toBe(0);
    expect(nodeOf(layout, 'r').lane).toBe(0);
    expect(new Set(['q1', 'q2', 'q3'].map((o) => nodeOf(layout, o).lane)).size).toBe(3);
    assertNoNodeInEdgeCorridor(layout);
    assertNoOverlappingLegs(layout);
  });

  it('handles an octopus merge without opening a corridor conflict', () => {
    const commits = [
      c('r', [], 1),
      c('p1', ['r'], 2),
      c('p2', ['r'], 3),
      c('p3', ['r'], 4),
      c('oct', ['p1', 'p2', 'p3'], 5),
    ];
    const layout = layoutGraph(commits);
    expect(nodeOf(layout, 'oct').isMerge).toBe(true);
    expect(layout.edges.filter((e) => e.from === 'oct')).toHaveLength(3);
    assertNoNodeInEdgeCorridor(layout);
    assertNoOverlappingLegs(layout);
  });

  it('derives geometry from the metrics it reports', () => {
    const layout = layoutGraph(DIAMOND, { rowHeight: 100, laneWidth: 50, paddingX: 10, paddingY: 20 });
    expect(nodeOf(layout, 'm')).toMatchObject({ x: 10, y: 20 });
    expect(nodeOf(layout, 'b')).toMatchObject({ x: 60, y: 220 });
    expect(layout.height).toBe(20 * 2 + 3 * 100);
    expect(layout.width).toBe(10 * 2 + 1 * 50);
  });

  it('lays out an empty graph without throwing', () => {
    const layout = layoutGraph([]);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.rowCount).toBe(0);
    expect(layout.laneCount).toBe(0);
  });

  it('lays out a single root commit', () => {
    const layout = layoutGraph([c('solo', [], 1)]);
    expect(layout.nodes).toHaveLength(1);
    expect(layout.edges).toHaveLength(0);
    expect(nodeOf(layout, 'solo').isRoot).toBe(true);
  });

  it('terminates and draws every node even for cyclic input', () => {
    const layout = layoutGraph([c('x', ['y'], 2), c('y', ['x'], 1)]);
    expect(layout.nodes).toHaveLength(2);
  });
});

describe('layout invariants hold for arbitrary DAGs', () => {
  it('does not route a branch line through an unrelated node (regression)', () => {
    // Minimised from a fuzz run. `c1` has a first parent that is already
    // lane-reserved AND a merge parent; the merge parent used to claim c1's
    // own lane, which suppressed the hold and let `c2` land inside the
    // corridor of the c1->c3 edge.
    const layout = layoutGraph([
      c('c0', ['c3'], 400),
      c('c1', ['c3', 'c2'], 318),
      c('c2', ['c3'], 217),
      c('c3', [], 130),
    ]);
    assertNoNodeInEdgeCorridor(layout);
  });

  /** Mulberry32, so the generated cases are the same on every run. */
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A random DAG: a commit may only parent commits created before it. */
  function randomDag(random: () => number, size: number): LayoutCommit[] {
    const commits: LayoutCommit[] = [];
    for (let i = 0; i < size; i += 1) {
      const parents: string[] = [];
      const maxParents = random() < 0.15 ? 3 : random() < 0.3 ? 2 : 1;
      for (let p = 0; p < maxParents && i > 0; p += 1) {
        const pick = `n${Math.floor(random() * i)}`;
        if (!parents.includes(pick)) parents.push(pick);
      }
      commits.push({ oid: `n${i}`, parents, timestamp: Math.floor(random() * 10_000) });
    }
    return commits;
  }

  it('holds the corridor and leg invariants across 400 random DAGs', () => {
    const random = rng(0x5f3a21);
    for (let i = 0; i < 400; i += 1) {
      const commits = randomDag(random, 2 + Math.floor(random() * 24));
      const layout = layoutGraph(commits);
      expect(layout.nodes).toHaveLength(commits.length);
      assertNoNodeInEdgeCorridor(layout);
    }
  });

  it('emits only well-formed, monotonically descending paths for random DAGs', () => {
    const random = rng(0x1234abc);
    for (let i = 0; i < 200; i += 1) {
      const layout = layoutGraph(randomDag(random, 2 + Math.floor(random() * 24)));
      for (const edge of layout.edges) {
        expect(edge.path).not.toContain('NaN');
        const ys = pathPoints(edge.path).map(([, y]) => y);
        for (let k = 1; k < ys.length; k += 1) {
          expect(ys[k]).toBeGreaterThanOrEqual(ys[k - 1]);
        }
      }
    }
  });

  it('clamps non-finite layout metrics instead of emitting NaN paths', () => {
    const layout = layoutGraph(DIAMOND, {
      rowHeight: Number.NaN,
      laneWidth: Number.POSITIVE_INFINITY,
      cornerRadius: Number.NaN,
    });
    for (const edge of layout.edges) expect(edge.path).not.toContain('NaN');
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    expect(Number.isFinite(layout.width)).toBe(true);
    expect(Number.isFinite(layout.height)).toBe(true);
  });
});

describe('describeGraph', () => {
  it('describes each row, its lane, and its parents for screen readers', () => {
    const lines = describeGraph(layoutGraph(DIAMOND), (oid) => oid.toUpperCase());
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('Row 1 of 4');
    expect(lines[0]).toContain('merge commit M');
    expect(lines[0]).toContain('parents: A');
    expect(lines[0]).toContain('and B');
    expect(lines[3]).toContain('root commit ROOT');
    expect(lines[3]).toContain('no parents');
  });
});
