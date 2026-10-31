import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LevelBuilder } from '../src/gen/builder';
import { CHAR, createCharacter, eyePosition } from '../src/core/character';
import { World } from '../src/core/World';
import { char, fwd, settle, simulate } from './helpers';

/** Room A (door on its north wall) is linked to room B (door on its east wall), 500 m away. */
function twoRooms(linked = true) {
  const b = new LevelBuilder('t');
  const ra = b.room({ center: [0, 0, 0], size: [8, 4, 8], doors: [{ id: 'a', side: 'n', width: 2, height: 3 }] });
  const rb = b.room({ center: [500, 3, 40], size: [8, 4, 8], doors: [{ id: 'b', side: 'e', width: 2, height: 3 }] });
  b.portal(ra.anchors.a, 'a');
  b.portal(rb.anchors.b, 'b');
  if (linked) b.pair('a', 'b');
  return new World(b.build());
}

describe('portal traversal', () => {
  it('walking through a door teleports into the linked room with matching orientation', () => {
    const w = twoRooms();
    const c = char(0, 0, 2, 0); // facing -Z, towards the north door
    settle(w, c);
    const ev = simulate(w, c, { y: 1 }, 2.0);
    expect(ev.map((e) => e.portal.id)).toEqual(['a']);
    // Inside room B: x in (496, 504), z in (36, 44), floor at y = 3.
    expect(c.pos.x).toBeGreaterThan(496);
    expect(c.pos.x).toBeLessThan(504);
    expect(c.pos.y).toBeCloseTo(3, 3);
    // B's door normal points -X into the room: we must now be looking and moving along -X.
    expect(fwd(c).distanceTo(new Vector3(-1, 0, 0))).toBeLessThan(1e-6);
    expect(c.vel.clone().setY(0).normalize().distanceTo(new Vector3(-1, 0, 0))).toBeLessThan(1e-3);
  });

  it('preserves speed and lateral offset through the portal', () => {
    const w = twoRooms();
    const c = char(0.5, 0, -3, 0);
    settle(w, c);
    const ev = simulate(w, c, { y: 1 }, 0.4);
    expect(ev.length).toBe(1);
    expect(c.vel.length()).toBeCloseTo(4.2, 3);
    // Lateral +0.5 m in A (x) maps to lateral +0.5 m along B's right vector (+Z when facing -X... right of -X is -Z).
    expect(c.pos.z).toBeCloseTo(40 - 0.5, 1);
  });

  it('round trip returns to the starting room', () => {
    const w = twoRooms();
    const c = char(0, 0, 1, 0);
    settle(w, c);
    simulate(w, c, { y: 1 }, 1.5);
    c.yaw += Math.PI; // turn around
    const back = simulate(w, c, { y: 1 }, 1.6);
    expect(back.map((e) => e.portal.id)).toEqual(['b']);
    expect(Math.abs(c.pos.x)).toBeLessThan(4);
    expect(Math.abs(c.pos.z)).toBeLessThan(4);
  });

  it('an unlinked portal behaves like a wall', () => {
    const w = twoRooms(false);
    const c = char(0, 0, 2, 0);
    settle(w, c);
    const ev = simulate(w, c, { y: 1, run: true }, 2);
    expect(ev).toHaveLength(0);
    expect(c.pos.z).toBeGreaterThan(-4 + CHAR.radius - 0.02);
  });

  it('flags backward traversal (moving opposite to the view direction)', () => {
    const w = twoRooms();
    const c = char(0, 0, 1, Math.PI); // facing +Z, away from the door
    settle(w, c);
    const ev = simulate(w, c, { y: -1 }, 2.5);
    expect(ev).toHaveLength(1);
    expect(ev[0].backward).toBe(true);
  });

  it('does not tunnel through the door frame at high speed with large time steps', () => {
    const w = twoRooms();
    const c = char(2.5, 0, 2, 0); // lined up with the wall beside the door
    settle(w, c);
    for (let i = 0; i < 40; i++) {
      c.vel.set(0, 0, -40);
      simulate(w, c, { y: 1, run: true }, 0.1, {}, 0.1);
    }
    expect(c.pos.z).toBeGreaterThan(-4);
    expect(c.pos.x).toBeLessThan(10);
  });

  it('camera eye follows the body through the portal (no lag frame)', () => {
    const w = twoRooms();
    const c = createCharacter(new Vector3(0, 0, -3.75), 0);
    settle(w, c);
    simulate(w, c, { y: 1 }, 0.3);
    const eye = eyePosition(c);
    expect(eye.x).toBeGreaterThan(490);
    expect(eye.y).toBeCloseTo(3 + CHAR.eye, 1);
  });

  it('raycasts follow the portal into the other room', () => {
    const w = twoRooms();
    const hit = w.raycast(new Vector3(0, 1.5, 0), new Vector3(0, 0, -1), 50);
    expect(hit.segments).toHaveLength(2);
    expect(hit.segments[0].portal?.id).toBe('a');
    // After the portal the ray travels -X inside room B and hits its far (west) wall at x = 496.2.
    expect(hit.point.x).toBeCloseTo(496.2, 3);
    expect(hit.distance).toBeCloseTo(4 + 504 - 496.2, 3);
  });
});
