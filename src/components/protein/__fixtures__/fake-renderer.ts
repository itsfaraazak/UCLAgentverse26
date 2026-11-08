import type { SelectedRenderer } from '../runtime/renderer';

/**
 * A stand-in for WebGL/WebGPU in jsdom. Records what the engines ask of it so
 * tests can assert on lifecycle (render calls, release) without a GPU.
 */
export interface FakeRenderer extends SelectedRenderer {
  readonly calls: { render: number; release: number; setSize: number };
}

export function createFakeRenderer(kind: 'webgpu' | 'webgl2' = 'webgl2'): FakeRenderer {
  const calls = { render: 0, release: 0, setSize: 0 };
  const canvas = document.createElement('canvas');
  return {
    kind,
    label: kind === 'webgpu' ? 'WebGPU' : 'WebGL 2',
    fallbackReason: kind === 'webgpu' ? null : 'WebGPU not exposed by this browser',
    calls,
    surface: {
      domElement: canvas,
      setPixelRatio: () => undefined,
      setSize: () => {
        calls.setSize += 1;
      },
      setClearColor: () => undefined,
      render: () => {
        calls.render += 1;
      },
    },
    release: () => {
      calls.release += 1;
    },
  };
}
