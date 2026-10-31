import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LevelBuilder } from '../src/gen/builder';
import { buildStoryLevel } from '../src/gen/storyLevel';
import { CHAR } from '../src/core/character';
import { World } from '../src/core/World';
import { char, makeWorld, settle, simulate } from './helpers';


function arena(extra: (b: LevelBuilder) => void): World {
  const b = new LevelBuilder('c');
  b.box([-20, -1, -20], [20, 0, 20], 'tile');
  extra(b);
  return new World(b.build());
}

describe('character collision', () => {
  it('stops at a wall at exactly one body radius', () => {
    const w = arena((b) => b.box([-5, 0, -3.4], [5, 3, -3], 'plaster'));
    const c = char(0, 0, 0, 0);
    settle(w, c);
    simulate(w, c, { y: 1, run: true }, 3);
    expect(c.pos.z).toBeCloseTo(-3 + CHAR.radius, 3);
  });

  it('slides along walls instead of sticking', () => {
    const w = arena((b) => b.box([-5, 0, -3.4], [5, 3, -3], 'plaster'));
    const c = char(0, 0, 0, Math.PI / 4); // diagonal into the wall
    settle(w, c);
    simulate(w, c, { y: 1 }, 2);
    expect(c.pos.x).toBeLessThan(-2);
  });

  it('climbs stairs of 0.25 m steps but not a 1 m block', () => {
    const w = arena((b) => {
      for (let i = 0; i < 8; i++) b.box([-1, 0, -2 - i], [1, 0.25 * (i + 1), -1 - i], 'wood');
      b.box([5, 0, -3], [7, 1, -1], 'marble');
    });
    const c = char(0, 0, 0, 0);
    settle(w, c);
    simulate(w, c, { y: 1 }, 2.0); // top step spans z -8..-9
    expect(c.pos.y).toBeCloseTo(2, 2);
    const d = char(6, 0, 0, 0);
    settle(w, d);
    simulate(w, d, { y: 1 }, 2);
    expect(d.pos.y).toBeCloseTo(0, 3);
    expect(d.pos.z).toBeCloseTo(-1 + CHAR.radius, 2);
  });

  it('can jump onto a 1.3 m ledge but not a 1.8 m one', () => {
    const w = arena((b) => {
      b.box([-1, 0, -4], [1, 1.3, -2], 'marble');
      b.box([5, 0, -4], [7, 1.8, -2], 'marble');
    });
    for (const [x, top, ok] of [[0, 1.3, true], [6, 1.8, false]] as const) {
      const c = char(x, 0, -1, 0);
      settle(w, c);
      simulate(w, c, { y: 1, jump: true }, 0.05);
      simulate(w, c, { y: 1 }, 0.55);
      if (ok) expect(c.pos.y).toBeCloseTo(top, 2);
      else expect(c.pos.y).toBeLessThan(top - 0.5);
    }
  });

  it('a ceiling stops a jump', () => {
    const w = arena((b) => b.box([-3, 2.2, -3], [3, 2.6, 3], 'plaster'));
    const c = char(0, 0, 0);
    settle(w, c);
    let maxY = 0;
    for (let i = 0; i < 60; i++) {
      simulate(w, c, { jump: i === 0 }, 1 / 60);
      maxY = Math.max(maxY, c.pos.y);
    }
    expect(maxY + CHAR.height).toBeLessThanOrEqual(2.2 + 1e-6);
  });

  it('walks up and down ramps', () => {
    const w = arena((b) => b.box([-1, 0, -10], [1, 2, -2], 'wood', { kind: 'ramp', ramp: 'z-' }));
    expect(w.groundAt(0, -6, 5)).toBeCloseTo(1, 6);
    const c = char(0, 0, 0, 0);
    settle(w, c);
    simulate(w, c, { y: 1 }, 2.2);
    expect(c.pos.y).toBeGreaterThan(1);
  });

  it('dynamic solids (cubes) are standable', () => {
    const w = arena(() => undefined);
    w.addDynamic({ id: 'cube', min: new Vector3(-1, 0, -3), max: new Vector3(1, 0.4, -1), kind: 'box', enabled: true, owner: 'cube' });
    const c = char(0, 0, 0, 0);
    settle(w, c);
    simulate(w, c, { y: 1 }, 0.6);
    expect(c.pos.y).toBeCloseTo(0.4, 3);
  });
});

describe('portal-aware collision', () => {
  const story = buildStoryLevel();

  it('geometry hidden behind a portal does not block the body straddling it', () => {
    // Penrose bottom portal: directly behind it sits the solid mass of the last flight.
    const w = makeWorld(story);
    const c = char(1201.5, 0, 12.5, -Math.PI / 2); // on the bottom landing, facing +X
    settle(w, c);
    const ev = simulate(w, c, { y: 1 }, 1.0);
    expect(ev.map((e) => e.portal.id)).toContain('pen_bot');
    expect(c.pos.y).toBeGreaterThan(7); // now on the top flight
  });

  it('while straddling, local solids behind the plane are dropped and remote ones are mapped in', () => {
    const w = makeWorld(story);
    const pos = new Vector3(1202.8, 0, 12.5); // 0.2 m in front of pen_bot (its front faces -X)
    const body = { pos, radius: CHAR.radius, yMin: 0.02, yMax: 1.8 };
    expect(w.straddled(body).map((p) => p.id)).toEqual(['pen_bot']);
    const solids = w.bodySolids(body);
    // Without portal awareness the stair mass (x >= 1203) would be here.
    const local = w.querySolids(new Vector3(1202.4, 0.02, 12.1), new Vector3(1203.2, 1.8, 12.9));
    expect(local.some((s) => s.min.x >= 1203 - 1e-6 && s.owner === 'block')).toBe(true);
    expect(solids.some((s) => s.owner === 'block' && s.min.x >= 1203 - 1e-6 && s.max.y > 0.5)).toBe(false);
  });

  it('obstacles just beyond the destination portal block a body straddling the source', () => {
    const b = new LevelBuilder('v');
    b.box([-10, -1, -10], [10, 0, 10], 'tile');
    b.box([90, -1, -10], [110, 0, 10], 'tile');
    b.portal({ pos: [0, 0, 0], yaw: 0, width: 2, height: 3 }, 'A');
    b.portal({ pos: [100, 0, 0], yaw: 0, width: 2, height: 3 }, 'B');
    b.pair('A', 'B');
    // A pillar standing right in front of B (B's local x 0.5..1.5).
    b.box([100.5, 0, 0.1], [101.5, 2, 0.6], 'marble');
    const w = new World(b.build());
    const body = { pos: new Vector3(-0.8, 0, 0.1), radius: CHAR.radius, yMin: 0.02, yMax: 1.8 };
    const solids = w.bodySolids(body);
    const v = solids.find((s) => s.owner === 'virtual');
    expect(v).toBeTruthy();
    // Mirrored behind A: x -1.5..-0.5, z -0.6..-0.1.
    expect(v!.min.x).toBeCloseTo(-1.5, 6);
    expect(v!.max.z).toBeCloseTo(-0.1, 6);
    // Walking straight in at that spot is stopped by the far-side pillar.
    const c = char(-0.8, 0, 2, 0);
    settle(w, c);
    const ev = simulate(w, c, { y: 1 }, 2);
    expect(ev).toHaveLength(0);
    expect(c.pos.z).toBeCloseTo(-0.1 + CHAR.radius, 2);
  });

  it('ground under a straddling body is sampled on the far side of the portal', () => {
    const w = makeWorld(story);
    const body = { pos: new Vector3(1202.9, 0, 12.5), radius: CHAR.radius, yMin: -2, yMax: 1.8 };
    // A point 0.1 m behind the bottom portal is, through the portal, on the top step (y = 8 - 8 = 0).
    expect(w.groundAtThroughPortals(1203.1, 12.5, 0.45, body)).toBeCloseTo(0, 6);
    // Without the portal the same spot would report the stair mass top (6.25+).
    expect(w.groundAt(1203.1, 12.5, 100)).toBeGreaterThan(7);
  });
});
