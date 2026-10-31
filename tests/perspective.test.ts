import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { anamorphError, evaluateAlignment, forcedPerspective, scatterFragments } from '../src/core/perspective';
import { buildStoryLevel } from '../src/gen/storyLevel';
import { char, makeWorld, settle, simulate, topologyFor } from './helpers';

/** Mechanic: spatial illusions created by camera perspective. */
describe('anamorphic illusion', () => {
  const V = new Vector3(2004.5, 1.62, 2);
  const bridge = [
    { min: new Vector3(1999, -0.3, -14), max: new Vector3(2001, 0, -6) },
    { min: new Vector3(1998.8, 0, -14), max: new Vector3(1999, 0.6, -6) },
  ];
  const frags = scatterFragments(V, bridge, 7, 1);

  it('every fragment is displaced and rescaled along its view ray', () => {
    expect(frags.length).toBe(16);
    for (const f of frags) {
      expect(Math.abs(f.k - 1)).toBeGreaterThan(0.2);
      expect(f.scattered.center.distanceTo(f.home.center)).toBeGreaterThan(0.5);
      // Every corner of the scattered box lies on the ray through the matching home corner.
      for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
        const home = f.home.center.clone().add(f.home.size.clone().multiply(new Vector3(sx, 0.5, sz)));
        const scat = f.scattered.center.clone().add(f.scattered.size.clone().multiply(new Vector3(sx, 0.5, sz)));
        const a = home.sub(V).normalize();
        const b = scat.sub(V).normalize();
        expect(a.angleTo(b)).toBeLessThan(1e-6);
      }
    }
  });

  it('projects exactly onto the target from the viewpoint, and not from elsewhere', () => {
    expect(anamorphError(V, frags)).toBeLessThan(1e-6);
    expect((anamorphError(V.clone().add(new Vector3(1.5, 0, 0)), frags) * 180) / Math.PI).toBeGreaterThan(2);
    expect((anamorphError(V.clone().add(new Vector3(0, 0, -3)), frags) * 180) / Math.PI).toBeGreaterThan(2);
  });

  it('alignment requires both the right spot and the right view direction', () => {
    const centroid = new Vector3(2000, -0.15, -10);
    const look = centroid.clone().sub(V).normalize();
    expect(evaluateAlignment(V, look, frags, 2).aligned).toBe(true);
    expect(evaluateAlignment(V, look.clone().negate(), frags, 2).aligned).toBe(false);
    expect(evaluateAlignment(V.clone().add(new Vector3(-2, 0, 0)), look, frags, 2).aligned).toBe(false);
    // Score grows as you approach the viewpoint.
    const far = evaluateAlignment(V.clone().add(new Vector3(-2, 0, 1)), look, frags, 2).score;
    const near = evaluateAlignment(V.clone().add(new Vector3(-0.3, 0, 0.1)), look, frags, 2).score;
    expect(near).toBeGreaterThan(far);
  });

  it('solving the illusion makes the bridge real: the chasm becomes walkable', () => {
    const level = buildStoryLevel();
    // Before: walking over the chasm means falling.
    const w1 = makeWorld(level);
    const c1 = char(2000, 0, -4, 0);
    settle(w1, c1);
    simulate(w1, c1, { y: 1 }, 3);
    expect(c1.pos.y).toBeLessThan(-5);
    // After: the solved rule enables the bridge.
    const w2 = makeWorld(level);
    const c2 = char(2000, 0, -4, 0);
    settle(w2, c2);
    topologyFor(w2, c2).solved('anam');
    simulate(w2, c2, { y: 1 }, 3);
    expect(c2.pos.y).toBeCloseTo(0, 3);
    expect(c2.pos.z).toBeLessThan(-14);
  });
});

describe('forced perspective', () => {
  it('keeps the angular size constant while the object slides along the view ray', () => {
    const theta = 0.4 / 1.2; // a 0.4 m cube held 1.2 m away
    for (const D of [2, 5, 9, 14]) {
      const { distance, size } = forcedPerspective(theta, D);
      expect(size / distance).toBeCloseTo(theta, 9);
      expect(distance + size / 2).toBeCloseTo(D, 9); // resting against the surface
    }
  });

  it('a small cube looked at against a far wall becomes big enough to climb', () => {
    const { size } = forcedPerspective(0.4 / 1.1, 8);
    expect(size).toBeGreaterThan(2.08);
    expect(size).toBeLessThan(2.72);
  });

  it('clamps to sane sizes', () => {
    expect(forcedPerspective(5, 100).size).toBe(6);
    expect(forcedPerspective(0.01, 1).size).toBeCloseTo(0.15, 9);
  });
});
