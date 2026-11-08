// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CellSim, PO2_RANGE } from '@/lib/cellsim';
import { CellFlow3D, SETTLE_TICKS } from './CellFlow3D';
import { loadCellEngine } from './load-engine';
import type { CellEngineHandle, CellEngineOptions } from './engine';
import type { CellFlowMetrics } from './metrics';
import {
  ContextLostError,
  LibraryLoadError,
  RendererUnavailableError,
} from '@/components/protein/runtime/errors';

vi.mock('./load-engine', () => ({ loadCellEngine: vi.fn() }));
const loadEngine = vi.mocked(loadCellEngine);

const METRICS_TICKS = 15;
const SICKLE = { seed: 5, pO2: PO2_RANGE.min, polymerizationTendency: 0.85 };

function fakeHandle(): CellEngineHandle {
  return {
    renderer: { kind: 'webgl2', label: 'WebGL 2', fallbackReason: 'WebGPU not exposed by this browser' },
    draw: vi.fn(),
    resetView: vi.fn(),
    inspect: () => ({ discoid: [], sickled: [], ringOcclusion: 0, tick: 0 }),
    trackedResourceCount: () => 0,
    dispose: vi.fn(),
  };
}

function engineWith(mount: (o: CellEngineOptions) => Promise<CellEngineHandle>) {
  const mountCellEngine = vi.fn(mount);
  loadEngine.mockResolvedValue({ mountCellEngine } as unknown as Awaited<ReturnType<typeof loadCellEngine>>);
  return mountCellEngine;
}

function setReducedMotion(reduce: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('reduce'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

function referenceMetrics(tick: number, params = SICKLE) {
  return new CellSim(params).run(tick).metrics;
}

beforeEach(() => {
  loadEngine.mockReset();
  setReducedMotion(false);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CellFlow3D — success path', () => {
  it('draws real snapshots and reports the simulation’s own metrics upward', async () => {
    const handle = fakeHandle();
    engineWith(async () => handle);
    const updates: CellFlowMetrics[] = [];
    const { container, unmount } = render(<CellFlow3D {...SICKLE} onMetrics={(m) => updates.push(m)} />);
    await waitFor(() => expect(container.querySelector('[data-renderer="webgl2"]')).not.toBeNull());
    await waitFor(() => expect(updates.at(-1)?.tick ?? 0).toBeGreaterThan(METRICS_TICKS), { timeout: 3000 });

    // Each reported number equals an independent CellSim run to that tick.
    const last = updates.at(-1);
    expect(last).toBeDefined();
    const m = last as CellFlowMetrics;
    expect(m.tick).toBeGreaterThan(0);
    expect(m.pO2).toBe(SICKLE.pO2);
    expect(m.polymerizationTendency).toBe(SICKLE.polymerizationTendency);
    expect(m).toMatchObject(referenceMetrics(m.tick));
    expect(vi.mocked(handle.draw).mock.calls.length).toBeGreaterThan(1);

    // Limitations are on the panel.
    expect(screen.getAllByText(/not validated haemorheology/i).length).toBe(2);
    expect(screen.getByText(/not clinical cut-offs/)).toBeTruthy();

    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const count = updates.length;
    unmount();
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 120));
    expect(updates.length).toBe(count);
  });

  it('respects prefers-reduced-motion: starts paused on a settled real state; Step advances one tick', async () => {
    setReducedMotion(true);
    engineWith(async () => fakeHandle());
    const updates: CellFlowMetrics[] = [];
    render(<CellFlow3D {...SICKLE} onMetrics={(m) => updates.push(m)} />);
    expect(await screen.findByText(/Reduced motion: starts paused/)).toBeTruthy();
    await waitFor(() => expect(updates.at(-1)?.tick).toBe(SETTLE_TICKS));
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 100));
    expect(updates.at(-1)?.tick).toBe(SETTLE_TICKS); // genuinely static
    fireEvent.click(screen.getByRole('button', { name: 'Step' }));
    expect(updates.at(-1)?.tick).toBe(SETTLE_TICKS + 1);
    expect(updates.at(-1)).toMatchObject(referenceMetrics(SETTLE_TICKS + 1));
  });

  it('applies a pO2 change in place; while paused it settles so the still frame reflects it', async () => {
    engineWith(async () => fakeHandle());
    const updates: CellFlowMetrics[] = [];
    const { rerender } = render(<CellFlow3D {...SICKLE} pO2={95} paused onMetrics={(m) => updates.push(m)} />);
    await waitFor(() => expect(updates.at(-1)?.tick).toBe(SETTLE_TICKS));
    rerender(<CellFlow3D {...SICKLE} pO2={20} paused onMetrics={(m) => updates.push(m)} />);
    await waitFor(() => expect(updates.at(-1)?.tick).toBe(2 * SETTLE_TICKS));
    expect(updates.at(-1)?.pO2).toBe(20);

    const reference = new CellSim({ ...SICKLE, pO2: 95 });
    reference.run(SETTLE_TICKS);
    reference.setPO2(20);
    expect(updates.at(-1)).toMatchObject(reference.run(SETTLE_TICKS).metrics);
  });
});

describe('CellFlow3D — failure paths keep the simulation and show metrics as text', () => {
  it('three.js chunk fails → fallback with live metrics; Retry reloads', async () => {
    loadEngine.mockRejectedValue(new LibraryLoadError(new Error('ChunkLoadError')));
    const updates: CellFlowMetrics[] = [];
    const { container } = render(<CellFlow3D {...SICKLE} onMetrics={(m) => updates.push(m)} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('3D library did not load');
    expect(alert.textContent).toContain('still running');
    await waitFor(() => expect(alert.textContent).toMatch(/Occlusion \d+\.\d%, mean flow \d+\.\d\d, sickled \d+\.\d%/));
    expect(container.querySelector('[data-renderer="none"]')).not.toBeNull();
    const before = updates.at(-1)?.tick ?? 0;
    await waitFor(() => expect(updates.at(-1)?.tick ?? 0).toBeGreaterThan(before));

    engineWith(async () => fakeHandle());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(container.querySelector('[data-renderer="webgl2"]')).not.toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('no WebGPU and no WebGL → renderer fallback', async () => {
    engineWith(async () => Promise.reject(new RendererUnavailableError(['WebGPU not exposed', 'WebGL 2 context could not be created'])));
    render(<CellFlow3D {...SICKLE} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not start WebGPU or WebGL 2');
    expect(alert.textContent).toContain('WebGL 2 context could not be created');
  });

  it('GPU context lost mid-run → fallback, engine disposed', async () => {
    let lost: ((e: Error) => void) | null = null;
    const handle = fakeHandle();
    engineWith(async (o) => {
      lost = o.onContextLost;
      return handle;
    });
    const { container } = render(<CellFlow3D {...SICKLE} />);
    await waitFor(() => expect(container.querySelector('[data-renderer="webgl2"]')).not.toBeNull());
    act(() => (lost as unknown as (e: Error) => void)(new ContextLostError()));
    expect((await screen.findByRole('alert')).textContent).toContain('context was lost');
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });

  it('really degrades with the real engine in a GPU-less browser', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const actual = await vi.importActual<typeof import('./engine')>('./engine');
    loadEngine.mockResolvedValue(actual);
    const { container } = render(<CellFlow3D {...SICKLE} />);
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert.textContent).toContain('could not start WebGPU or WebGL 2');
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('disposes an engine that finishes mounting after unmount', async () => {
    let resolveMount: (h: CellEngineHandle) => void = () => undefined;
    const mount = engineWith(() => new Promise<CellEngineHandle>((resolve) => (resolveMount = resolve)));
    const { unmount } = render(<CellFlow3D {...SICKLE} />);
    await waitFor(() => expect(mount).toHaveBeenCalled());
    unmount();
    const late = fakeHandle();
    await act(async () => resolveMount(late));
    expect(late.dispose).toHaveBeenCalledTimes(1);
  });
});
