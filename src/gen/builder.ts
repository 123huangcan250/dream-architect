import { DEFAULT_ENV, type BlockDef, type EnvDef, type FrameStyle, type LevelData, type MaterialKey, type PortalDef, type PropDef, type RuleDef, type Vec3T } from '../core/types';

export type Side = 'n' | 's' | 'e' | 'w';

export interface DoorSpec {
  id: string;
  side: Side;
  /** Lateral offset from the wall centre (+X for n/s walls, +Z for e/w walls). */
  offset?: number;
  width?: number;
  height?: number;
}

/** A doorway: bottom-centre on the wall's centre line; yaw makes the normal point INTO the room. */
export interface Anchor {
  pos: Vec3T;
  yaw: number;
  width: number;
  height: number;
}

export interface RoomSpec {
  center: Vec3T; // floor centre
  size: [number, number, number]; // interior w, h, d
  wall?: MaterialKey;
  floor?: MaterialKey | null;
  ceil?: MaterialKey | null;
  doors?: DoorSpec[];
  thickness?: number;
  /** Omit walls on these sides entirely. */
  open?: Side[];
}

export interface Room {
  min: Vec3T;
  max: Vec3T;
  anchors: Record<string, Anchor>;
}

export const SIDE_YAW: Record<Side, number> = { n: 0, s: Math.PI, e: -Math.PI / 2, w: Math.PI / 2 };

export function flipAnchor(a: Anchor): Anchor {
  return { ...a, yaw: a.yaw + Math.PI };
}

export class LevelBuilder {
  blocks: BlockDef[] = [];
  portals: PortalDef[] = [];
  props: PropDef[] = [];
  rules: RuleDef[] = [];
  private n = 0;

  constructor(public name: string, public spawn: { pos: Vec3T; yaw: number } = { pos: [0, 0, 0], yaw: 0 }, public env: EnvDef = { ...DEFAULT_ENV }) {}

  uid(prefix: string): string {
    return `${prefix}${++this.n}`;
  }

  box(min: Vec3T, max: Vec3T, mat: MaterialKey, opts: Partial<BlockDef> = {}): string {
    const id = opts.id ?? this.uid('b');
    const lo: Vec3T = [Math.min(min[0], max[0]), Math.min(min[1], max[1]), Math.min(min[2], max[2])];
    const hi: Vec3T = [Math.max(min[0], max[0]), Math.max(min[1], max[1]), Math.max(min[2], max[2])];
    this.blocks.push({ ...opts, id, min: lo, max: hi, mat });
    return id;
  }

  portal(a: Anchor, id: string, opts: { link?: string | null; frame?: FrameStyle; color?: string; flip?: boolean } = {}): string {
    this.portals.push({
      id,
      pos: [...a.pos],
      yaw: opts.flip ? a.yaw + Math.PI : a.yaw,
      width: a.width,
      height: a.height,
      link: opts.link ?? null,
      frame: opts.frame ?? 'none',
      color: opts.color,
    });
    return id;
  }

  /** Links two portals both ways. */
  pair(a: string, b: string): void {
    this.portals.find((p) => p.id === a)!.link = b;
    this.portals.find((p) => p.id === b)!.link = a;
  }

  link(a: string, b: string | null): void {
    this.portals.find((p) => p.id === a)!.link = b;
  }

  prop(p: PropDef): string {
    this.props.push(p);
    return p.id;
  }

  rule(r: Omit<RuleDef, 'id'> & { id?: string }): string {
    const id = r.id ?? this.uid('r');
    this.rules.push({ ...r, id });
    return id;
  }

  sign(pos: Vec3T, yaw: number, text: string, size = 1): string {
    return this.prop({ id: this.uid('sign'), type: 'sign', pos, yaw, text, size });
  }

  light(pos: Vec3T, color: string, radius = 1): string {
    return this.prop({ id: this.uid('light'), type: 'light', pos, color, radius });
  }

  /** A closed box room with doorways. Returns door anchors keyed by door id. */
  room(spec: RoomSpec): Room {
    const [cx, cy, cz] = spec.center;
    const [w, h, d] = spec.size;
    const t = spec.thickness ?? 0.4;
    const wall = spec.wall ?? 'plaster';
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    if (spec.floor !== null) this.box([x0 - t / 2, cy - 0.5, z0 - t / 2], [x1 + t / 2, cy, z1 + t / 2], spec.floor ?? 'tile');
    if (spec.ceil !== null) this.box([x0 - t / 2, cy + h, z0 - t / 2], [x1 + t / 2, cy + h + t, z1 + t / 2], spec.ceil ?? wall);
    const anchors: Record<string, Anchor> = {};
    const doors = spec.doors ?? [];
    const sides: Side[] = ['n', 's', 'e', 'w'];
    for (const side of sides) {
      if (spec.open?.includes(side)) continue;
      const alongX = side === 'n' || side === 's';
      const line = side === 'n' ? z0 : side === 's' ? z1 : side === 'e' ? x1 : x0;
      const len = alongX ? w : d;
      const c = alongX ? cx : cz;
      const openings = doors
        .filter((dd) => dd.side === side)
        .map((dd) => {
          const dw = dd.width ?? 2;
          const dh = Math.min(dd.height ?? 2.8, h);
          const off = dd.offset ?? 0;
          const pos: Vec3T = alongX ? [c + off, cy, line] : [line, cy, c + off];
          anchors[dd.id] = { pos, yaw: SIDE_YAW[side], width: dw, height: dh };
          return { a: c + off - dw / 2, b: c + off + dw / 2, h: dh };
        })
        .sort((p, q) => p.a - q.a);
      // Wall pieces between openings (extended by t/2 to close the corners).
      let cursor = c - len / 2 - t / 2;
      const end = c + len / 2 + t / 2;
      const seg = (a: number, b: number, ya: number, yb: number) => {
        if (b - a < 1e-3 || yb - ya < 1e-3) return;
        if (alongX) this.box([a, ya, line - t / 2], [b, yb, line + t / 2], wall);
        else this.box([line - t / 2, ya, a], [line + t / 2, yb, b], wall);
      };
      for (const o of openings) {
        seg(cursor, o.a, cy, cy + h);
        seg(o.a, o.b, cy + o.h, cy + h);
        cursor = o.b;
      }
      seg(cursor, end, cy, cy + h);
    }
    return { min: [x0, cy, z0], max: [x1, cy + h, z1], anchors };
  }

  /** Axis-aligned box given in a yawed frame (lateral/normal half extents). Exact for 90° yaws. */
  orientedBox(center: Vec3T, yaw: number, halfLateral: number, halfNormal: number, y0: number, y1: number, mat: MaterialKey, opts: Partial<BlockDef> = {}): string {
    const nx = Math.abs(Math.sin(yaw)), nz = Math.abs(Math.cos(yaw));
    const hx = nz * halfLateral + nx * halfNormal;
    const hz = nx * halfLateral + nz * halfNormal;
    return this.box([center[0] - hx, y0, center[2] - hz], [center[0] + hx, y1, center[2] + hz], mat, opts);
  }

  /** Free-standing frame (two posts, lintel, optional back panel) around a portal footprint. */
  standingFrame(a: Anchor, mat: MaterialKey, back = true): void {
    const r = [Math.cos(a.yaw), -Math.sin(a.yaw)];
    const n = [Math.sin(a.yaw), Math.cos(a.yaw)];
    const [px, py, pz] = a.pos;
    const off = a.width / 2 + 0.2;
    for (const s of [-1, 1]) {
      this.orientedBox([px + r[0] * off * s, 0, pz + r[1] * off * s], a.yaw, 0.2, 0.25, py, py + a.height + 0.4, mat);
    }
    this.orientedBox([px, 0, pz], a.yaw, a.width / 2, 0.25, py + a.height, py + a.height + 0.4, mat);
    if (back) this.orientedBox([px - n[0] * 0.32, 0, pz - n[1] * 0.32], a.yaw, a.width / 2, 0.08, py, py + a.height, mat);
  }

  build(meta: Record<string, unknown> = {}): LevelData {
    return {
      version: 1,
      name: this.name,
      spawn: this.spawn,
      env: this.env,
      blocks: this.blocks,
      portals: this.portals,
      props: this.props,
      rules: this.rules,
      meta,
    };
  }
}
