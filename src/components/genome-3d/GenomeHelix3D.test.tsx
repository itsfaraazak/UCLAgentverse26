// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContextLostError,
  LibraryLoadError,
  RendererUnavailableError,
  StructureDataError,
} from '@/components/protein/runtime/errors';
import { getLocus } from '@/lib/genome';
import { GenomeHelix3D } from './GenomeHelix3D';
import { loadGenomeEngine } from './load-engine';
import type { GenomeEngineHandle, GenomeEngineOptions } from './engine';
import { buildGenomeModel, buildLocusModel } from './model';

vi.mock('./load-engine', () => ({ loadGenomeEngine: vi.fn() }));
const loadEngine = vi.mocked(loadGenomeEngine);

const hbb = buildLocusModel({ variantId: 'HBB_HbS' });

function fakeHandle(): GenomeEngineHandle {
  return {
    renderer: { kind: 'webgl2', label: 'WebGL 2', fallbackReason: 'WebGPU not exposed by this browser' },
    scene: {
      codonInstances: hbb.totalCodonCount,
      rungInstances: hbb.modelledCodonCount * 3,
      modelledCodons: hbb.modelledCodonCount,
      unsequencedCodons: hbb.totalCodonCount - hbb.modelledCodonCount,
      editedCodonIndices: [7],
      focusedCodon: null,
      axisLength: 149.6,
    },
    resetView: vi.fn(),
    focusCodon: vi.fn(() => true),
    focusEdit: vi.fn(() => true),
    orbit: vi.fn(),
    zoom: vi.fn(),
    setAutoRotate: vi.fn(),
    trackedResourceCount: () => 0,
    dispose: vi.fn(),
  };
}

type Mount = (options: GenomeEngineOptions) => Promise<GenomeEngineHandle>;

function engineWith(mount: Mount) {
  const mountGenomeEngine = vi.fn(mount);
  loadEngine.mockResolvedValue({ mountGenomeEngine } as unknown as Awaited<ReturnType<typeof loadGenomeEngine>>);
  return mountGenomeEngine;
}

function setReducedMotion(reduce: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

beforeEach(() => {
  loadEngine.mockReset();
  setReducedMotion(false);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('GenomeHelix3D — success path', () => {
  it('shows the renderer pill, heading and codon counts; mounts HBB', async () => {
    const mount = engineWith(async () => fakeHandle());
    const { container } = render(<GenomeHelix3D />);

    await waitFor(() => expect(container.querySelector('[data-renderer="webgl2"]')).not.toBeNull());
    expect(screen.getByRole('heading', { name: 'HBB coding region' })).toBeTruthy();
    const locus = getLocus('HBB');
    expect(locus).toBeDefined();
    if (locus === undefined) return;
    const modelled = locus.cdsReference.codonCount;
    const expectedTotal = Math.max(modelled, ...locus.exons.map((e) => e.codonEnd));

    const counts = screen.getByText(/codons sequenced/);
    expect(counts.textContent).toContain(`${modelled} of ${expectedTotal} codons sequenced`);
    expect(mount.mock.calls[0]?.[0].model).toMatchObject({
      gene: 'HBB',
      modelledCodonCount: modelled,
      totalCodonCount: expectedTotal,
    });
  });

  it('disposes the engine handle on unmount', async () => {
    const handles: GenomeEngineHandle[] = [];
    engineWith(async () => {
      const h = fakeHandle();
      handles.push(h);
      return h;
    });
    const { container, unmount } = render(<GenomeHelix3D />);
    await waitFor(() => expect(container.querySelector('[data-renderer="webgl2"]')).not.toBeNull());
    unmount();
    expect(handles[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('is keyboard and toolbar operable once ready', async () => {
    let handle: GenomeEngineHandle | null = null;
    engineWith(async () => (handle = fakeHandle()));
    render(<GenomeHelix3D />);
    const view = await screen.findByRole('img');
    await waitFor(() => expect(handle).not.toBeNull());
    view.focus();
    fireEvent.keyDown(view, { key: 'ArrowLeft' });
    fireEvent.keyDown(view, { key: 'ArrowRight' });
    fireEvent.keyDown(view, { key: 'ArrowUp' });
    fireEvent.keyDown(view, { key: 'ArrowDown' });
    fireEvent.keyDown(view, { key: '+' });
    fireEvent.keyDown(view, { key: '-' });
    fireEvent.keyDown(view, { key: '0' });
    fireEvent.keyDown(view, { key: 'f' });
    const h = handle as unknown as GenomeEngineHandle;
    expect(h.orbit).toHaveBeenCalled();
    expect(h.zoom).toHaveBeenCalled();
    expect(h.resetView).toHaveBeenCalled();
    expect(h.focusEdit).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Rotate left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit site' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(h.orbit).toHaveBeenCalled();
    expect(h.zoom).toHaveBeenCalled();
    expect(h.focusEdit).toHaveBeenCalled();
    expect(h.resetView).toHaveBeenCalled();
  });
});

describe('GenomeHelix3D — every failure path renders a text fallback with retry', () => {
  async function expectFallback() {
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('GAG');
    expect(alert.textContent).toContain('GTG');
    expect(alert.textContent).toContain('codon 7');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    return alert;
  }

  it('three.js chunk fails to load → library fallback; Retry recovers', async () => {
    const mountGenomeEngine = vi.fn(async () => fakeHandle());
    loadEngine
      .mockRejectedValueOnce(new LibraryLoadError(new Error('ChunkLoadError')))
      .mockResolvedValue({ mountGenomeEngine } as unknown as Awaited<ReturnType<typeof loadGenomeEngine>>);
    const { container } = render(<GenomeHelix3D />);
    await expectFallback();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(container.querySelector('[data-renderer="webgl2"]')).not.toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('no WebGPU and no WebGL → renderer fallback', async () => {
    engineWith(async () =>
      Promise.reject(new RendererUnavailableError(['WebGPU not exposed', 'WebGL 2 context could not be created'])),
    );
    render(<GenomeHelix3D />);
    const alert = await expectFallback();
    expect(alert.textContent).toMatch(/could not start WebGPU or WebGL 2/);
  });

  it('unusable structure → data fallback', async () => {
    engineWith(async () => Promise.reject(new StructureDataError('HBB has no codons to draw')));
    render(<GenomeHelix3D />);
    await expectFallback();
  });

  it('GPU context lost after start → fallback via onContextLost', async () => {
    let lost: ((e: Error) => void) | null = null;
    engineWith(async (o) => {
      lost = o.onContextLost;
      return fakeHandle();
    });
    const { container } = render(<GenomeHelix3D />);
    await waitFor(() => expect(container.querySelector('[data-renderer="webgl2"]')).not.toBeNull());
    act(() => (lost as unknown as (e: Error) => void)(new ContextLostError()));
    const alert = await expectFallback();
    expect(alert.textContent).toMatch(/context was lost/);
  });
});

describe('GenomeHelix3D — unknown locus', () => {
  it('renders the fallback instead of throwing', () => {
    engineWith(async () => fakeHandle());
    render(<GenomeHelix3D gene="NOPE" />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

describe('GenomeHelix3D — prefers-reduced-motion', () => {
  it('forces autoRotate off and hides the rotation toggle', async () => {
    setReducedMotion(true);
    const mount = engineWith(async () => fakeHandle());
    render(<GenomeHelix3D autoRotate />);
    await waitFor(() => expect(mount).toHaveBeenCalled());
    expect(mount.mock.calls[0]?.[0]).toMatchObject({ autoRotate: false });
    expect(screen.queryByRole('button', { name: 'Rotate automatically' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop rotating' })).toBeNull();
  });

  it('shows the rotation toggle and clicking it calls setAutoRotate', async () => {
    setReducedMotion(false);
    let handle: GenomeEngineHandle | null = null;
    engineWith(async () => (handle = fakeHandle()));
    const { container } = render(<GenomeHelix3D autoRotate />);
    await waitFor(() => expect(container.querySelector('[data-renderer="webgl2"]')).not.toBeNull());
    const toggle = screen.getByRole('button', { name: 'Stop rotating' });
    fireEvent.click(toggle);
    const h = handle as unknown as GenomeEngineHandle;
    expect(h.setAutoRotate).toHaveBeenCalled();
  });
});

describe('GenomeHelix3D — caller-supplied model', () => {
  it('mounts the provided model instead of the HBB fixture', async () => {
    const model = buildGenomeModel({
      ref: { bases: 'ATGGAATAA', label: 'ref-short' },
      alt: { bases: 'ATGGTATAA', label: 'alt-short' },
    });
    const mount = engineWith(async () => fakeHandle());
    render(<GenomeHelix3D model={model} />);
    await waitFor(() => expect(mount).toHaveBeenCalled());
    expect(mount.mock.calls[0]?.[0].model).toBe(model);
  });
});

describe('GenomeHelix3D — teardown while loading', () => {
  it('disposes a scene that finishes mounting after unmount', async () => {
    let resolveMount: (h: GenomeEngineHandle) => void = () => undefined;
    let mountOptions: GenomeEngineOptions | null = null;
    engineWith(
      (o) =>
        new Promise<GenomeEngineHandle>((resolve) => {
          mountOptions = o;
          resolveMount = resolve;
        }),
    );
    const { unmount } = render(<GenomeHelix3D />);
    await waitFor(() => expect(mountOptions).not.toBeNull());
    unmount();
    const late = fakeHandle();
    await act(async () => resolveMount(late));
    expect(late.dispose).toHaveBeenCalledTimes(1);
  });
});
