import { WebGLRenderer, type Camera, type Scene } from 'three';
import { AbortedError, RendererUnavailableError, describe, isAbort } from './errors';
import type { GpuAdapterProbe } from './gpu';

/**
 * Client-side renderer selection, shared by the protein viewer and the 3D
 * cell view. Rendering always happens on the *viewer's* GPU; there is no
 * server GPU anywhere in this project.
 *
 * Policy:
 *   1. If the browser exposes `navigator.gpu` AND hands back a real adapter,
 *      lazily import `three/webgpu` and initialise a `WebGPURenderer`.
 *      If that renderer ends up on its internal WebGL2 backend instead of a
 *      true WebGPU backend, we discard it — the classic `WebGLRenderer` is
 *      the better-tested WebGL path and we would rather report honestly.
 *   2. Otherwise (or on any failure in step 1) create a `WebGLRenderer`
 *      (WebGL 2; three.js dropped WebGL 1 in r163).
 *   3. If WebGL 2 also fails, throw `RendererUnavailableError` carrying every
 *      reason collected, so the UI can render an informative text fallback.
 *
 * This module imports `three` statically, so it must only ever be reached via
 * a dynamic `import()` from a client component.
 */

export type RendererKind = 'webgpu' | 'webgl2';
export type RendererPreference = 'auto' | 'webgl';

/** The subset of the renderer surface our engines rely on. Both
 *  `WebGLRenderer` and `WebGPURenderer` satisfy it structurally. */
export interface RenderSurface {
  readonly domElement: HTMLCanvasElement;
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setClearColor(color: number, alpha?: number): void;
  render(scene: Scene, camera: Camera): unknown;
}

export interface SelectedRenderer {
  readonly kind: RendererKind;
  /** Short human label for the status affordance, e.g. "WebGPU". */
  readonly label: string;
  /** Why we are *not* on WebGPU, when we are not. `null` on WebGPU. */
  readonly fallbackReason: string | null;
  readonly surface: RenderSurface;
  /** Dispose the renderer and release its GPU context immediately. Idempotent. */
  release(): void;
}

/** Created renderers, before the WebGPU/WebGL decision is final. */
export interface RendererCandidate {
  readonly surface: RenderSurface;
  /** True only when the renderer is running on a real WebGPU device. */
  readonly onWebGPU: boolean;
  release(): void;
}

export interface RendererDeps {
  readonly gpu: GpuAdapterProbe | undefined;
  readonly createWebGPU: () => Promise<RendererCandidate>;
  readonly createWebGL: () => RendererCandidate;
}

function once(fn: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    try {
      fn();
    } catch {
      // A renderer that throws while being disposed has nothing left to free.
    }
  };
}

function createClassicWebGL(): RendererCandidate {
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  return {
    surface: renderer,
    onWebGPU: false,
    release: once(() => {
      renderer.dispose();
      // Without this the browser keeps the context alive until GC, and
      // browsers cap live WebGL contexts (~16). Variant switching would
      // eventually evict the *current* page's context.
      renderer.forceContextLoss();
    }),
  };
}

async function createWebGPUCandidate(): Promise<RendererCandidate> {
  const { WebGPURenderer } = await import('three/webgpu');
  const renderer = new WebGPURenderer({ antialias: true, alpha: true });
  const release = once(() => {
    void renderer.dispose().catch(() => undefined);
  });
  try {
    await renderer.init();
  } catch (err) {
    release();
    throw err;
  }
  const backend: object = renderer.backend;
  const onWebGPU = 'isWebGPUBackend' in backend && backend.isWebGPUBackend === true;
  return { surface: renderer, onWebGPU, release };
}

function isGpuProbe(value: unknown): value is GpuAdapterProbe {
  return (
    typeof value === 'object' &&
    value !== null &&
    'requestAdapter' in value &&
    typeof value.requestAdapter === 'function'
  );
}

/** `navigator.gpu`, if this browser genuinely exposes one. */
export function navigatorGpu(): GpuAdapterProbe | undefined {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return undefined;
  const gpu: unknown = navigator.gpu;
  return isGpuProbe(gpu) ? gpu : undefined;
}

export function defaultRendererDeps(): RendererDeps {
  return {
    gpu: navigatorGpu(),
    createWebGPU: createWebGPUCandidate,
    createWebGL: createClassicWebGL,
  };
}

function throwIfAborted(signal: AbortSignal | undefined, cleanup?: () => void): void {
  if (signal?.aborted) {
    cleanup?.();
    throw new AbortedError();
  }
}

/**
 * Pick a renderer at runtime. Never assumes either API exists.
 */
export async function selectRenderer(
  options: { prefer?: RendererPreference; signal?: AbortSignal } = {},
  deps: RendererDeps = defaultRendererDeps(),
): Promise<SelectedRenderer> {
  const { prefer = 'auto', signal } = options;
  const reasons: string[] = [];

  if (prefer === 'webgl') {
    reasons.push('WebGL requested by host');
  } else if (deps.gpu === undefined) {
    reasons.push('WebGPU not exposed by this browser');
  } else {
    let adapter: object | null = null;
    try {
      adapter = await deps.gpu.requestAdapter({ powerPreference: 'high-performance' });
    } catch (err) {
      reasons.push(`WebGPU adapter request failed (${describe(err)})`);
    }
    throwIfAborted(signal);
    if (adapter === null) {
      if (reasons.length === 0) reasons.push('No WebGPU adapter available');
    } else {
      try {
        const candidate = await deps.createWebGPU();
        throwIfAborted(signal, candidate.release);
        if (candidate.onWebGPU) {
          return {
            kind: 'webgpu',
            label: 'WebGPU',
            fallbackReason: null,
            surface: candidate.surface,
            release: candidate.release,
          };
        }
        candidate.release();
        reasons.push('WebGPU renderer could not reach a WebGPU device');
      } catch (err) {
        if (isAbort(err)) throw err;
        reasons.push(`WebGPU renderer failed to initialise (${describe(err)})`);
      }
    }
  }

  throwIfAborted(signal);
  try {
    const candidate = deps.createWebGL();
    return {
      kind: 'webgl2',
      label: 'WebGL 2',
      fallbackReason: reasons.join('; '),
      surface: candidate.surface,
      release: candidate.release,
    };
  } catch (err) {
    reasons.push(`WebGL 2 context could not be created (${describe(err)})`);
    throw new RendererUnavailableError(reasons);
  }
}
