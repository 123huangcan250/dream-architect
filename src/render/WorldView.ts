import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  Sphere,
  SphereGeometry,
  Vector3,
  type Material,
  type ShaderMaterial,
} from 'three';
import { createGlowMaterial, createPortalMaterial, createSkyMaterial, createWorldMaterial } from './shaders';
import { portalRight } from '../core/portalMath';
import type { BlockDef, MaterialKey } from '../core/types';
import type { RtPortal, World } from '../core/World';

export interface Chunk {
  mesh: Mesh;
  box: Box3;
  sphere: Sphere;
}

const FACES: [number[], number[][]][] = [
  // normal, 4 corners (as 0/1 selectors of min/max per axis)
  [[1, 0, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]]],
  [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]],
  [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
];

/** Merged box geometry with per-vertex block bounds (used by the bevel/contact shading). */
export function buildBoxGeometry(blocks: Pick<BlockDef, 'min' | 'max' | 'kind' | 'ramp'>[]): BufferGeometry {
  const n = blocks.length * 24;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const amin = new Float32Array(n * 3);
  const amax = new Float32Array(n * 3);
  const index = new Uint32Array(blocks.length * 36);
  let v = 0, k = 0;
  for (const b of blocks) {
    const ramp = b.kind === 'ramp' ? b.ramp : undefined;
    for (const [nrm, corners] of FACES) {
      const base = v;
      for (const c of corners) {
        let y = c[1] ? b.max[1] : b.min[1];
        if (ramp && c[1]) {
          // Lower the top edge at the low end of a ramp.
          const lowSide = ramp === 'x+' ? c[0] === 0 : ramp === 'x-' ? c[0] === 1 : ramp === 'z+' ? c[2] === 0 : c[2] === 1;
          if (lowSide) y = b.min[1] + 0.001;
        }
        pos.set([c[0] ? b.max[0] : b.min[0], y, c[2] ? b.max[2] : b.min[2]], v * 3);
        nor.set(nrm, v * 3);
        amin.set(b.min, v * 3);
        amax.set(b.max, v * 3);
        v++;
      }
      index.set([base, base + 1, base + 2, base, base + 2, base + 3], k);
      k += 6;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('aMin', new BufferAttribute(amin, 3));
  g.setAttribute('aMax', new BufferAttribute(amax, 3));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export class PortalVisual {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly frame: Group | null = null;
  constructor(public portal: RtPortal) {
    const d = portal.def;
    this.material = createPortalMaterial(d.color ?? '#c9b8ff');
    // Unit box: x [-.5,.5], y [0,1], z [-1,0]. Scaled to (width, height, thickness).
    const g = buildBoxGeometry([{ min: [-0.5, 0, -1], max: [0.5, 1, 0] }]);
    this.mesh = new Mesh(g, this.material);
    this.mesh.position.set(...d.pos);
    this.mesh.rotation.y = d.yaw;
    this.mesh.scale.set(d.width, d.height, 0.0005);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.userData.portalId = d.id;
    if (d.frame === 'glow') {
      const strip = new Group();
      const mat = createGlowMaterial(d.color ?? '#c9b8ff', 0.75, 'strip');
      const r = portalRight(d);
      const n = portal.normal;
      // Glowing strips on the face of the surrounding frame / jambs, just outside the opening.
      const add = (len: number, cx: number, cy: number, vertical: boolean) => {
        const m = new Mesh(new PlaneGeometry(len, 0.2), mat);
        m.position.set(d.pos[0] + r.x * cx + n.x * 0.27, d.pos[1] + cy, d.pos[2] + r.z * cx + n.z * 0.27);
        m.rotation.set(0, d.yaw, vertical ? Math.PI / 2 : 0);
        strip.add(m);
      };
      add(d.height + 0.2, -d.width / 2 - 0.2, d.height / 2 + 0.1, true);
      add(d.height + 0.2, d.width / 2 + 0.2, d.height / 2 + 0.1, true);
      add(d.width + 0.6, 0, d.height + 0.2, false);
      this.frame = strip;
    }
  }
  /** Thicken the portal into a box behind its plane while the camera hugs it (near-plane safety). */
  setThick(on: boolean): void {
    this.mesh.scale.z = on ? 0.18 : 0.0005;
  }
}

/** Renderable version of a World: merged static chunks, dynamic blocks, portal surfaces, sky. */
export class WorldView {
  readonly root = new Group();
  readonly chunks: Chunk[] = [];
  readonly dynamicMeshes = new Map<string, Mesh>();
  readonly portals = new Map<string, PortalVisual>();
  readonly sky: Mesh;
  private materials = new Map<MaterialKey, ShaderMaterial>();

  constructor(public world: World, chunkSize = 64) {
    this.sky = new Mesh(new SphereGeometry(50, 32, 16), createSkyMaterial());
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sky.onBeforeRender = (_r, _s, cam) => {
      this.sky.position.setFromMatrixPosition(cam.matrixWorld);
      this.sky.updateMatrixWorld();
    };
    this.root.add(this.sky);

    const groups = new Map<string, BlockDef[]>();
    for (const b of world.level.blocks) {
      if (b.dynamic || world.level.rules.some((r) => r.actions.some((a) => a.type === 'block' && a.block === b.id))) {
        const m = new Mesh(buildBoxGeometry([b]), this.mat(b.mat));
        m.visible = world.blockVisible.get(b.id) ?? true;
        this.dynamicMeshes.set(b.id, m);
        this.root.add(m);
        continue;
      }
      if (b.visible === false) continue;
      const cx = Math.floor((b.min[0] + b.max[0]) / 2 / chunkSize);
      const cz = Math.floor((b.min[2] + b.max[2]) / 2 / chunkSize);
      const key = `${cx},${cz},${b.mat}`;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(b);
    }
    for (const [key, list] of groups) {
      const mat = key.split(',')[2] as MaterialKey;
      const g = buildBoxGeometry(list);
      const mesh = new Mesh(g, this.mat(mat));
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.chunks.push({ mesh, box: g.boundingBox!.clone(), sphere: g.boundingSphere!.clone() });
    }
    for (const p of world.portalList) {
      const v = new PortalVisual(p);
      this.portals.set(p.id, v);
      this.root.add(v.mesh);
      if (v.frame) this.root.add(v.frame);
    }
    world.onBlockChanged.push((id) => {
      const m = this.dynamicMeshes.get(id);
      if (m) m.visible = world.blockVisible.get(id) ?? true;
    });
  }

  mat(key: MaterialKey): ShaderMaterial {
    let m = this.materials.get(key);
    if (!m) this.materials.set(key, (m = createWorldMaterial(key)));
    return m;
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as Material | Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }

  /** Approximate triangle count of the static scene. */
  get triangles(): number {
    let t = 0;
    for (const c of this.chunks) t += (c.mesh.geometry.index?.count ?? 0) / 3;
    return t;
  }

  static boxCenter(b: BlockDef): Vector3 {
    return new Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  }
}
