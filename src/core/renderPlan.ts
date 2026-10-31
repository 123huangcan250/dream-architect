import { Matrix4, Plane, Vector3, Vector4 } from 'three';
import { makeObliqueProjection, portalCorners, portalNormal, signedDistance, toPortalLocal } from './portalMath';
import type { RtPortal, World } from './World';

/** Normalised screen rectangle (0..1, origin bottom-left). */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ViewChild {
  portal: RtPortal;
  /** Sub-view rendered through the portal, or null when the budget/depth ran out (fallback fill). */
  node: ViewNode | null;
  rect: Rect;
}

export interface ViewNode {
  depth: number;
  camWorld: Matrix4;
  view: Matrix4;
  /** Projection used for rendering (oblique-clipped for depth > 0). */
  projection: Matrix4;
  /** World-space clip plane (points with positive distance are kept). */
  clipPlane: Plane | null;
  rect: Rect;
  /** Portal we are looking out of; it must not be drawn in this view. */
  exitPortal: string | null;
  children: ViewChild[];
  /** Portals drawn as closed (unlinked) surfaces in this view. */
  closed: RtPortal[];
}

export interface PlanOptions {
  maxDepth: number;
  maxPasses: number;
  maxPerView: number;
  /** Portals farther than this are invisible (fully fogged). */
  maxDistance: number;
  /** Minimum normalised area for a portal to be recursed into. */
  minArea: number;
  near: number;
}

export const DEFAULT_PLAN: PlanOptions = {
  maxDepth: 7,
  maxPasses: 28,
  maxPerView: 4,
  maxDistance: 140,
  minArea: 0.00004,
  near: 0.05,
};

export interface Plan {
  root: ViewNode;
  passes: number;
  observed: Set<string>;
  maxDepthReached: number;
}

export function rectArea(r: Rect): number {
  return Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
}

export function intersectRect(a: Rect, b: Rect): Rect {
  return { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
}

/** Sutherland–Hodgman clip of a polygon against "dist(p) >= 0". */
export function clipPolygon(poly: Vector3[], dist: (p: Vector3) => number): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = dist(a);
    const db = dist(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) out.push(a.clone().lerp(b, da / (da - db)));
  }
  return out;
}

const camPos = new Vector3();

/** Screen rect of a portal seen by a view, or null if it is not visible. */
export function portalScreenRect(p: RtPortal, node: Pick<ViewNode, 'camWorld' | 'view' | 'projection' | 'clipPlane'>, near: number, baseProjection: Matrix4): Rect | null {
  camPos.setFromMatrixPosition(node.camWorld);
  let poly = portalCorners(p.def);
  if (node.clipPlane) {
    const pl = node.clipPlane;
    poly = clipPolygon(poly, (v) => pl.distanceToPoint(v) + 1e-4);
    if (poly.length < 3) return null;
  }
  const viewPts = poly.map((v) => v.clone().applyMatrix4(node.view));
  const clipped = clipPolygon(viewPts, (v) => -v.z - near);
  if (clipped.length < 3) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const v4 = new Vector4();
  for (const v of clipped) {
    v4.set(v.x, v.y, v.z, 1).applyMatrix4(baseProjection);
    const nx = (v4.x / v4.w) * 0.5 + 0.5;
    const ny = (v4.y / v4.w) * 0.5 + 0.5;
    x0 = Math.min(x0, nx); x1 = Math.max(x1, nx);
    y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
  }
  return { x0, y0, x1, y1 };
}

/** True when the camera is so close to the portal that its near plane may cut the surface. */
export function cameraHugsPortal(p: RtPortal, camWorldPos: Vector3, margin = 0.6): boolean {
  const l = toPortalLocal(p.def, camWorldPos);
  return l.z >= 0 && l.z < margin && Math.abs(l.x) < p.def.width / 2 + 0.25 && l.y > -0.3 && l.y < p.def.height + 0.3;
}

function distanceToPortal(p: RtPortal, pos: Vector3): number {
  const l = toPortalLocal(p.def, pos);
  const dx = Math.max(0, Math.abs(l.x) - p.def.width / 2);
  const dy = Math.max(0, -l.y, l.y - p.def.height);
  return Math.hypot(dx, dy, l.z);
}

/**
 * Builds the recursive portal view tree breadth-first, so a limited pass budget is spent on
 * the shallow, large portals first. Pure math: no WebGL involved (unit-testable).
 */
export function planViews(world: World, camWorld: Matrix4, projection: Matrix4, opts: PlanOptions = DEFAULT_PLAN): Plan {
  const root: ViewNode = {
    depth: 0,
    camWorld: camWorld.clone(),
    view: camWorld.clone().invert(),
    projection: projection.clone(),
    clipPlane: null,
    rect: { x0: 0, y0: 0, x1: 1, y1: 1 },
    exitPortal: null,
    children: [],
    closed: [],
  };
  const observed = new Set<string>();
  let passes = 1;
  let maxDepthReached = 0;
  const queue: ViewNode[] = [root];
  const pos = new Vector3();
  while (queue.length) {
    const node = queue.shift()!;
    pos.setFromMatrixPosition(node.camWorld);
    const candidates: { p: RtPortal; rect: Rect; area: number }[] = [];
    for (const p of world.portalList) {
      if (p.id === node.exitPortal) continue;
      if (signedDistance(p.def, pos) <= 1e-5) continue; // one-sided: only the front is visible
      if (distanceToPortal(p, pos) > opts.maxDistance) continue;
      let rect: Rect | null;
      if (node.depth === 0 && cameraHugsPortal(p, pos)) rect = { ...node.rect };
      else rect = portalScreenRect(p, node, opts.near, projection);
      if (!rect) continue;
      rect = intersectRect(rect, node.rect);
      const area = rectArea(rect);
      if (area <= 0) continue;
      observed.add(p.id);
      if (!p.def.link) {
        node.closed.push(p);
        continue;
      }
      candidates.push({ p, rect, area });
    }
    candidates.sort((a, b) => b.area - a.area);
    candidates.forEach((c, i) => {
      const canRecurse =
        node.depth + 1 <= opts.maxDepth && passes < opts.maxPasses && i < opts.maxPerView && c.area >= opts.minArea;
      if (!canRecurse) {
        node.children.push({ portal: c.p, node: null, rect: c.rect });
        return;
      }
      const m = world.transformOf(c.p)!;
      const dest = world.destOf(c.p)!;
      const childWorld = m.clone().multiply(node.camWorld);
      const view = childWorld.clone().invert();
      const plane = new Plane().setFromNormalAndCoplanarPoint(portalNormal(dest.def), new Vector3(...dest.def.pos));
      const child: ViewNode = {
        depth: node.depth + 1,
        camWorld: childWorld,
        view,
        projection: makeObliqueProjection(projection, view, plane),
        clipPlane: plane,
        rect: c.rect,
        exitPortal: dest.id,
        children: [],
        closed: [],
      };
      passes++;
      maxDepthReached = Math.max(maxDepthReached, child.depth);
      node.children.push({ portal: c.p, node: child, rect: c.rect });
      queue.push(child);
    });
  }
  return { root, passes, observed, maxDepthReached };
}
