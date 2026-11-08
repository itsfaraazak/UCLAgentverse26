// TEMP STUB — replaced at integration. Signatures must match SPEC.md §4.
//
// Deterministic, seeded 2D particle flow through a capillary with a
// constriction. Pure and framework-free: no canvas, no DOM, no timers, so
// `FunctionalAssayAgent` can call `run()` headless.
//
// ILLUSTRATIVE MODEL. Not validated haemorheology. See SPEC.md §7.7.

/** Per-cell shape state. */
export type CellState = 'discoid' | 'sickled';

export interface Cell {
  readonly id: number;
  /** Axial position, 0 → 1 along the capillary. */
  readonly x: number;
  /** Transverse position, 0 → 1 across the capillary. */
  readonly y: number;
  /** Axial velocity in channel-lengths per tick, as actually moved. */
  readonly vx: number;
  readonly radius: number;
  readonly state: CellState;
}

export interface SimParams {
  readonly seed: number;
  readonly cellCount: number;
  /** Oxygen tension, mmHg. */
  readonly pO2: number;
  /** Genotype-derived sickling propensity, 0 → 1. */
  readonly polymerizationTendency: number;
  /** 0 → 1; fraction of the lumen removed at the narrowest point. */
  readonly capillaryConstriction: number;
}

/** Exposed metrics — the contract the assay agent and the UI read. */
export interface SimMetrics {
  /** 0 → 1. 1 means the constriction is fully jammed. */
  readonly occlusion: number;
  /** Mean axial velocity, channel-lengths per tick. */
  readonly meanFlow: number;
  /** 0 → 1. Fraction of cells currently in the sickled state. */
  readonly sickledFraction: number;
}

export interface SimState extends SimMetrics {
  readonly tick: number;
  readonly cells: readonly Cell[];
  readonly params: SimParams;
}

export const PO2_SICKLING_ONSET = 60;
export const PO2_SPREAD = 14;

const BASE_SPEED = 0.0045;
const SICKLED_DRAG = 0.3;
const SICKLED_ELONGATION = 1.9;
const SWITCH_RATE = 0.06;
/** Speed, as a fraction of unimpeded, that a queued cell still creeps at. */
const LANE_CREEP = 0.45;
/**
 * Normalisation for `occlusion`: the impeded-cell packing fraction in the
 * constriction zone that counts as fully jammed. Chosen so the reference
 * allele reads near zero and a fully sickled population reads near one.
 */
const JAM_PACKING = 0.14;
const ZONE_HALF_WIDTH = 0.15;
const CONSTRICTION_SIGMA = 0.085;

/** mulberry32 — small, fast, fully deterministic from a 32-bit seed. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Half-width of the lumen at axial position `x`. 0.5 is the unobstructed wall. */
export function lumenHalfWidth(x: number, constriction: number): number {
  const bell = Math.exp(-(((x - 0.5) / CONSTRICTION_SIGMA) ** 2));
  return 0.5 * (1 - constriction * bell);
}

/**
 * Per-tick probability that a discoid cell sickles. Rises as pO2 falls and as
 * polymerization tendency rises. A logistic in pO2 around the onset value.
 */
export function deoxyDrive(pO2: number): number {
  return 1 / (1 + Math.exp((pO2 - PO2_SICKLING_ONSET) / PO2_SPREAD));
}

export function sicklingRate(pO2: number, tendency: number): number {
  return SWITCH_RATE * tendency * deoxyDrive(pO2);
}

/**
 * Per-tick probability that a sickled cell relaxes back to discoid.
 *
 * The pair of rates is a two-state occupancy model whose equilibrium sickled
 * fraction is exactly `tendency × drive(pO2)`, which is what makes the
 * genotypes legibly different on screen.
 */
export function unsicklingRate(pO2: number, tendency: number): number {
  return SWITCH_RATE * (1 - tendency * deoxyDrive(pO2));
}

interface MutableCell {
  id: number;
  x: number;
  y: number;
  vx: number;
  radius: number;
  state: CellState;
  /** 0 → 1: how much slower than unimpeded this cell is moving. */
  stall: number;
}

function metricsOf(cells: readonly MutableCell[], params: SimParams): SimMetrics {
  if (cells.length === 0) return { occlusion: 0, meanFlow: 0, sickledFraction: 0 };

  let sickled = 0;
  let flowSum = 0;
  let blockedArea = 0;

  for (const c of cells) {
    if (c.state === 'sickled') sickled += 1;
    flowSum += c.vx;
    if (Math.abs(c.x - 0.5) <= ZONE_HALF_WIDTH) {
      // Only cells that are actually impeded count towards occlusion, and a
      // sickled cell sweeps a larger footprint than a discoid one.
      const footprint =
        Math.PI * c.radius * c.radius * (c.state === 'sickled' ? SICKLED_ELONGATION : 1);
      blockedArea += footprint * c.stall;
    }
  }

  // Lumen area available across the constriction zone, by numeric integration.
  let zoneArea = 0;
  const steps = 24;
  for (let i = 0; i < steps; i += 1) {
    const x = 0.5 - ZONE_HALF_WIDTH + ((2 * ZONE_HALF_WIDTH) / steps) * (i + 0.5);
    zoneArea += 2 * lumenHalfWidth(x, params.capillaryConstriction) * ((2 * ZONE_HALF_WIDTH) / steps);
  }

  const packing = zoneArea > 0 ? blockedArea / zoneArea : 0;

  return {
    occlusion: Math.min(1, Math.max(0, packing / JAM_PACKING)),
    meanFlow: flowSum / cells.length,
    sickledFraction: sickled / cells.length,
  };
}

/**
 * A seeded capillary-flow simulation. `step()` advances one tick; `run(ticks)`
 * advances many and returns the metrics. Same seed + same params ⇒ identical
 * metrics, with no reliance on wall-clock time or any host API.
 */
export class CellSim {
  private params: SimParams;
  private readonly rng: () => number;
  private cells: MutableCell[];
  private tick = 0;
  private metrics: SimMetrics;

  constructor(params: SimParams) {
    this.params = params;
    this.rng = makeRng(params.seed);
    this.cells = [];
    for (let i = 0; i < params.cellCount; i += 1) {
      const x = this.rng();
      const radius = 0.016 + this.rng() * 0.006;
      const span = Math.max(0.02, lumenHalfWidth(x, params.capillaryConstriction) - radius);
      this.cells.push({
        id: i,
        x,
        y: 0.5 + (this.rng() * 2 - 1) * span,
        vx: 0,
        radius,
        state: 'discoid',
        stall: 0,
      });
    }
    this.metrics = metricsOf(this.cells, this.params);
  }

  /** Change oxygen tension without discarding the current cell population. */
  setPO2(pO2: number): void {
    this.params = { ...this.params, pO2 };
  }

  /** Change the genotype-derived sickling propensity in place. */
  setPolymerizationTendency(tendency: number): void {
    this.params = { ...this.params, polymerizationTendency: tendency };
  }

  getParams(): SimParams {
    return this.params;
  }

  /** Advance exactly one tick. */
  step(): SimState {
    const { pO2, polymerizationTendency, capillaryConstriction } = this.params;
    const pSickle = sicklingRate(pO2, polymerizationTendency);
    const pRelax = unsicklingRate(pO2, polymerizationTendency);

    for (const c of this.cells) {
      if (c.state === 'discoid') {
        if (this.rng() < pSickle) c.state = 'sickled';
      } else if (this.rng() < pRelax) {
        c.state = 'discoid';
      }
    }

    // Unimpeded speed: continuity speeds flow up where the lumen narrows, and
    // cells near the wall move slower than cells mid-stream. This is the
    // yardstick a healthy cell is measured against.
    const free = this.cells.map((c) => {
      const hw = lumenHalfWidth(c.x, capillaryConstriction);
      const continuity = 0.5 / Math.max(0.04, hw);
      const profile = 1 - 0.55 * Math.min(1, (Math.abs(c.y - 0.5) / hw) ** 2);
      return BASE_SPEED * continuity * profile;
    });

    // A sickled cell is stiffer, so it drags; one whose long axis exceeds the
    // lumen at its position cannot pass at all.
    const desired = this.cells.map((c, i) => {
      const hw = lumenHalfWidth(c.x, capillaryConstriction);
      const needed = c.radius * (c.state === 'sickled' ? SICKLED_ELONGATION : 1);
      if (needed >= hw) return 0;
      return free[i] * (c.state === 'sickled' ? SICKLED_DRAG : 1);
    });

    // A cell cannot drive through a slower neighbour in its own lane: it
    // slows behind it and is pushed sideways, which is what turns a few stiff
    // cells into a queue without freezing the channel permanently.
    const nudge = new Float64Array(this.cells.length);
    const order = this.cells.map((_, i) => i).sort((a, b) => this.cells[b].x - this.cells[a].x);
    for (let k = 1; k < order.length; k += 1) {
      const i = order[k];
      const me = this.cells[i];
      for (let j = k - 1; j >= 0 && j >= k - 8; j -= 1) {
        const lead = this.cells[order[j]];
        const gap = lead.x - me.x;
        const clearance = me.radius + lead.radius;
        if (gap > 0 && gap < clearance && Math.abs(lead.y - me.y) < clearance * 0.55) {
          const creep = Math.max(desired[order[j]], free[i] * LANE_CREEP);
          if (creep < desired[i]) {
            desired[i] = creep;
            nudge[i] += me.y >= lead.y ? clearance * 0.12 : -clearance * 0.12;
          }
        }
      }
    }

    for (let i = 0; i < this.cells.length; i += 1) {
      const c = this.cells[i];
      const speed = desired[i];
      let x = c.x + speed;
      let y = c.y + nudge[i];
      if (x > 1) {
        // Recirculate: re-enter upstream, re-seeded transversely.
        x -= 1;
        const span = Math.max(0.02, lumenHalfWidth(x, capillaryConstriction) - c.radius);
        y = 0.5 + (this.rng() * 2 - 1) * span;
      } else {
        // Drift towards the centreline where the wall encroaches.
        const hw = lumenHalfWidth(x, capillaryConstriction);
        const limit = Math.max(0, hw - c.radius);
        if (Math.abs(y - 0.5) > limit) y = 0.5 + Math.sign(y - 0.5) * limit;
      }
      c.stall = free[i] > 0 ? Math.min(1, Math.max(0, 1 - speed / free[i])) : 1;
      c.vx = speed;
      c.x = x;
      c.y = y;
    }

    this.tick += 1;
    this.metrics = metricsOf(this.cells, this.params);
    return this.state();
  }

  /** Advance `ticks` steps and return the state at the end. */
  run(ticks: number): SimState {
    for (let i = 0; i < ticks; i += 1) this.step();
    return this.state();
  }

  state(): SimState {
    return {
      tick: this.tick,
      cells: this.cells.map((c) => ({
        id: c.id,
        x: c.x,
        y: c.y,
        vx: c.vx,
        radius: c.radius,
        state: c.state,
      })),
      params: this.params,
      ...this.metrics,
    };
  }
}

export function createSim(params: SimParams): CellSim {
  return new CellSim(params);
}

/** Headless convenience for `FunctionalAssayAgent`: metrics after `ticks`. */
export function run(params: SimParams, ticks: number): SimMetrics {
  const sim = new CellSim(params);
  const final = sim.run(ticks);
  return {
    occlusion: final.occlusion,
    meanFlow: final.meanFlow,
    sickledFraction: final.sickledFraction,
  };
}
