import { Vector3 } from 'three';
import { transformYaw } from './portalMath';
import { World, type RtPortal, type Solid } from './World';

export const CHAR = {
  radius: 0.3,
  height: 1.8,
  eye: 1.62,
  stepHeight: 0.45,
  gravity: 18,
  jumpSpeed: 6.2,
  walkSpeed: 4.2,
  runSpeed: 7.0,
  groundAccel: 45,
  airAccel: 8,
  maxSubstep: 0.12,
};

export interface CharacterState {
  pos: Vector3; // feet
  vel: Vector3;
  yaw: number;
  pitch: number;
  onGround: boolean;
  /** Visual-only eye offset used to smooth stair steps (decays to 0). */
  eyeSmooth: number;
  /** Accumulated height gained through portals (for the altimeter). */
  portalLift: number;
}

export interface MoveInput {
  /** x = strafe right, y = forward; length <= 1 */
  x: number;
  y: number;
  jump: boolean;
  run: boolean;
}

export interface CrossEvent {
  portal: RtPortal;
  backward: boolean;
}

export interface CrossHooks {
  /** Called right before the transform is applied; may relink the portal. */
  beforeCross?(p: RtPortal, backward: boolean): void;
}

export function createCharacter(pos: Vector3, yaw = 0): CharacterState {
  return { pos: pos.clone(), vel: new Vector3(), yaw, pitch: 0, onGround: false, eyeSmooth: 0, portalLift: 0 };
}

export function forwardOf(yaw: number, out = new Vector3()): Vector3 {
  return out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}

export function eyePosition(c: CharacterState, out = new Vector3()): Vector3 {
  return out.set(c.pos.x, c.pos.y + CHAR.eye + c.eyeSmooth, c.pos.z);
}

function bodyQuery(c: CharacterState, lowerY: number) {
  return { pos: c.pos, radius: CHAR.radius, yMin: lowerY, yMax: c.pos.y + CHAR.height };
}

/** Pushes the body circle out of blocking solids. Returns true if any contact happened. */
export function resolveHorizontal(world: World, c: CharacterState, ignore?: Solid): boolean {
  let touched = false;
  const r = CHAR.radius;
  for (let iter = 0; iter < 4; iter++) {
    const stepTop = c.pos.y + CHAR.stepHeight;
    const solids = world.bodySolids(bodyQuery(c, c.pos.y + 0.02));
    let pushX = 0, pushZ = 0, best = 0;
    for (const s of solids) {
      if (s === ignore) continue;
      if (s.min.y >= c.pos.y + CHAR.height - 0.01) continue;
      const qx = Math.max(s.min.x, Math.min(c.pos.x, s.max.x));
      const qz = Math.max(s.min.z, Math.min(c.pos.z, s.max.z));
      const top = World.surfaceAt(s, qx, qz);
      if (top <= stepTop) continue;
      let dx = c.pos.x - qx;
      let dz = c.pos.z - qz;
      const d2 = dx * dx + dz * dz;
      let pen: number;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        if (d >= r) continue;
        pen = r - d;
        dx /= d; dz /= d;
      } else {
        // Centre inside the box: push out along the shallowest axis.
        const ox = [c.pos.x - s.min.x, s.max.x - c.pos.x];
        const oz = [c.pos.z - s.min.z, s.max.z - c.pos.z];
        const m = Math.min(ox[0], ox[1], oz[0], oz[1]);
        dx = m === ox[0] ? -1 : m === ox[1] ? 1 : 0;
        dz = dx !== 0 ? 0 : m === oz[0] ? -1 : 1;
        pen = m + r;
      }
      if (pen > best) {
        best = pen;
        pushX = dx * pen;
        pushZ = dz * pen;
      }
    }
    if (best <= 1e-6) break;
    touched = true;
    c.pos.x += pushX;
    c.pos.z += pushZ;
    const len = Math.hypot(pushX, pushZ);
    const nx = pushX / len, nz = pushZ / len;
    const vn = c.vel.x * nx + c.vel.z * nz;
    if (vn < 0) {
      c.vel.x -= vn * nx;
      c.vel.z -= vn * nz;
    }
  }
  return touched;
}

/** Highest ground under the body footprint (centre + 4 samples), portal-aware. */
export function sampleGround(world: World, c: CharacterState, maxY: number, ignore?: Solid): number {
  const q = bodyQuery(c, c.pos.y - 2);
  const k = CHAR.radius * 0.7;
  let best = -Infinity;
  const offs = [[0, 0], [k, 0], [-k, 0], [0, k], [0, -k]];
  for (const [ox, oz] of offs) {
    const h = world.groundAtThroughPortals(c.pos.x + ox, c.pos.z + oz, maxY, q, ignore);
    if (h > best) best = h;
  }
  return best;
}

function ceilingAbove(world: World, c: CharacterState): number {
  const solids = world.bodySolids(bodyQuery(c, c.pos.y + CHAR.stepHeight));
  let lowest = Infinity;
  const r = CHAR.radius * 0.8;
  for (const s of solids) {
    if (s.min.y <= c.pos.y + CHAR.stepHeight) continue;
    if (c.pos.x + r < s.min.x || c.pos.x - r > s.max.x || c.pos.z + r < s.min.z || c.pos.z - r > s.max.z) continue;
    lowest = Math.min(lowest, s.min.y);
  }
  return lowest;
}

/** Applies a portal transform to the character. */
export function teleportCharacter(world: World, c: CharacterState, p: RtPortal): void {
  const m = world.transformOf(p);
  if (!m) return;
  const oldY = c.pos.y;
  c.pos.applyMatrix4(m);
  const speed = c.vel.length();
  if (speed > 1e-9) c.vel.transformDirection(m).multiplyScalar(speed);
  c.yaw += transformYaw(m);
  c.portalLift += oldY - c.pos.y;
}

/**
 * Advances the character by dt. Handles acceleration, collisions (portal-aware), stairs,
 * gravity and portal traversal. Returns the portals crossed this step.
 */
export function stepCharacter(world: World, c: CharacterState, input: MoveInput, dt: number, hooks: CrossHooks = {}, ignore?: Solid): CrossEvent[] {
  const events: CrossEvent[] = [];
  dt = Math.min(dt, 0.1);
  // Desired horizontal velocity.
  const fwd = forwardOf(c.yaw);
  const right = new Vector3(-fwd.z, 0, fwd.x);
  const wish = new Vector3().addScaledVector(fwd, input.y).addScaledVector(right, input.x);
  if (wish.lengthSq() > 1) wish.normalize();
  wish.multiplyScalar(input.run ? CHAR.runSpeed : CHAR.walkSpeed);
  const accel = c.onGround ? CHAR.groundAccel : CHAR.airAccel;
  const dvx = wish.x - c.vel.x;
  const dvz = wish.z - c.vel.z;
  const dl = Math.hypot(dvx, dvz);
  const maxDv = accel * dt;
  if (dl > maxDv) {
    c.vel.x += (dvx / dl) * maxDv;
    c.vel.z += (dvz / dl) * maxDv;
  } else {
    c.vel.x = wish.x;
    c.vel.z = wish.z;
  }
  if (input.jump && c.onGround) {
    c.vel.y = CHAR.jumpSpeed;
    c.onGround = false;
  }

  const travel = Math.hypot(c.vel.x, c.vel.z) * dt + Math.abs(c.vel.y) * dt;
  const steps = Math.max(1, Math.ceil(travel / CHAR.maxSubstep));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const prev = c.pos.clone();
    c.pos.x += c.vel.x * h;
    c.pos.z += c.vel.z * h;

    // Traverse first, then resolve collisions in whichever space the body ended up in:
    // resolving first would let geometry hidden behind the portal push the body back.
    const cross = world.findCrossing(prev, c.pos, 1.0);
    if (cross) {
      const travelDir = c.pos.clone().sub(prev).setY(0).normalize();
      const backward = forwardOf(c.yaw).dot(travelDir) < -0.25;
      hooks.beforeCross?.(cross.portal, backward);
      if (world.transformOf(cross.portal)) {
        teleportCharacter(world, c, cross.portal);
        events.push({ portal: cross.portal, backward });
      } else {
        c.pos.copy(prev); // portal closed under our feet: treat as a wall
      }
    }
    resolveHorizontal(world, c, ignore);

    // Vertical.
    const wasGround = c.onGround;
    c.vel.y -= CHAR.gravity * h;
    c.pos.y += c.vel.y * h;
    const canStep = c.vel.y <= 1.0;
    const maxY = c.pos.y + (canStep ? CHAR.stepHeight : 0.02);
    const ground = sampleGround(world, c, maxY, ignore);
    if (c.vel.y <= 0 && c.pos.y <= ground + 1e-4) {
      const lift = ground - c.pos.y;
      if (wasGround && lift > 0.02) c.eyeSmooth -= lift;
      c.pos.y = ground;
      c.vel.y = 0;
      c.onGround = true;
    } else if (wasGround && c.vel.y <= 0 && ground > -Infinity && c.pos.y - ground <= CHAR.stepHeight + 0.05) {
      // Stick to descending stairs.
      c.eyeSmooth += c.pos.y - ground;
      c.pos.y = ground;
      c.vel.y = 0;
      c.onGround = true;
    } else if (canStep && ground > c.pos.y && ground - c.pos.y <= CHAR.stepHeight) {
      c.pos.y = ground;
      c.vel.y = 0;
      c.onGround = true;
    } else {
      c.onGround = false;
    }
    if (c.vel.y > 0) {
      const ceil = ceilingAbove(world, c);
      if (c.pos.y + CHAR.height > ceil) {
        c.pos.y = ceil - CHAR.height;
        c.vel.y = 0;
      }
    }
  }
  // Decay visual step smoothing.
  c.eyeSmooth *= Math.exp(-dt * 14);
  if (Math.abs(c.eyeSmooth) < 1e-3) c.eyeSmooth = 0;
  c.eyeSmooth = Math.max(-0.6, Math.min(0.6, c.eyeSmooth));
  return events;
}
