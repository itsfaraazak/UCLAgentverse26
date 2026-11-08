// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Material } from 'three';
import { CellSim, PO2_RANGE } from '@/lib/cellsim';
import { mountCellEngine } from './engine';
import { SimDriver } from './driver';
import { worldX, worldY } from './geometry';
import { ManualScheduler } from './__fixtures__/scheduler';
import { createFakeRenderer } from '@/components/protein/__fixtures__/fake-renderer';
import { classifyFailure } from '@/components/protein/runtime/errors';
import { selectRenderer } from '@/components/protein/runtime/renderer';

const LOW = { seed: 11, pO2: PO2_RANGE.min, polymerizationTendency: 0.85 };

function host(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('mountCellEngine', () => {
  it('draws every cell exactly where lib/cellsim put it, split by state', async () => {
    const scheduler = new ManualScheduler();
    const driver = new SimDriver(LOW, { scheduler });
    const fake = createFakeRenderer();
    const engine = await mountCellEngine({
      container: host(),
      initial: driver.snapshot,
      onContextLost: () => undefined,
      createRenderer: async () => fake,
    });
    driver.subscribe((s) => engine.draw(s));
    driver.play();
    scheduler.run(200);

    // Independent re-run of the real simulation to the same tick.
    const tick = driver.snapshot.tick;
    const reference = new CellSim(LOW).run(tick);
    const view = engine.inspect();
    expect(view.tick).toBe(tick);

    const disc = reference.cells.filter((c) => c.state === 'discoid');
    const sick = reference.cells.filter((c) => c.state === 'sickled');
    expect(sick.length).toBeGreaterThan(0); // low pO2 + sickle genotype actually sickles
    expect(view.discoid).toHaveLength(disc.length);
    expect(view.sickled).toHaveLength(sick.length);
    disc.forEach((c, i) => {
      expect(view.discoid[i]?.x).toBeCloseTo(worldX(c.x, reference.geom), 4);
      expect(view.discoid[i]?.y).toBeCloseTo(worldY(c.y, reference.geom), 4);
      expect(view.discoid[i]?.scale).toBeCloseTo(c.radius, 4);
    });
    sick.forEach((c, i) => {
      expect(view.sickled[i]?.x).toBeCloseTo(worldX(c.x, reference.geom), 4);
      expect(view.sickled[i]?.y).toBeCloseTo(worldY(c.y, reference.geom), 4);
    });
    expect(view.ringOcclusion).toBeCloseTo(Math.min(1, reference.metrics.occlusion), 6);
    expect(fake.calls.render).toBeGreaterThan(1);
    driver.dispose();
    engine.dispose();
  });

  it('disposes all GPU resources, cancels frames and releases the context on dispose', async () => {
    const geometryDispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(Material.prototype, 'dispose');
    const container = host();
    const fake = createFakeRenderer();
    const sim = new CellSim(LOW);
    const engine = await mountCellEngine({
      container,
      initial: sim.snapshot(),
      onContextLost: () => undefined,
      createRenderer: async () => fake,
    });
    expect(engine.trackedResourceCount()).toBeGreaterThanOrEqual(12);
    engine.resetView(); // leaves a pending render frame
    engine.dispose();
    engine.dispose();
    expect(engine.trackedResourceCount()).toBe(0);
    // vessel, wall, ring, discoid, sickle geometries; 5 materials.
    expect(geometryDispose.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(materialDispose.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(fake.calls.release).toBe(1);
    expect(container.querySelector('canvas')).toBeNull();
    const renders = fake.calls.render;
    engine.draw(sim.step());
    await new Promise((r) => setTimeout(r, 40));
    expect(fake.calls.render).toBe(renders);
  });

  it('releases a renderer that arrives after the caller aborted', async () => {
    const controller = new AbortController();
    const fake = createFakeRenderer();
    const err = await mountCellEngine({
      container: host(),
      initial: new CellSim(LOW).snapshot(),
      signal: controller.signal,
      onContextLost: () => undefined,
      createRenderer: async () => {
        controller.abort();
        return fake;
      },
    }).catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(fake.calls.release).toBe(1);
  });

  it('fails as "renderer" with the real selector when there is no WebGPU or WebGL', async () => {
    const err = await mountCellEngine({
      container: host(),
      initial: new CellSim(LOW).snapshot(),
      onContextLost: () => undefined,
      createRenderer: selectRenderer,
    }).catch((e: unknown) => e);
    expect(classifyFailure(err)).toBe('renderer');
  });
});
