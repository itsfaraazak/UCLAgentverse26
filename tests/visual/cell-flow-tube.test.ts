import { describe, expect, it } from 'vitest';
import { countNonzeroBytes, isSolidRgba, renderAndMatchBaseline, renderScene } from './harness';
import { buildCellFlowTube, CELL_FLOW_TUBE } from './scenes/cell-flow-tube';

describe('cell-flow-tube visual scene', () => {
  it('renders a byte-identical frame twice', async () => {
    const first = await renderScene(buildCellFlowTube, CELL_FLOW_TUBE);
    const second = await renderScene(buildCellFlowTube, CELL_FLOW_TUBE);
    expect(first.pixels).toEqual(second.pixels);
  });

  it('matches the committed baseline for the selected adapter', async () => {
    await renderAndMatchBaseline(CELL_FLOW_TUBE.name, buildCellFlowTube, {
      ...CELL_FLOW_TUBE,
      maxMismatchedPixels: 0,
    });
  });

  it('documents whether the adapter executed shaders', async () => {
    const frame = await renderScene(buildCellFlowTube, CELL_FLOW_TUBE);
    const nonzero = countNonzeroBytes(frame.pixels);
    if (frame.adapter === 'mock') {
      // vgpu/mock stores textures but does not rasterize or clear them.
      expect(nonzero).toBe(0);
      expect(isSolidRgba(frame.pixels)).toBe(true);
    } else {
      expect(nonzero).toBeGreaterThan(0);
      expect(isSolidRgba(frame.pixels)).toBe(false);
    }
  });
});
