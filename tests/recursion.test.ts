import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { LevelBuilder } from '../src/gen/builder';
import { buildStoryLevel } from '../src/gen/storyLevel';
import { cameraHugsPortal, clipPolygon, DEFAULT_PLAN, planViews, rectArea, type ViewNode } from '../src/core/renderPlan';
import { World } from '../src/core/World';
import { makeWorld } from './helpers';

/** Mechanic: recursive portal rendering (planning half; the GL half executes this tree). */
function camAt(pos: [number, number, number], yaw: number, pitch = 0): PerspectiveCamera {
  const c = new PerspectiveCamera(75, 16 / 9, 0.05, 2000);
  c.position.set(...pos);
  c.rotation.set(pitch, yaw, 0, 'YXZ');
  c.updateMatrixWorld();
  return c;
}

function depthOf(n: ViewNode): number {
  return Math.max(n.depth, ...n.children.map((c) => (c.node ? depthOf(c.node) : n.depth)));
}

function count(n: ViewNode): number {
  return 1 + n.children.reduce((s, c) => s + (c.node ? count(c.node) : 0), 0);
}

function mirrors(): World {
  const b = new LevelBuilder('m');
  b.box([-20, -1, -20], [20, 0, 20], 'tile');
  b.portal({ pos: [-5, 0, 0], yaw: Math.PI / 2, width: 2, height: 3 }, 'a');
  b.portal({ pos: [5, 0, 0], yaw: -Math.PI / 2, width: 2, height: 3 }, 'b');
  b.pair('a', 'b');
  return new World(b.build());
}

describe('recursive portal view planning', () => {
  it('two facing portals recurse until the depth limit', () => {
    const w = mirrors();
    const cam = camAt([3, 1.5, 0.2], Math.PI / 2); // looking -X at portal a
    const plan = planViews(w, cam.matrixWorld, cam.projectionMatrix, { ...DEFAULT_PLAN, maxDepth: 6, minArea: 0 });
    expect(depthOf(plan.root)).toBe(6);
    expect(plan.maxDepthReached).toBe(6);
    expect(plan.passes).toBe(count(plan.root));
    // Each level is nested inside its parent's screen rectangle.
    let n: ViewNode | null = plan.root;
    let last = 1;
    while (n) {
      const area = rectArea(n.rect);
      expect(area).toBeLessThanOrEqual(last + 1e-9);
      last = area;
      n = n.children.find((c) => c.node)?.node ?? null;
    }
  });

  it('the pass budget caps total work and degrades to fallback fills', () => {
    const w = makeWorld(buildStoryLevel());
    const cam = camAt([800, 1.6, 0], 0); // endless corridor, looking north
    const plan = planViews(w, cam.matrixWorld, cam.projectionMatrix, { ...DEFAULT_PLAN, maxPasses: 4, minArea: 0 });
    expect(plan.passes).toBeLessThanOrEqual(4);
    const fallbacks: number[] = [];
    const walk = (n: ViewNode) => n.children.forEach((c) => (c.node ? walk(c.node) : fallbacks.push(n.depth)));
    walk(plan.root);
    expect(fallbacks.length).toBeGreaterThan(0);
  });

  it('portals are one-sided: invisible from behind', () => {
    const w = mirrors();
    const cam = camAt([-8, 1.5, 0], -Math.PI / 2); // behind portal a, looking +X through its back
    const plan = planViews(w, cam.matrixWorld, cam.projectionMatrix);
    expect(plan.root.children.map((c) => c.portal.id)).not.toContain('a');
  });

  it('portals behind the camera or outside the frustum are culled', () => {
    const w = mirrors();
    const cam = camAt([0, 1.5, 0], 0); // looking -Z, both portals are to the sides
    const plan = planViews(w, cam.matrixWorld, cam.projectionMatrix);
    expect(plan.passes).toBe(1);
    expect(plan.observed.size).toBe(0);
  });

  it('a camera hugging a portal gets a full-screen view (near-plane crossing safety)', () => {
    const w = mirrors();
    const a = w.portals.get('a')!;
    expect(cameraHugsPortal(a, new Vector3(-4.97, 1.6, 0))).toBe(true);
    const cam = camAt([-4.97, 1.6, 0], Math.PI / 2 + 0.6);
    const plan = planViews(w, cam.matrixWorld, cam.projectionMatrix);
    const child = plan.root.children.find((c) => c.portal.id === 'a')!;
    expect(rectArea(child.rect)).toBeCloseTo(1, 9);
  });

  it('child views carry the destination plane for clipping and never draw their own exit', () => {
    const w = mirrors();
    const cam = camAt([3, 1.5, 0.2], Math.PI / 2);
    const plan = planViews(w, cam.matrixWorld, cam.projectionMatrix, { ...DEFAULT_PLAN, maxDepth: 1 });
    const child = plan.root.children[0].node!;
    expect(child.exitPortal).toBe('b');
    expect(child.clipPlane!.distanceToPoint(new Vector3(0, 1, 0))).toBeGreaterThan(0); // keeps the room
    expect(child.clipPlane!.distanceToPoint(new Vector3(7, 1, 0))).toBeLessThan(0); // drops what's behind b
    expect(child.children.map((c) => c.portal.id)).not.toContain('b');
  });

  it('far portals are distance-culled (they are fully fogged)', () => {
    const w = mirrors();
    const cam = camAt([3, 1.5, 0.2], Math.PI / 2);
    const plan = planViews(w, cam.matrixWorld, cam.projectionMatrix, { ...DEFAULT_PLAN, maxDistance: 5 });
    expect(plan.passes).toBe(1);
  });

  it('clips polygons correctly', () => {
    const sq = [new Vector3(-1, 0, -1), new Vector3(1, 0, -1), new Vector3(1, 0, 1), new Vector3(-1, 0, 1)];
    const half = clipPolygon(sq, (p) => p.x);
    expect(half.length).toBe(4);
    expect(Math.min(...half.map((p) => p.x))).toBeCloseTo(0, 9);
    expect(clipPolygon(sq, (p) => p.x - 5)).toHaveLength(0);
  });

  it('the infinite corridor shows itself recursively', () => {
    const w = makeWorld(buildStoryLevel());
    const cam = camAt([800, 1.6, 6], 0);
    const plan = planViews(w, cam.matrixWorld, cam.projectionMatrix, { ...DEFAULT_PLAN, maxDepth: 5, maxPasses: 500 });
    let n = plan.root;
    const ids: string[] = [];
    while (n.children.length && n.children[0].node) {
      const c = n.children.find((x) => x.portal.id === 'cor_n');
      if (!c?.node) break;
      ids.push(c.portal.id);
      n = c.node;
    }
    expect(ids.length).toBe(5);
    // Each recursion steps the virtual camera 16 m further back along the corridor.
    expect(new Vector3().setFromMatrixPosition(n.camWorld).z).toBeCloseTo(6 + 16 * 5, 6);
  });
});
