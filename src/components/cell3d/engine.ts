import {
  Color,
  DirectionalLight,
  DoubleSide,
  Euler,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  TorusGeometry,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SimSnapshot } from '@/lib/cellsim';
import { AbortedError } from '@/components/protein/runtime/errors';
import {
  selectRenderer,
  type RendererKind,
  type RendererPreference,
  type SelectedRenderer,
} from '@/components/protein/runtime/renderer';
import { ResourceTracker } from '@/components/protein/runtime/resources';
import { attachViewport } from '@/components/protein/runtime/viewport';
import {
  createDiscoidGeometry,
  createSickleGeometry,
  createVesselGeometry,
  createWallOutlineGeometry,
  worldX,
  worldY,
} from './geometry';

/**
 * Three.js renderer for `lib/cellsim` snapshots. It owns no simulation state:
 * `draw(snapshot)` writes each cell's simulated position, heading, radius and
 * state into two `InstancedMesh`es and renders. Loaded only via dynamic
 * `import()` from `CellFlow3D`.
 */

export const CELL_PALETTE = {
  discoid: 0xdc2626,
  sickled: 0x7c3aed,
  stalled: 0xf59e0b,
  ringIdle: 0x94a3b8,
  ringJam: 0xf97316,
  vessel: 0xf1a9a9,
  wall: 0xb45f5f,
} as const;

export interface RendererInfo {
  readonly kind: RendererKind;
  readonly label: string;
  readonly fallbackReason: string | null;
}

export interface CellEngineOptions {
  readonly container: HTMLElement;
  /** Fixes channel geometry and instance capacity. */
  readonly initial: SimSnapshot;
  readonly prefer?: RendererPreference;
  readonly signal?: AbortSignal;
  readonly onContextLost: (err: Error) => void;
  readonly createRenderer?: (opts: {
    prefer?: RendererPreference;
    signal?: AbortSignal;
  }) => Promise<SelectedRenderer>;
}

export interface CellInstanceInspection {
  readonly discoid: ReadonlyArray<{ x: number; y: number; scale: number }>;
  readonly sickled: ReadonlyArray<{ x: number; y: number; scale: number }>;
  readonly ringOcclusion: number;
  readonly tick: number;
}

export interface CellEngineHandle {
  readonly renderer: RendererInfo;
  draw(snapshot: SimSnapshot): void;
  resetView(): void;
  /** Diagnostics: read back what the GPU buffers currently hold. */
  inspect(): CellInstanceInspection;
  trackedResourceCount(): number;
  dispose(): void;
}

/** Tilt discs a little off face-on so the biconcave dimple catches light. */
const DISC_TILT = new Quaternion().setFromEuler(new Euler(0.5, 0.25, 0));
const Z_AXIS = new Vector3(0, 0, 1);

export async function mountCellEngine(options: CellEngineOptions): Promise<CellEngineHandle> {
  const {
    container,
    initial,
    prefer = 'auto',
    signal,
    onContextLost,
    createRenderer = selectRenderer,
  } = options;
  const geom = initial.geom;
  const constriction = initial.params.capillaryConstriction;
  const capacity = Math.max(1, initial.cells.length);
  // Reference speed for "stalled": the fastest cell in the seeded,
  // all-discoid initial state, i.e. the sim's own unobstructed centreline.
  let referenceFlow = 0;
  for (const c of initial.cells) referenceFlow = Math.max(referenceFlow, c.vx);
  if (referenceFlow <= 0) referenceFlow = 1;

  const selected = await createRenderer({ prefer, signal });
  if (signal?.aborted) {
    selected.release();
    throw new AbortedError();
  }
  const surface = selected.surface;
  surface.setClearColor(0x000000, 0);
  const tracker = new ResourceTracker();

  const scene = new Scene();
  const camera = new PerspectiveCamera(28, 1, 1, 5000);
  scene.add(camera);
  scene.add(new HemisphereLight(0xffffff, 0x40303a, 1.5));
  const key = new DirectionalLight(0xffffff, 1.8);
  key.position.set(-0.3, 0.9, 1);
  camera.add(key);

  // Vessel (back half) and in-plane wall outline.
  scene.add(
    new Mesh(
      tracker.track(createVesselGeometry(geom, constriction)),
      tracker.track(
        new MeshStandardMaterial({
          color: CELL_PALETTE.vessel,
          roughness: 0.8,
          side: DoubleSide,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
        }),
      ),
    ),
  );
  scene.add(
    new LineSegments(
      tracker.track(createWallOutlineGeometry(geom, constriction)),
      tracker.track(new LineBasicMaterial({ color: CELL_PALETTE.wall })),
    ),
  );

  // Constriction ring: tints toward orange with the sim's occlusion metric.
  const ringMat = tracker.track(
    new MeshStandardMaterial({ color: CELL_PALETTE.ringIdle, roughness: 0.4, emissive: CELL_PALETTE.ringJam, emissiveIntensity: 0 }),
  );
  const ring = new Mesh(tracker.track(new TorusGeometry(geom.opening / 2 + 1.2, 0.9, 10, 64)), ringMat);
  ring.rotation.y = Math.PI / 2;
  ring.position.x = worldX(geom.constrictionX, geom);
  scene.add(ring);

  // Cells.
  const cellMat = (): MeshStandardMaterial =>
    tracker.track(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0 }));
  const discoid = tracker.track(new InstancedMesh(tracker.track(createDiscoidGeometry()), cellMat(), capacity));
  const sickled = tracker.track(new InstancedMesh(tracker.track(createSickleGeometry()), cellMat(), capacity));
  const idle = new Color(CELL_PALETTE.discoid);
  for (const mesh of [discoid, sickled]) {
    // Positions change every frame; a stale bounding sphere would cull cells.
    mesh.frustumCulled = false;
    // Allocate instanceColor before the first render.
    for (let i = 0; i < capacity; i += 1) mesh.setColorAt(i, idle);
    mesh.count = 0;
    scene.add(mesh);
  }

  const colorDiscoid = new Color(CELL_PALETTE.discoid);
  const colorSickled = new Color(CELL_PALETTE.sickled);
  const colorStalled = new Color(CELL_PALETTE.stalled);
  const ringIdle = new Color(CELL_PALETTE.ringIdle);
  const ringJam = new Color(CELL_PALETTE.ringJam);
  const tmpColor = new Color();
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const heading = new Quaternion();
  let lastTick = initial.tick;
  let lastOcclusion = 0;

  let aspect = 1;
  let disposed = false;
  let frame: number | null = null;
  const renderNow = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (!disposed) surface.render(scene, camera);
  };
  const requestRender = (): void => {
    if (disposed || frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!disposed) surface.render(scene, camera);
    });
  };

  const controls = new OrbitControls(camera, surface.domElement);
  controls.enableZoom = false; // never hijack page scroll
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.minPolarAngle = Math.PI * 0.22;
  controls.maxPolarAngle = Math.PI * 0.62;
  controls.minAzimuthAngle = -Math.PI / 3;
  controls.maxAzimuthAngle = Math.PI / 3;
  controls.addEventListener('change', requestRender);

  const resetView = (): void => {
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const fitWidth = (geom.width * 0.54) / Math.tan(hFov / 2);
    const fitHeight = (geom.height * 0.9) / Math.tan(vFov / 2);
    const distance = Math.max(fitWidth, fitHeight);
    controls.target.set(0, 0, 0);
    camera.position.copy(new Vector3(0, 0.3, 1).normalize().multiplyScalar(distance));
    camera.near = Math.max(1, distance * 0.2);
    camera.far = distance * 4;
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    controls.update();
    requestRender();
  };

  const detach = attachViewport({
    container,
    surface,
    onResize: (width, height) => {
      aspect = width / height;
      camera.aspect = aspect;
      resetView();
    },
    onContextLost: (err) => {
      if (!disposed) onContextLost(err);
    },
  });

  const draw = (snapshot: SimSnapshot): void => {
    if (disposed) return;
    const { constrictionX, constrictionHalfLength } = snapshot.geom;
    let nd = 0;
    let ns = 0;
    for (const cell of snapshot.cells) {
      if (nd + ns >= capacity) break;
      position.set(worldX(cell.x, snapshot.geom), worldY(cell.y, snapshot.geom), 0);
      scale.setScalar(cell.radius);
      if (cell.state === 'discoid') {
        matrix.compose(position, DISC_TILT, scale);
        discoid.setMatrixAt(nd, matrix);
        discoid.setColorAt(nd, colorDiscoid);
        nd += 1;
      } else {
        // Sim y grows downward, world Y upward: negate the heading.
        heading.setFromAxisAngle(Z_AXIS, -cell.theta);
        matrix.compose(position, heading, scale);
        sickled.setMatrixAt(ns, matrix);
        const inNeck = Math.abs(cell.x - constrictionX) <= constrictionHalfLength;
        const stall = inNeck ? 1 - Math.min(1, Math.max(0, cell.vx / referenceFlow)) : 0;
        tmpColor.copy(colorSickled).lerp(colorStalled, stall * stall);
        sickled.setColorAt(ns, tmpColor);
        ns += 1;
      }
    }
    discoid.count = nd;
    sickled.count = ns;
    for (const mesh of [discoid, sickled]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
    const occ = Math.min(1, Math.max(0, snapshot.metrics.occlusion));
    ringMat.color.copy(ringIdle).lerp(ringJam, occ);
    ringMat.emissiveIntensity = occ * 0.6;
    lastOcclusion = occ;
    lastTick = snapshot.tick;
    renderNow();
  };

  draw(initial);

  const read = (mesh: InstancedMesh) => {
    const out: Array<{ x: number; y: number; scale: number }> = [];
    const m = new Matrix4();
    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getMatrixAt(i, m);
      m.decompose(p, q, s);
      out.push({ x: p.x, y: p.y, scale: s.x });
    }
    return out;
  };

  return {
    renderer: {
      kind: selected.kind,
      label: selected.label,
      fallbackReason: selected.fallbackReason,
    },
    draw,
    resetView,
    inspect: () => ({
      discoid: read(discoid),
      sickled: read(sickled),
      ringOcclusion: lastOcclusion,
      tick: lastTick,
    }),
    trackedResourceCount: () => tracker.size,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      detach();
      scene.clear();
      tracker.disposeAll();
      selected.release();
    },
  };
}
