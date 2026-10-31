import {
  Frustum,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  PerspectiveCamera,
  Plane,
  Vector3,
  WebGLRenderTarget,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { cameraHugsPortal, DEFAULT_PLAN, planViews, type Plan, type PlanOptions, type ViewNode } from '../core/renderPlan';
import { shared, MAX_LIGHTS } from './shaders';
import type { WorldView } from './WorldView';
import type { World } from '../core/World';

export interface RenderStats {
  passes: number;
  maxDepth: number;
  drawCalls: number;
  triangles: number;
  targets: number;
  observed: Set<string>;
}

export interface PortalRenderOptions extends PlanOptions {
  /** 'shader' = GPU clip-plane discard (robust); 'oblique' = Lengyel near-plane (faster). */
  clipMode: 'shader' | 'oblique';
  /** Resolution scale per recursion depth. */
  depthScale: number[];
  quality: number;
}

export const DEFAULT_RENDER: PortalRenderOptions = {
  ...DEFAULT_PLAN,
  clipMode: 'shader',
  depthScale: [1, 0.8, 0.6, 0.5, 0.42, 0.36, 0.32, 0.3, 0.3, 0.3],
  quality: 1,
};

export interface LightSource {
  pos: Vector3;
  color: Vector3;
}

/**
 * Executes a recursive portal plan: each portal view is rendered (deepest first) into a pooled
 * render target, then sampled in screen space by the portal surface one level up.
 */
export class PortalRenderer {
  opts: PortalRenderOptions = { ...DEFAULT_RENDER };
  private pool = new Map<number, WebGLRenderTarget[]>();
  private created = 0;
  private cam = new PerspectiveCamera();
  private frustum = new Frustum();
  private projView = new Matrix4();
  private width = 1;
  private height = 1;
  lights: LightSource[] = [];
  /** Small objects culled per pass by distance from that pass's camera. */
  cullables: Map<Object3D, { pos: Vector3; r: number }> = new Map();
  /** Extra objects that should be hidden in a given pass (e.g. the held object outside its space). */
  hooks: { beforePass?: (node: ViewNode) => void } = {};
  lastPlan: Plan | null = null;
  private clip = new Plane();
  private clipList = [this.clip];

  constructor(private renderer: WebGLRenderer, private scene: Scene, public view: WorldView, public world: World) {}

  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    for (const list of this.pool.values()) list.forEach((t) => t.dispose());
    this.pool.clear();
    this.created = 0;
  }

  private acquire(depth: number): WebGLRenderTarget {
    const list = this.pool.get(depth) ?? [];
    this.pool.set(depth, list);
    const t = list.pop();
    if (t) return t;
    const s = (this.opts.depthScale[Math.min(depth, this.opts.depthScale.length - 1)] ?? 0.3) * this.opts.quality;
    this.created++;
    const rt = new WebGLRenderTarget(Math.max(4, Math.round(this.width * s)), Math.max(4, Math.round(this.height * s)), {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      type: HalfFloatType,
      depthBuffer: true,
    });
    (rt as WebGLRenderTarget & { __depth: number }).__depth = depth;
    return rt;
  }

  private release(depth: number, t: WebGLRenderTarget): void {
    this.pool.get(depth)!.push(t);
  }

  /** Renders the full portal-aware view of `camera` into `target`. */
  render(camera: PerspectiveCamera, target: WebGLRenderTarget): RenderStats {
    camera.updateMatrixWorld();
    const plan = planViews(this.world, camera.matrixWorld, camera.projectionMatrix, { ...this.opts, near: camera.near });
    this.lastPlan = plan;
    this.cam.copy(camera);
    const camPos = new Vector3().setFromMatrixPosition(camera.matrixWorld);
    for (const pv of this.view.portals.values()) pv.setThick(cameraHugsPortal(pv.portal, camPos));
    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
    this.renderNode(plan.root, target, camera);
    for (const pv of this.view.portals.values()) pv.setThick(false);
    return {
      passes: plan.passes,
      maxDepth: plan.maxDepthReached,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      targets: this.created,
      observed: plan.observed,
    };
  }

  private renderNode(node: ViewNode, target: WebGLRenderTarget, mainCam: PerspectiveCamera): void {
    // 1. Children first (depth-first), keeping their textures until this level is drawn.
    const textures: { id: string; t: WebGLRenderTarget | null; depth: number }[] = [];
    for (const c of node.children) {
      if (!c.node) {
        textures.push({ id: c.portal.id, t: null, depth: 0 });
        continue;
      }
      const t = this.acquire(c.node.depth);
      this.renderNode(c.node, t, mainCam);
      textures.push({ id: c.portal.id, t, depth: c.node.depth });
    }
    // 2. Configure portal surfaces for this view.
    const eye = new Vector3().setFromMatrixPosition(node.camWorld);
    for (const pv of this.view.portals.values()) {
      pv.mesh.visible = false;
      if (pv.frame) pv.frame.visible = pv.portal.id !== node.exitPortal && pv.portal.center.distanceTo(eye) < 90;
    }
    for (const tx of textures) {
      const pv = this.view.portals.get(tx.id)!;
      pv.mesh.visible = true;
      pv.material.uniforms.map.value = tx.t ? tx.t.texture : null;
      pv.material.uniforms.uMode.value = tx.t ? 0 : 1;
    }
    for (const p of node.closed) {
      const pv = this.view.portals.get(p.id)!;
      pv.mesh.visible = true;
      pv.material.uniforms.uMode.value = 2;
    }
    // 3. Camera for this pass.
    const cam = node.depth === 0 ? mainCam : this.cam;
    if (node.depth > 0) {
      node.camWorld.decompose(cam.position, cam.quaternion, cam.scale);
      cam.updateMatrixWorld(true);
    }
    const baseProj = mainCam.projectionMatrix;
    const useOblique = this.opts.clipMode === 'oblique' && node.depth > 0;
    cam.projectionMatrix.copy(useOblique ? node.projection : baseProj);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    // Always exactly one global plane so material programs never switch variants between passes.
    if (!useOblique && node.clipPlane) {
      this.clip.copy(node.clipPlane);
      this.clip.constant += 0.002;
    } else this.clip.set(UP, 1e6);
    this.renderer.clippingPlanes = this.clipList;
    // 4. Cull chunks against the (non-oblique) frustum, the portal clip plane and fog distance.
    this.projView.multiplyMatrices(baseProj, node.view);
    this.frustum.setFromProjectionMatrix(this.projView);
    const camPos = new Vector3().setFromMatrixPosition(node.camWorld);
    const maxD = this.opts.maxDistance + 20;
    for (const ch of this.view.chunks) {
      let vis = this.frustum.intersectsBox(ch.box) && ch.sphere.distanceToPoint(camPos) < maxD;
      if (vis && node.clipPlane) vis = !boxBehindPlane(ch.box.min, ch.box.max, node.clipPlane);
      ch.mesh.visible = vis;
    }
    const propD = Math.min(maxD, 90);
    for (const [obj, c] of this.cullables) {
      obj.visible = c.pos.distanceTo(camPos) < propD + c.r && (!node.clipPlane || node.clipPlane.distanceToPoint(c.pos) > -c.r);
    }
    this.updateLights(camPos);
    this.hooks.beforePass?.(node);
    // 5. Draw into the scissored region of the target.
    const w = target.width, h = target.height;
    const r = node.rect;
    const x0 = Math.floor(r.x0 * w), y0 = Math.floor(r.y0 * h);
    const sw = Math.ceil(r.x1 * w) - x0, sh = Math.ceil(r.y1 * h) - y0;
    target.scissor.set(x0, y0, Math.max(1, sw), Math.max(1, sh));
    target.scissorTest = node.depth > 0;
    target.viewport.set(0, 0, w, h);
    shared.uResolution.value.set(w, h);
    this.renderer.setRenderTarget(target);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, cam);
    // 6. Give child targets back to the pool.
    for (const tx of textures) if (tx.t) this.release(tx.depth, tx.t);
  }

  private updateLights(camPos: Vector3): void {
    const sorted = this.lights
      .map((l) => ({ l, d: l.pos.distanceToSquared(camPos) }))
      .filter((x) => x.d < 60 * 60)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_LIGHTS);
    sorted.forEach((x, i) => {
      shared.uLightPos.value[i].copy(x.l.pos);
      shared.uLightCol.value[i].copy(x.l.color);
    });
    shared.uLightCount.value = sorted.length;
  }

  dispose(): void {
    for (const list of this.pool.values()) list.forEach((t) => t.dispose());
    this.pool.clear();
  }
}

const UP = new Vector3(0, 1, 0);

function boxBehindPlane(min: Vector3, max: Vector3, plane: Plane): boolean {
  const n = plane.normal;
  // Most positive corner along the normal.
  const x = n.x >= 0 ? max.x : min.x;
  const y = n.y >= 0 ? max.y : min.y;
  const z = n.z >= 0 ? max.z : min.z;
  return n.x * x + n.y * y + n.z * z + plane.constant < 0;
}

export function hideFromPasses(obj: Object3D, test: (node: ViewNode) => boolean): (node: ViewNode) => void {
  return (node) => {
    obj.visible = test(node);
  };
}
