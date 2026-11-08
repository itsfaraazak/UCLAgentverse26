// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import lociFile from '@/data/loci.json';
import { ProteinViewer } from './ProteinViewer';
import { loadProteinEngine } from './load-engine';
import type { ProteinEngineHandle, ProteinEngineOptions } from './engine';
import {
  LibraryLoadError,
  PdbFetchError,
  RendererUnavailableError,
  StructureDataError,
} from './runtime/errors';

vi.mock('./load-engine', () => ({ loadProteinEngine: vi.fn() }));
const loadEngine = vi.mocked(loadProteinEngine);

const HBS = lociFile.loci[0]?.variants.find((v) => v.id === 'HBB_HbS');

function fakeHandle(options: ProteinEngineOptions): ProteinEngineHandle {
  return {
    renderer: { kind: 'webgl2', label: 'WebGL 2', fallbackReason: 'WebGPU not exposed by this browser' },
    structure: {
      pdbId: options.pdbId,
      title: `TITLE OF ${options.pdbId}`,
      molecules: [
        { molecule: 'HEMOGLOBIN ALPHA', chains: ['A', 'C'] },
        { molecule: 'HEMOGLOBIN BETA', chains: ['B', 'D'] },
      ],
      chainCount: 4,
      atomCount: 4000,
      highlightedChains: ['B', 'D'],
      otherChainsAtPosition: [{ chainId: 'A', resName: 'ASP' }],
    },
    resetView: vi.fn(),
    focusResidue: vi.fn(),
    orbit: vi.fn(),
    zoom: vi.fn(),
    trackedResourceCount: () => 0,
    dispose: vi.fn(),
  };
}

type Mount = (options: ProteinEngineOptions) => Promise<ProteinEngineHandle>;

function engineWith(mount: Mount) {
  const mountProteinEngine = vi.fn(mount);
  loadEngine.mockResolvedValue({ mountProteinEngine } as unknown as Awaited<ReturnType<typeof loadProteinEngine>>);
  return mountProteinEngine;
}

const pdbText = 'ATOM      1  CA  VAL B   6       0.000   0.000   0.000  1.00  0.00           C';

beforeEach(() => {
  loadEngine.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('ProteinViewer — success path', () => {
  it('shows the renderer status, legend and fixture text; disposes on unmount', async () => {
    const handles: ProteinEngineHandle[] = [];
    const mount = engineWith(async (o) => {
      const h = fakeHandle(o);
      handles.push(h);
      return h;
    });
    const loadPdb = vi.fn(async () => pdbText);
    const { container, unmount } = render(<ProteinViewer loadPdb={loadPdb} />);

    await waitFor(() => expect(container.querySelector('[data-renderer="webgl2"]')).not.toBeNull());
    expect(loadPdb).toHaveBeenCalledWith('2HBS', expect.any(AbortSignal));
    expect(mount.mock.calls[0]?.[0]).toMatchObject({ pdbId: '2HBS', residueNumber: 6, expectedResName: 'VAL' });
    expect(screen.getByText(/in chains B, D/)).toBeTruthy();
    expect(screen.getAllByText(/Glutamate \(Glu, E\) → Valine \(Val, V\) at codon 7/).length).toBeGreaterThan(0);
    // Both limitations surfaced: the fixture's, and "not a prediction".
    expect(screen.getByText(new RegExp(HBS?.structural.limitation.slice(0, 40) ?? 'x'))).toBeTruthy();
    expect(screen.getAllByText(/not a (structure )?prediction/i).length).toBeGreaterThan(0);

    unmount();
    expect(handles[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('is keyboard operable once ready', async () => {
    let handle: ProteinEngineHandle | null = null;
    engineWith(async (o) => (handle = fakeHandle(o)));
    render(<ProteinViewer loadPdb={async () => pdbText} />);
    const view = await screen.findByRole('img', { name: /highlighted in magenta in chains B, D/ });
    view.focus();
    fireEvent.keyDown(view, { key: 'ArrowLeft' });
    fireEvent.keyDown(view, { key: '+' });
    fireEvent.keyDown(view, { key: 'f' });
    expect(handle).not.toBeNull();
    const h = handle as unknown as ProteinEngineHandle;
    expect(h.orbit).toHaveBeenCalled();
    expect(h.zoom).toHaveBeenCalled();
    expect(h.focusResidue).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Rotate right' }));
    expect(h.orbit).toHaveBeenCalledTimes(2);
  });

  it('toggles to the reference structure, disposing the previous scene', async () => {
    const handles: ProteinEngineHandle[] = [];
    const mount = engineWith(async (o) => {
      const h = fakeHandle(o);
      handles.push(h);
      return h;
    });
    const loadPdb = vi.fn(async () => pdbText);
    const { container } = render(<ProteinViewer loadPdb={loadPdb} />);
    await waitFor(() => expect(container.querySelector('[data-renderer="webgl2"]')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Glu6 · 4HHB/ }));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
    expect(loadPdb).toHaveBeenLastCalledWith('4HHB', expect.any(AbortSignal));
    expect(mount.mock.calls[1]?.[0]).toMatchObject({ pdbId: '4HHB', expectedResName: 'GLU' });
    expect(handles[0]?.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('ProteinViewer — every failure path renders a text fallback with retry', () => {
  async function expectFallback(title: RegExp) {
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(title);
    // The residue change in words, with amino-acid names, plus the summary.
    expect(alert.textContent).toContain('Glutamate (Glu, E) → Valine (Val, V)');
    expect(alert.textContent).toContain(HBS?.structural.summary ?? '∅');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    return alert;
  }

  it('PDB fetch fails (offline / conference wifi) → network fallback; Retry refetches and recovers', async () => {
    engineWith(async (o) => fakeHandle(o));
    const loadPdb = vi
      .fn<(id: string, s: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(new PdbFetchError('Could not reach the RCSB file server (Failed to fetch)'))
      .mockResolvedValueOnce(pdbText);
    const { container } = render(<ProteinViewer loadPdb={loadPdb} />);
    await expectFallback(/could not be downloaded/);
    expect(container.querySelector('[data-renderer="none"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(container.querySelector('[data-renderer="webgl2"]')).not.toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(loadPdb).toHaveBeenCalledTimes(2);
  });

  it('three.js chunk fails to load → library fallback', async () => {
    loadEngine.mockRejectedValue(new LibraryLoadError(new Error('ChunkLoadError')));
    render(<ProteinViewer loadPdb={async () => pdbText} />);
    await expectFallback(/3D library did not load/);
  });

  it('library fails while the download also fails → one fallback, no unhandled rejection', async () => {
    loadEngine.mockRejectedValue(new LibraryLoadError(new Error('ChunkLoadError')));
    render(<ProteinViewer loadPdb={async () => Promise.reject(new PdbFetchError('offline'))} />);
    await expectFallback(/could not be downloaded/);
  });

  it('no WebGPU and no WebGL → renderer fallback', async () => {
    engineWith(async () => Promise.reject(new RendererUnavailableError(['WebGPU not exposed', 'WebGL 2 context could not be created'])));
    render(<ProteinViewer loadPdb={async () => pdbText} />);
    const alert = await expectFallback(/could not start WebGPU or WebGL 2/);
    expect(alert.textContent).toContain('WebGL 2 context could not be created');
  });

  it('unusable structure file → data fallback', async () => {
    engineWith(async () => Promise.reject(new StructureDataError('TEST contains no atom records')));
    render(<ProteinViewer loadPdb={async () => pdbText} />);
    await expectFallback(/could not be used/);
  });

  it('GPU context lost after start → fallback, scene disposed', async () => {
    let lost: ((e: Error) => void) | null = null;
    let handle: ProteinEngineHandle | null = null;
    engineWith(async (o) => {
      lost = o.onContextLost;
      return (handle = fakeHandle(o));
    });
    const { container } = render(<ProteinViewer loadPdb={async () => pdbText} />);
    await waitFor(() => expect(container.querySelector('[data-renderer="webgl2"]')).not.toBeNull());
    const { ContextLostError } = await import('./runtime/errors');
    act(() => (lost as unknown as (e: Error) => void)(new ContextLostError()));
    await expectFallback(/context was lost/);
    expect((handle as unknown as ProteinEngineHandle).dispose).toHaveBeenCalledTimes(1);
  });
});

describe('ProteinViewer — teardown while loading', () => {
  it('aborts the download and disposes a scene that finishes mounting after unmount', async () => {
    let resolveMount: (h: ProteinEngineHandle) => void = () => undefined;
    let mountOptions: ProteinEngineOptions | null = null;
    engineWith(
      (o) =>
        new Promise<ProteinEngineHandle>((resolve) => {
          mountOptions = o;
          resolveMount = resolve;
        }),
    );
    let pdbSignal: AbortSignal | null = null;
    const { unmount } = render(
      <ProteinViewer
        loadPdb={async (_id, signal) => {
          pdbSignal = signal;
          return pdbText;
        }}
      />,
    );
    await waitFor(() => expect(mountOptions).not.toBeNull());
    unmount();
    expect((pdbSignal as unknown as AbortSignal).aborted).toBe(true);
    const late = fakeHandle(mountOptions as unknown as ProteinEngineOptions);
    await act(async () => resolveMount(late));
    expect(late.dispose).toHaveBeenCalledTimes(1);
  });
});
