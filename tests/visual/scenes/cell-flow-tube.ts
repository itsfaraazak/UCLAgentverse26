import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { draw, frame, geometry, type ShaderSource } from 'vgpu/mock';
import {
  composeMatrix,
  cylinder,
  instances,
  orbitRig,
  perspective,
  rigPose,
  sphere,
  viewMatrices,
} from 'vgpu/scene';
import { instanceGeometry } from 'vgpu/scene/gpu';
import { prepareWgsl } from '../deps';
import type { SceneBuilder, SceneContext } from '../harness';

export const CELL_FLOW_TUBE = {
  name: 'cell-flow-tube',
  width: 256,
  height: 256,
  cellCount: 24,
  clear: [0.04, 0.05, 0.08, 1] as const,
};

const shaderPath = fileURLToPath(new URL('./cell-flow-tube.wgsl', import.meta.url));
const worldScratch = new Float32Array(16);

let shader: ShaderSource | undefined;

async function loadShader(): Promise<ShaderSource> {
  shader ??= await prepareWgsl(readFileSync(shaderPath, 'utf8'), shaderPath);
  return shader;
}

function placeCells(count: number) {
  const cells = instances({ capacity: count, attributes: { tint: 'float32x4' } });
  for (let i = 0; i < count; i += 1) {
    const t = i / count;
    const angle = t * Math.PI * 4;
    const shade = 0.82 + (i % 5) * 0.035;
    const id = cells.add({ tint: [0.92 * shade, 0.14, 0.2, 1] });
    cells.setWorld(
      id,
      composeMatrix(
        {
          position: [Math.cos(angle) * 0.72, (t - 0.5) * 3.6, Math.sin(angle) * 0.72],
          scale: 0.22,
        },
        worldScratch,
      ),
    );
  }
  return cells;
}

export const buildCellFlowTube: SceneBuilder = async (ctx: SceneContext) => {
  const shaderSource = await loadShader();
  const aspect = ctx.width / ctx.height;

  const tube = instances({ capacity: 1, attributes: { tint: 'float32x4' } });
  tube.add({ tint: [0.22, 0.48, 0.62, 1] });
  const tubeBridge = instanceGeometry(ctx.gpu, tube, {
    mesh: geometry(
      ctx.gpu,
      cylinder({
        radius: 0.4,
        height: 4.2,
        radialSegments: 24,
        heightSegments: 1,
        openEnded: true,
      }),
    ),
  });

  const cells = placeCells(CELL_FLOW_TUBE.cellCount);
  const cellBridge = instanceGeometry(ctx.gpu, cells, {
    mesh: geometry(ctx.gpu, sphere({ radius: 0.5, widthSegments: 12, heightSegments: 8 })),
  });

  const projection = perspective({ fov: 45, near: 0.1, far: 100 }, aspect, new Float32Array(16));
  const pose = rigPose(orbitRig({ yaw: 0.72, pitch: 0.38, distance: 7.2 }), {
    position: new Float32Array(3),
    quaternion: new Float32Array(4),
  });
  const matrices = { view: new Float32Array(16), viewProjection: new Float32Array(16) };
  viewMatrices(pose, projection, matrices);

  const camera = { viewProjection: matrices.viewProjection };
  const lighting = { direction: [-0.35, 0.9, 0.4], ambient: 0.18 };
  const tubeDraw = draw(ctx.gpu, { shader: shaderSource, geometry: tubeBridge.geometry, cull: 'back' });
  const cellDraw = draw(ctx.gpu, { shader: shaderSource, geometry: cellBridge.geometry, cull: 'back' });
  tubeDraw.set({ camera, lighting });
  cellDraw.set({ camera, lighting });

  const tubeCount = tubeBridge.publish();
  const cellCount = cellBridge.publish();
  frame(ctx.gpu, (current) => {
    current.pass({ target: ctx.target, clear: CELL_FLOW_TUBE.clear }, (pass) => {
      pass.draw(tubeDraw, { instances: tubeCount });
      pass.draw(cellDraw, { instances: cellCount });
    });
  });
};
