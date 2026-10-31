import { describe, expect, it } from 'vitest';
import { applyAction, buildPuzzleLevel, generatePuzzle, initialState, slotTarget, solvePuzzle, type PuzzleAction, type PuzzleSpec, type PuzzleState } from '../src/gen/puzzle';
import { validateLevel } from '../src/core/level';
import { TopologySystem } from '../src/core/topology';
import { makeWorld } from './helpers';

/** Mechanic: generated paradox puzzles (generator + solver + level realisation). */
describe('paradox puzzle generator', () => {
  const cases: [number, number][] = [];
  for (let d = 1; d <= 3; d++) for (let s = 1; s <= 12; s++) cases.push([s * 7919 + d, d]);

  it.each(cases)('seed %i (difficulty %i) is solvable and requires bending space', (seed, diff) => {
    const p = generatePuzzle(seed, diff);
    const sol = solvePuzzle(p);
    expect(sol).not.toBeNull();
    expect(sol!.length).toBeGreaterThanOrEqual(4 + diff * 3);
    expect(sol!.some((a) => a.type === 'lever')).toBe(true);
    expect(solvePuzzle(p, initialState(p), false)).toBeNull();
    // Replaying the solution reaches the exit.
    let s = initialState(p);
    for (const a of sol!) s = applyAction(p, s, a)!;
    expect(s.room).toBe(p.exitRoom);
  });

  it('is deterministic per seed', () => {
    expect(generatePuzzle(42, 2)).toEqual(generatePuzzle(42, 2));
  });

  it('produces genuinely non-Euclidean links (one-way doors exist)', () => {
    let oneWay = 0;
    for (let s = 1; s <= 10; s++) {
      const p = generatePuzzle(s, 2);
      for (let slot = 0; slot < p.rooms * 4; slot++) {
        const t = p.base[slot];
        if (t != null && p.base[t] !== slot) oneWay++;
      }
    }
    expect(oneWay).toBeGreaterThan(10);
  });

  it('BFS returns a shortest solution (no shorter one exists by exhaustive search)', () => {
    const p = generatePuzzle(7, 1);
    const sol = solvePuzzle(p)!;
    const acts = (room: number): PuzzleAction[] => [
      ...[0, 1, 2, 3].map((d) => ({ type: 'door' as const, slot: room * 4 + d })),
      ...p.levers.map((_, i) => ({ type: 'lever' as const, lever: i })),
    ];
    const dfs = (s: PuzzleState, depth: number): boolean => {
      if (applyAction(p, s, { type: 'exit' })) return true;
      if (depth === 0) return false;
      return acts(s.room).some((a) => {
        const n = applyAction(p, s, a);
        return n ? dfs(n, depth - 1) : false;
      });
    };
    expect(dfs(initialState(p), sol.length - 1)).toBe(true); // sol.length-1 moves + exit
    expect(dfs(initialState(p), sol.length - 2)).toBe(false);
  });
});

describe('puzzle level realisation', () => {
  it('builds a valid level whose portals mirror the abstract topology', () => {
    const spec = generatePuzzle(2024, 2);
    const level = buildPuzzleLevel(spec);
    expect(validateLevel(level).errors).toEqual([]);
    const w = makeWorld(level);
    for (let slot = 0; slot < spec.rooms * 4; slot++) {
      const p = w.portals.get(`p${Math.floor(slot / 4)}_${slot % 4}`);
      const t = slotTarget(spec, slot, 0);
      if (!p) {
        expect(t).toBeNull();
        continue;
      }
      expect(p.def.link).toBe(t == null ? null : `p${Math.floor(t / 4)}_${t % 4}`);
    }
  });

  it('pulling a lever rewires the 3D portals exactly as the solver assumes', () => {
    const spec: PuzzleSpec = generatePuzzle(99, 3);
    const w = makeWorld(buildPuzzleLevel(spec));
    const topo = new TopologySystem(w, w.level.rules, { isObserved: () => false, isStraddling: () => false });
    let mask = 0;
    spec.levers.forEach((_, i) => {
      topo.lever(`lever${i}`, true);
      mask |= 1 << i;
      for (let slot = 0; slot < spec.rooms * 4; slot++) {
        const p = w.portals.get(`p${Math.floor(slot / 4)}_${slot % 4}`);
        if (!p) continue;
        const t = slotTarget(spec, slot, mask);
        expect(p.def.link).toBe(t == null ? null : `p${Math.floor(t / 4)}_${t % 4}`);
      }
    });
  });

  it('collecting every shard opens the exit gate', () => {
    const spec = generatePuzzle(5, 1);
    const w = makeWorld(buildPuzzleLevel(spec));
    const topo = new TopologySystem(w, w.level.rules, { isObserved: () => false, isStraddling: () => false });
    topo.setShards(spec.shards.length - 1);
    expect(w.portals.get('gate')!.def.link).toBeNull();
    topo.setShards(spec.shards.length);
    expect(w.portals.get('gate')!.def.link).toBe('vic_in');
  });
});
