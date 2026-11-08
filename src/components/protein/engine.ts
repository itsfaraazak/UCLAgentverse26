import {
  CatmullRomCurve3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Sphere,
  Spherical,
  TubeGeometry,
  Vector3,
  type BufferAttribute,
  type BufferGeometry,
  type InterleavedBufferAttribute,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PDBLoader } from 'three/addons/loaders/PDBLoader.js';
import { AbortedError, StructureDataError } from './runtime/errors';
import {
  selectRenderer,
  type RendererKind,
  type RendererPreference,
  type SelectedRenderer,
} from './runtime/renderer';
import { ResourceTracker } from './runtime/resources';
import { attachViewport } from './runtime/viewport';
import {
  backboneTraces,
  ligandAtomIndices,
  parseAtomRecords,
  parseMolecules,
  parseTitle,
  selectResidue,
  type MoleculeEntry,
} from './pdb';

/**
 * Three.js scene for one deposited structure. Loaded only via dynamic
 * `import()` from `ProteinViewer` — never reachable from a server component.
 *
 * What is drawn, and nothing more:
 *   - a Cα backbone tube per chain (chains that carry the edited position in
 *     one colour, the others in a muted colour);
 *   - hetero groups (haem) as small CPK-coloured spheres, colours from
 *     PDBLoader;
 *   - every atom of residue N in each chain where it is the expected amino
 *     acid, as large highlight spheres with a translucent halo.
 * No contacts, pockets or interfaces are inferred or drawn.
 */

export const PROTEIN_PALETTE = {
  carrierChain: 0x3b82f6,
  otherChain: 0x94a3b8,
  highlight: 0xe11d74,
} as const;

export interface StructureSummary {
  readonly pdbId: string;
  readonly title: string | null;
  readonly molecules: readonly MoleculeEntry[];
  readonly chainCount: number;
  readonly atomCount: number;
  readonly highlightedChains: readonly string[];
  readonly otherChainsAtPosition: ReadonlyArray<{ chainId: string; resName: string }>;
}

export interface RendererInfo {
  readonly kind: RendererKind;
  readonly label: string;
  readonly fallbackReason: string | null;
}

export interface ProteinEngineOptions {
  readonly container: HTMLElement;
  readonly pdbId: string;
  readonly pdbText: string;
  readonly residueNumber: number;
  /** Three-letter code this structure should carry at `residueNumber`. */
  readonly expectedResName: string;
  readonly prefer?: RendererPreference;
  readonly signal?: AbortSignal;
  readonly onContextLost: (err: Error) => void;
  /** Injection seam for tests; defaults to runtime WebGPU→WebGL selection. */
  readonly createRenderer?: (opts: {
    prefer?: RendererPreference;
    signal?: AbortSignal;
  }) => Promise<SelectedRenderer>;
}

export interface ProteinEngineHandle {
  readonly renderer: RendererInfo;
  readonly structure: StructureSummary;
  /** Whole-structure framing, looking toward the edited residue. */
  resetView(): void;
  /** Move in close to the first highlighted residue. */
  focusResidue(): void;
  /** Keyboard orbit, radians. */
  orbit(deltaAzimuth: number, deltaPolar: number): void;
  /** >1 zooms in, <1 zooms out. */
  zoom(factor: number): void;
  /** Number of GPU resources still held; 0 after `dispose()`. */
  trackedResourceCount(): number;
  dispose(): void;
}

type PositionAttribute = BufferAttribute | InterleavedBufferAttribute;

function vectorAt(attr: PositionAttribute, index: number, target = new Vector3()): Vector3 {
  return target.set(attr.getX(index), attr.getY(index), attr.getZ(index));
}

function centroid(attr: PositionAttribute, indices: readonly number[]): Vector3 {
  const c = new Vector3();
  const v = new Vector3();
  for (const i of indices) c.add(vectorAt(attr, i, v));
  return indices.length > 0 ? c.multiplyScalar(1 / indices.length) : c;
}

export async function mountProteinEngine(
  options: ProteinEngineOptions,
): Promise<ProteinEngineHandle> {
  const {
    container,
    pdbId,
    pdbText,
    residueNumber,
    expectedResName,
    prefer = 'auto',
    signal,
    onContextLost,
    createRenderer = selectRenderer,
  } = options;

  // Parse first: a bad file should fail before we touch the GPU.
  let geometryAtoms: BufferGeometry;
  let geometryBonds: BufferGeometry;
  try {
    ({ geometryAtoms, geometryBonds } = new PDBLoader().parse(pdbText));
  } catch (err) {
    throw new StructureDataError(
      `PDBLoader could not parse ${pdbId} (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  // We never draw PDBLoader's CONECT bond geometry.
  geometryBonds.dispose();

  const records = parseAtomRecords(pdbText);
  const positions = geometryAtoms.getAttribute('position');
  const colors = geometryAtoms.getAttribute('color');
  if (records.length === 0 || positions.count === 0) {
    geometryAtoms.dispose();
    throw new StructureDataError(`${pdbId} contains no atom records`);
  }
  if (positions.count !== records.length) {
    geometryAtoms.dispose();
    throw new StructureDataError(
      `Atom tables disagree for ${pdbId} (${positions.count} vs ${records.length}); refusing to guess which atom is the edited residue`,
    );
  }

  const traces = backboneTraces(records).filter((t) => t.caIndices.length >= 4);
  if (traces.length === 0) {
    geometryAtoms.dispose();
    throw new StructureDataError(`${pdbId} has no polymer backbone to draw`);
  }
  const selection = selectResidue(records, residueNumber, expectedResName);
  const ligands = ligandAtomIndices(records);
  const carrier = new Set(selection.matchedChains);

  // Renderer.
  const selected = await createRenderer({ prefer, signal });
  if (signal?.aborted) {
    selected.release();
    geometryAtoms.dispose();
    throw new AbortedError();
  }

  const tracker = new ResourceTracker();
  tracker.track(geometryAtoms);
  const surface = selected.surface;
  surface.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.5, 2000);
  scene.add(camera);
  scene.add(new HemisphereLight(0xffffff, 0x3a3f4a, 1.6));
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(0.4, 0.8, 1);
  camera.add(key);

  const model = new Group();
  scene.add(model);

  // Backbone tubes.
  const carrierMat = tracker.track(
    new MeshStandardMaterial({ color: PROTEIN_PALETTE.carrierChain, roughness: 0.55 }),
  );
  const otherMat = tracker.track(
    new MeshStandardMaterial({ color: PROTEIN_PALETTE.otherChain, roughness: 0.6 }),
  );
  const bounds: Vector3[] = [];
  for (const trace of traces) {
    const points = trace.caIndices.map((i) => vectorAt(positions, i));
    bounds.push(...points);
    const curve = new CatmullRomCurve3(points, false, 'centripetal');
    const geometry = tracker.track(
      new TubeGeometry(curve, Math.min(points.length * 4, 1200), 0.42, 6, false),
    );
    model.add(new Mesh(geometry, carrier.has(trace.chainId) ? carrierMat : otherMat));
  }

  const unitSphere = tracker.track(new IcosahedronGeometry(1, 2));
  const matrix = new Matrix4();
  const v = new Vector3();
  const tmpColor = new Color();

  // Hetero groups (haem etc.) with PDBLoader's CPK colours.
  if (ligands.length > 0) {
    const mat = tracker.track(new MeshStandardMaterial({ roughness: 0.5 }));
    const mesh = tracker.track(new InstancedMesh(unitSphere, mat, ligands.length));
    ligands.forEach((atomIndex, k) => {
      vectorAt(positions, atomIndex, v);
      matrix.makeScale(0.42, 0.42, 0.42).setPosition(v);
      mesh.setMatrixAt(k, matrix);
      tmpColor.setRGB(colors.getX(atomIndex), colors.getY(atomIndex), colors.getZ(atomIndex));
      mesh.setColorAt(k, tmpColor);
    });
    mesh.frustumCulled = false;
    model.add(mesh);
  }

  // The edited residue.
  const halos: Vector3[] = [];
  if (selection.atomIndices.length > 0) {
    const mat = tracker.track(
      new MeshStandardMaterial({
        color: PROTEIN_PALETTE.highlight,
        emissive: PROTEIN_PALETTE.highlight,
        emissiveIntensity: 0.35,
        roughness: 0.35,
      }),
    );
    const mesh = tracker.track(new InstancedMesh(unitSphere, mat, selection.atomIndices.length));
    selection.atomIndices.forEach((atomIndex, k) => {
      vectorAt(positions, atomIndex, v);
      matrix.makeScale(0.95, 0.95, 0.95).setPosition(v);
      mesh.setMatrixAt(k, matrix);
    });
    mesh.frustumCulled = false;
    model.add(mesh);

    const haloMat = tracker.track(
      new MeshStandardMaterial({
        color: PROTEIN_PALETTE.highlight,
        emissive: PROTEIN_PALETTE.highlight,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
    );
    const haloMesh = tracker.track(new InstancedMesh(unitSphere, haloMat, selection.byChain.size));
    let k = 0;
    for (const indices of selection.byChain.values()) {
      const c = centroid(positions, indices);
      halos.push(c);
      matrix.makeScale(4.2, 4.2, 4.2).setPosition(c);
      haloMesh.setMatrixAt(k, matrix);
      k += 1;
    }
    haloMesh.frustumCulled = false;
    haloMesh.renderOrder = 1;
    model.add(haloMesh);
  }

  // Centre the model on its backbone and remember the framing.
  const sphere = new Sphere().setFromPoints(bounds);
  model.position.copy(sphere.center).multiplyScalar(-1);
  const radius = Math.max(sphere.radius, 1);
  const focus = halos[0]?.clone().sub(sphere.center) ?? null;
  const viewDir =
    focus !== null && focus.lengthSq() > 1e-6 ? focus.clone().normalize() : new Vector3(0, 0, 1);

  // Fixed clip planes spanning every reachable camera distance.
  camera.near = Math.max(0.1, radius * 0.01);
  camera.far = radius * 12;
  camera.updateProjectionMatrix();

  const controls = new OrbitControls(camera, surface.domElement);
  controls.enableDamping = false;
  controls.minDistance = radius * 0.15;
  controls.maxDistance = radius * 6;

  let aspect = 1;
  let disposed = false;
  let frame: number | null = null;
  const draw = (): void => {
    frame = null;
    if (disposed) return;
    surface.render(scene, camera);
  };
  const requestRender = (): void => {
    if (disposed || frame !== null) return;
    frame = requestAnimationFrame(draw);
  };
  controls.addEventListener('change', requestRender);

  const fitDistance = (): number => {
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    return (radius * 1.08) / Math.sin(Math.min(vFov, hFov) / 2);
  };
  const place = (direction: Vector3, distance: number, target: Vector3): void => {
    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    controls.update();
    requestRender();
  };
  const resetView = (): void => place(viewDir, fitDistance(), new Vector3());
  const focusResidue = (): void => {
    if (focus === null) {
      resetView();
      return;
    }
    place(viewDir, Math.max(radius * 0.55, 18), focus.clone());
  };

  const detach = attachViewport({
    container,
    surface,
    onResize: (width, height) => {
      aspect = width / height;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      requestRender();
    },
    onContextLost: (err) => {
      if (!disposed) onContextLost(err);
    },
  });
  resetView();

  const spherical = new Spherical();
  const offset = new Vector3();

  return {
    renderer: {
      kind: selected.kind,
      label: selected.label,
      fallbackReason: selected.fallbackReason,
    },
    structure: {
      pdbId,
      title: parseTitle(pdbText),
      molecules: parseMolecules(pdbText),
      chainCount: traces.length,
      atomCount: records.length,
      highlightedChains: selection.matchedChains,
      otherChainsAtPosition: selection.otherChains,
    },
    resetView,
    focusResidue,
    orbit(deltaAzimuth, deltaPolar) {
      offset.copy(camera.position).sub(controls.target);
      spherical.setFromVector3(offset);
      spherical.theta += deltaAzimuth;
      spherical.phi = Math.min(Math.PI - 0.05, Math.max(0.05, spherical.phi + deltaPolar));
      offset.setFromSpherical(spherical);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
      controls.update();
      requestRender();
    },
    zoom(factor) {
      offset.copy(camera.position).sub(controls.target);
      const next = Math.min(
        controls.maxDistance,
        Math.max(controls.minDistance, offset.length() / factor),
      );
      offset.setLength(next);
      camera.position.copy(controls.target).add(offset);
      controls.update();
      requestRender();
    },
    trackedResourceCount: () => tracker.size,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      // Detach (and drop the context-lost listener) *before* releasing:
      // forceContextLoss() fires webglcontextlost, which is not an error.
      detach();
      scene.clear();
      tracker.disposeAll();
      selected.release();
    },
  };
}
