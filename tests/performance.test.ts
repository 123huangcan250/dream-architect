import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { buildStoryLevel } from '../src/gen/storyLevel';
import { buildMazeLevel } from '../src/gen/maze';
import { DEFAULT_PLAN, planViews } from '../src/core/renderPlan';
import { SpatialHash } from '../src/core/SpatialHash';
import { Rng } from '../src/core/rng';
import { WorldView } from '../src/render/WorldView';
import { char, makeWorld, settle, simulate } from './helpers';

/** Budgets that keep the engine real-time: render planning, broad phase, batching, physics. */
describe('performance budgets', () => {
  const story = buildStoryLevel();

  it('render planning stays within the pass budget from anywhere in the story', () => {
    const w = makeWorld(story);
    const rng = new Rng(1);
    const spots: [number, number, number][] = [
      [0, 1.6, 8], [400, 1.6, 20], [398, 1.6, 12.4], [800, 1.6, 6], [1201.5, 1.6, 12.5], [1600, 1.6, 0], [2000, 1.6, 3], [2004.5, 1.62, 2],
    ];
    const cam = new PerspectiveCamera(75, 16 / 9, 0.05, 2000);
    let total = 0, n = 0, worst = 0;
    for (const s of spots) {
      for (let k = 0; k < 16; k++) {
        cam.position.set(...s);
        cam.rotation.set(rng.range(-0.3, 0.3), rng.range(-Math.PI, Math.PI), 0, 'YXZ');
        cam.updateMatrixWorld();
        const t0 = performance.now();
        const plan = planViews(w, cam.matrixWorld, cam.projectionMatrix);
        const dt = performance.now() - t0;
        total += dt;
        n++;
        worst = Math.max(worst, plan.passes);
        expect(plan.passes).toBeLessThanOrEqual(DEFAULT_PLAN.maxPasses);
        expect(plan.maxDepthReached).toBeLessThanOrEqual(DEFAULT_PLAN.maxDepth);
      }
    }
    expect(total / n).toBeLessThan(4); // ms of CPU per frame for planning
    expect(worst).toBeGreaterThan(3); // the scenes really do recurse
  });

  it('a maze with dozens of seam portals still respects the budget', () => {
    const w = makeWorld(buildMazeLevel(14, 14, 7, { wrap: true, braid: 0.5, wormholes: 4 }));
    expect(w.portalList.length).toBeGreaterThan(10);
    const cam = new PerspectiveCamera(75, 16 / 9, 0.05, 2000);
    for (let i = 0; i < 40; i++) {
      cam.position.set(2 + (i % 14) * 4, 1.6, 2 + Math.floor(i / 3) * 4);
      cam.rotation.set(0, (i * Math.PI) / 7, 0, 'YXZ');
      cam.updateMatrixWorld();
      expect(planViews(w, cam.matrixWorld, cam.projectionMatrix).passes).toBeLessThanOrEqual(DEFAULT_PLAN.maxPasses);
    }
  });

  it('spatial hash returns exactly the brute-force overlaps while touching few items', () => {
    const rng = new Rng(9);
    const hash = new SpatialHash<{ min: Vector3; max: Vector3 }>(8);
    const items = Array.from({ length: 4000 }, () => {
      const c = new Vector3(rng.range(-500, 500), 0, rng.range(-500, 500));
      const s = rng.range(0.2, 6);
      return { min: c.clone().subScalar(s), max: c.clone().addScalar(s) };
    });
    items.forEach((i) => hash.insert(i));
    for (let k = 0; k < 50; k++) {
      const x = rng.range(-500, 500), z = rng.range(-500, 500);
      const got = new Set(hash.query(x - 3, z - 3, x + 3, z + 3));
      const brute = items.filter((i) => !(i.max.x < x - 3 || i.min.x > x + 3 || i.max.z < z - 3 || i.min.z > z + 3));
      expect(got.size).toBe(brute.length);
      for (const b of brute) expect(got.has(b)).toBe(true);
    }
  });

  it('static geometry is batched into a few draw calls per region', () => {
    const w = makeWorld(story);
    const view = new WorldView(w);
    expect(story.blocks.length).toBeGreaterThan(200);
    expect(view.chunks.length).toBeLessThan(story.blocks.length / 3);
  });

  it('character physics is cheap (1000 steps across portals in well under a frame each)', () => {
    const w = makeWorld(story);
    const c = char(800, 0, 4, 0);
    settle(w, c);
    const t0 = performance.now();
    simulate(w, c, { y: 1, run: true }, 1000 / 60);
    const per = (performance.now() - t0) / 1000;
    expect(per).toBeLessThan(1);
  });
});
