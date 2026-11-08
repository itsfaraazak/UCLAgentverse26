import { describe, expect, it } from 'vitest';
import { B_DNA, codonSpan, helixLayout } from './layout';

const HBB_CODONS = 147;
const HBB_BASES = HBB_CODONS * 3;

function hypot3(dx: number, dy: number, dz: number): number {
  return Math.hypot(dx, dy, dz);
}

describe('helixLayout', () => {
  it('lays out 147 codons as 441 nodes with 1-based codonIndex and offsets 0,1,2', () => {
    const layout = helixLayout({ codonCount: HBB_CODONS });
    expect(layout.nodes).toHaveLength(HBB_BASES);

    for (let i = 0; i < layout.nodes.length; i += 1) {
      const node = layout.nodes[i];
      expect(node).toBeDefined();
      if (node === undefined) continue;
      expect(node.baseIndex).toBe(i);
      expect(node.codonIndex).toBe(Math.floor(i / 3) + 1);
      expect(node.offsetInCodon).toBe(i % 3);
    }

    for (let codon = 1; codon <= HBB_CODONS; codon += 1) {
      const inCodon = layout.nodes.filter((node) => node.codonIndex === codon);
      expect(inCodon).toHaveLength(3);
      expect(inCodon.map((node) => node.offsetInCodon)).toEqual([0, 1, 2]);
    }
  });

  it('advances the axis by rise each base and reports axisLength as (n-1)*rise', () => {
    const layout = helixLayout({ codonCount: HBB_CODONS });
    const { rise } = layout.params;

    for (let i = 0; i < layout.nodes.length; i += 1) {
      const node = layout.nodes[i];
      expect(node).toBeDefined();
      if (node === undefined) continue;
      expect(node.axis.x).toBe(0);
      expect(node.axis.z).toBe(0);
      expect(node.axis.y).toBeCloseTo(i * rise);
      if (i > 0) {
        const prev = layout.nodes[i - 1];
        expect(prev).toBeDefined();
        if (prev === undefined) continue;
        expect(node.axis.y - prev.axis.y).toBeCloseTo(rise);
        expect(node.axis.y).toBeGreaterThan(prev.axis.y);
      }
    }

    expect(layout.axisLength).toBeCloseTo((HBB_BASES - 1) * rise);
  });

  it('places both strands at radius from the axis', () => {
    const layout = helixLayout({ codonCount: HBB_CODONS });
    const { radius } = layout.params;

    for (const node of layout.nodes) {
      const distA = hypot3(
        node.strandA.x - node.axis.x,
        node.strandA.y - node.axis.y,
        node.strandA.z - node.axis.z,
      );
      const distB = hypot3(
        node.strandB.x - node.axis.x,
        node.strandB.y - node.axis.y,
        node.strandB.z - node.axis.z,
      );
      expect(distA).toBeCloseTo(radius);
      expect(distB).toBeCloseTo(radius);
    }
  });

  it('gives a unit rungDirection from strandB toward strandA', () => {
    const layout = helixLayout({ codonCount: HBB_CODONS });

    for (const node of layout.nodes) {
      const { rungDirection: d, rungLength, strandA, strandB } = node;
      const mag = hypot3(d.x, d.y, d.z);
      expect(mag).toBeCloseTo(1);

      expect(strandB.x + d.x * rungLength).toBeCloseTo(strandA.x);
      expect(strandB.y + d.y * rungLength).toBeCloseTo(strandA.y);
      expect(strandB.z + d.z * rungLength).toBeCloseTo(strandA.z);
    }
  });

  it('advances strandA angle by 2π after basesPerTurn bases', () => {
    const basesPerTurn = 10;
    const layout = helixLayout({ codonCount: 20, basesPerTurn });
    const step = basesPerTurn;

    for (let i = 0; i + step < layout.nodes.length; i += 1) {
      const here = layout.nodes[i];
      const later = layout.nodes[i + step];
      expect(here).toBeDefined();
      expect(later).toBeDefined();
      if (here === undefined || later === undefined) continue;
      expect(later.angle - here.angle).toBeCloseTo(Math.PI * 2);
    }
  });

  it('throws RangeError for invalid codonCount or a non-finite radius', () => {
    expect(() => helixLayout({ codonCount: 0 })).toThrow(RangeError);
    expect(() => helixLayout({ codonCount: -1 })).toThrow(RangeError);
    expect(() => helixLayout({ codonCount: 2.5 })).toThrow(RangeError);
    expect(() => helixLayout({ codonCount: 3, radius: Number.NaN })).toThrow(RangeError);
    expect(() => helixLayout({ codonCount: 3, radius: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it('is deterministic for identical params', () => {
    const params = { codonCount: 12, rise: 0.4, radius: 1.2, basesPerTurn: 10, strandPhase: 2 };
    expect(helixLayout(params)).toEqual(helixLayout(params));
  });
});

describe('codonSpan', () => {
  it('returns a middle codon’s three nodes and the mean of their rungCenters', () => {
    const layout = helixLayout({ codonCount: HBB_CODONS });
    const codonIndex = 74;
    const span = codonSpan(layout, codonIndex);
    expect(span).toBeDefined();
    if (span === undefined) return;

    expect(span.nodes).toHaveLength(3);
    expect(span.nodes.every((node) => node.codonIndex === codonIndex)).toBe(true);
    expect(span.nodes.map((node) => node.offsetInCodon)).toEqual([0, 1, 2]);

    const mean = {
      x: span.nodes.reduce((sum, node) => sum + node.rungCenter.x, 0) / 3,
      y: span.nodes.reduce((sum, node) => sum + node.rungCenter.y, 0) / 3,
      z: span.nodes.reduce((sum, node) => sum + node.rungCenter.z, 0) / 3,
    };
    expect(span.center.x).toBeCloseTo(mean.x);
    expect(span.center.y).toBeCloseTo(mean.y);
    expect(span.center.z).toBeCloseTo(mean.z);
  });

  it('returns undefined for out-of-range codonIndex', () => {
    const layout = helixLayout({ codonCount: HBB_CODONS });
    expect(codonSpan(layout, 0)).toBeUndefined();
    expect(codonSpan(layout, HBB_CODONS + 1)).toBeUndefined();
  });
});

describe('B_DNA', () => {
  it('supplies the omitted knobs when only codonCount is given', () => {
    const layout = helixLayout({ codonCount: 1 });
    expect(layout.params).toEqual({ codonCount: 1, ...B_DNA });
  });
});

describe('helixLayout — degenerate strand phase', () => {
  it('refuses a phase that collapses the two strands onto each other', () => {
    // sin(phase/2) === 0 ⇒ zero-length rung ⇒ NaN rungDirection. A silently
    // invisible helix is worse than a thrown error.
    expect(() => helixLayout({ codonCount: 4, strandPhase: Math.PI * 2 })).toThrow(RangeError);
    expect(() => helixLayout({ codonCount: 4, strandPhase: Math.PI * 4 })).toThrow(/multiple of 2/);
  });

  it('still produces finite geometry at the default phase', () => {
    const { nodes } = helixLayout({ codonCount: 147 });
    expect(nodes).toHaveLength(441);
    for (const n of nodes) {
      expect(Number.isFinite(n.rungLength)).toBe(true);
      expect(n.rungLength).toBeGreaterThan(0);
      expect(Number.isFinite(n.rungDirection.x)).toBe(true);
    }
  });
});
