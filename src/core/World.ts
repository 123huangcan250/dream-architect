import { Box3, Matrix4, Vector3 } from 'three';
import { SpatialHash } from './SpatialHash';
import {
  portalFrame,
  portalNormal,
  portalRight,
  portalTransform,
  rayPortal,
  segmentCrossesPortal,
  toPortalLocal,
} from './portalMath';
import type { BlockDef, LevelData, PortalDef } from './types';

export interface Solid {
  id: string;
  min: Vector3;
  max: Vector3;
  kind: 'box' | 'ramp';
  ramp?: 'x+' | 'x-' | 'z+' | 'z-';
  enabled: boolean;
  owner: 'block' | 'cube' | 'barrier' | 'virtual';
}

export class RtPortal {
  readonly frame: Matrix4;
  readonly normal: Vector3;
  readonly right: Vector3;
  readonly center: Vector3;
  barrier: Solid;
  constructor(public def: PortalDef) {
    this.frame = portalFrame(def);
    this.normal = portalNormal(def);
    this.right = portalRight(def);
    this.center = new Vector3(def.pos[0], def.pos[1] + def.height / 2, def.pos[2]);
    // Thin collision slab used while the portal has no destination.
    const hw = def.width / 2;
    const ax = Math.abs(this.right.x) * hw + Math.abs(this.normal.x) * 0.05;
    const az = Math.abs(this.right.z) * hw + Math.abs(this.normal.z) * 0.05;
    this.barrier = {
      id: `barrier:${def.id}`,
      min: new Vector3(def.pos[0] - ax, def.pos[1], def.pos[2] - az),
      max: new Vector3(def.pos[0] + ax, def.pos[1] + def.height, def.pos[2] + az),
      kind: 'box',
      enabled: def.link == null,
      owner: 'barrier',
    };
  }
  get id(): string {
    return this.def.id;
  }
}

export interface RaySegment {
  origin: Vector3;
  dir: Vector3;
  length: number;
  /** Transform from the ray's original space into this segment's space. */
  toSpace: Matrix4;
  /** Portal entered at the end of this segment (if any). */
  portal?: RtPortal;
}

export interface RayHit {
  distance: number;
  point: Vector3;
  normal: Vector3;
  solid: Solid | null;
  segments: RaySegment[];
}

export interface BodyQuery {
  pos: Vector3; // feet
  radius: number;
  yMin: number;
  yMax: number;
}

const tmpV = new Vector3();
const tmpV2 = new Vector3();

/** Runtime world: collision geometry, portal graph and dynamic state. Rendering-agnostic. */
export class World {
  readonly portals = new Map<string, RtPortal>();
  readonly portalList: RtPortal[] = [];
  readonly blocks = new Map<string, BlockDef>();
  readonly solids = new SpatialHash<Solid>(8);
  readonly solidById = new Map<string, Solid>();
  readonly dynamicSolids: Solid[] = [];
  readonly blockVisible = new Map<string, boolean>();
  /** Lowest point of the level, used for fall-out detection. */
  floorY = 0;
  private transformCache = new Map<string, Matrix4>();
  onLinkChanged: ((p: RtPortal) => void)[] = [];
  onBlockChanged: ((id: string) => void)[] = [];

  constructor(public level: LevelData) {
    let minY = Infinity;
    for (const b of level.blocks) {
      this.blocks.set(b.id, b);
      const s: Solid = {
        id: b.id,
        min: new Vector3(...b.min),
        max: new Vector3(...b.max),
        kind: b.kind ?? 'box',
        ramp: b.ramp,
        enabled: b.solid !== false,
        owner: 'block',
      };
      this.solids.insert(s);
      this.solidById.set(b.id, s);
      this.blockVisible.set(b.id, b.visible !== false);
      minY = Math.min(minY, b.min[1]);
    }
    for (const pd of level.portals) {
      const p = new RtPortal({ ...pd });
      this.portals.set(pd.id, p);
      this.portalList.push(p);
      this.solids.insert(p.barrier);
    }
    this.floorY = Number.isFinite(minY) ? minY : 0;
  }

  // ---------- portal graph ----------

  setLink(portalId: string, target: string | null): void {
    const p = this.portals.get(portalId);
    if (!p) return;
    if (target != null && !this.portals.has(target)) target = null;
    if (p.def.link === target) return;
    p.def.link = target;
    p.barrier.enabled = target == null;
    this.transformCache.delete(portalId);
    for (const cb of this.onLinkChanged) cb(p);
  }

  /** Matrix that maps the space in front of `p` into the space behind its destination. */
  transformOf(p: RtPortal): Matrix4 | null {
    const link = p.def.link;
    if (!link) return null;
    const dest = this.portals.get(link);
    if (!dest) return null;
    let m = this.transformCache.get(p.id);
    if (!m) {
      m = portalTransform(p.def, dest.def);
      this.transformCache.set(p.id, m);
    }
    return m;
  }

  destOf(p: RtPortal): RtPortal | null {
    return p.def.link ? this.portals.get(p.def.link) ?? null : null;
  }

  /** First linked portal crossed front-to-back by the horizontal motion a->b (probe height relative to a/b). */
  findCrossing(a: Vector3, b: Vector3, probe: number): { portal: RtPortal; t: number } | null {
    let best: { portal: RtPortal; t: number } | null = null;
    for (const p of this.portalList) {
      if (!p.def.link) continue;
      const c = segmentCrossesPortal(p.def, a, b, probe, 0.25);
      if (c && (!best || c.t < best.t)) best = { portal: p, t: c.t };
    }
    return best;
  }

  // ---------- blocks ----------

  setBlock(id: string, on: boolean): void {
    const s = this.solidById.get(id);
    if (!s) return;
    const changed = s.enabled !== on || this.blockVisible.get(id) !== on;
    s.enabled = on;
    this.blockVisible.set(id, on);
    if (changed) for (const cb of this.onBlockChanged) cb(id);
  }

  addDynamic(s: Solid): void {
    this.dynamicSolids.push(s);
  }

  removeDynamic(s: Solid): void {
    const i = this.dynamicSolids.indexOf(s);
    if (i >= 0) this.dynamicSolids.splice(i, 1);
  }

  /** All enabled solids whose AABB overlaps the box. */
  querySolids(min: Vector3, max: Vector3, out: Solid[] = [], ignore?: Solid): Solid[] {
    const start = out.length;
    this.solids.query(min.x, min.z, max.x, max.z, out);
    let w = start;
    for (let i = start; i < out.length; i++) {
      const s = out[i];
      if (!s.enabled || s === ignore) continue;
      if (s.max.y < min.y || s.min.y > max.y) continue;
      out[w++] = s;
    }
    out.length = w;
    for (const s of this.dynamicSolids) {
      if (!s.enabled || s === ignore) continue;
      if (s.max.x < min.x || s.min.x > max.x || s.max.z < min.z || s.min.z > max.z) continue;
      if (s.max.y < min.y || s.min.y > max.y) continue;
      out.push(s);
    }
    return out;
  }

  /** Top-surface height of a solid at (x, z), or -Infinity. */
  static surfaceAt(s: Solid, x: number, z: number): number {
    if (x < s.min.x || x > s.max.x || z < s.min.z || z > s.max.z) return -Infinity;
    if (s.kind !== 'ramp') return s.max.y;
    let t = 0;
    switch (s.ramp) {
      case 'x+': t = (x - s.min.x) / (s.max.x - s.min.x); break;
      case 'x-': t = (s.max.x - x) / (s.max.x - s.min.x); break;
      case 'z+': t = (z - s.min.z) / (s.max.z - s.min.z); break;
      case 'z-': t = (s.max.z - z) / (s.max.z - s.min.z); break;
    }
    return s.min.y + (s.max.y - s.min.y) * t;
  }

  /** Highest walkable surface at (x, z) not above maxY. Ignores portals. */
  groundAt(x: number, z: number, maxY: number, ignore?: Solid): number {
    const list = this.querySolids(tmpV.set(x - 0.01, -1e9, z - 0.01), tmpV2.set(x + 0.01, maxY, z + 0.01), [], ignore);
    let best = -Infinity;
    for (const s of list) {
      const h = World.surfaceAt(s, x, z);
      if (h <= maxY + 1e-4 && h > best) best = h;
    }
    return best;
  }

  /**
   * Portal-aware ground height. A sample point that lies behind a portal the body is
   * straddling is evaluated in the destination space and mapped back.
   */
  groundAtThroughPortals(x: number, z: number, maxY: number, body: BodyQuery, ignore?: Solid): number {
    const pt = tmpV.set(x, maxY, z);
    for (const p of this.straddled(body)) {
      const l = toPortalLocal(p.def, pt);
      if (l.z < 0 && Math.abs(l.x) <= p.def.width / 2) {
        const m = this.transformOf(p)!;
        const q = pt.clone().applyMatrix4(m);
        const h = this.groundAt(q.x, q.z, q.y, ignore);
        if (h === -Infinity) return h;
        const inv = m.clone().invert();
        return new Vector3(q.x, h, q.z).applyMatrix4(inv).y;
      }
    }
    return this.groundAt(x, z, maxY, ignore);
  }

  /** Linked portals whose doorway the body (circle in XZ) currently overlaps from the front. */
  straddled(body: BodyQuery): RtPortal[] {
    const out: RtPortal[] = [];
    for (const p of this.portalList) {
      if (!p.def.link) continue;
      const l = toPortalLocal(p.def, body.pos, tmpV2);
      if (l.z < -0.01 || l.z > body.radius + 0.05) continue;
      if (Math.abs(l.x) > p.def.width / 2 + body.radius) continue;
      const bottom = p.def.pos[1];
      if (body.yMax < bottom || body.yMin > bottom + p.def.height) continue;
      out.push(p);
    }
    return out;
  }

  /**
   * Solids relevant to a body, with portal awareness: geometry hidden behind a straddled portal
   * is dropped, and the destination side's geometry is mapped back into this space.
   */
  bodySolids(body: BodyQuery, out: Solid[] = []): Solid[] {
    const r = body.radius + 0.1;
    const min = new Vector3(body.pos.x - r, body.yMin, body.pos.z - r);
    const max = new Vector3(body.pos.x + r, body.yMax, body.pos.z + r);
    this.querySolids(min, max, out);
    const portals = this.straddled(body);
    if (portals.length === 0) return out;

    for (const p of portals) {
      const hw = p.def.width / 2 - 0.02;
      const bottom = p.def.pos[1];
      const top = bottom + p.def.height;
      // 1. Drop local solids that sit entirely behind the portal, inside its doorway tunnel.
      for (let i = out.length - 1; i >= 0; i--) {
        const s = out[i];
        if (s.owner === 'virtual') continue;
        if (s.max.y <= bottom + 0.01 || s.min.y >= top) continue;
        const ext = localExtents(p, s);
        if (ext.zMax <= 0.001 && ext.xMax > -hw && ext.xMin < hw) out.splice(i, 1);
      }
      // 2. Bring in destination solids that sit in front of the destination portal.
      const m = this.transformOf(p)!;
      const dest = this.destOf(p)!;
      const inv = m.clone().invert();
      const dmin = min.clone().applyMatrix4(m);
      const dmax = max.clone().applyMatrix4(m);
      const box = new Box3().setFromPoints([dmin, dmax]);
      const remote = this.querySolids(box.min, box.max, []);
      const dhw = dest.def.width / 2 - 0.02;
      for (const s of remote) {
        if (s.owner === 'barrier') continue;
        const ext = localExtents(dest, s);
        if (ext.zMin < -0.001 || ext.xMax <= -dhw || ext.xMin >= dhw) continue;
        const tb = new Box3(s.min.clone(), s.max.clone()).applyMatrix4(inv);
        out.push({ id: `virtual:${s.id}`, min: tb.min, max: tb.max, kind: s.kind, ramp: s.ramp ? rotateRamp(s.ramp, inv) : undefined, enabled: true, owner: 'virtual' });
      }
    }
    return out;
  }

  // ---------- raycasting ----------

  /** Raycast that follows linked portals. */
  raycast(origin: Vector3, dir: Vector3, maxDist: number, maxPortals = 6, ignore?: Solid): RayHit {
    let o = origin.clone();
    let d = dir.clone().normalize();
    let remaining = maxDist;
    let travelled = 0;
    const toSpace = new Matrix4();
    const segments: RaySegment[] = [];
    for (let hop = 0; hop <= maxPortals; hop++) {
      const end = o.clone().addScaledVector(d, remaining);
      const bmin = o.clone().min(end).subScalar(0.01);
      const bmax = o.clone().max(end).addScalar(0.01);
      const cands = this.querySolids(bmin, bmax, [], ignore);
      let bestT = remaining;
      let bestSolid: Solid | null = null;
      const bestN = new Vector3();
      for (const s of cands) {
        const hit = raySlab(o, d, s.min, s.max, bestT);
        if (hit) {
          bestT = hit.t;
          bestSolid = s;
          bestN.copy(hit.n);
        }
      }
      let bestPortal: RtPortal | null = null;
      for (const p of this.portalList) {
        if (!p.def.link) continue;
        const t = rayPortal(p.def, o, d, bestT);
        if (t != null && t < bestT + 1e-6) {
          bestT = t;
          bestPortal = p;
        }
      }
      if (bestPortal && hop < maxPortals) {
        segments.push({ origin: o.clone(), dir: d.clone(), length: bestT, toSpace: toSpace.clone(), portal: bestPortal });
        const m = this.transformOf(bestPortal)!;
        o = o.addScaledVector(d, bestT).applyMatrix4(m);
        d = d.transformDirection(m);
        o.addScaledVector(d, 1e-4);
        toSpace.premultiply(m);
        remaining -= bestT;
        travelled += bestT;
        continue;
      }
      segments.push({ origin: o.clone(), dir: d.clone(), length: bestT, toSpace: toSpace.clone() });
      return {
        distance: travelled + bestT,
        point: o.clone().addScaledVector(d, bestT),
        normal: bestN,
        solid: bestSolid,
        segments,
      };
    }
    const last = segments[segments.length - 1];
    return { distance: maxDist, point: last.origin.clone().addScaledVector(last.dir, last.length), normal: new Vector3(), solid: null, segments };
  }
}

function localExtents(p: RtPortal, s: Solid) {
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  const c = new Vector3();
  for (let i = 0; i < 4; i++) {
    c.set(i & 1 ? s.max.x : s.min.x, 0, i & 2 ? s.max.z : s.min.z);
    const l = toPortalLocal(p.def, c);
    xMin = Math.min(xMin, l.x); xMax = Math.max(xMax, l.x);
    zMin = Math.min(zMin, l.z); zMax = Math.max(zMax, l.z);
  }
  return { xMin, xMax, zMin, zMax };
}

function rotateRamp(r: 'x+' | 'x-' | 'z+' | 'z-', m: Matrix4): 'x+' | 'x-' | 'z+' | 'z-' {
  const v = new Vector3(r[0] === 'x' ? 1 : 0, 0, r[0] === 'z' ? 1 : 0).multiplyScalar(r[1] === '+' ? 1 : -1);
  v.transformDirection(m);
  if (Math.abs(v.x) > Math.abs(v.z)) return v.x > 0 ? 'x+' : 'x-';
  return v.z > 0 ? 'z+' : 'z-';
}

/** Slab ray/AABB test. Returns entry distance and face normal. Rays starting inside are ignored. */
export function raySlab(o: Vector3, d: Vector3, min: Vector3, max: Vector3, maxT: number): { t: number; n: Vector3 } | null {
  let tmin = 0;
  let tmax = maxT;
  let axis = -1;
  let sign = 0;
  for (let a = 0; a < 3; a++) {
    const oa = a === 0 ? o.x : a === 1 ? o.y : o.z;
    const da = a === 0 ? d.x : a === 1 ? d.y : d.z;
    const mn = a === 0 ? min.x : a === 1 ? min.y : min.z;
    const mx = a === 0 ? max.x : a === 1 ? max.y : max.z;
    if (Math.abs(da) < 1e-9) {
      if (oa < mn || oa > mx) return null;
      continue;
    }
    let t1 = (mn - oa) / da;
    let t2 = (mx - oa) / da;
    let s = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = a;
      sign = s;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (axis < 0) return null;
  const n = new Vector3();
  n.setComponent(axis, sign);
  return { t: tmin, n };
}
