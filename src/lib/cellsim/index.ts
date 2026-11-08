// TEMP STUB — replaced at integration. Signatures must match SPEC.md §4.
//
// Deterministic, seeded 2D particle flow through a capillary with a
// constriction, per SPEC §4.4. Runs headless via `step()` — no canvas, no DOM —
// so FunctionalAssayAgent can call it. Same seed + same params ⇒ identical
// metrics.
//
// SPEC §4.4 names the behaviour and the exposed metrics but does not fix the
// function signatures beyond "must run headless via step()". The shapes below
// are this stub's reading of it; see the integration notes in the PR body.
//
// ILLUSTRATIVE MODEL. This is not validated haemorheology. It is a toy
// particle model whose constants were chosen to read clearly on screen.

/** Oxygen tension bounds, mmHg. Mirrors data/loci.json `simulation.pO2`. */
export const PO2_MIN = 10;
export const PO2_MAX = 100;

export interface CellSimParams {
  readonly seed: number;
  readonly cellCount: number;
  /** Oxygen tension, mmHg. */
  readonly pO2: number;
  /** 0–1; how far the capillary narrows at its waist. */
  readonly capillaryConstriction: number;
  /** 0–1, from the genotype's structural annotation. */
  readonly polymerizationTendency: number;
}

export type CellShape = 'discoid' | 'sickled';

export interface Cell {
  readonly id: number;
  /** Normalised 0–1 along the capillary. */
  readonly x: number;
  /** Normalised 0–1 across the capillary. */
  readonly y: number;
  readonly vx: number;
  readonly state: CellShape;
  /** Radians; purely presentational, derived from position. */
  readonly orientation: number;
}

export interface SimMetrics {
  /** 0–1. Fraction of the constriction's capacity that is blocked. */
  readonly occlusion: number;
  /** Mean axial velocity, normalised units per tick. */
  readonly meanFlow: number;
  /** 0–1. Fraction of cells currently sickled. */
  readonly sickledFraction: number;
}

export interface SimState {
  readonly tick: number;
  readonly cells: readonly Cell[];
  readonly metrics: SimMetrics;
  readonly params: CellSimParams;
}

/** Mulberry32 — small, fast, fully deterministic from a 32-bit seed. */
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

/** Where the capillary is narrowest, along x. */
const WAIST = 0.52;
const WAIST_WIDTH = 0.16;

/** Channel half-height at x, in normalised units. */
export function channelHalfHeight(x: number, constriction: number): number {
  const d = (x - WAIST) / WAIST_WIDTH;
  const bell = Math.exp(-d * d);
  return 0.5 * (1 - constriction * bell);
}

/** Oxygen tension below which the model starts to sickle at all, mmHg. */
const SICKLING_ONSET = 60;
/** Scales the onset rate. Chosen so the curated genotypes separate clearly. */
const ONSET_RATE = 0.15;
/**
 * Floor on the relaxation rate, so the two rates reach an equilibrium instead
 * of every cell eventually sickling given enough ticks. Without it, a genotype
 * with a very low tendency still ends up fully sickled, which would make the
 * repaired allele indistinguishable from the pathogenic one.
 */
const RELAX_FLOOR = 0.02;

/**
 * Probability per tick that a discoid cell sickles. Rises as pO2 falls and as
 * polymerization tendency rises. Both terms are squared: fibre formation is
 * cooperative, so the response is markedly non-linear in each. Above
 * `SICKLING_ONSET` the deoxygenation term is zero and nothing sickles.
 */
function sicklingPressure(pO2: number, tendency: number): number {
  const deoxy = Math.max(0, (SICKLING_ONSET - pO2) / (SICKLING_ONSET - PO2_MIN));
  const clamped = clamp01(tendency);
  return Math.min(1, ONSET_RATE * clamped * clamped * deoxy * deoxy);
}

/** Probability per tick that a sickled cell relaxes back to discoid. */
function unsicklingPressure(pO2: number): number {
  const reoxy = Math.max(0, (pO2 - SICKLING_ONSET) / (PO2_MAX - SICKLING_ONSET));
  return RELAX_FLOOR + 0.3 * reoxy;
}

/**
 * The equilibrium sickled fraction the model tends toward, ignoring the small
 * extra relaxation from cells recycling at the inlet. Exposed because the
 * verifier reasons about steady state, not about a single frame.
 */
export function equilibriumSickledFraction(pO2: number, tendency: number): number {
  const on = sicklingPressure(pO2, tendency);
  const off = unsicklingPressure(pO2);
  return on + off === 0 ? 0 : on / (on + off);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function measure(cells: readonly Cell[], params: CellSimParams): SimMetrics {
  if (cells.length === 0) {
    return { occlusion: 0, meanFlow: 0, sickledFraction: 0 };
  }
  let sickled = 0;
  let flow = 0;
  let inWaist = 0;
  let sickledInWaist = 0;
  for (const cell of cells) {
    if (cell.state === 'sickled') sickled += 1;
    flow += cell.vx;
    if (Math.abs(cell.x - WAIST) < WAIST_WIDTH) {
      inWaist += 1;
      if (cell.state === 'sickled') sickledInWaist += 1;
    }
  }
  // Capacity of the waist scales with how open it is.
  const waistCapacity = Math.max(
    1,
    cells.length * 0.55 * (1 - params.capillaryConstriction),
  );
  const crowding = inWaist / waistCapacity;
  const stiffness = inWaist === 0 ? 0 : sickledInWaist / inWaist;
  return {
    occlusion: clamp01(crowding * stiffness),
    meanFlow: flow / cells.length,
    sickledFraction: sickled / cells.length,
  };
}

const BASE_SPEED = 0.0075;

export function createSim(params: CellSimParams): SimState {
  const random = rng(params.seed);
  const cells: Cell[] = [];
  for (let i = 0; i < params.cellCount; i += 1) {
    const x = random();
    const half = channelHalfHeight(x, params.capillaryConstriction);
    const y = 0.5 + (random() * 2 - 1) * half * 0.86;
    cells.push({
      id: i,
      x,
      y,
      vx: BASE_SPEED * (0.7 + random() * 0.6),
      state: 'discoid',
      orientation: random() * Math.PI,
    });
  }
  return { tick: 0, cells, metrics: measure(cells, params), params };
}

/**
 * Advance one tick. Pure: returns a new state and never touches a canvas.
 * The RNG is re-derived from `seed + tick`, so stepping the same state twice
 * gives the same result and a run is reproducible from its params alone.
 */
export function step(state: SimState): SimState {
  const p = state.params;
  const tick = state.tick + 1;
  const random = rng((p.seed ^ (tick * 0x9e3779b1)) >>> 0);
  const onsetP = sicklingPressure(p.pO2, p.polymerizationTendency);
  const offP = unsicklingPressure(p.pO2);
  const occlusion = state.metrics.occlusion;

  const cells = state.cells.map((cell): Cell => {
    let next: CellShape = cell.state;
    if (cell.state === 'discoid') {
      if (random() < onsetP) next = 'sickled';
    } else if (random() < offP) {
      next = 'discoid';
    }

    const half = channelHalfHeight(cell.x, p.capillaryConstriction);
    // Plug flow: faster mid-channel, slower at the wall.
    const offset = Math.abs(cell.y - 0.5) / Math.max(half, 1e-6);
    const profile = Math.max(0.15, 1 - offset * offset);
    // Sickled cells gain drag, and a jammed waist slows everything behind it.
    const drag = next === 'sickled' ? 0.42 : 1;
    const jam = 1 - 0.75 * occlusion;
    const vx = BASE_SPEED * profile * drag * jam * (0.85 + random() * 0.3);

    let x = cell.x + vx;
    let y = cell.y;
    if (x > 1) {
      // Recycle at the inlet so cell count — and therefore the metrics
      // denominator — stays constant.
      x -= 1;
      const inletHalf = channelHalfHeight(x, p.capillaryConstriction);
      y = 0.5 + (random() * 2 - 1) * inletHalf * 0.86;
      next = 'discoid';
    }
    // Keep cells inside the (possibly narrowing) channel walls.
    const halfAtX = channelHalfHeight(x, p.capillaryConstriction);
    const maxOffset = halfAtX * 0.9;
    if (Math.abs(y - 0.5) > maxOffset) {
      y = 0.5 + Math.sign(y - 0.5) * maxOffset;
    }

    return {
      id: cell.id,
      x,
      y,
      vx,
      state: next,
      orientation: next === 'sickled' ? cell.orientation : cell.orientation + vx * 6,
    };
  });

  return { tick, cells, metrics: measure(cells, p), params: p };
}

/**
 * Headless run used by FunctionalAssayAgent. Returns settled metrics after
 * `ticks` steps. Deterministic for a given params + ticks.
 */
export function runHeadless(params: CellSimParams, ticks = 240): SimMetrics {
  let state = createSim(params);
  // Average over the tail so a single frame's crowding does not dominate.
  let occlusion = 0;
  let meanFlow = 0;
  let sickledFraction = 0;
  const window = Math.max(1, Math.floor(ticks / 4));
  for (let i = 0; i < ticks; i += 1) {
    state = step(state);
    if (i >= ticks - window) {
      occlusion += state.metrics.occlusion;
      meanFlow += state.metrics.meanFlow;
      sickledFraction += state.metrics.sickledFraction;
    }
  }
  return {
    occlusion: occlusion / window,
    meanFlow: meanFlow / window,
    sickledFraction: sickledFraction / window,
  };
}
