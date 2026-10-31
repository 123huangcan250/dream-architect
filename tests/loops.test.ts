import { describe, expect, it } from 'vitest';
import { buildStoryLevel } from '../src/gen/storyLevel';
import { char, followPath, makeWorld, settle, simulate, topologyFor } from './helpers';

/** Mechanic: infinite corridors and impossible (Penrose) staircases. */
describe('endless corridor', () => {
  const level = buildStoryLevel();

  it('walking north forever keeps you inside the same 16 m corridor', () => {
    const w = makeWorld(level);
    const c = char(800, 0, 4, 0);
    settle(w, c);
    const ev = simulate(w, c, { y: 1, run: true }, 14); // ~98 m of walking
    expect(ev.length).toBeGreaterThanOrEqual(5);
    expect(ev.every((e) => e.portal.id === 'cor_n')).toBe(true);
    expect(c.pos.z).toBeGreaterThanOrEqual(-8);
    expect(c.pos.z).toBeLessThanOrEqual(8);
    expect(Math.abs(c.pos.x - 800)).toBeLessThan(2);
  });

  it('walking south loops the other way', () => {
    const w = makeWorld(level);
    const c = char(800, 0, 0, Math.PI);
    settle(w, c);
    const ev = simulate(w, c, { y: 1, run: true }, 6);
    expect(ev.length).toBeGreaterThanOrEqual(2);
    expect(ev.every((e) => e.portal.id === 'cor_s')).toBe(true);
  });

  it('only walking backwards through the north end reaches the sanctum', () => {
    const w = makeWorld(level);
    const c = char(800, 0, 0, Math.PI); // facing south
    settle(w, c);
    const topo = topologyFor(w, c);
    const hooks = { beforeCross: (p: { id: string }, back: boolean) => topo.beforeCross(p.id, back) };
    simulate(w, c, { y: -1 }, 3, hooks); // walk backwards, northwards
    expect(c.pos.z).toBeLessThan(-95);
    expect(c.pos.z).toBeGreaterThan(-104);
    expect(w.portals.get('cor_n')!.def.link).toBe('sanct_in');
  });

  it('loop counter triggers the hint messages', () => {
    const w = makeWorld(level);
    const c = char(800, 0, 4, 0);
    settle(w, c);
    const messages: string[] = [];
    const topo = topologyFor(w, c, new Set(), messages);
    simulate(w, c, { y: 1, run: true }, 20, { beforeCross: (p, b) => topo.beforeCross(p.id, b) });
    // afterCross is fired by the game loop; emulate it from the crossings.
    for (let i = 0; i < 6; i++) topo.afterCross('cor_n');
    expect(topo.counters.get('loops')).toBe(6);
    expect(messages.length).toBe(2);
  });
});

describe('Penrose stairs', () => {
  const level = buildStoryLevel();
  const LOOP: [number, number][] = [
    [1201.5, 2],
    [1212.5, 1.5],
    [1212.5, 12.5],
    [1201.2, 12.5],
  ];

  it('every flight goes up, yet one lap returns to the starting landing', () => {
    const w = makeWorld(level);
    const c = char(1201.5, 0, 12.5, 0);
    settle(w, c);
    const heights: number[] = [];
    const ev = followPath(w, c, LOOP.slice(0, 1));
    heights.push(c.pos.y);
    followPath(w, c, LOOP.slice(1, 2));
    heights.push(c.pos.y);
    followPath(w, c, LOOP.slice(2, 3));
    heights.push(c.pos.y);
    const ev2 = followPath(w, c, LOOP.slice(3));
    expect(ev).toHaveLength(0);
    expect(heights[0]).toBeCloseTo(2, 1);
    expect(heights[1]).toBeCloseTo(4, 1);
    expect(heights[2]).toBeCloseTo(6, 1);
    expect(ev2.map((e) => e.portal.id)).toEqual(['pen_top']);
    // Back on the bottom landing...
    expect(c.pos.y).toBeCloseTo(0, 2);
    // ...but the dream altimeter says we climbed a full storey.
    expect(c.portalLift).toBeCloseTo(8, 6);
  });

  it('three laps accumulate 24 m of climb and open the summit after two', () => {
    const w = makeWorld(level);
    const c = char(1201.5, 0, 12.5, 0);
    settle(w, c);
    const topo = topologyFor(w, c);
    const hooks = { beforeCross: (p: { id: string }, b: boolean) => topo.beforeCross(p.id, b) };
    followPath(w, c, LOOP, hooks);
    followPath(w, c, LOOP, hooks);
    expect(topo.counters.get('ascent')).toBe(2);
    topo.flush();
    expect(w.portals.get('pen_top')!.def.link).toBe('summit_in');
    // The second crossing itself still landed on the stairs (no visible pop).
    expect(c.pos.x).toBeLessThan(1215);
    // Third lap ends on the summit.
    followPath(w, c, LOOP.slice(0, 3), hooks);
    c.yaw = Math.PI / 2; // face west, up the last flight
    simulate(w, c, { y: 1 }, 3.5, hooks);
    expect(c.pos.x).toBeGreaterThan(2780);
    expect(c.pos.y).toBeCloseTo(0, 2);
  });

  it('walking down the stairs reverses the count', () => {
    const w = makeWorld(level);
    const c = char(1201.5, 0, 12.5, -Math.PI / 2);
    settle(w, c);
    const topo = topologyFor(w, c);
    const ev = simulate(w, c, { y: 1 }, 1.0, { beforeCross: (p, b) => topo.beforeCross(p.id, b) });
    expect(ev[0].portal.id).toBe('pen_bot');
    expect(topo.counters.get('ascent')).toBe(-1);
    expect(c.portalLift).toBeCloseTo(-8, 6);
  });
});
