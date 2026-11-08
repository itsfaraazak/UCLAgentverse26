// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Material } from 'three';
import { mountProteinEngine } from './engine';
import { classifyFailure } from './runtime/errors';
import { selectRenderer } from './runtime/renderer';
import { createFakeRenderer } from './__fixtures__/fake-renderer';
import { syntheticPdb } from './__fixtures__/pdb';

function host(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('mountProteinEngine', () => {
  it('builds the scene, finds the edited residue and reports the renderer', async () => {
    const container = host();
    const fake = createFakeRenderer('webgl2');
    const handle = await mountProteinEngine({
      container,
      pdbId: 'TEST',
      pdbText: syntheticPdb('VAL'),
      residueNumber: 6,
      expectedResName: 'VAL',
      onContextLost: () => undefined,
      createRenderer: async () => fake,
    });
    expect(container.querySelector('canvas')).toBe(fake.surface.domElement);
    expect(handle.renderer).toEqual({ kind: 'webgl2', label: 'WebGL 2', fallbackReason: fake.fallbackReason });
    expect(handle.structure.highlightedChains).toEqual(['B']);
    expect(handle.structure.otherChainsAtPosition).toEqual([{ chainId: 'A', resName: 'ASP' }]);
    expect(handle.structure.title).toContain('SYNTHETIC');
    expect(handle.structure.chainCount).toBe(2);
    expect(handle.trackedResourceCount()).toBeGreaterThan(0);
    handle.dispose();
  });

  it('disposes every geometry and material, releases the renderer and removes the canvas', async () => {
    const geometryDispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(Material.prototype, 'dispose');
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const container = host();
    const fake = createFakeRenderer();
    const handle = await mountProteinEngine({
      container,
      pdbId: 'TEST',
      pdbText: syntheticPdb('VAL'),
      residueNumber: 6,
      expectedResName: 'VAL',
      onContextLost: () => undefined,
      createRenderer: async () => fake,
    });
    handle.orbit(0.3, 0.1); // schedule a frame so dispose must cancel it
    const tracked = handle.trackedResourceCount();
    handle.dispose();
    handle.dispose(); // idempotent
    expect(handle.trackedResourceCount()).toBe(0);
    // 1 PDBLoader atom geometry + 2 tubes + 1 sphere, plus the PDBLoader bond
    // geometry disposed right after parse.
    expect(geometryDispose.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(materialDispose.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(tracked).toBeGreaterThanOrEqual(8);
    expect(fake.calls.release).toBe(1);
    expect(cancel).toHaveBeenCalled();
    expect(container.querySelector('canvas')).toBeNull();
    const rendersAtDispose = fake.calls.render;
    await new Promise((r) => setTimeout(r, 40));
    expect(fake.calls.render).toBe(rendersAtDispose);
  });

  it('withholds the highlight (and says so) when the structure carries a different residue', async () => {
    const handle = await mountProteinEngine({
      container: host(),
      pdbId: 'TEST',
      pdbText: syntheticPdb('GLU'),
      residueNumber: 6,
      expectedResName: 'VAL',
      onContextLost: () => undefined,
      createRenderer: async () => createFakeRenderer(),
    });
    expect(handle.structure.highlightedChains).toEqual([]);
    handle.dispose();
  });

  it('rejects an unusable file as a data failure before touching the GPU', async () => {
    const createRenderer = vi.fn(async () => createFakeRenderer());
    const err = await mountProteinEngine({
      container: host(),
      pdbId: 'TEST',
      pdbText: 'HEADER    NOTHING HERE\nEND\n',
      residueNumber: 6,
      expectedResName: 'VAL',
      onContextLost: () => undefined,
      createRenderer,
    }).catch((e: unknown) => e);
    expect(classifyFailure(err)).toBe('data');
    expect(createRenderer).not.toHaveBeenCalled();
  });

  it('releases a renderer that arrives after the caller aborted', async () => {
    const controller = new AbortController();
    const fake = createFakeRenderer();
    const container = host();
    const err = await mountProteinEngine({
      container,
      pdbId: 'TEST',
      pdbText: syntheticPdb('VAL'),
      residueNumber: 6,
      expectedResName: 'VAL',
      signal: controller.signal,
      onContextLost: () => undefined,
      createRenderer: async () => {
        controller.abort();
        return fake;
      },
    }).catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(fake.calls.release).toBe(1);
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('reports a lost GPU context, but not the one its own dispose triggers', async () => {
    const onContextLost = vi.fn();
    const fake = createFakeRenderer();
    const handle = await mountProteinEngine({
      container: host(),
      pdbId: 'TEST',
      pdbText: syntheticPdb('VAL'),
      residueNumber: 6,
      expectedResName: 'VAL',
      onContextLost,
      createRenderer: async () => fake,
    });
    fake.surface.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(onContextLost).toHaveBeenCalledTimes(1);
    expect(classifyFailure(onContextLost.mock.calls[0]?.[0])).toBe('context-lost');
    handle.dispose();
    fake.surface.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(onContextLost).toHaveBeenCalledTimes(1);
  });

  it('with the real selector in a GPU-less environment, fails as "renderer" (jsdom has neither WebGPU nor WebGL)', async () => {
    // jsdom logs "Not implemented: HTMLCanvasElement.getContext"; silence it.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const container = host();
    const err = await mountProteinEngine({
      container,
      pdbId: 'TEST',
      pdbText: syntheticPdb('VAL'),
      residueNumber: 6,
      expectedResName: 'VAL',
      onContextLost: () => undefined,
      createRenderer: selectRenderer,
    }).catch((e: unknown) => e);
    expect(classifyFailure(err)).toBe('renderer');
    expect(String(err)).toContain('WebGPU not exposed');
    expect(container.querySelector('canvas')).toBeNull();
  });
});
