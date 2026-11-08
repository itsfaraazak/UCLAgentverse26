import type { FrameScheduler } from '../driver';

/** A hand-cranked requestAnimationFrame for deterministic tests. */
export class ManualScheduler implements FrameScheduler {
  private next = 1;
  private readonly pending = new Map<number, (t: number) => void>();
  cancelled = 0;

  request(callback: (t: number) => void): number {
    const id = this.next++;
    this.pending.set(id, callback);
    return id;
  }

  cancel(id: number): void {
    if (this.pending.delete(id)) this.cancelled += 1;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Fire every currently-pending callback at time `t`. */
  frame(t: number): void {
    const due = [...this.pending.entries()];
    this.pending.clear();
    for (const [, cb] of due) cb(t);
  }

  /** Run `n` frames at a fixed interval starting from `start`. */
  run(n: number, intervalMs = 1000 / 60, start = 0): number {
    let t = start;
    for (let i = 0; i < n; i += 1) {
      this.frame(t);
      t += intervalMs;
    }
    return t;
  }
}
