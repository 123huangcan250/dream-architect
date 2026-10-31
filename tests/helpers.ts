import { Vector3 } from 'three';
import { CHAR, createCharacter, forwardOf, stepCharacter, type CharacterState, type CrossEvent, type CrossHooks, type MoveInput } from '../src/core/character';
import { TopologySystem } from '../src/core/topology';
import type { LevelData } from '../src/core/types';
import { World } from '../src/core/World';
import { cloneLevel } from '../src/core/level';

export const DT = 1 / 60;

export function simulate(world: World, c: CharacterState, input: Partial<MoveInput>, seconds: number, hooks: CrossHooks = {}, dt = DT): CrossEvent[] {
  const all: CrossEvent[] = [];
  const inp: MoveInput = { x: 0, y: 0, jump: false, run: false, ...input };
  for (let t = 0; t < seconds; t += dt) all.push(...stepCharacter(world, c, inp, dt, hooks));
  return all;
}

/** Lets the character fall onto the ground. */
export function settle(world: World, c: CharacterState): void {
  simulate(world, c, {}, 0.5);
}

/** Steers towards successive XZ waypoints (in whatever space the character currently is). */
export function followPath(world: World, c: CharacterState, points: [number, number][], hooks: CrossHooks = {}, maxSeconds = 60): CrossEvent[] {
  const events: CrossEvent[] = [];
  let i = 0;
  for (let t = 0; t < maxSeconds && i < points.length; t += DT) {
    const [tx, tz] = points[i];
    const dx = tx - c.pos.x, dz = tz - c.pos.z;
    if (Math.hypot(dx, dz) < 0.4) {
      i++;
      continue;
    }
    c.yaw = Math.atan2(-dx, -dz);
    events.push(...stepCharacter(world, c, { x: 0, y: 1, jump: false, run: false }, DT, hooks));
  }
  if (i < points.length) throw new Error(`stuck before waypoint ${i} at ${c.pos.toArray().map((v) => v.toFixed(2))}`);
  return events;
}

export function makeWorld(level: LevelData): World {
  return new World(cloneLevel(level));
}

export function topologyFor(world: World, c: CharacterState, observed = new Set<string>(), messages: string[] = []): TopologySystem {
  return new TopologySystem(world, world.level.rules, {
    isObserved: (id) => observed.has(id),
    isStraddling: (id) => world.straddled({ pos: c.pos, radius: CHAR.radius, yMin: c.pos.y, yMax: c.pos.y + CHAR.height }).some((p) => p.id === id),
    message: (m) => messages.push(m),
  });
}

export function char(x: number, y: number, z: number, yaw = 0): CharacterState {
  return createCharacter(new Vector3(x, y, z), yaw);
}

export function fwd(c: CharacterState): Vector3 {
  return forwardOf(c.yaw);
}

export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}
