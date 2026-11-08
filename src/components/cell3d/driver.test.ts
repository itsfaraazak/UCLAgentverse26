import { describe, expect, it, vi } from 'vitest';
import { CellSim, PO2_RANGE } from '@/lib/cellsim';
import { SimDriver } from './driver';
import { ManualScheduler } from './__fixtures__/scheduler';

const SICKLE = { seed: 7, pO2: PO2_RANGE.min, polymerizationTendency: 0.85 };

describe('SimDriver', () => {
  it('publishes exactly the snapshots CellSim.step() produces — no interpolation', () => {
    const scheduler = new ManualScheduler();
    const driver = new SimDriver(SICKLE, { scheduler });
    const seen: number[] = [];
    driver.subscribe((s) => seen.push(s.tick));
    driver.play();
    scheduler.run(61); // 60 intervals at 60 Hz = 1 s
    const tick = driver.snapshot.tick;
    expect(tick).toBeGreaterThanOrEqual(59);
    expect(tick).toBeLessThanOrEqual(60);

    const reference = new CellSim(SICKLE);
    reference.run(tick);
    expect(JSON.stringify(driver.snapshot.cells)).toBe(JSON.stringify(reference.snapshot().cells));
    expect(JSON.stringify(driver.snapshot.metrics)).toBe(JSON.stringify(reference.metrics()));
    // Monotone whole ticks.
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThan(seen[i - 1] ?? -1);
    driver.dispose();
  });

  it('advances at a fixed rate independent of display refresh (120 Hz ≈ 60 Hz)', () => {
    const at60 = new ManualScheduler();
    const at120 = new ManualScheduler();
    const a = new SimDriver(SICKLE, { scheduler: at60 });
    const b = new SimDriver(SICKLE, { scheduler: at120 });
    a.play();
    b.play();
    at60.run(121, 1000 / 60);
    at120.run(241, 1000 / 120);
    expect(Math.abs(a.snapshot.tick - b.snapshot.tick)).toBeLessThanOrEqual(1);
    a.dispose();
    b.dispose();
  });

  it('does not fast-forward after a long gap (backgrounded tab)', () => {
    const scheduler = new ManualScheduler();
    const driver = new SimDriver(SICKLE, { scheduler, maxStepsPerFrame: 4 });
    driver.play();
    scheduler.frame(0);
    scheduler.frame(60_000);
    expect(driver.snapshot.tick).toBeLessThanOrEqual(4);
    driver.dispose();
  });

  it('pause cancels the pending frame; dispose leaves nothing scheduled', () => {
    const scheduler = new ManualScheduler();
    const driver = new SimDriver(SICKLE, { scheduler });
    driver.play();
    scheduler.run(5);
    expect(scheduler.pendingCount).toBe(1);
    driver.pause();
    expect(scheduler.pendingCount).toBe(0);
    driver.play();
    driver.dispose();
    expect(scheduler.pendingCount).toBe(0);
    expect(driver.playing).toBe(false);
    const listener = vi.fn();
    driver.subscribe(listener);
    driver.advance(3);
    expect(listener).not.toHaveBeenCalled();
  });

  it('applies pO2 / polymerisation in place, matching CellSim setters', () => {
    const scheduler = new ManualScheduler();
    const driver = new SimDriver({ seed: 3, pO2: 95, polymerizationTendency: 0 }, { scheduler });
    const reference = new CellSim({ seed: 3, pO2: 95, polymerizationTendency: 0 });
    driver.advance(30);
    reference.run(30);
    driver.setPO2(15);
    driver.setPolymerizationTendency(0.85);
    reference.setPO2(15);
    reference.setPolymerizationTendency(0.85);
    expect(driver.snapshot.params.pO2).toBe(15);
    driver.advance(90);
    reference.run(90);
    expect(JSON.stringify(driver.snapshot.cells)).toBe(JSON.stringify(reference.snapshot().cells));
    driver.dispose();
  });
});
