import { Matrix4, Plane, Quaternion, Vector3, Vector4 } from 'three';
import type { PortalDef } from './types';

const ROT_Y_PI = new Matrix4().makeRotationY(Math.PI);

/** World matrix of a portal: origin at bottom-centre, +Z = front normal, +Y = up. */
export function portalFrame(p: Pick<PortalDef, 'pos' | 'yaw'>, out = new Matrix4()): Matrix4 {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), p.yaw);
  return out.compose(new Vector3(p.pos[0], p.pos[1], p.pos[2]), q, new Vector3(1, 1, 1));
}

export function portalNormal(p: Pick<PortalDef, 'yaw'>, out = new Vector3()): Vector3 {
  return out.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
}

/** Unit vector along the portal's width (local +X). */
export function portalRight(p: Pick<PortalDef, 'yaw'>, out = new Vector3()): Vector3 {
  return out.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
}

/**
 * Transform that carries anything entering `from` (through its front) to the matching place
 * behind `to`'s front: M = To * RotY(pi) * From^-1.
 */
export function portalTransform(
  from: Pick<PortalDef, 'pos' | 'yaw'>,
  to: Pick<PortalDef, 'pos' | 'yaw'>,
  out = new Matrix4(),
): Matrix4 {
  const fromInv = portalFrame(from).invert();
  return out.copy(portalFrame(to)).multiply(ROT_Y_PI).multiply(fromInv);
}

/** Yaw delta applied by a portal transform (portals only rotate about Y). */
export function transformYaw(m: Matrix4): number {
  const e = m.elements;
  // Column 0 is the transformed +X axis: (cos a, 0, -sin a).
  return Math.atan2(-e[2], e[0]);
}

export function portalPlane(p: Pick<PortalDef, 'pos' | 'yaw'>, out = new Plane()): Plane {
  return out.setFromNormalAndCoplanarPoint(portalNormal(p), new Vector3(...p.pos));
}

export function signedDistance(p: Pick<PortalDef, 'pos' | 'yaw'>, pt: Vector3): number {
  const n = portalNormal(p);
  return n.x * (pt.x - p.pos[0]) + n.z * (pt.z - p.pos[2]);
}

/** Corners of the portal rectangle in world space (BL, BR, TR, TL, as seen from the front). */
export function portalCorners(p: PortalDef): Vector3[] {
  const r = portalRight(p);
  const hw = p.width / 2;
  const base = new Vector3(...p.pos);
  const up = new Vector3(0, p.height, 0);
  return [
    base.clone().addScaledVector(r, -hw),
    base.clone().addScaledVector(r, hw),
    base.clone().addScaledVector(r, hw).add(up),
    base.clone().addScaledVector(r, -hw).add(up),
  ];
}

/** Local coordinates of a world point in portal space: x = lateral, y = height above bottom, z = signed distance. */
export function toPortalLocal(p: Pick<PortalDef, 'pos' | 'yaw'>, pt: Vector3, out = new Vector3()): Vector3 {
  const dx = pt.x - p.pos[0];
  const dz = pt.z - p.pos[2];
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  return out.set(dx * c - dz * s, pt.y - p.pos[1], dx * s + dz * c);
}

export interface Crossing {
  /** Fraction along the segment where the plane is crossed. */
  t: number;
}

/**
 * Detects a front-to-back crossing of a portal rectangle by the segment a->b.
 * `yProbe` is the height (relative to the points' y) that must lie inside the rectangle;
 * `margin` widens the vertical acceptance window.
 */
export function segmentCrossesPortal(
  p: PortalDef,
  a: Vector3,
  b: Vector3,
  yProbe = 0,
  margin = 0,
): Crossing | null {
  const la = toPortalLocal(p, a);
  const lb = toPortalLocal(p, b);
  if (!(la.z >= 0 && lb.z < 0)) return null;
  const t = la.z / (la.z - lb.z);
  const x = la.x + (lb.x - la.x) * t;
  const y = la.y + (lb.y - la.y) * t + yProbe;
  if (Math.abs(x) > p.width / 2) return null;
  if (y < -margin || y > p.height + margin) return null;
  return { t };
}

/** Ray vs. portal front face. Returns distance or null. */
export function rayPortal(p: PortalDef, origin: Vector3, dir: Vector3, maxDist: number): number | null {
  const n = portalNormal(p);
  const denom = n.x * dir.x + n.z * dir.z;
  if (denom >= -1e-6) return null; // must travel into the front face
  const d = signedDistance(p, origin);
  if (d < 0) return null;
  const t = -d / denom;
  if (t > maxDist) return null;
  const hit = origin.clone().addScaledVector(dir, t);
  const l = toPortalLocal(p, hit);
  if (Math.abs(l.x) > p.width / 2 || l.y < 0 || l.y > p.height) return null;
  return t;
}

/**
 * Eric Lengyel's oblique near-plane clipping. Replaces the near plane of `projection` with
 * `worldPlane` (keeping points on its positive side). Camera must be on the negative side.
 */
export function makeObliqueProjection(
  projection: Matrix4,
  viewMatrix: Matrix4,
  worldPlane: Plane,
  out = new Matrix4(),
): Matrix4 {
  out.copy(projection);
  const plane = worldPlane.clone().applyMatrix4(viewMatrix);
  const c = new Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  // Camera at the origin of view space must be behind the plane, otherwise skip.
  if (c.w >= -1e-4) return out;
  const e = out.elements;
  const q = new Vector4(
    (Math.sign(c.x) + e[8]) / e[0],
    (Math.sign(c.y) + e[9]) / e[5],
    -1.0,
    (1.0 + e[10]) / e[14],
  );
  c.multiplyScalar(2.0 / c.dot(q));
  e[2] = c.x;
  e[6] = c.y;
  e[10] = c.z + 1.0;
  e[14] = c.w;
  return out;
}
