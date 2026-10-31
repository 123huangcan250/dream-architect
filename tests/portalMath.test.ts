import { describe, expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera, Plane, Vector3, Vector4 } from 'three';
import {
  makeObliqueProjection,
  portalCorners,
  portalNormal,
  portalTransform,
  rayPortal,
  segmentCrossesPortal,
  signedDistance,
  transformYaw,
} from '../src/core/portalMath';
import type { PortalDef } from '../src/core/types';
import { angleDiff } from './helpers';

const A: PortalDef = { id: 'a', pos: [0, 0, 0], yaw: 0, width: 2, height: 3, link: 'b' };
const B: PortalDef = { id: 'b', pos: [100, 5, -40], yaw: Math.PI / 2, width: 2, height: 3, link: 'a' };

describe('portal transform', () => {
  it('maps the centre of A onto the centre of B', () => {
    const m = portalTransform(A, B);
    const c = new Vector3(0, 1.5, 0).applyMatrix4(m);
    expect(c.distanceTo(new Vector3(100, 6.5, -40))).toBeLessThan(1e-9);
  });

  it('turns "entering A" into "leaving B"', () => {
    const m = portalTransform(A, B);
    const into = portalNormal(A).negate().transformDirection(m);
    expect(into.distanceTo(portalNormal(B))).toBeLessThan(1e-9);
  });

  it('maps space behind A to space in front of B (and vice versa)', () => {
    const m = portalTransform(A, B);
    expect(signedDistance(B, new Vector3(0.3, 1, -0.5).applyMatrix4(m))).toBeCloseTo(0.5, 9);
    expect(signedDistance(B, new Vector3(0.3, 1, 2).applyMatrix4(m))).toBeCloseTo(-2, 9);
  });

  it('a round trip through a linked pair is the identity', () => {
    const m = portalTransform(B, A).multiply(portalTransform(A, B));
    expect(m.equals(new Matrix4()) || m.elements.every((v, i) => Math.abs(v - new Matrix4().elements[i]) < 1e-9)).toBe(true);
  });

  it('extracts the yaw delta of the transform', () => {
    const m = portalTransform(A, B);
    expect(angleDiff(transformYaw(m), B.yaw + Math.PI - A.yaw)).toBeLessThan(1e-9);
  });

  it('a Penrose-style vertical offset portal is a pure translation', () => {
    const top: PortalDef = { id: 't', pos: [3, 8, 12.5], yaw: Math.PI / 2, width: 3, height: 3.2, link: 'b' };
    const bot: PortalDef = { id: 'b', pos: [3, 0, 12.5], yaw: -Math.PI / 2, width: 3, height: 3.2, link: 't' };
    const m = portalTransform(top, bot);
    expect(angleDiff(transformYaw(m), 0)).toBeLessThan(1e-9);
    expect(new Vector3(7, 9, 1).applyMatrix4(m).distanceTo(new Vector3(7, 1, 1))).toBeLessThan(1e-9);
  });
});

describe('crossing detection', () => {
  it('detects a front-to-back crossing inside the rectangle', () => {
    const c = segmentCrossesPortal(A, new Vector3(0.5, 0, 0.2), new Vector3(0.5, 0, -0.1), 1);
    expect(c).not.toBeNull();
    expect(c!.t).toBeCloseTo(2 / 3, 6);
  });
  it('ignores crossings outside the width, above the top or from behind', () => {
    expect(segmentCrossesPortal(A, new Vector3(1.2, 0, 0.2), new Vector3(1.2, 0, -0.1), 1)).toBeNull();
    expect(segmentCrossesPortal(A, new Vector3(0, 4, 0.2), new Vector3(0, 4, -0.1), 1)).toBeNull();
    expect(segmentCrossesPortal(A, new Vector3(0, 0, -0.2), new Vector3(0, 0, 0.1), 1)).toBeNull();
  });
  it('ray hits only the front face inside the rectangle', () => {
    expect(rayPortal(A, new Vector3(0, 1, 5), new Vector3(0, 0, -1), 10)).toBeCloseTo(5, 9);
    expect(rayPortal(A, new Vector3(0, 1, -5), new Vector3(0, 0, 1), 10)).toBeNull();
    expect(rayPortal(A, new Vector3(3, 1, 5), new Vector3(0, 0, -1), 10)).toBeNull();
  });
  it('corners are ordered and sized', () => {
    const c = portalCorners(B);
    expect(c[0].distanceTo(c[1])).toBeCloseTo(2, 9);
    expect(c[1].distanceTo(c[2])).toBeCloseTo(3, 9);
  });
});

describe('oblique near-plane clipping', () => {
  const cam = new PerspectiveCamera(75, 1.5, 0.05, 1000);
  cam.updateMatrixWorld();
  const view = cam.matrixWorldInverse;
  // Keep only what lies beyond z = -5 (a portal plane 5 m ahead).
  const plane = new Plane(new Vector3(0, 0, -1), -5);
  const proj = makeObliqueProjection(cam.projectionMatrix, view, plane);
  const clipZ = (p: Vector3) => {
    const v = new Vector4(p.x, p.y, p.z, 1).applyMatrix4(view).applyMatrix4(proj);
    return { z: v.z, w: v.w };
  };

  it('keeps points beyond the portal plane inside the depth range', () => {
    for (const z of [-5.01, -10, -200]) {
      const { z: cz, w } = clipZ(new Vector3(0.3, -0.2, z));
      expect(cz).toBeGreaterThanOrEqual(-w);
      expect(cz).toBeLessThanOrEqual(w);
    }
  });
  it('clips points between the camera and the portal plane', () => {
    for (const z of [-0.5, -2, -4.9]) {
      const { z: cz, w } = clipZ(new Vector3(0.1, 0.1, z));
      expect(cz).toBeLessThan(-w);
    }
  });
  it('leaves x/y projection untouched (screen rects stay valid)', () => {
    const e = proj.elements, o = cam.projectionMatrix.elements;
    for (const i of [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15]) expect(e[i]).toBe(o[i]);
  });
  it('falls back to the normal projection when the camera is in front of the plane', () => {
    const p = makeObliqueProjection(cam.projectionMatrix, view, new Plane(new Vector3(0, 0, 1), 5));
    expect(p.equals(cam.projectionMatrix)).toBe(true);
  });
});
