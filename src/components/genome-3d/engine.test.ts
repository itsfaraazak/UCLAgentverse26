// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Material } from 'three';
import { createFakeRenderer } from '@/components/protein/__fixtures__/fake-renderer';
import { classifyFailure } from '@/components/protein/runtime/errors';
import { selectRenderer } from '@/components/protein/runtime/renderer';
import { mountGenomeEngine } from './engine';
import { getLocus } from '@/lib/genome';
import { buildGenomeModel, buildLocusModel } from './model';

function hbbExtent() {
  const locus = getLocus('HBB');
  if (locus === undefined) throw new Error('loci.json has no HBB locus');
  const modelled = locus.cdsReference.codonCount;
  const annotatedEnd = Math.max(...locus.exons.map((e) => e.codonEnd));
  return { modelled, expectedTotal: Math.max(modelled, annotatedEnd) };
}

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

    const { modelled, expectedTotal } = hbbExtent();
    expect(model.modelledCodonCount).toBe(modelled);
    expect(model.totalCodonCount).toBe(expectedTotal);
    expect(model.segments).toHaveLength(model.totalCodonCount);
    expect(engine.scene.codonInstances).toBe(model.totalCodonCount);
    expect(engine.scene.modelledCodons).toBe(model.modelledCodonCount);
    expect(engine.scene.rungInstances).toBe(model.modelledCodonCount * 3);
    expect(engine.scene.unsequencedCodons).toBe(
      model.totalCodonCount - model.modelledCodonCount,
    );
    expect(engine.scene.editedCodonIndices).toEqual([7]);
    engine.dispose();
  });

  it('draws an unsequenced tail as codon beads with no rungs', async () => {
    const model = buildGenomeModel({
      ref: { bases: 'ATGGAGAAACCC', label: 'ref' },
      alt: { bases: 'ATGGTGAAACCC', label: 'alt' },
      totalCodonCount: 20,
    });
    const engine = await mountGenomeEngine({
      container: host(),
      model,
      onContextLost: () => undefined,
      createRenderer: async () => createFakeRenderer(),
    });
    expect(engine.scene.codonInstances).toBe(20);
    expect(engine.scene.modelledCodons).toBe(4);
    expect(engine.scene.rungInstances).toBe(4 * 3);
    expect(engine.scene.unsequencedCodons).toBe(20 - 4);
    expect(engine.focusCodon(20)).toBe(true);
    expect(engine.focusCodon(21)).toBe(false);
    engine.dispose();
    expect(engine.trackedResourceCount()).toBe(0);
  });

  it('instances rather than allocating geometry per codon', async () => {
    const created = vi.spyOn(BufferGeometry.prototype, 'setAttribute');
    const model = buildLocusModel({ variantId: 'HBB_HbS' });
    const engine = await mountGenomeEngine({
      container: host(),
      model,
      onContextLost: () => undefined,
      createRenderer: async () => createFakeRenderer(),
    });

    // Every codon and rung is drawn, but the scene holds only a handful of
    // geometries/materials — which is what proves they are instanced and not
    // one mesh (and one geometry) per codon.
    expect(engine.scene.codonInstances).toBe(model.totalCodonCount);
    expect(engine.scene.rungInstances).toBe(model.modelledCodonCount * 3);
    expect(engine.trackedResourceCount()).toBeLessThan(20);
    expect(created.mock.calls.length).toBeLessThan(model.totalCodonCount);
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
    // true B-DNA proportions a full CDS is a ~150-unit hairline, so the
    // default framing has to be a readable stretch around the edit.
    expect(engine.scene.focusedCodon).toBe(7);
    engine.resetView();
    expect(engine.scene.focusedCodon).toBeNull();
    expect(engine.focusEdit()).toBe(true);
    expect(engine.scene.focusedCodon).toBe(7);
    expect(engine.focusCodon(model.totalCodonCount)).toBe(true);
    expect(engine.focusCodon(model.totalCodonCount + 1)).toBe(false);
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
