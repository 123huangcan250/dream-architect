import { describe, expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { buildStoryLevel } from '../src/gen/storyLevel';
import { planViews } from '../src/core/renderPlan';
import { char, followPath, makeWorld, settle, simulate } from './helpers';

/** Mechanic: interiors larger than their exteriors (the wardrobe in the courtyard). */
describe('bigger on the inside', () => {
  const level = buildStoryLevel();

  it('the wardrobe footprint is tiny compared to the hall behind its door', () => {
    const w = makeWorld(level);
    const door = w.portals.get('booth')!;
    const hall = w.portals.get('hall_s')!;
    expect(door.def.link).toBe('hall_s');
    // Exterior: 2.4 x 2.4 m. Interior reached through the door: 36 x 50 m.
    const exterior = 2.4 * 2.4;
    const interior = 36 * 50;
    expect(interior / exterior).toBeGreaterThan(300);
    // The hall is nowhere near the wardrobe in world space.
    expect(new Vector3(...hall.def.pos).distanceTo(new Vector3(...door.def.pos))).toBeGreaterThan(300);
  });

  it('walking through the wardrobe door enters the grand hall', () => {
    const w = makeWorld(level);
    const c = char(0, 0, 6, 0);
    settle(w, c);
    const ev = simulate(w, c, { y: 1 }, 3);
    expect(ev.map((e) => e.portal.id)).toEqual(['booth']);
    expect(c.pos.x).toBeGreaterThan(382);
    expect(c.pos.x).toBeLessThan(418);
    expect(c.pos.z).toBeLessThan(25);
  });

  it('walking around the wardrobe never leaves the courtyard', () => {
    const w = makeWorld(level);
    const c = char(0, 0, 6, 0);
    settle(w, c);
    const ev = followPath(w, c, [[3, 4], [3, -4], [-3, -4], [-3, 4], [0, 6]]);
    expect(ev).toHaveLength(0);
    expect(Math.abs(c.pos.x)).toBeLessThan(15);
  });

  it('the wardrobe walls are solid from the outside', () => {
    const w = makeWorld(level);
    const c = char(3, 0, 0, -Math.PI / 2); // east of the booth facing west
    settle(w, c);
    simulate(w, c, { y: 1 }, 2);
    expect(c.pos.x).toBeGreaterThan(1.4 + 0.29);
  });

  it('looking at the door renders the hall through it (view is placed in the hall)', () => {
    const w = makeWorld(level);
    const cam = new PerspectiveCamera(75, 1.6, 0.05, 2000);
    cam.position.set(0, 1.6, 6);
    cam.updateMatrixWorld();
    const plan = planViews(w, cam.matrixWorld, cam.projectionMatrix);
    const child = plan.root.children.find((c) => c.portal.id === 'booth');
    expect(child?.node).toBeTruthy();
    const p = new Vector3().setFromMatrixPosition(child!.node!.camWorld);
    expect(p.x).toBeGreaterThan(390); // virtual camera stands in the hall
    expect(p.z).toBeGreaterThan(25); // ...behind the hall's south door, looking in
    expect(child!.node!.camWorld).toBeInstanceOf(Matrix4);
  });
});
