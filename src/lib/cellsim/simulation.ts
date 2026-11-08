import lociFile from '@/data/loci.json';
import { Mulberry32 } from './prng';
import type {
  AssayInput,
  Cell,
  CellShape,
  ChannelGeom,
  SimMetrics,
  SimParams,
  SimSnapshot,
} from './types';

/**
 * Illustrative 2D particle model of red-cell flow through a constricted
 * capillary. Not calibrated haemorheology — see SPEC.md §4.4 / §7.
 *
 * Headless: no canvas, no DOM, no window. The UI renders from snapshots.
 */

const CHANNEL_WIDTH = 480;
const CHANNEL_HEIGHT = 100;
const CONSTRICTION_X = CHANNEL_WIDTH * 0.5;
const CONSTRICTION_HALF_LENGTH = 56;
const U_MAX = 2.4;
const DISCOID_RADIUS = 4.2;
const SICKLED_RADIUS = 5.8;
const SICKLE_RATE = 0.18;
const UNSICKLE_RATE = 0.12;
const METRIC_WINDOW = 48;
const NEIGHBOR_CUTOFF = 14;

export const DEFAULT_ASSAY_STEPS = 260;

/**
 * Length of the acute-hypoxia challenge the agent pipeline assays over.
 *
 * This number needs stating, because the model has no steady state at severe
 * hypoxia. A sickled cell that jams the constriction only clears if it
 * unsickles, and at a sustained low pO2 it re-sickles, so jams accumulate for
 * as long as the run continues. Wildtype (tendency 0) never sickles and sits
 * at exactly 0 however long it runs; a near-reference genotype such as the
 * repaired allele (tendency 0.05) therefore drifts upward without bound —
 * measured occlusion 0.02 / 0.10 / 0.18 / 0.21 at 80 / 200 / 260 / 400 steps.
 *
 * Past a few hundred steps the comparison stops being about genotype and
 * becomes about how long the run was. So the assay is defined as a challenge
 * of fixed, declared duration, and this is that duration. It is a modelling
 * choice, not a measurement, and it is the kind of choice this tool exists to
 * make auditable rather than implicit.
 */
export const CHALLENGE_STEPS = 200;

export const SIMULATION_DEFAULTS = {
  seed: lociFile.simulation.defaults.seed,
  cellCount: lociFile.simulation.defaults.cellCount,
  pO2: lociFile.simulation.defaults.pO2,
  capillaryConstriction: lociFile.simulation.defaults.capillaryConstriction,
} as const;

export const PO2_RANGE = {
  min: lociFile.simulation.pO2.min,
  max: lociFile.simulation.pO2.max,
  unit: lociFile.simulation.pO2.unit,
  label: lociFile.simulation.pO2.label,
  sicklingOnsetBelow: lociFile.simulation.pO2.sicklingOnsetBelow,
} as const;

export const CHANNEL = {
  width: CHANNEL_WIDTH,
  height: CHANNEL_HEIGHT,
  constrictionX: CONSTRICTION_X,
  constrictionHalfLength: CONSTRICTION_HALF_LENGTH,
} as const;

/**
 * The fixture's own note on these parameters, loaded rather than restated.
 *
 * SPEC §4.4 and §7.7: the simulation is illustrative and the UI must say so
 * where its numbers appear. `ASSAY_MODEL_LIMITATION` below is this codebase's
 * short form for a panel; this is the fixture author's full statement.
 */
export const SIMULATION_NOTE: string = lociFile.simulation._note;

export const ASSAY_MODEL_LIMITATION =
  'Illustrative particle model, not validated haemorheology. ' +
  'Numbers are for teaching the genotype → flow coupling, not prediction.';

interface MutableCell {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  state: CellShape;
  theta: number;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function hypoxiaFactor(pO2: number): number {
  const onset = PO2_RANGE.sicklingOnsetBelow;
  if (pO2 >= onset) return 0;
  const span = Math.max(1e-9, onset - PO2_RANGE.min);
  return clamp((onset - pO2) / span, 0, 1);
}

export function channelHalfHeight(
  x: number,
  constriction: number,
  height: number = CHANNEL_HEIGHT,
): number {
  const full = height / 2;
  const openingHalf = (height * constriction) / 2;
  const dx = Math.abs(x - CONSTRICTION_X);
  if (dx >= CONSTRICTION_HALF_LENGTH) return full;
  const t = dx / CONSTRICTION_HALF_LENGTH;
  const s = 0.5 - 0.5 * Math.cos(Math.PI * t);
  return openingHalf + s * (full - openingHalf);
}

export function resolveParams(input: AssayInput): SimParams {
  const poly = clamp(input.polymerizationTendency, 0, 1);
  const pO2 = clamp(
    input.pO2 ?? SIMULATION_DEFAULTS.pO2,
    PO2_RANGE.min,
    PO2_RANGE.max,
  );
  return {
    seed: input.seed ?? SIMULATION_DEFAULTS.seed,
    cellCount: input.cellCount ?? SIMULATION_DEFAULTS.cellCount,
    pO2,
    polymerizationTendency: poly,
    capillaryConstriction:
      input.capillaryConstriction ?? SIMULATION_DEFAULTS.capillaryConstriction,
  };
}

function emptyMetrics(): SimMetrics {
  return { occlusion: 0, meanFlow: 0, sickledFraction: 0 };
}

function averageMetrics(window: readonly SimMetrics[]): SimMetrics {
  const n = window.length;
  if (n === 0) return emptyMetrics();
  let occlusion = 0;
  let meanFlow = 0;
  let sickledFraction = 0;
  for (let i = 0; i < n; i += 1) {
    const m = window[i];
    if (m === undefined) continue;
    occlusion += m.occlusion;
    meanFlow += m.meanFlow;
    sickledFraction += m.sickledFraction;
  }
  return {
    occlusion: occlusion / n,
    meanFlow: meanFlow / n,
    sickledFraction: sickledFraction / n,
  };
}

function freezeCell(cell: MutableCell): Cell {
  return {
    id: cell.id,
    x: cell.x,
    y: cell.y,
    vx: cell.vx,
    vy: cell.vy,
    radius: cell.radius,
    state: cell.state,
    theta: cell.theta,
  };
}

export class CellSim {
  private readonly rng: Mulberry32;
  private readonly cells: MutableCell[];
  private readonly recent: SimMetrics[] = [];
  private params: SimParams;
  private tick = 0;

  constructor(input: AssayInput) {
    this.params = resolveParams(input);
    if (this.params.cellCount <= 0) {
      throw new Error('cellCount must be positive');
    }
    this.rng = new Mulberry32(this.params.seed);
    this.cells = this.seedCells();
  }

  getParams(): SimParams {
    return this.params;
  }

  geom(): ChannelGeom {
    return {
      width: CHANNEL_WIDTH,
      height: CHANNEL_HEIGHT,
      constrictionX: CONSTRICTION_X,
      constrictionHalfLength: CONSTRICTION_HALF_LENGTH,
      opening: CHANNEL_HEIGHT * this.params.capillaryConstriction,
    };
  }

  halfHeightAt(x: number): number {
    return channelHalfHeight(x, this.params.capillaryConstriction);
  }

  setPO2(pO2: number): void {
    this.params = {
      ...this.params,
      pO2: clamp(pO2, PO2_RANGE.min, PO2_RANGE.max),
    };
  }

  setPolymerizationTendency(value: number): void {
    this.params = {
      ...this.params,
      polymerizationTendency: clamp(value, 0, 1),
    };
  }

  step(): SimSnapshot {
    this.tick += 1;
    this.integrate();
    this.collide();
    this.confine();
    this.transition();
    const instant = this.instantMetrics();
    this.recent.push(instant);
    if (this.recent.length > METRIC_WINDOW) {
      this.recent.shift();
    }
    return this.snapshot();
  }

  run(steps: number): SimSnapshot {
    const n = Math.max(0, Math.floor(steps));
    for (let i = 0; i < n; i += 1) {
      this.step();
    }
    return this.snapshot();
  }

  metrics(): SimMetrics {
    if (this.recent.length === 0) return this.instantMetrics();
    return averageMetrics(this.recent);
  }

  snapshot(): SimSnapshot {
    const cells: Cell[] = [];
    for (let i = 0; i < this.cells.length; i += 1) {
      const cell = this.cells[i];
      if (cell === undefined) continue;
      cells.push(freezeCell(cell));
    }
    return {
      tick: this.tick,
      params: this.params,
      geom: this.geom(),
      cells,
      metrics: this.metrics(),
    };
  }

  private seedCells(): MutableCell[] {
    const { cellCount, capillaryConstriction } = this.params;
    const cols = Math.max(1, Math.ceil(Math.sqrt((cellCount * CHANNEL_WIDTH) / CHANNEL_HEIGHT)));
    const rows = Math.max(1, Math.ceil(cellCount / cols));
    const out: MutableCell[] = [];
    for (let i = 0; i < cellCount; i += 1) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const jitterX = (this.rng.next() - 0.5) * 0.35;
      const jitterY = (this.rng.next() - 0.5) * 0.35;
      const x = ((col + 0.5 + jitterX) / cols) * CHANNEL_WIDTH;
      const localH = channelHalfHeight(x, capillaryConstriction);
      const rowOffset = (row - (rows - 1) / 2) / Math.max(1, rows);
      const y =
        CHANNEL_HEIGHT / 2 +
        rowOffset * (localH - DISCOID_RADIUS) * 1.6 +
        jitterY * (localH - DISCOID_RADIUS) * 0.4;
      const yFromCenter = y - CHANNEL_HEIGHT / 2;
      const arg = localH <= 0 ? 1 : clamp(yFromCenter / localH, -1, 1);
      const vx = U_MAX * (1 - arg * arg);
      out.push({
        id: i,
        x: wrapX(x),
        y: clamp(y, DISCOID_RADIUS, CHANNEL_HEIGHT - DISCOID_RADIUS),
        vx,
        vy: 0,
        radius: DISCOID_RADIUS,
        state: 'discoid',
        theta: 0,
      });
    }
    return out;
  }

  private integrate(): void {
    const { capillaryConstriction } = this.params;
    const centerY = CHANNEL_HEIGHT / 2;
    for (let i = 0; i < this.cells.length; i += 1) {
      const cell = this.cells[i];
      if (cell === undefined) continue;
      const h = channelHalfHeight(cell.x, capillaryConstriction);
      const yFromCenter = cell.y - centerY;
      const arg = h <= 0 ? 1 : clamp(yFromCenter / h, -1, 1);
      const poiseuille = U_MAX * (1 - arg * arg);
      let drag = cell.state === 'sickled' ? 3.6 : 1;
      if (inNeck(cell.x) && cell.state === 'sickled') {
        drag *= 2.8;
      }
      cell.vx = poiseuille / drag;
      cell.vy += -0.04 * yFromCenter;
      cell.vy *= 0.72;
      cell.x += cell.vx;
      cell.y += cell.vy;
      cell.theta = Math.atan2(cell.vy, cell.vx);
      if (cell.x > CHANNEL_WIDTH) cell.x -= CHANNEL_WIDTH;
      if (cell.x < 0) cell.x += CHANNEL_WIDTH;
    }
  }

  private collide(): void {
    const n = this.cells.length;
    for (let i = 0; i < n; i += 1) {
      const a = this.cells[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < n; j += 1) {
        const b = this.cells[j];
        if (b === undefined) continue;
        let dx = b.x - a.x;
        if (dx > CHANNEL_WIDTH / 2) dx -= CHANNEL_WIDTH;
        if (dx < -CHANNEL_WIDTH / 2) dx += CHANNEL_WIDTH;
        const dy = b.y - a.y;
        if (dx > NEIGHBOR_CUTOFF || dx < -NEIGHBOR_CUTOFF || dy > NEIGHBOR_CUTOFF || dy < -NEIGHBOR_CUTOFF) {
          continue;
        }
        const distSq = dx * dx + dy * dy;
        const minDist = a.radius + b.radius;
        if (distSq >= minDist * minDist || distSq <= 0) continue;
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        const nx = dx / dist;
        const ny = dy / dist;
        const weightA = a.state === 'sickled' ? 0.22 : 0.5;
        const weightB = b.state === 'sickled' ? 0.22 : 0.5;
        const sum = weightA + weightB;
        a.x -= nx * overlap * (weightA / sum);
        a.y -= ny * overlap * (weightA / sum);
        b.x += nx * overlap * (weightB / sum);
        b.y += ny * overlap * (weightB / sum);
        if (inNeck(a.x) && (a.state === 'sickled' || b.state === 'sickled')) {
          a.vx *= 0.55;
          b.vx *= 0.55;
        }
      }
    }
  }

  private confine(): void {
    const { capillaryConstriction } = this.params;
    const centerY = CHANNEL_HEIGHT / 2;
    for (let i = 0; i < this.cells.length; i += 1) {
      const cell = this.cells[i];
      if (cell === undefined) continue;
      const h = channelHalfHeight(cell.x, capillaryConstriction);
      const deform = cell.state === 'sickled' ? 1 : 0.72;
      const rEff = cell.radius * deform;
      let yFromCenter = cell.y - centerY;
      const limit = Math.max(0.5, h - rEff);
      if (yFromCenter > limit) {
        yFromCenter = limit;
        cell.vy = Math.min(0, cell.vy);
      } else if (yFromCenter < -limit) {
        yFromCenter = -limit;
        cell.vy = Math.max(0, cell.vy);
      }
      cell.y = centerY + yFromCenter;
      if (cell.x > CHANNEL_WIDTH) cell.x -= CHANNEL_WIDTH;
      if (cell.x < 0) cell.x += CHANNEL_WIDTH;
    }
  }

  private transition(): void {
    const hypoxia = hypoxiaFactor(this.params.pO2);
    const poly = this.params.polymerizationTendency;
    const drive = poly * hypoxia;
    const pOn = drive * drive * SICKLE_RATE;
    const pOff =
      (1 - hypoxia) * UNSICKLE_RATE + (1 - poly) * hypoxia * 0.02;
    for (let i = 0; i < this.cells.length; i += 1) {
      const cell = this.cells[i];
      if (cell === undefined) continue;
      if (cell.state === 'discoid') {
        if (pOn > 0 && this.rng.next() < pOn) {
          cell.state = 'sickled';
          cell.radius = SICKLED_RADIUS;
        }
      } else if (pOff > 0 && this.rng.next() < pOff) {
        cell.state = 'discoid';
        cell.radius = DISCOID_RADIUS;
      }
    }
  }

  private instantMetrics(): SimMetrics {
    const n = this.cells.length;
    if (n === 0) return emptyMetrics();
    let sickled = 0;
    let flow = 0;
    let blocked = 0;
    const opening = CHANNEL_HEIGHT * this.params.capillaryConstriction;
    for (let i = 0; i < n; i += 1) {
      const cell = this.cells[i];
      if (cell === undefined) continue;
      flow += Math.max(0, cell.vx);
      if (cell.state !== 'sickled') continue;
      sickled += 1;
      if (inNeck(cell.x)) {
        const stall = 1 - clamp(cell.vx / U_MAX, 0, 1);
        blocked += 2 * cell.radius * (0.45 + 0.55 * stall);
      }
    }
    return {
      occlusion: clamp(blocked / Math.max(opening, 1e-9), 0, 1),
      meanFlow: flow / n,
      sickledFraction: sickled / n,
    };
  }
}

function inNeck(x: number): boolean {
  return Math.abs(x - CONSTRICTION_X) <= CONSTRICTION_HALF_LENGTH;
}

function wrapX(x: number): number {
  let v = x % CHANNEL_WIDTH;
  if (v < 0) v += CHANNEL_WIDTH;
  return v;
}

/**
 * Run the simulation headless and report steady-state metrics.
 *
 * The estimator matters, so it is stated here. `CellSim.metrics()` averages a
 * 48-step trailing window, which is the right thing for a live readout but the
 * wrong thing for an assay: for a genotype near the sickling threshold, a
 * single terminal window lands inside an intermittent jam or outside it, and
 * the reported occlusion swings with the step count rather than with the
 * genotype. Measured on the repaired allele (tendency 0.05) at pO2 10, the
 * terminal window gave 0.031 / 0.378 / 0.418 / 0.194 / 0.364 at 160 / 200 /
 * 220 / 260 / 400 steps — noise, not signal.
 *
 * So this averages across the run after a warm-up, which is what makes the
 * number a property of the genotype. It stays fully deterministic: same seed
 * and same params give the same result.
 */
export function runAssay(input: AssayInput): SimMetrics {
  const steps = Math.max(0, Math.floor(input.steps ?? DEFAULT_ASSAY_STEPS));
  const sim = new CellSim(input);

  // Let the flow establish before measuring; the first ticks are the initial
  // layout relaxing, not the genotype behaving.
  const warmup = Math.min(steps, Math.ceil(steps * 0.25));
  sim.run(warmup);

  const samples: SimMetrics[] = [];
  for (let i = warmup; i < steps; i += 1) {
    sim.step();
    samples.push(sim.metrics());
  }
  if (samples.length === 0) return sim.metrics();
  return averageMetrics(samples);
}
