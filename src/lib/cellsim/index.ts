// TEMP STUB — replaced at integration. Signatures must match SPEC.md §4.
//
// SPEC.md §4.4 `lib/cellsim`. Deterministic, seeded, headless. No canvas, no
// DOM, no React — `FunctionalAssayAgent` calls `step()` directly.
//
// SPEC §4.4 names the exposed metrics (`occlusion`, `meanFlow`,
// `sickledFraction`), the `pO2` control, the per-cell `discoid | sickled`
// state and the requirement that `step()` run headless, but does not give the
// function signatures. The shapes below are this variant's literal reading and
// are flagged as unspecified in the final report.
//
// Model, stated plainly so a reviewer can re-derive it:
//   * Each cell draws a fixed `susceptibility` in [0,1) once, from the seeded
//     PRNG. A cell is sickled whenever `polymerizationTendency × hypoxia`
//     exceeds its susceptibility, where hypoxia rises from 0 at the onset
//     tension to 1 at zero pO2. So the *probability* that a given cell is
//     sickled rises as pO2 falls and as tendency rises, exactly as SPEC §4.4
//     requires, but a particular run is reproducible rather than stochastic.
//   * Sickled cells are stiff: they gain drag, and in the constriction they
//     jam, creeping instead of flowing.
//   * `occlusion` is weighted occupancy of the constriction against the gap
//     the constriction leaves, with a sickled cell counted as occupying far
//     more of it than a deformable discoid one.
//
// HONEST LIMITS: this is an illustrative teaching model, not validated
// haemorheology. Its parameters were chosen so the demo reads clearly on
// screen. No number it produces is a prediction about a real cell, a real
// capillary or a real patient. The UI states this wherever these numbers
// appear (SPEC §7.7).

export interface SimParams {
  /** Integer seed. Same seed + same params ⇒ identical metrics. */
  readonly seed: number;
  readonly cellCount: number;
  /** Oxygen tension, mmHg. */
  readonly pO2: number;
  /** Fractional narrowing of the channel at the constriction, 0–1. */
  readonly constriction: number;
  /** Genotype-derived, 0–1. Reference ≈ 0, sickle allele high, repaired low. */
  readonly polymerizationTendency: number;
}

export type CellState = 'discoid' | 'sickled';

export interface Cell {
  readonly id: number;
  /** Normalised position along the capillary, 0–1. */
  readonly x: number;
  /** Normalised offset across the capillary, -1 (wall) to 1 (wall). */
  readonly y: number;
  readonly state: CellState;
  /** Fixed per-cell threshold in [0,1). Drawn once, never re-rolled. */
  readonly susceptibility: number;
  /** Current axial speed in normalised units per step. */
  readonly speed: number;
  /** True while the cell is stuck at the constriction. */
  readonly jammed: boolean;
}

export interface SimMetrics {
  /** 0–1. Share of the constriction's cross-section obstructed. */
  readonly occlusion: number;
  /** Mean axial speed across all cells, normalised units per step. */
  readonly meanFlow: number;
  /** 0–1. Share of cells currently in the sickled state. */
  readonly sickledFraction: number;
}

export interface SimState {
  readonly params: SimParams;
  readonly cells: readonly Cell[];
  readonly tick: number;
  readonly metrics: SimMetrics;
  /** Opaque PRNG cursor; carried so `step` stays a pure function of state. */
  readonly rngCursor: number;
}

/** Normalised axial position of the constriction. */
export const CONSTRICTION_X = 0.55;
/** Half-width of the constricted zone, in normalised axial units. */
export const CONSTRICTION_HALF_WIDTH = 0.07;

/** Below this pO2, sickling begins for a polymerisation-prone genotype. */
export const SICKLING_ONSET_PO2 = 60;

/** Free-flow axial speed mid-channel, normalised units per step. */
const BASE_SPEED = 0.006;
/** A jammed cell creeps rather than stopping dead, so jams can clear. */
const CREEP_SPEED = 0.0004;
/**
 * Occlusion measures *pathological* blockage, so a deformable discoid cell
 * contributes nothing to it: a genotype with no sickled cells reads 0 by
 * construction, however narrow the channel is. Geometric narrowing is the
 * constriction's own property and is already in the denominator.
 */
const DISCOID_FOOTPRINT = 0;
/** Share of the gap a stiff sickled cell occupies. */
const SICKLED_FOOTPRINT = 1;

/** mulberry32 — small, fast, fully deterministic from a 32-bit seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A PRNG positioned at `cursor` draws, so state carries no closure. */
function rngAt(seed: number, cursor: number): () => number {
  const rng = mulberry32(seed);
  for (let i = 0; i < cursor; i += 1) rng();
  return rng;
}

/** Channel half-height at an axial position, 0–1. */
export function channelHalfHeight(x: number, constriction: number): number {
  const d = Math.abs(x - CONSTRICTION_X);
  if (d >= CONSTRICTION_HALF_WIDTH) return 1;
  // Smooth cosine taper into the constriction.
  const t = 1 - d / CONSTRICTION_HALF_WIDTH;
  const depth = Math.min(Math.max(constriction, 0), 0.95);
  return 1 - depth * (0.5 - 0.5 * Math.cos(Math.PI * t));
}

/** 0 at or above the onset tension, rising to 1 at zero pO2. */
export function hypoxia(pO2: number): number {
  return Math.min(Math.max((SICKLING_ONSET_PO2 - pO2) / SICKLING_ONSET_PO2, 0), 1);
}

/**
 * Probability that any given cell is sickled: the expected sickled fraction
 * at this pO2 for this genotype. Rises as pO2 falls and as
 * polymerizationTendency rises; zero for a genotype with no tendency.
 */
export function sicklingProbability(pO2: number, polymerizationTendency: number): number {
  if (polymerizationTendency <= 0) return 0;
  return Math.min(Math.max(polymerizationTendency, 0), 1) * hypoxia(pO2);
}

function stateFor(cell: Cell, params: SimParams): CellState {
  return sicklingProbability(params.pO2, params.polymerizationTendency) > cell.susceptibility
    ? 'sickled'
    : 'discoid';
}

function measure(cells: readonly Cell[], params: SimParams): SimMetrics {
  if (cells.length === 0) return { occlusion: 0, meanFlow: 0, sickledFraction: 0 };

  const sickled = cells.filter((c) => c.state === 'sickled').length;
  const meanFlow = cells.reduce((sum, c) => sum + c.speed, 0) / cells.length;

  const inZone = cells.filter((c) => Math.abs(c.x - CONSTRICTION_X) < CONSTRICTION_HALF_WIDTH);
  const gap = channelHalfHeight(CONSTRICTION_X, params.constriction) * 2;

  // Capacity: how much weighted occupancy the constriction would carry if the
  // cells were spread uniformly through an unobstructed channel.
  const uniformOccupancy = cells.length * CONSTRICTION_HALF_WIDTH * 2;
  const capacity = Math.max(uniformOccupancy * gap, 1);

  const weighted = inZone.reduce(
    (sum, c) => sum + (c.state === 'sickled' ? SICKLED_FOOTPRINT : DISCOID_FOOTPRINT),
    0,
  );

  return {
    occlusion: Math.min(Math.max(weighted / capacity, 0), 1),
    meanFlow,
    sickledFraction: sickled / cells.length,
  };
}

export function createSim(params: SimParams): SimState {
  const rng = mulberry32(params.seed);
  let cursor = 0;
  const draw = (): number => {
    cursor += 1;
    return rng();
  };

  const cells: Cell[] = [];
  for (let id = 0; id < params.cellCount; id += 1) {
    const x = draw();
    const y = (draw() * 2 - 1) * 0.85;
    const susceptibility = draw();
    const seed: Cell = {
      id,
      x,
      y,
      susceptibility,
      state: 'discoid',
      speed: BASE_SPEED,
      jammed: false,
    };
    cells.push({ ...seed, state: stateFor(seed, params) });
  }

  return { params, cells, tick: 0, metrics: measure(cells, params), rngCursor: cursor };
}

/**
 * Advance one step. Pure: same input state ⇒ same output state.
 * Headless — touches no canvas and no DOM.
 */
export function step(state: SimState): SimState {
  const { params } = state;
  const rng = rngAt(params.seed, state.rngCursor);
  let cursor = state.rngCursor;
  const draw = (): number => {
    cursor += 1;
    return rng();
  };

  const upstreamCongestion = state.metrics.occlusion;

  const next: Cell[] = state.cells.map((cell) => {
    const nextState = stateFor(cell, params);

    const halfHeight = channelHalfHeight(cell.x, params.constriction);
    const inZone = Math.abs(cell.x - CONSTRICTION_X) < CONSTRICTION_HALF_WIDTH;

    // A stiff cell cannot deform through a gap much narrower than itself.
    // Deterministic: the same per-cell constant decides, so the run replays.
    const jammed =
      nextState === 'sickled' && inZone && halfHeight < 0.75 && cell.susceptibility < 0.8;

    // Poiseuille-ish profile: faster mid-channel, slower near the wall, slowed
    // further by whatever is already congesting the constriction.
    const wallFactor = 1 - Math.min(Math.abs(cell.y) / Math.max(halfHeight, 0.05), 1) ** 2 * 0.6;
    const drag = nextState === 'sickled' ? 0.45 : 1;
    const congestion = Math.max(1 - 0.8 * upstreamCongestion, 0.05);
    const speed = jammed ? CREEP_SPEED : BASE_SPEED * wallFactor * drag * congestion;

    let x = cell.x + speed;
    let y = cell.y;
    let susceptibility = cell.susceptibility;

    // Recycle at the far end so the field stays populated. A recycled cell is
    // a new cell: it draws a fresh position and a fresh susceptibility.
    if (x > 1) {
      x -= 1;
      y = (draw() * 2 - 1) * 0.85;
      susceptibility = draw();
    }

    // Keep the cell inside the channel wall.
    const limit = channelHalfHeight(x, params.constriction) * 0.9;
    if (Math.abs(y) > limit) y = Math.sign(y) * limit;

    const moved: Cell = { id: cell.id, x, y, susceptibility, state: nextState, speed, jammed };
    return { ...moved, state: stateFor(moved, params) };
  });

  return {
    params,
    cells: next,
    tick: state.tick + 1,
    metrics: measure(next, params),
    rngCursor: cursor,
  };
}

/** Current metrics for a state. */
export function metrics(state: SimState): SimMetrics {
  return state.metrics;
}

/**
 * Run `steps` steps headlessly and return the final metrics. This is the entry
 * point `FunctionalAssayAgent` uses; it must not require a canvas.
 */
export function runHeadless(params: SimParams, steps: number): SimMetrics {
  let state = createSim(params);
  for (let i = 0; i < steps; i += 1) state = step(state);
  return state.metrics;
}
