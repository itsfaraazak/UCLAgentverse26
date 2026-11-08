import {
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Spherical,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AbortedError, StructureDataError } from '@/components/protein/runtime/errors';
import {
  selectRenderer,
  type RendererKind,
  type RendererPreference,
  type SelectedRenderer,
} from '@/components/protein/runtime/renderer';
import { ResourceTracker } from '@/components/protein/runtime/resources';
import { attachViewport } from '@/components/protein/runtime/viewport';
import { GENOME_PALETTE } from './palette';
import { codonSpan, helixLayout, type BaseNode, type HelixLayout, type Vec3 } from './layout';
import type { CodonSegment, GenomeModel } from './model';

/**
 * Three.js scene for the locus itself — distinct from `components/protein`,
 * which draws a deposited protein structure. Reached only through a dynamic
 * `import()` from `GenomeHelix3D`, so `three` never lands in a host page's
 * initial chunk.
 *
 * What is drawn, and nothing more:
 *   - two backbone ribbons following the sense and antisense strands;
 *   - one base-pair rung per modelled base (an `InstancedMesh`, 93 for HBB);
 *   - one core bead per codon of the locus's annotated extent (an
 *     `InstancedMesh`, 147 for HBB), coloured by diff status, with codons we
 *     hold no sequence for drawn dim and hollow rather than invented;
 *   - a highlight bead, a halo and an axis ring at the edited codon.
 *
 * This is a **schematic** B-form helix at textbook proportions (≈3.4 Å rise,
 * ≈10.5 bp/turn). It is not a predicted or deposited structure, and nothing
 * here models the physical effect of the edit — the shell says so in text
 * next to the canvas, and `loci.json`'s own `limitation` travels with it.
 */


/** Geometry proportions, kept here so the engine owns its own look. */
const GEOMETRY = {
  /** Radius of the per-codon core bead. */
  codonRadius: 0.34,
  /** Radius of a base-pair rung. */
  rungRadius: 0.085,
  /** Radius of each backbone ribbon. */
  ribbonRadius: 0.17,
  /** Radius of the marker ring drawn around the edited codon. */
  ringRadius: 2.1,
  /**
   * How many codons the focused view frames.
   *
   * B-DNA really is long and thin: 147 codons at a ≈3.4 Å rise is ~150 world
   * units against a radius of 1, so framing the whole locus draws a hairline
   * with the edit marker sub-pixel. That view is honest but useless, so it
   * stays available as "Fit" while the default lands on a readable stretch
   * of helix around the edit.
   */
  codonsInFocus: 17,
} as const;

export interface RendererInfo {
  readonly kind: RendererKind;
  readonly label: string;
  readonly fallbackReason: string | null;
}

/** What the engine actually put on screen, for the shell's text alternative. */
export interface SceneSummary {
  readonly codonInstances: number;
  readonly rungInstances: number;
  readonly modelledCodons: number;
  readonly unsequencedCodons: number;
  readonly editedCodonIndices: readonly number[];
  readonly focusedCodon: number | null;
  /** Axial length of the drawn helix, world units. */
  readonly axisLength: number;
}

export interface GenomeEngineOptions {
  readonly container: HTMLElement;
  readonly model: GenomeModel;
  readonly prefer?: RendererPreference;
  /** Idle rotation. The shell passes `false` under `prefers-reduced-motion`. */
  readonly autoRotate?: boolean;
  readonly signal?: AbortSignal;
  readonly onContextLost: (err: Error) => void;
  /** Injection seam for tests; defaults to runtime WebGPU→WebGL selection. */
  readonly createRenderer?: (opts: {
    prefer?: RendererPreference;
    signal?: AbortSignal;
  }) => Promise<SelectedRenderer>;
}

export interface GenomeEngineHandle {
  readonly renderer: RendererInfo;
  readonly scene: SceneSummary;
  /** Frame the whole locus. */
  resetView(): void;
  /** Fly in to a 1-based codon. Returns false if it is out of range. */
  focusCodon(codonIndex: number): boolean;
  /** Jump straight to the edit site; false when nothing changed. */
  focusEdit(): boolean;
  orbit(deltaAzimuth: number, deltaPolar: number): void;
  /** >1 zooms in, <1 zooms out. */
  zoom(factor: number): void;
  setAutoRotate(enabled: boolean): void;
  /** Number of GPU resources still held; 0 after `dispose()`. */
  trackedResourceCount(): number;
  dispose(): void;
}

function v3(p: Vec3): Vector3 {
  return new Vector3(p.x, p.y, p.z);
}

function colorForSegment(segment: CodonSegment, edited: ReadonlySet<number>): number {
  if (!segment.modelled) return GENOME_PALETTE.codonUnsequenced;
  if (edited.has(segment.codonIndex)) return GENOME_PALETTE.codonEdited;
  if (segment.silent) return GENOME_PALETTE.codonSilent;
  return GENOME_PALETTE.codonSame;
}

const UP = new Vector3(0, 1, 0);

/** Orientation taking a +Y unit cylinder onto an arbitrary direction. */
function alignY(direction: Vector3, target: Quaternion): Quaternion {
  return target.setFromUnitVectors(UP, direction);
}

function ribbon(points: readonly Vector3[], tracker: ResourceTracker, color: number): Mesh {
  const curve = new CatmullRomCurve3([...points], false, 'centripetal');
  const geometry = tracker.track(
    new TubeGeometry(curve, Math.min(points.length * 2, 1400), GEOMETRY.ribbonRadius, 6, false),
  );
  const material = tracker.track(new MeshStandardMaterial({ color, roughness: 0.6 }));
  return new Mesh(geometry, material);
}

export async function mountGenomeEngine(
  options: GenomeEngineOptions,
): Promise<GenomeEngineHandle> {
  const {
    container,
    model,
    prefer = 'auto',
    autoRotate = false,
    signal,
    onContextLost,
    createRenderer = selectRenderer,
  } = options;

  // ---- Derive geometry from the model before touching the GPU. -----------
  if (model.totalCodonCount < 1) {
    throw new StructureDataError(
      `${model.gene} has no codons to draw (the sequence diff produced ${model.totalCodonCount} rows)`,
    );
  }
  const layout: HelixLayout = helixLayout({ codonCount: model.totalCodonCount });
  const segmentByIndex = new Map(model.segments.map((s) => [s.codonIndex, s]));
  const editedSet = new Set(model.editedCodonIndices);

  // Rungs exist only where we actually have bases.
  const modelledNodes: BaseNode[] = layout.nodes.filter((node) => {
    const segment = segmentByIndex.get(node.codonIndex);
    return segment !== undefined && segment.modelled;
  });

  // ---- Renderer ----------------------------------------------------------
  const selected = await createRenderer({ prefer, signal });
  if (signal?.aborted) {
    selected.release();
    throw new AbortedError();
  }

  const tracker = new ResourceTracker();
  const surface = selected.surface;
  surface.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 4000);
  scene.add(camera);
  scene.add(new HemisphereLight(0xffffff, 0x2a303c, 1.5));
  const key = new DirectionalLight(0xffffff, 1.5);
  key.position.set(0.5, 0.7, 1);
  camera.add(key);

  const model3d = new Group();
  // Centre the helix on the origin so orbiting feels natural.
  model3d.position.set(0, -layout.axisLength / 2, 0);
  scene.add(model3d);

  // Backbone ribbons.
  model3d.add(ribbon(layout.nodes.map((n) => v3(n.strandA)), tracker, GENOME_PALETTE.strandA));
  model3d.add(ribbon(layout.nodes.map((n) => v3(n.strandB)), tracker, GENOME_PALETTE.strandB));

  const matrix = new Matrix4();
  const quat = new Quaternion();
  const scale = new Vector3();
  const tmpColor = new Color();

  // Base-pair rungs — one instance per modelled base.
  if (modelledNodes.length > 0) {
    const geometry = tracker.track(
      new CylinderGeometry(GEOMETRY.rungRadius, GEOMETRY.rungRadius, 1, 6, 1),
    );
    const material = tracker.track(
      new MeshStandardMaterial({ color: GENOME_PALETTE.rung, roughness: 0.7 }),
    );
    const mesh = tracker.track(new InstancedMesh(geometry, material, modelledNodes.length));
    modelledNodes.forEach((node, i) => {
      alignY(v3(node.rungDirection), quat);
      matrix.compose(
        v3(node.rungCenter),
        quat,
        scale.set(1, node.rungLength, 1),
      );
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    model3d.add(mesh);
  }

  // Codon core beads — one instance per codon of the annotated extent.
  const codonGeometry = tracker.track(
    new CylinderGeometry(GEOMETRY.codonRadius, GEOMETRY.codonRadius, 1, 10, 1),
  );
  const codonMaterial = tracker.track(new MeshStandardMaterial({ roughness: 0.5 }));
  const codonMesh = tracker.track(
    new InstancedMesh(codonGeometry, codonMaterial, model.totalCodonCount),
  );
  const codonLength = layout.params.rise * 3 * 0.86; // a visible gap between codons
  for (let i = 0; i < model.totalCodonCount; i += 1) {
    const codonIndex = i + 1;
    const span = codonSpan(layout, codonIndex);
    const segment = segmentByIndex.get(codonIndex);
    if (span === undefined || segment === undefined) continue;
    const edited = editedSet.has(codonIndex);
    matrix.compose(
      v3(span.center),
      quat.identity(),
      scale.set(edited ? 1.9 : 1, codonLength, edited ? 1.9 : 1),
    );
    codonMesh.setMatrixAt(i, matrix);
    tmpColor.setHex(colorForSegment(segment, editedSet));
    codonMesh.setColorAt(i, tmpColor);
  }
  codonMesh.instanceMatrix.needsUpdate = true;
  if (codonMesh.instanceColor !== null) codonMesh.instanceColor.needsUpdate = true;
  codonMesh.frustumCulled = false;
  model3d.add(codonMesh);

  // ---- The edit site, marked unmistakably. -------------------------------
  const focusTargets = new Map<number, Vector3>();
  for (const codonIndex of editedSet) {
    const span = codonSpan(layout, codonIndex);
    if (span !== undefined) focusTargets.set(codonIndex, v3(span.center));
  }

  if (focusTargets.size > 0) {
    const haloGeometry = tracker.track(new IcosahedronGeometry(1, 2));
    const haloMaterial = tracker.track(
      new MeshStandardMaterial({
        color: GENOME_PALETTE.highlight,
        emissive: GENOME_PALETTE.highlight,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.17,
        depthWrite: false,
      }),
    );
    const haloMesh = tracker.track(
      new InstancedMesh(haloGeometry, haloMaterial, focusTargets.size),
    );
    // A ring around the axis stays findable when the whole locus is framed
    // and the bead itself is only a few pixels.
    const ringGeometry = tracker.track(
      new TorusGeometry(GEOMETRY.ringRadius, 0.055, 8, 48),
    );
    const ringMaterial = tracker.track(
      new MeshStandardMaterial({
        color: GENOME_PALETTE.highlight,
        emissive: GENOME_PALETTE.highlight,
        emissiveIntensity: 0.5,
        roughness: 0.4,
      }),
    );
    const ringMesh = tracker.track(new InstancedMesh(ringGeometry, ringMaterial, focusTargets.size));
    const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

    let k = 0;
    for (const centre of focusTargets.values()) {
      matrix.compose(centre, quat.identity(), scale.setScalar(1.5));
      haloMesh.setMatrixAt(k, matrix);
      matrix.compose(centre, flat, scale.setScalar(1));
      ringMesh.setMatrixAt(k, matrix);
      k += 1;
    }
    haloMesh.instanceMatrix.needsUpdate = true;
    ringMesh.instanceMatrix.needsUpdate = true;
    haloMesh.frustumCulled = false;
    haloMesh.renderOrder = 1;
    ringMesh.frustumCulled = false;
    model3d.add(ringMesh);
    model3d.add(haloMesh);
  }

  // ---- Camera, controls, render loop -------------------------------------
  const halfLength = layout.axisLength / 2;
  const boundingRadius = Math.hypot(halfLength, GEOMETRY.ringRadius);

  camera.near = Math.max(0.01, boundingRadius * 0.002);
  camera.far = boundingRadius * 16;
  camera.updateProjectionMatrix();

  const controls = new OrbitControls(camera, surface.domElement);
  controls.enableDamping = false;
  controls.minDistance = 0.6;
  controls.maxDistance = boundingRadius * 8;
  controls.autoRotateSpeed = 0.7;

  let aspect = 1;
  let disposed = false;
  let frame: number | null = null;
  let spinning = autoRotate;
  let focusedCodon: number | null = null;

  const draw = (): void => {
    frame = null;
    if (disposed) return;
    if (spinning) {
      controls.autoRotate = true;
      controls.update();
    }
    surface.render(scene, camera);
    // Only an idle spin needs a continuous loop; everything else renders
    // on demand, so a static view costs nothing.
    if (spinning) requestRender();
  };
  const requestRender = (): void => {
    if (disposed || frame !== null) return;
    frame = requestAnimationFrame(draw);
  };
  controls.addEventListener('change', requestRender);

  const fitDistance = (radius: number): number => {
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    return (radius * 1.1) / Math.sin(Math.min(vFov, hFov) / 2);
  };
  const place = (direction: Vector3, distance: number, target: Vector3): void => {
    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    controls.update();
    requestRender();
  };

  // Looking slightly down the helix reads as a helix rather than a stripe.
  const wholeView = new Vector3(0.82, 0.22, 0.52).normalize();
  const closeView = new Vector3(1, 0.12, 0.35).normalize();

  /** Distance that frames `codonsInFocus` codons plus the marker ring. */
  const focusDistance = (): number =>
    fitDistance(
      Math.max((GEOMETRY.codonsInFocus * 3 * layout.params.rise) / 2, GEOMETRY.ringRadius * 1.3),
    );

  const resetView = (): void => {
    focusedCodon = null;
    place(wholeView, fitDistance(boundingRadius), new Vector3());
  };

  const focusCodon = (codonIndex: number): boolean => {
    const span = codonSpan(layout, codonIndex);
    if (span === undefined) return false;
    // Model-space → world, mirroring the group's centring offset.
    const target = v3(span.center).add(model3d.position);
    focusedCodon = codonIndex;
    place(closeView, focusDistance(), target);
    return true;
  };

  const focusEdit = (): boolean => {
    const index = model.primaryEditedCodon;
    if (index === null) return false;
    return focusCodon(index);
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
  // Land on the edit site by default; `resetView` ("Fit") still shows the
  // whole locus for anyone who wants its true extent.
  resetView();
  if (model.primaryEditedCodon !== null) focusCodon(model.primaryEditedCodon);
  if (spinning) requestRender();

  const spherical = new Spherical();
  const offset = new Vector3();

  return {
    renderer: {
      kind: selected.kind,
      label: selected.label,
      fallbackReason: selected.fallbackReason,
    },
    scene: {
      codonInstances: model.totalCodonCount,
      rungInstances: modelledNodes.length,
      modelledCodons: model.modelledCodonCount,
      unsequencedCodons: model.totalCodonCount - model.modelledCodonCount,
      editedCodonIndices: model.editedCodonIndices,
      get focusedCodon() {
        return focusedCodon;
      },
      axisLength: layout.axisLength,
    },
    resetView,
    focusCodon,
    focusEdit,
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
    setAutoRotate(enabled) {
      spinning = enabled;
      controls.autoRotate = enabled;
      if (enabled) requestRender();
    },
    trackedResourceCount: () => tracker.size,
    dispose() {
      if (disposed) return;
      disposed = true;
      spinning = false;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      // Detach before releasing: forceContextLoss() fires webglcontextlost,
      // which is teardown, not an error worth reporting.
      detach();
      scene.clear();
      model3d.clear();
      tracker.disposeAll();
      selected.release();
    },
  };
}
