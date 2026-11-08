// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Material } from 'three';
import lociFile from '@/data/loci.json';
import { createFakeRenderer } from '@/components/protein/__fixtures__/fake-renderer';
import { classifyFailure } from '@/components/protein/runtime/errors';
import { selectRenderer } from '@/components/protein/runtime/renderer';
import { mountGenomeEngine } from './engine';
import { buildGenomeModel, buildLocusModel } from './model';

const hbb = lociFile.loci.find((locus) => locus.gene === 'HBB');
if (hbb === undefined) throw new Error('HBB fixture missing from loci.json');
const HBB_CODON_COUNT = hbb.cdsReference.codonCount;
const HBB_RUNG_COUNT = HBB_CODON_COUNT * 3;

function host(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('mountGenomeEngine — instancing driven by the real locus', () => {
  it('instances one codon per annotated codon and one rung per modelled base', async () => {
    const model = buildLocusModel({ variantId: 'HBB_HbS' });
    const engine = await mountGenomeEngine({
      container: host(),
      model,
      onContextLost: () => undefined,
      createRenderer: async () => createFakeRenderer(),
    });

    // HBB: the full NM_000518.5 CDS — every annotated codon is sequenced.
    expect(model.modelledCodonCount).toBe(HBB_CODON_COUNT);
    expect(model.totalCodonCount).toBe(HBB_CODON_COUNT);
    expect(engine.scene.codonInstances).toBe(HBB_CODON_COUNT);
    expect(engine.scene.rungInstances).toBe(HBB_RUNG_COUNT);
    expect(engine.scene.unsequencedCodons).toBe(0);
    expect(engine.scene.editedCodonIndices).toEqual([7]);
    engine.dispose();
  });

  it('instances rather than allocating geometry per codon', async () => {
    const created = vi.spyOn(BufferGeometry.prototype, 'setAttribute');
    const engine = await mountGenomeEngine({
      container: host(),
      model: buildLocusModel({ variantId: 'HBB_HbS' }),
      onContextLost: () => undefined,
      createRenderer: async () => createFakeRenderer(),
    });

    // The full CDS and its rungs are drawn, but the scene holds only a handful
    // of geometries/materials — which is what proves they are instanced and
    // not one mesh (and one geometry) per codon.
    expect(engine.scene.codonInstances).toBe(HBB_CODON_COUNT);
    expect(engine.scene.rungInstances).toBe(HBB_RUNG_COUNT);
    expect(engine.trackedResourceCount()).toBeLessThan(20);
    expect(created.mock.calls.length).toBeLessThan(HBB_CODON_COUNT);
    engine.dispose();
  });

  it('draws no rungs when nothing is modelled but still refuses an empty locus', async () => {
    const empty = buildGenomeModel({
      ref: { bases: 'ATG', label: 'ref' },
      alt: { bases: 'ATG', label: 'alt' },
    });
    const engine = await mountGenomeEngine({
      container: host(),
      model: empty,
      onContextLost: () => undefined,
      createRenderer: async () => createFakeRenderer(),
    });
    expect(engine.scene.codonInstances).toBe(1);
    expect(engine.scene.editedCodonIndices).toEqual([]);
    expect(engine.focusEdit()).toBe(false);
    engine.dispose();
  });
});

describe('mountGenomeEngine — focus and framing', () => {
  it('jumps straight to the edit site, and rejects an out-of-range codon', async () => {
    const model = buildLocusModel({ variantId: 'HBB_HbS' });
    const engine = await mountGenomeEngine({
      container: host(),
      model,
      onContextLost: () => undefined,
      createRenderer: async () => createFakeRenderer(),
    });
    // The view lands on the edit site rather than on the whole locus: at
    // true B-DNA proportions the full CDS is a long hairline, so the
    // default framing has to be a readable stretch around the edit.
    expect(engine.scene.focusedCodon).toBe(7);
    engine.resetView();
    expect(engine.scene.focusedCodon).toBeNull();
    expect(engine.focusEdit()).toBe(true);
    expect(engine.scene.focusedCodon).toBe(7);
    expect(engine.focusCodon(HBB_CODON_COUNT)).toBe(true);
    expect(engine.focusCodon(HBB_CODON_COUNT + 1)).toBe(false);
    expect(engine.focusCodon(0)).toBe(false);
    engine.resetView();
    expect(engine.scene.focusedCodon).toBeNull();
    engine.dispose();
  });

  it('renders on demand when idle, and continuously only while auto-rotating', async () => {
    const fake = createFakeRenderer();
    const engine = await mountGenomeEngine({
      container: host(),
      model: buildLocusModel({ variantId: 'HBB_HbS' }),
      autoRotate: false,
      onContextLost: () => undefined,
      createRenderer: async () => fake,
    });
    await new Promise((r) => setTimeout(r, 60));
    const idle = fake.calls.render;
    await new Promise((r) => setTimeout(r, 60));
    // No idle loop: a static view costs nothing.
    expect(fake.calls.render).toBe(idle);

    engine.setAutoRotate(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(fake.calls.render).toBeGreaterThan(idle);
    engine.dispose();
  });
});

describe('mountGenomeEngine — teardown', () => {
  it('disposes every tracked resource, cancels frames and releases the context', async () => {
    const geometryDispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(Material.prototype, 'dispose');
    const container = host();
    const fake = createFakeRenderer();
    const engine = await mountGenomeEngine({
      container,
      model: buildLocusModel({ variantId: 'HBB_HbS' }),
      autoRotate: true,
      onContextLost: () => undefined,
      createRenderer: async () => fake,
    });

    // ribbons ×2 (geometry+material), rungs, codons, halo, ring.
    expect(engine.trackedResourceCount()).toBeGreaterThanOrEqual(12);
    engine.focusEdit(); // leaves a pending frame
    engine.dispose();
    engine.dispose(); // idempotent

    expect(engine.trackedResourceCount()).toBe(0);
    expect(geometryDispose.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(materialDispose.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(fake.calls.release).toBe(1);
    expect(container.querySelector('canvas')).toBeNull();

    // The auto-rotate loop must be dead, not merely paused.
    const renders = fake.calls.render;
    await new Promise((r) => setTimeout(r, 80));
    expect(fake.calls.render).toBe(renders);
  });

  it('releases a renderer that arrives after the caller aborted', async () => {
    const controller = new AbortController();
    const fake = createFakeRenderer();
    const err = await mountGenomeEngine({
      container: host(),
      model: buildLocusModel({ variantId: 'HBB_HbS' }),
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
    const err = await mountGenomeEngine({
      container: host(),
      model: buildLocusModel({ variantId: 'HBB_HbS' }),
      onContextLost: () => undefined,
      createRenderer: selectRenderer,
    }).catch((e: unknown) => e);
    expect(classifyFailure(err)).toBe('renderer');
  });
});
