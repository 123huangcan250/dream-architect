import { LevelBuilder, SIDE_YAW, type Side } from './builder';
import { Rng } from '../core/rng';
import type { LevelData, MaterialKey } from '../core/types';

/**
 * Paradox puzzles: rooms whose doors (4 slots each) lead to other doors. Links can be
 * one-way, self-referential and lever-dependent. A generator proposes random topologies and
 * a breadth-first solver accepts only those that are solvable *and* require bending space.
 */

export interface LeverSpec {
  room: number;
  /** slot -> [target when lever off, target when on] */
  affects: { slot: number; off: number | null; on: number | null }[];
}

export interface PuzzleSpec {
  rooms: number;
  /** Base target slot for every slot (index room*4+side), null = solid wall. */
  base: (number | null)[];
  levers: LeverSpec[];
  shards: number[];
  exitRoom: number;
  start: number;
  difficulty: number;
  seed: number;
  title: string;
}

export type PuzzleAction =
  | { type: 'door'; slot: number }
  | { type: 'lever'; lever: number }
  | { type: 'exit' };

export interface PuzzleState {
  room: number;
  levers: number; // bitmask
  shards: number; // bitmask of collected shard indices
}

export const SIDES: Side[] = ['n', 'e', 's', 'w'];
const allShards = (p: PuzzleSpec) => (1 << p.shards.length) - 1;

export function slotTarget(p: PuzzleSpec, slot: number, levers: number): number | null {
  for (let i = 0; i < p.levers.length; i++) {
    const a = p.levers[i].affects.find((x) => x.slot === slot);
    if (a) return levers & (1 << i) ? a.on : a.off;
  }
  return p.base[slot];
}

function collect(p: PuzzleSpec, room: number, shards: number): number {
  p.shards.forEach((r, i) => {
    if (r === room) shards |= 1 << i;
  });
  return shards;
}

export function initialState(p: PuzzleSpec): PuzzleState {
  return { room: p.start, levers: 0, shards: collect(p, p.start, 0) };
}

export function applyAction(p: PuzzleSpec, s: PuzzleState, a: PuzzleAction): PuzzleState | null {
  switch (a.type) {
    case 'door': {
      if (Math.floor(a.slot / 4) !== s.room) return null;
      const t = slotTarget(p, a.slot, s.levers);
      if (t == null) return null;
      const room = Math.floor(t / 4);
      return { room, levers: s.levers, shards: collect(p, room, s.shards) };
    }
    case 'lever':
      if (p.levers[a.lever]?.room !== s.room) return null;
      return { ...s, levers: s.levers ^ (1 << a.lever) };
    case 'exit':
      return s.room === p.exitRoom && s.shards === allShards(p) ? s : null;
  }
}

function actionsFor(p: PuzzleSpec, s: PuzzleState, allowLevers = true): PuzzleAction[] {
  const out: PuzzleAction[] = [];
  for (let d = 0; d < 4; d++) out.push({ type: 'door', slot: s.room * 4 + d });
  if (allowLevers) p.levers.forEach((l, i) => l.room === s.room && out.push({ type: 'lever', lever: i }));
  return out;
}

const key = (s: PuzzleState) => `${s.room}|${s.levers}|${s.shards}`;

/** Breadth-first search for the shortest action sequence that wins from `from`. */
export function solvePuzzle(p: PuzzleSpec, from: PuzzleState = initialState(p), allowLevers = true): PuzzleAction[] | null {
  const prev = new Map<string, { k: string; a: PuzzleAction } | null>([[key(from), null]]);
  const q: PuzzleState[] = [from];
  for (let i = 0; i < q.length; i++) {
    const s = q[i];
    if (applyAction(p, s, { type: 'exit' })) {
      const path: PuzzleAction[] = [{ type: 'exit' }];
      let k = key(s);
      for (let e = prev.get(k); e; e = prev.get(k)) {
        path.push(e.a);
        k = e.k;
      }
      return path.reverse();
    }
    for (const a of actionsFor(p, s, allowLevers)) {
      const n = applyAction(p, s, a);
      if (!n) continue;
      const nk = key(n);
      if (prev.has(nk)) continue;
      prev.set(nk, { k: key(s), a });
      q.push(n);
    }
  }
  return null;
}

const ROOM_NAMES = ['回声之室', '倒影之室', '未至之室', '遗忘之室', '双生之室', '静默之室', '回旋之室'];
const ADJ = ['不存在的', '折叠的', '倒置的', '迟到的', '自我吞噬的', '无穷小的'];
const NOUN = ['走廊', '房间', '门', '楼梯', '回忆', '方向'];

/** Generates a solvable paradox puzzle. Deterministic for a given seed. */
export function generatePuzzle(seed: number, difficulty = 1): PuzzleSpec {
  const rng = new Rng(seed);
  const minLen = 4 + difficulty * 3;
  let best: PuzzleSpec | null = null;
  for (let attempt = 0; attempt < 600; attempt++) {
    const rooms = Math.min(7, rng.int(3 + difficulty, 4 + difficulty));
    const base: (number | null)[] = Array(rooms * 4).fill(null);
    const active: number[] = [];
    for (let r = 0; r < rooms; r++) {
      const sides = rng.shuffle([0, 1, 2, 3]).slice(0, rng.int(2, 3));
      for (const d of sides) active.push(r * 4 + d);
    }
    for (const s of active) {
      const room = Math.floor(s / 4);
      const others = active.filter((t) => Math.floor(t / 4) !== room);
      // Occasionally a door leads back into its own room (a paradox loop).
      base[s] = rng.chance(0.08) ? rng.pick(active.filter((t) => Math.floor(t / 4) === room && t !== s).concat(others)) : rng.pick(others);
    }
    const leverCount = rng.int(1, Math.min(3, 1 + difficulty));
    const affected = new Set<number>();
    const levers: LeverSpec[] = [];
    for (let i = 0; i < leverCount; i++) {
      const choices = rng.shuffle(active.filter((s) => !affected.has(s))).slice(0, rng.int(1, 2));
      const affects = choices.map((slot) => {
        affected.add(slot);
        const room = Math.floor(slot / 4);
        return { slot, off: base[slot], on: rng.chance(0.15) ? null : rng.pick(active.filter((t) => Math.floor(t / 4) !== room && t !== base[slot])) };
      });
      levers.push({ room: rng.int(0, rooms - 1), affects });
    }
    const start = 0;
    const shardCount = rng.int(1, difficulty > 1 ? 3 : 2);
    const shards = Array.from({ length: shardCount }, () => rng.int(1, rooms - 1));
    const exitRoom = rng.int(1, rooms - 1);
    const spec: PuzzleSpec = { rooms, base, levers, shards, exitRoom, start, difficulty, seed, title: '' };
    const sol = solvePuzzle(spec);
    if (!sol || sol.length < minLen) continue;
    if (!sol.some((a) => a.type === 'lever')) continue;
    if (solvePuzzle(spec, initialState(spec), false)) continue; // must require bending space
    spec.title = `${rng.pick(ADJ)}${rng.pick(NOUN)}`;
    best = spec;
    break;
  }
  // Extremely unlikely: derive a new seed deterministically and try again.
  return best ?? { ...generatePuzzle((Math.imul(seed, 2654435761) + 1) >>> 0, difficulty), seed };
}

export function roomName(i: number): string {
  return ROOM_NAMES[i % ROOM_NAMES.length];
}

export const PUZZLE_ORIGIN = 4000;
export const PUZZLE_SPACING = 50;
export const PUZZLE_ROOM = 10;

export function roomCenter(i: number): [number, number] {
  return [PUZZLE_ORIGIN + i * PUZZLE_SPACING, 0];
}

/** Room index containing a world position, or -1. */
export function roomAt(p: PuzzleSpec, x: number, z: number): number {
  for (let i = 0; i < p.rooms; i++) {
    const [cx, cz] = roomCenter(i);
    if (Math.abs(x - cx) <= PUZZLE_ROOM / 2 + 0.3 && Math.abs(z - cz) <= PUZZLE_ROOM / 2 + 0.3) return i;
  }
  return -1;
}

export function describeAction(p: PuzzleSpec, a: PuzzleAction): string {
  const sideName = { n: '北', e: '东', s: '南', w: '西' } as const;
  switch (a.type) {
    case 'door':
      return `穿过「${roomName(Math.floor(a.slot / 4))}」的${sideName[SIDES[a.slot % 4]]}门`;
    case 'lever':
      return `拉动「${roomName(p.levers[a.lever].room)}」里的拉杆`;
    case 'exit':
      return `走进「${roomName(p.exitRoom)}」中央的出口`;
  }
}

/** Builds the 3D level for a puzzle spec. */
export function buildPuzzleLevel(p: PuzzleSpec): LevelData {
  const mats: MaterialKey[] = ['plaster', 'brick', 'hedge', 'night', 'marble', 'gold', 'tile'];
  const [sx, sz] = roomCenter(p.start);
  const b = new LevelBuilder(`悖论谜题 · ${p.title}`, { pos: [sx, 0, sz + 2], yaw: 0 }, {
    skyTop: '#121a3a', skyBottom: '#b98fd6', fogColor: '#7d6aa8', fogDensity: 0.02, stars: 0.9,
  });
  const usedSlot = (s: number) => p.base[s] != null || p.levers.some((l) => l.affects.some((a) => a.slot === s));
  const W = 2.4, Hd = 3;
  for (let r = 0; r < p.rooms; r++) {
    const [cx, cz] = roomCenter(r);
    const doors = SIDES.map((side, d) => ({ id: `p${r}_${d}`, side, width: W, height: Hd, used: usedSlot(r * 4 + d) })).filter((x) => x.used);
    const room = b.room({ center: [cx, 0, cz], size: [PUZZLE_ROOM, 5, PUZZLE_ROOM], wall: mats[r % mats.length], floor: 'checker', ceil: 'night', doors });
    for (const d of doors) b.portal(room.anchors[d.id], d.id, { frame: 'glow', color: '#c9b8ff' });
    b.sign([cx, 4.1, cz - PUZZLE_ROOM / 2 + 0.25], 0, roomName(r), 0.9);
    b.light([cx, 4.4, cz], '#e9dcff', 1.2);
    // Door glyphs: tell the player which side is which.
    for (const d of doors) {
      const a = room.anchors[d.id];
      const yaw = SIDE_YAW[d.side];
      const nx = Math.sin(yaw), nz = Math.cos(yaw);
      b.sign([a.pos[0] + nx * 0.25, 3.45, a.pos[2] + nz * 0.25], yaw, { n: '北', e: '东', s: '南', w: '西' }[d.side], 0.35);
    }
  }
  for (let s = 0; s < p.rooms * 4; s++) {
    const t = slotTarget(p, s, 0);
    if (usedSlot(s)) b.link(`p${Math.floor(s / 4)}_${s % 4}`, t == null ? null : `p${Math.floor(t / 4)}_${t % 4}`);
  }
  p.levers.forEach((l, i) => {
    const [cx, cz] = roomCenter(l.room);
    const id = `lever${i}`;
    b.prop({ id, type: 'lever', pos: [cx - 2.5 + i * 0.9, 0, cz + 2], yaw: 0, state: false });
    for (const state of [true, false]) {
      b.rule({
        trigger: { type: 'lever', prop: id, state },
        actions: [
          ...l.affects.map((a) => {
            const t = state ? a.on : a.off;
            return { type: 'link' as const, portal: `p${Math.floor(a.slot / 4)}_${a.slot % 4}`, target: t == null ? null : `p${Math.floor(t / 4)}_${t % 4}`, mode: 'now' as const };
          }),
          { type: 'message' as const, text: state ? '空间折叠了。' : '空间复原了。' },
        ],
      });
    }
  });
  p.shards.forEach((r, i) => {
    const [cx, cz] = roomCenter(r);
    b.prop({ id: `shard${i}`, type: 'shard', pos: [cx + 2.5 - i * 0.8, 1.3, cz + 2], color: '#ffd27a' });
  });
  const [ex, ez] = roomCenter(p.exitRoom);
  const gate = { pos: [ex, 0, ez - 1.5] as [number, number, number], yaw: 0, width: 2, height: 3 };
  b.portal(gate, 'gate', { frame: 'glow', color: '#ffd27a' });
  b.standingFrame(gate, 'gold');
  const vx = PUZZLE_ORIGIN - 120;
  b.box([vx - 15, -0.5, -25], [vx + 15, 0, 15], 'cloud');
  const vin = { pos: [vx, 0, 10] as [number, number, number], yaw: Math.PI, width: 2, height: 3 };
  b.portal(vin, 'vic_in', { link: 'gate' });
  b.standingFrame(vin, 'gold');
  b.prop({ id: 'goal', type: 'goal', pos: [vx, 1.5, -6], radius: 2.5 });
  b.light([vx, 2.5, -6], '#fff1c4', 4);
  b.rule({ trigger: { type: 'shards', count: p.shards.length }, once: true, actions: [{ type: 'link', portal: 'gate', target: 'vic_in', mode: 'now' }, { type: 'message', text: `出口在「${roomName(p.exitRoom)}」开启。` }] });
  b.rule({ trigger: { type: 'start' }, once: true, actions: [{ type: 'message', text: `谜题「${p.title}」：收集 ${p.shards.length} 枚碎片，找到出口。门未必通向它看起来的地方。按 H 获取提示。` }] });
  return b.build({ kind: 'puzzle', puzzle: p });
}
