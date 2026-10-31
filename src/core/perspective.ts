import { Vector3 } from 'three';
import { Rng } from './rng';

export interface BoxShape {
  center: Vector3;
  size: Vector3;
}

export interface Fragment {
  home: BoxShape;
  scattered: BoxShape;
  /** Scale factor along the ray from the viewpoint. */
  k: number;
}

/**
 * Anamorphic illusion: every piece is pushed along the ray from the viewpoint and scaled by
 * the same factor. Seen from the viewpoint, the scattered set projects exactly onto the target.
 */
export function scatterFragments(
  viewpoint: Vector3,
  targets: { min: Vector3; max: Vector3 }[],
  seed: number,
  pieceLength = 1.2,
): Fragment[] {
  const rng = new Rng(seed);
  const out: Fragment[] = [];
  for (const t of targets) {
    const size = t.max.clone().sub(t.min);
    const alongX = size.x >= size.z;
    const len = alongX ? size.x : size.z;
    const n = Math.max(1, Math.round(len / pieceLength));
    for (let i = 0; i < n; i++) {
      const pmin = t.min.clone();
      const pmax = t.max.clone();
      if (alongX) {
        pmin.x = t.min.x + (size.x * i) / n;
        pmax.x = t.min.x + (size.x * (i + 1)) / n;
      } else {
        pmin.z = t.min.z + (size.z * i) / n;
        pmax.z = t.min.z + (size.z * (i + 1)) / n;
      }
      const home: BoxShape = { center: pmin.clone().add(pmax).multiplyScalar(0.5), size: pmax.clone().sub(pmin) };
      // Alternate pieces nearer to and farther from the eye, never close to the true position.
      const k = rng.chance(0.5) ? rng.range(0.35, 0.75) : rng.range(1.35, 2.2);
      const scattered: BoxShape = {
        center: viewpoint.clone().add(home.center.clone().sub(viewpoint).multiplyScalar(k)),
        size: home.size.clone().multiplyScalar(k),
      };
      out.push({ home, scattered, k });
    }
  }
  return out;
}

/** Mean angle (radians) between where each fragment appears and where its target is, seen from `eye`. */
export function anamorphError(eye: Vector3, frags: Fragment[]): number {
  if (frags.length === 0) return 0;
  let sum = 0;
  const a = new Vector3();
  const b = new Vector3();
  for (const f of frags) {
    a.copy(f.scattered.center).sub(eye).normalize();
    b.copy(f.home.center).sub(eye).normalize();
    sum += Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
  }
  return sum / frags.length;
}

export interface AlignmentResult {
  error: number;
  facing: number;
  aligned: boolean;
  /** 0..1 progress hint for UI. */
  score: number;
}

export function evaluateAlignment(eye: Vector3, viewDir: Vector3, frags: Fragment[], maxErrorDeg = 1.6, maxFacingDeg = 28): AlignmentResult {
  const error = anamorphError(eye, frags);
  const centroid = new Vector3();
  for (const f of frags) centroid.add(f.home.center);
  centroid.multiplyScalar(1 / Math.max(1, frags.length));
  const toTarget = centroid.sub(eye).normalize();
  const facing = Math.acos(Math.max(-1, Math.min(1, toTarget.dot(viewDir.clone().normalize()))));
  const errDeg = (error * 180) / Math.PI;
  const facingDeg = (facing * 180) / Math.PI;
  const aligned = errDeg <= maxErrorDeg && facingDeg <= maxFacingDeg;
  const score = Math.max(0, 1 - errDeg / 25) * (facingDeg <= maxFacingDeg ? 1 : 0.4);
  return { error, facing, aligned, score };
}

/**
 * Forced perspective: keep an object's apparent (angular) size while sliding it along the view
 * ray until it touches the first surface at `surfaceDist`.
 */
export function forcedPerspective(
  angularSize: number,
  surfaceDist: number,
  minSize = 0.15,
  maxSize = 6,
  minDist = 0.6,
): { distance: number; size: number } {
  let d = surfaceDist / (1 + angularSize * 0.5);
  let s = angularSize * d;
  if (s > maxSize) {
    s = maxSize;
    d = Math.min(s / angularSize, surfaceDist - s * 0.5);
  } else if (s < minSize) {
    s = minSize;
    d = s / angularSize;
  }
  if (d < minDist) {
    d = minDist;
    s = Math.min(s, angularSize * d);
  }
  return { distance: d, size: s };
}
