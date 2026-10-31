import { CanvasTexture, Group, Mesh, OctahedronGeometry, PlaneGeometry, SRGBColorSpace, Vector3, type Object3D, type ShaderMaterial } from 'three';
import { evaluateAlignment, forcedPerspective, scatterFragments, type AlignmentResult, type Fragment } from '../core/perspective';
import { World, type RaySegment, type Solid } from '../core/World';
import type { PropDef } from '../core/types';
import { buildBoxGeometry } from '../render/WorldView';
import { createCrystalMaterial, createGlowMaterial, createSignMaterial, createWorldMaterial } from '../render/shaders';
import type { LightSource } from '../render/PortalRenderer';

function billboard(m: Object3D): void {
  m.onBeforeRender = (_r, _s, cam) => {
    m.quaternion.copy(cam.quaternion);
    m.updateMatrixWorld();
  };
}

export function glowSprite(color: string, size: number, intensity = 1): Mesh {
  const m = new Mesh(new PlaneGeometry(size, size), createGlowMaterial(color, intensity));
  m.renderOrder = 10;
  billboard(m);
  return m;
}

function signTexture(text: string): { tex: CanvasTexture; aspect: number } {
  const lines = text.split('\n');
  const fontPx = 64;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = `600 ${fontPx}px "Noto Serif SC", "Source Han Serif SC", "Microsoft YaHei", serif`;
  ctx.font = font;
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + fontPx * 1.4);
  const h = Math.ceil(lines.length * fontPx * 1.35 + fontPx * 0.9);
  c.width = w;
  c.height = h;
  ctx.font = font;
  const r = fontPx * 0.35;
  ctx.fillStyle = 'rgba(28, 20, 52, 0.78)';
  ctx.beginPath();
  ctx.roundRect(4, 4, w - 8, h - 8, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 215, 150, 0.85)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#fff3e0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, w / 2, fontPx * 0.45 + (i + 0.5) * fontPx * 1.35 + 4));
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: w / h };
}

export interface PropEvents {
  collect(id: string): void;
  lever(id: string, state: boolean): void;
  solved(id: string): void;
  goal(id: string): void;
  sound(name: 'pickup' | 'lever' | 'grab' | 'drop' | 'solve' | 'align'): void;
}

interface CubeState {
  def: Extract<PropDef, { type: 'cube' }>;
  mesh: Mesh;
  pos: Vector3;
  size: number;
  velY: number;
  solid: Solid;
}

interface AnamState {
  def: Extract<PropDef, { type: 'anamorph' }>;
  frags: Fragment[];
  meshes: Mesh[];
  sparkles: Mesh[];
  state: 'scattered' | 'morph' | 'done';
  t: number;
  hold: number;
  last: AlignmentResult | null;
}

export interface Interactable {
  id: string;
  kind: 'lever' | 'cube';
  center: Vector3;
  radius: number;
}

/** Visuals and behaviour of all level props. */
export class Props {
  readonly root = new Group();
  readonly collected = new Set<string>();
  readonly leverState = new Map<string, boolean>();
  readonly lights: LightSource[] = [];
  /** Objects the renderer may distance-cull per pass (permanently hidden ones are removed). */
  readonly cull = new Map<Object3D, { pos: Vector3; r: number }>();
  private shards = new Map<string, { mesh: Group; base: Vector3 }>();
  private levers = new Map<string, { handle: Group; pos: Vector3; angle: number }>();
  readonly cubes = new Map<string, CubeState>();
  readonly anamorphs: AnamState[] = [];
  private goals: Extract<PropDef, { type: 'goal' }>[] = [];
  private goalMeshes: Object3D[] = [];
  held: CubeState | null = null;
  private heldAngular = 0;
  heldInfo = { size: 0, distance: 0 };
  private time = 0;

  constructor(private world: World, private events: PropEvents, defs: PropDef[], private signsEnabled = true) {
    for (const d of defs) this.add(d);
  }

  private add(d: PropDef): void {
    switch (d.type) {
      case 'shard': {
        const g = new Group();
        const crystal = new Mesh(new OctahedronGeometry(0.32, 0), createCrystalMaterial(d.color ?? '#ffd27a'));
        crystal.scale.set(0.8, 1.3, 0.8);
        g.add(crystal, glowSprite(d.color ?? '#ffd27a', 2.2, 0.9));
        g.position.set(...d.pos);
        this.root.add(g);
        this.cull.set(g, { pos: g.position, r: 1.5 });
        this.shards.set(d.id, { mesh: g, base: new Vector3(...d.pos) });
        this.lights.push({ pos: new Vector3(...d.pos), color: hexToVec(d.color ?? '#ffd27a', 1.2) });
        break;
      }
      case 'lever': {
        const g = new Group();
        const base = new Mesh(buildBoxGeometry([{ min: [-0.35, 0, -0.25], max: [0.35, 0.9, 0.25] }]), createWorldMaterial('marble'));
        const plate = new Mesh(buildBoxGeometry([{ min: [-0.25, 0.9, -0.18], max: [0.25, 0.95, 0.18] }]), createWorldMaterial('gold'));
        const handle = new Group();
        const stick = new Mesh(buildBoxGeometry([{ min: [-0.04, 0, -0.04], max: [0.04, 0.55, 0.04] }]), createWorldMaterial('gold'));
        const knob = new Mesh(new OctahedronGeometry(0.09, 1), createCrystalMaterial('#ff9bd2'));
        knob.position.y = 0.58;
        handle.add(stick, knob);
        handle.position.y = 0.93;
        g.add(base, plate, handle);
        g.position.set(...d.pos);
        g.rotation.y = d.yaw;
        this.root.add(g);
        this.cull.set(g, { pos: g.position, r: 1.2 });
        const state = d.state ?? false;
        this.leverState.set(d.id, state);
        this.levers.set(d.id, { handle, pos: new Vector3(d.pos[0], d.pos[1] + 1.1, d.pos[2]), angle: state ? -0.6 : 0.6 });
        break;
      }
      case 'cube': {
        const mesh = new Mesh(buildBoxGeometry([{ min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }]), createWorldMaterial('grid'));
        const pos = new Vector3(...d.pos);
        const solid: Solid = { id: `cube:${d.id}`, min: new Vector3(), max: new Vector3(), kind: 'box', enabled: true, owner: 'cube' };
        const st: CubeState = { def: d, mesh, pos, size: d.size, velY: 0, solid };
        this.updateCube(st);
        this.world.addDynamic(solid);
        this.root.add(mesh);
        this.cull.set(mesh, { pos: mesh.position, r: 6 });
        this.cubes.set(d.id, st);
        break;
      }
      case 'sign': {
        if (!this.signsEnabled) break;
        const { tex, aspect } = signTexture(d.text);
        const lines = d.text.split('\n').length;
        const h = (lines * 0.27 + 0.2) * (d.size ?? 1);
        const m = new Mesh(new PlaneGeometry(h * aspect, h), createSignMaterial(tex));
        m.position.set(...d.pos);
        m.rotation.y = d.yaw;
        m.renderOrder = 5;
        this.root.add(m);
        this.cull.set(m, { pos: m.position, r: 3 });
        break;
      }
      case 'light': {
        const s = glowSprite(d.color, 1.6 * (d.radius ?? 1), 0.8);
        s.position.set(...d.pos);
        this.root.add(s);
        this.cull.set(s, { pos: s.position, r: 2 });
        this.lights.push({ pos: new Vector3(...d.pos), color: hexToVec(d.color, d.radius ?? 1) });
        break;
      }
      case 'anamorph': {
        const targets = d.blocks.map((id) => this.world.blocks.get(id)!).filter(Boolean);
        const frags = scatterFragments(new Vector3(...d.viewpoint), targets.map((b) => ({ min: new Vector3(...b.min), max: new Vector3(...b.max) })), d.seed, 1.0);
        const st: AnamState = { def: d, frags, meshes: [], sparkles: [], state: 'scattered', t: 0, hold: 0, last: null };
        let fi = 0;
        for (const b of targets) {
          const sz = new Vector3(...b.max).sub(new Vector3(...b.min));
          const n = Math.max(1, Math.round((sz.x >= sz.z ? sz.x : sz.z) / 1.0));
          for (let i = 0; i < n; i++, fi++) {
            const m = new Mesh(buildBoxGeometry([{ min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }]), createWorldMaterial(b.mat));
            this.root.add(m);
            this.cull.set(m, { pos: m.position, r: 3 });
            st.meshes.push(m);
            const sp = glowSprite('#ffe9b0', 0.6, 0.5);
            this.root.add(sp);
            this.cull.set(sp, { pos: sp.position, r: 3 });
            st.sparkles.push(sp);
          }
        }
        void fi;
        this.applyFragments(st, 0);
        this.anamorphs.push(st);
        break;
      }
      case 'goal': {
        this.goals.push(d);
        const g = new Group();
        const orb = new Mesh(new OctahedronGeometry(0.7, 2), createCrystalMaterial('#fff1c4'));
        g.add(orb, glowSprite('#ffd27a', 7, 1.2));
        g.position.set(...d.pos);
        this.root.add(g);
        this.cull.set(g, { pos: g.position, r: 5 });
        this.goalMeshes.push(g);
        break;
      }
    }
  }

  private applyFragments(st: AnamState, t: number): void {
    const e = t * t * (3 - 2 * t);
    st.frags.forEach((f, i) => {
      const m = st.meshes[i];
      m.position.lerpVectors(f.scattered.center, f.home.center, e);
      m.scale.lerpVectors(f.scattered.size, f.home.size, e);
      m.rotation.set(0, 0, 0);
      st.sparkles[i].position.copy(m.position);
    });
  }

  private updateCube(c: CubeState): void {
    const h = c.size / 2;
    c.mesh.position.copy(c.pos);
    c.mesh.scale.setScalar(c.size);
    c.solid.min.set(c.pos.x - h, c.pos.y - h, c.pos.z - h);
    c.solid.max.set(c.pos.x + h, c.pos.y + h, c.pos.z + h);
  }

  /** Nearest interactable along a (portal-following) view ray. */
  pick(segments: RaySegment[], reach: number): Interactable | null {
    let acc = 0;
    for (const seg of segments) {
      const limit = Math.min(seg.length, reach - acc);
      if (limit <= 0) break;
      let best: Interactable | null = null;
      let bestT = limit;
      const test = (it: Interactable) => {
        const t = raySphere(seg.origin, seg.dir, it.center, it.radius);
        if (t != null && t < bestT) {
          bestT = t;
          best = it;
        }
      };
      for (const [id, l] of this.levers) test({ id, kind: 'lever', center: l.pos, radius: 0.55 });
      for (const [id, c] of this.cubes) if (c !== this.held) test({ id, kind: 'cube', center: c.pos, radius: Math.max(0.3, c.size * 0.75) });
      if (best) return best;
      acc += seg.length;
    }
    return null;
  }

  toggleLever(id: string): void {
    const s = !this.leverState.get(id);
    this.leverState.set(id, s);
    this.events.sound('lever');
    this.events.lever(id, s);
  }

  grab(id: string, eye: Vector3, standingOn: Solid | null): boolean {
    const c = this.cubes.get(id);
    if (!c || c.solid === standingOn) return false;
    this.held = c;
    c.solid.enabled = false;
    this.heldAngular = c.size / Math.max(0.5, c.pos.distanceTo(eye));
    this.events.sound('grab');
    return true;
  }

  release(): void {
    if (!this.held) return;
    this.held.solid.enabled = true;
    this.held.velY = 0;
    this.held = null;
    this.events.sound('drop');
  }

  /** Forced perspective placement of the held cube along the view ray (through portals). */
  updateHeld(eye: Vector3, dir: Vector3): void {
    const c = this.held;
    if (!c) return;
    const hit = this.world.raycast(eye, dir, 80, 4, c.solid);
    const { distance, size } = forcedPerspective(this.heldAngular, hit.distance);
    c.size = size;
    let acc = 0;
    for (const seg of hit.segments) {
      if (distance <= acc + seg.length || seg === hit.segments[hit.segments.length - 1]) {
        c.pos.copy(seg.origin).addScaledVector(seg.dir, Math.min(distance - acc, seg.length));
        break;
      }
      acc += seg.length;
    }
    // Never show the held cube sunk into the floor it is hovering over.
    const ground = this.cubeGround(c);
    if (c.pos.y - size / 2 < ground) c.pos.y = ground + size / 2;
    this.heldInfo = { size, distance };
    this.updateCube(c);
  }

  /** Highest surface under the cube footprint that lies below its centre. */
  private cubeGround(c: CubeState): number {
    const k = (c.size / 2) * 0.8;
    let ground = -Infinity;
    for (const [ox, oz] of [[0, 0], [k, k], [-k, k], [k, -k], [-k, -k]]) {
      ground = Math.max(ground, this.world.groundAt(c.pos.x + ox, c.pos.z + oz, c.pos.y, c.solid));
    }
    return ground;
  }

  update(dt: number, eye: Vector3, viewDir: Vector3, playerFeet: Vector3): { align: AlignmentResult | null } {
    this.time += dt;
    let align: AlignmentResult | null = null;
    for (const [id, s] of this.shards) {
      if (this.collected.has(id)) continue;
      s.mesh.position.set(s.base.x, s.base.y + Math.sin(this.time * 2 + s.base.x) * 0.12, s.base.z);
      s.mesh.children[0].rotation.y = this.time * 1.4;
      if (s.mesh.position.distanceTo(eye) < 1.4 || s.mesh.position.distanceTo(playerFeet.clone().setY(playerFeet.y + 0.9)) < 1.2) {
        this.collected.add(id);
        s.mesh.visible = false;
        this.cull.delete(s.mesh);
        const li = this.lights.findIndex((l) => l.pos.distanceTo(s.base) < 0.01);
        if (li >= 0) this.lights.splice(li, 1);
        this.events.sound('pickup');
        this.events.collect(id);
      }
    }
    for (const [id, l] of this.levers) {
      const target = this.leverState.get(id) ? -0.6 : 0.6;
      l.angle += (target - l.angle) * Math.min(1, dt * 12);
      l.handle.rotation.x = l.angle;
    }
    for (const c of this.cubes.values()) {
      if (c === this.held) continue;
      // Gravity until the cube rests on something; a cube sunk into a surface pops up onto it.
      const h = c.size / 2;
      const ground = this.cubeGround(c);
      if (c.pos.y - h < ground - 1e-3) {
        c.pos.y = ground + h;
        c.velY = 0;
        this.updateCube(c);
      } else if (c.pos.y - h > ground + 1e-3) {
        c.velY -= 18 * dt;
        c.pos.y = Math.max(ground + h, c.pos.y + c.velY * dt);
        if (c.pos.y - h <= ground + 1e-3) c.velY = 0;
        if (c.pos.y < this.world.floorY - 40) {
          c.pos.set(...c.def.pos);
          c.size = c.def.size;
          c.velY = 0;
        }
        this.updateCube(c);
      }
    }
    for (const st of this.anamorphs) {
      if (st.state === 'scattered') {
        const vp = new Vector3(...st.def.viewpoint);
        const near = eye.distanceTo(vp) < 10;
        const r = evaluateAlignment(eye, viewDir, st.frags, 2.0);
        st.last = r;
        if (near) align = r;
        st.hold = r.aligned ? st.hold + dt : 0;
        st.sparkles.forEach((s, i) => ((s.material as ShaderMaterial).uniforms.uIntensity.value = 0.25 + 0.6 * r.score * (0.6 + 0.4 * Math.sin(this.time * 5 + i))));
        if (st.hold > 0.35) {
          st.state = 'morph';
          st.t = 0;
          this.events.sound('align');
        }
      } else if (st.state === 'morph') {
        st.t = Math.min(1, st.t + dt / 1.4);
        this.applyFragments(st, st.t);
        if (st.t >= 1) {
          st.state = 'done';
          for (const m of [...st.meshes, ...st.sparkles]) {
            m.visible = false;
            this.cull.delete(m);
          }
          this.events.sound('solve');
          this.events.solved(st.def.id);
        }
      }
    }
    for (const g of this.goalMeshes) g.children[0].rotation.y = this.time;
    for (const gd of this.goals) {
      const gp = new Vector3(...gd.pos);
      if (gp.distanceTo(playerFeet.clone().setY(playerFeet.y + 1)) < gd.radius) this.events.goal(gd.id);
    }
    return { align };
  }

  /** The dynamic solid directly under the feet, if any (prevents grabbing what you stand on). */
  standingOn(feet: Vector3): Solid | null {
    for (const c of this.cubes.values()) {
      const s = c.solid;
      if (feet.x >= s.min.x - 0.3 && feet.x <= s.max.x + 0.3 && feet.z >= s.min.z - 0.3 && feet.z <= s.max.z + 0.3 && Math.abs(feet.y - s.max.y) < 0.08) return s;
    }
    return null;
  }

  shardPositions(): { id: string; pos: Vector3 }[] {
    return [...this.shards].filter(([id]) => !this.collected.has(id)).map(([id, s]) => ({ id, pos: s.base }));
  }

  get shardTotal(): number {
    return this.shards.size;
  }

  dispose(): void {
    this.world.dynamicSolids.length = 0;
  }
}

export function hexToVec(hex: string, k = 1): Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return new Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255).multiplyScalar(k);
}

export function raySphere(o: Vector3, d: Vector3, c: Vector3, r: number): number | null {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t >= 0) return t;
  return cc <= 0 ? 0 : null;
}
