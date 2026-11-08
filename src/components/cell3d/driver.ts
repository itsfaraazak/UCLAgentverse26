import { CellSim, type SimSnapshot } from '@/lib/cellsim';

/**
 * Drives the real `lib/cellsim` simulation from `requestAnimationFrame`.
 * three-free and renderer-free: if the 3D view cannot start, the very same
 * driver keeps the simulation running and the shell shows its metrics as
 * text.
 *
 * Every frame advances the simulation by whole `step()`s and publishes the
 * resulting snapshot. Nothing is interpolated, eased or invented: what a
 * subscriber receives is exactly `CellSim`'s state after N ticks.
 *
 * Fixed timestep: the simulation advances at `stepsPerSecond` regardless of
 * display refresh rate (60 Hz and 120 Hz screens look the same), and at most
 * `maxStepsPerFrame` per frame so a backgrounded tab doesn't fast-forward on
 * return.
 */

export interface FrameScheduler {
  request(callback: (timeMs: number) => void): number;
  cancel(id: number): void;
}

export const browserScheduler: FrameScheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
};

export interface SimDriverParams {
  readonly seed: number;
  readonly pO2: number;
  readonly polymerizationTendency: number;
  readonly cellCount?: number;
  readonly capillaryConstriction?: number;
}

export interface SimDriverOptions {
  readonly scheduler?: FrameScheduler;
  readonly stepsPerSecond?: number;
  readonly maxStepsPerFrame?: number;
}

export type SnapshotListener = (snapshot: SimSnapshot) => void;

export class SimDriver {
  private readonly sim: CellSim;
  private readonly scheduler: FrameScheduler;
  private readonly stepMs: number;
  private readonly maxStepsPerFrame: number;
  private readonly listeners = new Set<SnapshotListener>();
  private latest: SimSnapshot;
  private frameId: number | null = null;
  private lastTime: number | null = null;
  private accumulator = 0;
  private disposed = false;

  constructor(params: SimDriverParams, options: SimDriverOptions = {}) {
    this.sim = new CellSim({
      seed: params.seed,
      pO2: params.pO2,
      polymerizationTendency: params.polymerizationTendency,
      cellCount: params.cellCount,
      capillaryConstriction: params.capillaryConstriction,
    });
    this.scheduler = options.scheduler ?? browserScheduler;
    this.stepMs = 1000 / (options.stepsPerSecond ?? 60);
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? 4;
    this.latest = this.sim.snapshot();
  }

  get playing(): boolean {
    return this.frameId !== null;
  }

  get snapshot(): SimSnapshot {
    return this.latest;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  play(): void {
    if (this.disposed || this.frameId !== null) return;
    this.lastTime = null;
    this.accumulator = 0;
    this.frameId = this.scheduler.request(this.onFrame);
  }

  pause(): void {
    if (this.frameId !== null) this.scheduler.cancel(this.frameId);
    this.frameId = null;
    this.lastTime = null;
  }

  /** Advance exactly `n` real ticks and publish (used when paused). */
  advance(n = 1): SimSnapshot {
    if (this.disposed) return this.latest;
    const steps = Math.max(0, Math.floor(n));
    if (steps > 0) this.publish(this.sim.run(steps));
    return this.latest;
  }

  setPO2(pO2: number): void {
    this.sim.setPO2(pO2);
    this.refreshParams();
  }

  setPolymerizationTendency(value: number): void {
    this.sim.setPolymerizationTendency(value);
    this.refreshParams();
  }

  dispose(): void {
    this.pause();
    this.disposed = true;
    this.listeners.clear();
  }

  /** Republish so text views reflect a parameter change while paused.
   *  Same cells, same tick — only `params` differs. */
  private refreshParams(): void {
    if (this.disposed) return;
    this.publish(this.sim.snapshot());
  }

  private publish(snapshot: SimSnapshot): void {
    this.latest = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }

  private readonly onFrame = (time: number): void => {
    this.frameId = null;
    if (this.disposed) return;
    if (this.lastTime !== null) {
      // Clamp long gaps (tab switch, breakpoint) so we never try to "catch up".
      this.accumulator += Math.min(time - this.lastTime, 250);
    }
    this.lastTime = time;
    let steps = Math.floor(this.accumulator / this.stepMs);
    if (steps > this.maxStepsPerFrame) {
      steps = this.maxStepsPerFrame;
      this.accumulator = 0;
    } else {
      this.accumulator -= steps * this.stepMs;
    }
    // Schedule before publishing so a listener that pauses wins.
    this.frameId = this.scheduler.request(this.onFrame);
    if (steps > 0) this.publish(this.sim.run(steps));
  };
}
