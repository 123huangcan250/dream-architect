import { LevelBuilder } from './builder';
import { astar, bfsDistances, type Edge } from './pathfinding';
import { Rng } from '../core/rng';
import type { LevelData } from '../core/types';

export type Dir = 0 | 1 | 2 | 3; // 0 = north (-z), 1 = east (+x), 2 = south (+z), 3 = west (-x)
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const OPP: Dir[] = [2, 3, 0, 1];

export interface Wormhole {
  a: number;
  aDir: Dir;
  b: number;
  bDir: Dir;
}

export interface Maze {
  w: number;
  h: number;
  wrap: boolean;
  seed: number;
  /** east[i]: passage between cell i and its east neighbour (wrapping on a torus). */
  east: boolean[];
  /** south[i]: passage between cell i and its south neighbour. */
  south: boolean[];
  wormholes: Wormhole[];
}

export interface MazeOptions {
  wrap?: boolean;
  /** Fraction of dead ends to braid away (adds loops). */
  braid?: number;
  wormholes?: number;
}

export const idx = (m: Pick<Maze, 'w'>, x: number, y: number) => y * m.w + x;
export const cellXY = (m: Pick<Maze, 'w'>, i: number): [number, number] => [i % m.w, Math.floor(i / m.w)];

/** Neighbour across direction d, or -1 if outside a non-wrapping maze. */
export function stepCell(m: Pick<Maze, 'w' | 'h' | 'wrap'>, i: number, d: Dir): number {
  let [x, y] = cellXY(m, i);
  x += DX[d];
  y += DY[d];
  if (m.wrap) {
    x = (x + m.w) % m.w;
    y = (y + m.h) % m.h;
  } else if (x < 0 || y < 0 || x >= m.w || y >= m.h) return -1;
  return idx(m, x, y);
}

export function isOpen(m: Maze, i: number, d: Dir): boolean {
  const n = stepCell(m, i, d);
  if (n < 0) return false;
  switch (d) {
    case 1: return m.east[i];
    case 2: return m.south[i];
    case 3: return m.east[n];
    default: return m.south[n];
  }
}

function setOpen(m: Maze, i: number, d: Dir): void {
  const n = stepCell(m, i, d);
  if (n < 0) return;
  if (d === 1) m.east[i] = true;
  else if (d === 2) m.south[i] = true;
  else if (d === 3) m.east[n] = true;
  else m.south[n] = true;
}

export function openDirs(m: Maze, i: number): Dir[] {
  return ([0, 1, 2, 3] as Dir[]).filter((d) => isOpen(m, i, d));
}

/** Graph neighbours including wormhole jumps. */
export function mazeNeighbors(m: Maze, i: number): Edge[] {
  const out: Edge[] = [];
  for (const d of [0, 1, 2, 3] as Dir[]) if (isOpen(m, i, d)) out.push({ to: stepCell(m, i, d), cost: 1 });
  for (const wh of m.wormholes) {
    if (wh.a === i) out.push({ to: wh.b, cost: 1 });
    if (wh.b === i) out.push({ to: wh.a, cost: 1 });
  }
  return out;
}

/** Shortest steps between two cells ignoring walls (torus-aware). */
export function gridDistance(m: Pick<Maze, 'w' | 'h' | 'wrap'>, a: number, b: number): number {
  const [ax, ay] = cellXY(m, a);
  const [bx, by] = cellXY(m, b);
  let dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  if (m.wrap) {
    dx = Math.min(dx, m.w - dx);
    dy = Math.min(dy, m.h - dy);
  }
  return dx + dy;
}

/** Admissible heuristic that accounts for wormhole shortcuts. */
export function mazeHeuristic(m: Maze, goal: number): (n: number) => number {
  const ends = m.wormholes.flatMap((w) => [w.a, w.b]);
  const exitToGoal = ends.length ? Math.min(...ends.map((e) => gridDistance(m, e, goal))) : Infinity;
  return (n) => {
    const direct = gridDistance(m, n, goal);
    if (!ends.length) return direct;
    const viaHole = Math.min(...ends.map((e) => gridDistance(m, n, e))) + 1 + exitToGoal;
    return Math.min(direct, viaHole);
  };
}

export function solveMaze(m: Maze, from: number, to: number): number[] | null {
  return astar(from, to, (n) => mazeNeighbors(m, n), mazeHeuristic(m, to));
}

/** Recursive-backtracker maze (optionally on a torus), braided and threaded with wormholes. */
export function generateMaze(w: number, h: number, seed: number, opts: MazeOptions = {}): Maze {
  const rng = new Rng(seed);
  const m: Maze = { w, h, wrap: opts.wrap ?? true, seed, east: Array(w * h).fill(false), south: Array(w * h).fill(false), wormholes: [] };
  const seen = new Array(w * h).fill(false);
  const stack = [0];
  seen[0] = true;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const dirs = rng.shuffle([0, 1, 2, 3] as Dir[]).filter((d) => {
      const n = stepCell(m, cur, d);
      return n >= 0 && !seen[n];
    });
    if (!dirs.length) {
      stack.pop();
      continue;
    }
    const d = dirs[0];
    const n = stepCell(m, cur, d);
    setOpen(m, cur, d);
    seen[n] = true;
    stack.push(n);
  }
  // Braid: knock out a wall in some dead ends to create loops.
  const braid = opts.braid ?? 0.25;
  for (let i = 0; i < w * h; i++) {
    if (openDirs(m, i).length !== 1 || !rng.chance(braid)) continue;
    const closed = ([0, 1, 2, 3] as Dir[]).filter((d) => !isOpen(m, i, d) && stepCell(m, i, d) >= 0);
    if (closed.length) setOpen(m, i, rng.pick(closed));
  }
  // Wormholes between distant dead ends, through the wall opposite the opening.
  const deadEnds = rng.shuffle([...Array(w * h).keys()].filter((i) => i !== 0 && openDirs(m, i).length === 1));
  const used = new Set<number>();
  for (let k = 0; k < (opts.wormholes ?? 2); k++) {
    const a = deadEnds.find((i) => !used.has(i));
    if (a === undefined) break;
    used.add(a);
    const b = deadEnds.filter((i) => !used.has(i)).sort((p, q) => gridDistance(m, a, q) - gridDistance(m, a, p))[0];
    if (b === undefined) break;
    used.add(b);
    m.wormholes.push({ a, aDir: OPP[openDirs(m, a)[0]], b, bDir: OPP[openDirs(m, b)[0]] });
  }
  return m;
}

export interface MazeLayout {
  origin: [number, number];
  cell: number;
  wall: number;
}

export const MAZE_LAYOUT: MazeLayout = { origin: [0, 0], cell: 4, wall: 3.2 };

export function cellCenter(m: Maze, i: number, L = MAZE_LAYOUT): [number, number] {
  const [x, y] = cellXY(m, i);
  return [L.origin[0] + (x + 0.5) * L.cell, L.origin[1] + (y + 0.5) * L.cell];
}

export function cellAt(m: Maze, wx: number, wz: number, L = MAZE_LAYOUT): number {
  const x = Math.floor((wx - L.origin[0]) / L.cell);
  const y = Math.floor((wz - L.origin[1]) / L.cell);
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return -1;
  return idx(m, x, y);
}

const DIR_YAW = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // portal facing into a cell from its wall d

/** Turns a maze into a playable level: torus edges and wormholes become seamless portals. */
export function buildMazeLevel(w: number, h: number, seed: number, opts: MazeOptions = {}): LevelData {
  const m = generateMaze(w, h, seed, opts);
  const L = MAZE_LAYOUT;
  const C = L.cell, T = 0.4, WH = L.wall;
  const b = new LevelBuilder(`迷梦回廊 #${seed}`, { pos: [C / 2, 0, C / 2], yaw: 0 }, {
    skyTop: '#0b1033',
    skyBottom: '#5a4a8f',
    fogColor: '#3e3670',
    fogDensity: 0.03,
    stars: 1,
  });
  const X = (x: number) => L.origin[0] + x * C;
  const Z = (y: number) => L.origin[1] + y * C;
  b.box([X(0) - 1, -0.5, Z(0) - 1], [X(w) + 1, 0, Z(h) + 1], 'tile');
  for (let x = 0; x <= w; x++) for (let y = 0; y <= h; y++) b.box([X(x) - T / 2, 0, Z(y) - T / 2], [X(x) + T / 2, WH + 0.3, Z(y) + T / 2], 'marble');
  const wallX = (x: number, y: number) => b.box([X(x) - T / 2, 0, Z(y) + T / 2], [X(x) + T / 2, WH, Z(y + 1) - T / 2], 'hedge');
  const wallZ = (x: number, y: number) => b.box([X(x) + T / 2, 0, Z(y) - T / 2], [X(x + 1) - T / 2, WH, Z(y) + T / 2], 'hedge');
  const pw = C - T;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(m, x, y);
      // East edge (interior or the wrap seam).
      if (x < w - 1) {
        if (!m.east[i]) wallX(x + 1, y);
      } else if (m.wrap && m.east[i]) {
        const cz = Z(y) + C / 2;
        b.portal({ pos: [X(w), 0, cz], yaw: DIR_YAW[1], width: pw, height: WH }, `wrapE_${y}`);
        b.portal({ pos: [X(0), 0, cz], yaw: DIR_YAW[3], width: pw, height: WH }, `wrapW_${y}`);
        b.pair(`wrapE_${y}`, `wrapW_${y}`);
      } else {
        wallX(w, y);
        wallX(0, y);
      }
      if (y < h - 1) {
        if (!m.south[i]) wallZ(x, y + 1);
      } else if (m.wrap && m.south[i]) {
        const cx = X(x) + C / 2;
        b.portal({ pos: [cx, 0, Z(h)], yaw: DIR_YAW[2], width: pw, height: WH }, `wrapS_${x}`);
        b.portal({ pos: [cx, 0, Z(0)], yaw: DIR_YAW[0], width: pw, height: WH }, `wrapN_${x}`);
        b.pair(`wrapS_${x}`, `wrapN_${x}`);
      } else {
        wallZ(x, h);
        wallZ(x, 0);
      }
    }
  }
  // Wormholes: a portal on the wall face opposite each dead end's opening.
  m.wormholes.forEach((wh, k) => {
    const place = (cell: number, d: Dir, id: string) => {
      const [cx, cz] = cellCenter(m, cell);
      const off = C / 2 - T / 2 - 0.001;
      const px = cx + DX[d] * off;
      const pz = cz + DY[d] * off;
      b.portal({ pos: [px, 0, pz], yaw: DIR_YAW[d], width: pw, height: WH }, id, { frame: 'glow', color: '#b48cff' });
    };
    place(wh.a, wh.aDir, `worm${k}_a`);
    place(wh.b, wh.bDir, `worm${k}_b`);
    b.pair(`worm${k}_a`, `worm${k}_b`);
  });
  // Goal: the cell farthest from the start (through portals).
  const dist = bfsDistances(0, (n) => mazeNeighbors(m, n));
  let goal = 0;
  for (const [c, d] of dist) if (d > (dist.get(goal) ?? 0)) goal = c;
  const [gx, gz] = cellCenter(m, goal);
  b.prop({ id: 'goal', type: 'goal', pos: [gx, 1.2, gz], radius: 1.2 });
  b.light([gx, 2.2, gz], '#ffd27a', 2.5);
  const rng = new Rng(seed ^ 0x55);
  for (let k = 0; k < (w * h) / 6; k++) {
    const c = rng.int(0, w * h - 1);
    const [lx, lz] = cellCenter(m, c);
    b.light([lx, WH + 0.8, lz], rng.pick(['#8fd3ff', '#ffb3e6', '#c9b8ff']), 0.8);
  }
  b.rule({ trigger: { type: 'start' }, once: true, actions: [{ type: 'message', text: '找到金色的光。迷宫的边缘连着另一侧的边缘——按 G 显示路径。' }] });
  return b.build({ kind: 'maze', maze: m, layout: L, goal, shortest: dist.get(goal) });
}
