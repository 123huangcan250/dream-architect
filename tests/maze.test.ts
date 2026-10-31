import { describe, expect, it } from 'vitest';
import { buildMazeLevel, cellCenter, generateMaze, gridDistance, idx, isOpen, mazeHeuristic, mazeNeighbors, openDirs, solveMaze, stepCell, type Dir, type Maze } from '../src/gen/maze';
import { astar, bfsDistances } from '../src/gen/pathfinding';
import { validateLevel } from '../src/core/level';
import { char, makeWorld, settle, simulate } from './helpers';

/** Mechanic: procedural maze generation (torus + wormholes) and path planning through portals. */
function edgeCount(m: Maze): number {
  return m.east.filter(Boolean).length + m.south.filter(Boolean).length;
}

describe('maze generation', () => {
  it('a perfect maze is a spanning tree', () => {
    for (const seed of [1, 2, 3, 99]) {
      const m = generateMaze(10, 8, seed, { braid: 0, wormholes: 0, wrap: false });
      expect(edgeCount(m)).toBe(10 * 8 - 1);
      expect(bfsDistances(0, (n) => mazeNeighbors(m, n)).size).toBe(80);
    }
  });

  it('braiding adds loops', () => {
    const m = generateMaze(10, 10, 5, { braid: 1, wormholes: 0 });
    expect(edgeCount(m)).toBeGreaterThan(99);
  });

  it('torus mazes use passages across the seams', () => {
    let wraps = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const m = generateMaze(8, 8, seed, { wrap: true, braid: 0, wormholes: 0 });
      for (let y = 0; y < 8; y++) if (m.east[idx(m, 7, y)]) wraps++;
      for (let x = 0; x < 8; x++) if (m.south[idx(m, x, 7)]) wraps++;
    }
    expect(wraps).toBeGreaterThan(0);
  });

  it('is deterministic per seed', () => {
    expect(generateMaze(9, 9, 1234)).toEqual(generateMaze(9, 9, 1234));
    expect(generateMaze(9, 9, 1234)).not.toEqual(generateMaze(9, 9, 1235));
  });

  it('wormholes join two dead ends through their back walls', () => {
    const m = generateMaze(10, 10, 77, { wormholes: 3, braid: 0 });
    expect(m.wormholes.length).toBe(3);
    for (const w of m.wormholes) {
      expect(openDirs(m, w.a)).toHaveLength(1);
      expect(isOpen(m, w.a, w.aDir)).toBe(false);
      expect(mazeNeighbors(m, w.a).some((e) => e.to === w.b)).toBe(true);
    }
  });
});

describe('path planning', () => {
  const m = generateMaze(12, 12, 4242, { wormholes: 3, braid: 0.3, wrap: true });
  const dist0 = bfsDistances(0, (n) => mazeNeighbors(m, n));

  it('A* finds optimal paths (matches BFS) through seams and wormholes', () => {
    for (const goal of [5, 37, 80, 143, 100, 66]) {
      const p = solveMaze(m, 0, goal)!;
      expect(p[0]).toBe(0);
      expect(p[p.length - 1]).toBe(goal);
      expect(p.length - 1).toBe(dist0.get(goal));
      for (let i = 1; i < p.length; i++) expect(mazeNeighbors(m, p[i - 1]).some((e) => e.to === p[i])).toBe(true);
    }
  });

  it('the heuristic is admissible everywhere', () => {
    const goal = 100;
    const h = mazeHeuristic(m, goal);
    const d = bfsDistances(goal, (n) => mazeNeighbors(m, n));
    for (const [n, dd] of d) expect(h(n)).toBeLessThanOrEqual(dd);
  });

  it('torus grid distance wraps around', () => {
    expect(gridDistance(m, idx(m, 0, 0), idx(m, 11, 0))).toBe(1);
    expect(stepCell(m, idx(m, 0, 0), 3 as Dir)).toBe(idx(m, 11, 0));
  });

  it('A* explores fewer nodes than plain Dijkstra on open grids', () => {
    let a = 0, d = 0;
    const nb = (n: number) => {
      const x = n % 30, y = Math.floor(n / 30);
      return [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => x + dx >= 0 && x + dx < 30 && y + dy >= 0 && y + dy < 30).map(([dx, dy]) => ({ to: n + dx + dy * 30, cost: 1 }));
    };
    astar(0, 30 * 30 - 1, (n) => (a++, nb(n)), (n) => 29 - (n % 30) + 29 - Math.floor(n / 30));
    astar(0, 30 * 30 - 1, (n) => (d++, nb(n)), () => 0);
    expect(a).toBeLessThan(d);
  });
});

describe('maze level', () => {
  const level = buildMazeLevel(8, 8, 31337, { wrap: true, wormholes: 2 });

  it('validates without errors and places the goal at the farthest cell', () => {
    const r = validateLevel(level);
    expect(r.errors).toEqual([]);
    const maze = level.meta!.maze as Maze;
    const goal = level.meta!.goal as number;
    const d = bfsDistances(0, (n) => mazeNeighbors(maze, n));
    expect(d.get(goal)).toBe(Math.max(...d.values()));
  });

  it('walking off an open seam re-enters from the opposite edge', () => {
    const maze = level.meta!.maze as Maze;
    const w = makeWorld(level);
    // Find an open east seam.
    const y = [...Array(8).keys()].find((yy) => maze.east[idx(maze, 7, yy)]);
    expect(y).toBeDefined();
    if (y === undefined) return;
    const [cx, cz] = cellCenter(maze, idx(maze, 7, y));
    const c = char(cx, 0, cz, -Math.PI / 2); // facing +X
    settle(w, c);
    const ev = simulate(w, c, { y: 1 }, 1.2);
    expect(ev.map((e) => e.portal.id)).toEqual([`wrapE_${y}`]);
    expect(c.pos.x).toBeLessThan(4); // now in column 0
  });
});
