import { describe, expect, it, vi, type Mock } from 'vitest';
import { classifyFailure } from './errors';
import { ResourceTracker } from './resources';
import { selectRenderer, type RendererCandidate, type RendererDeps } from './renderer';

// Runs in node: no navigator.gpu, no WebGL. Every renderer is a stub; this
// file tests the *decision*, not three.js.

function candidate(onWebGPU: boolean): RendererCandidate & { release: Mock<() => void> } {
  return {
    onWebGPU,
    release: vi.fn<() => void>(),
    surface: {
      domElement: {} as HTMLCanvasElement,
      setPixelRatio: () => undefined,
      setSize: () => undefined,
      setClearColor: () => undefined,
      render: () => undefined,
    },
  };
}

function deps(overrides: Partial<RendererDeps>): RendererDeps {
  return {
    gpu: undefined,
    createWebGPU: vi.fn(async () => candidate(true)),
    createWebGL: vi.fn(() => candidate(false)),
    ...overrides,
  };
}

const adapterProbe = (adapter: object | null) => ({ requestAdapter: vi.fn(async () => adapter) });

describe('selectRenderer', () => {
  it('uses WebGPU when navigator.gpu yields an adapter and the renderer reaches a WebGPU device', async () => {
    const d = deps({ gpu: adapterProbe({}) });
    const r = await selectRenderer({}, d);
    expect(r.kind).toBe('webgpu');
    expect(r.label).toBe('WebGPU');
    expect(r.fallbackReason).toBeNull();
    expect(d.createWebGL).not.toHaveBeenCalled();
  });

  it('falls back to WebGL 2 when navigator.gpu is absent, without importing three/webgpu', async () => {
    const d = deps({ gpu: undefined });
    const r = await selectRenderer({}, d);
    expect(r.kind).toBe('webgl2');
    expect(r.fallbackReason).toContain('not exposed');
    expect(d.createWebGPU).not.toHaveBeenCalled();
  });

  it('falls back when requestAdapter() resolves null', async () => {
    const d = deps({ gpu: adapterProbe(null) });
    const r = await selectRenderer({}, d);
    expect(r.kind).toBe('webgl2');
    expect(r.fallbackReason).toContain('No WebGPU adapter');
    expect(d.createWebGPU).not.toHaveBeenCalled();
  });

  it('falls back when requestAdapter() throws', async () => {
    const d = deps({ gpu: { requestAdapter: vi.fn(async () => Promise.reject(new Error('blocklisted'))) } });
    const r = await selectRenderer({}, d);
    expect(r.kind).toBe('webgl2');
    expect(r.fallbackReason).toContain('blocklisted');
  });

  it('falls back when WebGPURenderer.init() fails', async () => {
    const d = deps({ gpu: adapterProbe({}), createWebGPU: vi.fn(async () => Promise.reject(new Error('device lost'))) });
    const r = await selectRenderer({}, d);
    expect(r.kind).toBe('webgl2');
    expect(r.fallbackReason).toContain('device lost');
  });

  it('discards a WebGPURenderer that landed on its internal WebGL backend and releases it', async () => {
    const half = candidate(false);
    const d = deps({ gpu: adapterProbe({}), createWebGPU: vi.fn(async () => half) });
    const r = await selectRenderer({}, d);
    expect(r.kind).toBe('webgl2');
    expect(half.release).toHaveBeenCalledTimes(1);
    expect(d.createWebGL).toHaveBeenCalledTimes(1);
  });

  it('honours a host request for WebGL even when WebGPU is available', async () => {
    const d = deps({ gpu: adapterProbe({}) });
    const r = await selectRenderer({ prefer: 'webgl' }, d);
    expect(r.kind).toBe('webgl2');
    expect(d.createWebGPU).not.toHaveBeenCalled();
  });

  it('throws RendererUnavailableError with every reason when WebGL 2 also fails', async () => {
    const d = deps({
      gpu: undefined,
      createWebGL: vi.fn(() => {
        throw new Error('Error creating WebGL context.');
      }),
    });
    const err = await selectRenderer({}, d).catch((e: unknown) => e);
    expect(classifyFailure(err)).toBe('renderer');
    expect(String(err)).toContain('not exposed');
    expect(String(err)).toContain('Error creating WebGL context');
  });

  it('releases a WebGPU renderer that finishes initialising after the caller aborted', async () => {
    const late = candidate(true);
    const controller = new AbortController();
    const d = deps({
      gpu: adapterProbe({}),
      createWebGPU: vi.fn(async () => {
        controller.abort();
        return late;
      }),
    });
    const err = await selectRenderer({ signal: controller.signal }, d).catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(late.release).toHaveBeenCalledTimes(1);
    expect(d.createWebGL).not.toHaveBeenCalled();
  });
});

describe('ResourceTracker', () => {
  it('disposes everything it tracked exactly once', () => {
    const tracker = new ResourceTracker();
    const a = { dispose: vi.fn() };
    const b = { dispose: vi.fn() };
    tracker.track(a);
    tracker.track(b);
    tracker.track(a);
    expect(tracker.size).toBe(2);
    tracker.release([a]);
    expect(a.dispose).toHaveBeenCalledTimes(1);
    tracker.disposeAll();
    tracker.disposeAll();
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).toHaveBeenCalledTimes(1);
    expect(tracker.size).toBe(0);
  });

  it('keeps going when one resource throws on dispose (lost context)', () => {
    const tracker = new ResourceTracker();
    const bad = { dispose: vi.fn(() => { throw new Error('context lost'); }) };
    const good = { dispose: vi.fn() };
    tracker.track(bad);
    tracker.track(good);
    expect(() => tracker.disposeAll()).not.toThrow();
    expect(good.dispose).toHaveBeenCalled();
  });
});
