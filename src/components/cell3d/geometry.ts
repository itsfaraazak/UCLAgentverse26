import {
  BufferAttribute,
  BufferGeometry,
  LatheGeometry,
  TorusGeometry,
  Vector2,
} from 'three';
import { channelHalfHeight, type ChannelGeom } from '@/lib/cellsim';

/**
 * Cell and vessel geometry. Shapes are presentational; positions, sizes,
 * headings and states all come from `lib/cellsim` per frame.
 */

/**
 * Biconcave disc, unit radius, axis along +Z. Profile from the classic
 * Evans–Fung parametrisation of the resting red-cell shape (normalised to the
 * cell radius) — a picture of "discoid", not a mechanical model.
 */
export function createDiscoidGeometry(segments = 28): BufferGeometry {
  const R = 3.91;
  const C0 = 0.81;
  const C2 = 7.83;
  const C4 = -4.39;
  const half = (x: number): number => {
    const x2 = x * x;
    return (Math.sqrt(Math.max(0, 1 - x2)) * (C0 + C2 * x2 + C4 * x2 * x2)) / 2 / R;
  };
  const n = 14;
  const top: Vector2[] = [];
  for (let i = 0; i <= n; i += 1) {
    // Cosine spacing puts more samples near the rim, where curvature is.
    const x = Math.sin((i / n) * (Math.PI / 2));
    top.push(new Vector2(Math.max(x, 1e-4), half(x)));
  }
  const bottom = top
    .slice(0, -1)
    .reverse()
    .map((p) => new Vector2(p.x, -p.y));
  const geometry = new LatheGeometry([...top, ...bottom], segments);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/**
 * Crescent ("sickle") with tapered tips, unit half-span, long axis along X,
 * flattened in Z.
 */
export function createSickleGeometry(): BufferGeometry {
  const arc = Math.PI * 1.15;
  const radius = 1;
  const geometry = new TorusGeometry(radius, 0.3, 10, 40, arc);
  const pos = geometry.getAttribute('position');
  if (!(pos instanceof BufferAttribute)) return geometry;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let u = Math.atan2(y, x);
    if (u < 0) u += Math.PI * 2;
    const t = Math.max(0.08, Math.pow(Math.sin((Math.PI * Math.min(u, arc)) / arc), 0.7));
    const cx = radius * Math.cos(u);
    const cy = radius * Math.sin(u);
    pos.setXYZ(i, cx + (x - cx) * t, cy + (y - cy) * t, z * t);
  }
  pos.needsUpdate = true;
  geometry.rotateZ(Math.PI / 2 - arc / 2);
  geometry.center();
  geometry.scale(1, 1, 0.55);
  geometry.computeVertexNormals();
  return geometry;
}

/** World X for a sim x: the channel is centred on the origin. */
export function worldX(x: number, geom: ChannelGeom): number {
  return x - geom.width / 2;
}

/** World Y for a sim y: sim y grows downward (canvas convention). */
export function worldY(y: number, geom: ChannelGeom): number {
  return geom.height / 2 - y;
}

/**
 * The back half of the vessel (a cut-away), so the wall never veils the
 * cells. Radius follows the simulation's own `channelHalfHeight`, so the
 * constriction drawn is exactly the one the cells are confined by.
 */
export function createVesselGeometry(geom: ChannelGeom, constriction: number, samples = 160): BufferGeometry {
  const points: Vector2[] = [];
  for (let k = 0; k <= samples; k += 1) {
    const x = (k / samples) * geom.width;
    points.push(new Vector2(channelHalfHeight(x, constriction, geom.height), worldX(x, geom)));
  }
  // Lathe about +Y, back half only (φ ∈ [π/2, 3π/2] ⇒ z ≤ 0).
  const geometry = new LatheGeometry(points, 48, Math.PI / 2, Math.PI);
  // Map the lathe axis (+Y) onto the flow axis (+X).
  geometry.rotateZ(-Math.PI / 2);
  return geometry;
}

/** Wall outlines in the cells' plane (z = 0): the profile cells see. */
export function createWallOutlineGeometry(geom: ChannelGeom, constriction: number, samples = 160): BufferGeometry {
  const vertices: number[] = [];
  for (const sign of [1, -1]) {
    for (let k = 0; k < samples; k += 1) {
      const x0 = (k / samples) * geom.width;
      const x1 = ((k + 1) / samples) * geom.width;
      vertices.push(
        worldX(x0, geom),
        sign * channelHalfHeight(x0, constriction, geom.height),
        0,
        worldX(x1, geom),
        sign * channelHalfHeight(x1, constriction, geom.height),
        0,
      );
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
  return geometry;
}
