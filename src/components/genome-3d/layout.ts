/**
 * Pure numeric geometry for a B-DNA double helix that runs a coding sequence.
 * Kept framework-free so the same numbers can be unit-tested in node and later
 * fed to a Three.js InstancedMesh without the maths living in the renderer.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Geometry knobs for the helix. Defaults in `B_DNA`. */
export interface HelixParams {
  /** Number of codons in the coding region. Must be a positive integer. */
  readonly codonCount: number;
  /** World units the helix advances along its axis per base pair. */
  readonly rise: number;
  /** Distance from the central axis to a strand. */
  readonly radius: number;
  /** Base pairs per full 360 degree turn. */
  readonly basesPerTurn: number;
  /**
   * Radians separating the two strands about the axis, which is what makes
   * the major and minor grooves different widths.
   */
  readonly strandPhase: number;
}

/**
 * B-DNA-ish proportions, scaled to convenient world units. Rise and turn
 * follow textbook B-form (~3.4 Å, 10.5 bp/turn); radius is 1 so the helix
 * frames easily; phase is off π so the grooves are unequal.
 */
export const B_DNA: Omit<HelixParams, 'codonCount'> = {
  rise: 0.34,
  radius: 1,
  basesPerTurn: 10.5,
  strandPhase: 2.1,
};

/** One base pair: a rung between the two strands. */
export interface BaseNode {
  /** 0-based index over the whole sequence. */
  readonly baseIndex: number;
  /** 1-based codon number, i.e. floor(baseIndex / 3) + 1. */
  readonly codonIndex: number;
  /** 0, 1 or 2 — position of this base inside its codon. */
  readonly offsetInCodon: number;
  /** Point on the central axis at this base pair. */
  readonly axis: Vec3;
  /** Base position on the sense strand. */
  readonly strandA: Vec3;
  /** Base position on the antisense strand. */
  readonly strandB: Vec3;
  /** Midpoint of the rung (equals `axis`). */
  readonly rungCenter: Vec3;
  /** Unit vector pointing from strandB to strandA. */
  readonly rungDirection: Vec3;
  /** Length of the rung, strandB to strandA. */
  readonly rungLength: number;
  /** Angle of strandA about the axis, radians. */
  readonly angle: number;
}

export interface HelixLayout {
  readonly nodes: readonly BaseNode[];
  readonly params: HelixParams;
  /** Axial length from the first to the last base pair. */
  readonly axisLength: number;
  /** Centre of the whole helix, for framing a camera. */
  readonly center: Vec3;
}

const TWO_PI = Math.PI * 2;

function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer, got ${String(value)}`);
  }
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive number, got ${String(value)}`);
  }
}

function resolveParams(input: Partial<HelixParams> & { codonCount: number }): HelixParams {
  const params: HelixParams = {
    codonCount: input.codonCount,
    rise: input.rise ?? B_DNA.rise,
    radius: input.radius ?? B_DNA.radius,
    basesPerTurn: input.basesPerTurn ?? B_DNA.basesPerTurn,
    strandPhase: input.strandPhase ?? B_DNA.strandPhase,
  };
  assertPositiveInteger('codonCount', params.codonCount);
  assertPositiveFinite('rise', params.rise);
  assertPositiveFinite('radius', params.radius);
  assertPositiveFinite('basesPerTurn', params.basesPerTurn);
  assertPositiveFinite('strandPhase', params.strandPhase);
  // At a phase that is a whole number of turns the two strands coincide, the
  // rung has zero length and `rungDirection` would be NaN. Refuse it here
  // rather than emit geometry that silently renders as nothing.
  if (Math.abs(Math.sin(params.strandPhase / 2)) < 1e-9) {
    throw new RangeError(
      `strandPhase must not be a multiple of 2π (the strands would coincide), got ${String(params.strandPhase)}`,
    );
  }
  return params;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function mean(points: readonly Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const n = points.length;
  return vec3(x / n, y / n, z / n);
}

/**
 * Lay out every base pair of a coding-region helix. Axis along +Y from y = 0
 * so a later camera can frame `center` without knowing about strands.
 */
export function helixLayout(params: Partial<HelixParams> & { codonCount: number }): HelixLayout {
  const resolved = resolveParams(params);
  const baseCount = resolved.codonCount * 3;
  const nodes: BaseNode[] = [];

  for (let i = 0; i < baseCount; i += 1) {
    const y = i * resolved.rise;
    const angle = (i * TWO_PI) / resolved.basesPerTurn;
    const angleB = angle + resolved.strandPhase;
    const axis = vec3(0, y, 0);
    const strandA = vec3(resolved.radius * Math.cos(angle), y, resolved.radius * Math.sin(angle));
    const strandB = vec3(resolved.radius * Math.cos(angleB), y, resolved.radius * Math.sin(angleB));
    const rungLength = distance(strandA, strandB);
    const rungDirection = vec3(
      (strandA.x - strandB.x) / rungLength,
      (strandA.y - strandB.y) / rungLength,
      (strandA.z - strandB.z) / rungLength,
    );
    nodes.push({
      baseIndex: i,
      codonIndex: Math.floor(i / 3) + 1,
      offsetInCodon: i % 3,
      axis,
      strandA,
      strandB,
      rungCenter: axis,
      rungDirection,
      rungLength,
      angle,
    });
  }

  const axisLength = (baseCount - 1) * resolved.rise;
  return {
    nodes,
    params: resolved,
    axisLength,
    center: vec3(0, axisLength / 2, 0),
  };
}

/**
 * The axial span of one 1-based codon: its three base pairs.
 * Returns undefined when `codonIndex` is out of range so callers can
 * highlight without a bounds check of their own.
 */
export function codonSpan(
  layout: HelixLayout,
  codonIndex: number,
): {
  readonly start: Vec3;
  readonly end: Vec3;
  readonly center: Vec3;
  readonly nodes: readonly BaseNode[];
} | undefined {
  if (!Number.isInteger(codonIndex) || codonIndex < 1 || codonIndex > layout.params.codonCount) {
    return undefined;
  }
  const startIndex = (codonIndex - 1) * 3;
  const nodes = layout.nodes.slice(startIndex, startIndex + 3);
  if (nodes.length !== 3) {
    return undefined;
  }
  const first = nodes[0];
  const last = nodes[2];
  if (first === undefined || last === undefined) {
    return undefined;
  }
  return {
    start: first.axis,
    end: last.axis,
    center: mean(nodes.map((node) => node.rungCenter)),
    nodes,
  };
}
