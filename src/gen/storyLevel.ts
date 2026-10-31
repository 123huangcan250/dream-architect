import { LevelBuilder } from './builder';
import type { LevelData } from '../core/types';

/**
 * "The Dreaming House": the handcrafted campaign. Each wing showcases one spatial mechanic.
 * Regions live far apart on the X axis; only portals connect them.
 */
export function buildStoryLevel(): LevelData {
  const b = new LevelBuilder('梦之宅 · The Dreaming House', { pos: [0, 0, 10], yaw: 0 }, {
    skyTop: '#1d1946',
    skyBottom: '#f4b6c2',
    fogColor: '#d8a7c3',
    fogDensity: 0.011,
    stars: 0.8,
  });
  const Y = Math.PI;
  const H = Math.PI / 2;

  // ---------------- Courtyard: a wardrobe bigger on the inside ----------------
  b.room({ center: [0, 0, 0], size: [30, 7, 30], wall: 'plaster', floor: 'checker', ceil: null });
  const booth = b.room({
    center: [0, 0, 0], size: [2.4, 3, 2.4], wall: 'marble', floor: null, ceil: 'gold',
    doors: [{ id: 'booth', side: 's', width: 1.4, height: 2.4 }],
  });
  b.box([-1.6, 3.4, -1.6], [1.6, 3.7, 1.6], 'gold', { solid: false });
  b.portal(booth.anchors.booth, 'booth', { flip: true });
  for (const [x, z] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) {
    b.box([x - 0.6, 0, z - 0.6], [x + 0.6, 6, z + 0.6], 'marble');
    b.box([x - 0.9, 6, z - 0.9], [x + 0.9, 6.4, z + 0.9], 'gold');
    b.light([x, 6.9, z], '#ffd9a8', 1.2);
  }
  for (const [x, y, z, s] of [[-6, 11, -18, 2], [8, 14, -22, 3], [-14, 13, 6, 2.5], [16, 10, 12, 1.5], [3, 17, 30, 4]]) {
    b.box([x - s / 2, y - s / 2, z - s / 2], [x + s / 2, y + s / 2, z + s / 2], 'cloud', { solid: false });
  }
  b.sign([0, 2.72, 1.42], 0, '这个衣柜，比它看起来要大。', 0.55);
  b.sign([6, 1.6, 8], -Math.PI / 6, 'WASD 移动 · 鼠标环顾\nShift 奔跑 · 空格 跳跃\nE 互动 · 左键 拿起', 0.9);

  // ---------------- Grand hall ----------------
  const hall = b.room({
    center: [400, 0, 0], size: [36, 14, 50], wall: 'marble', floor: 'checker', ceil: 'night',
    doors: [
      { id: 'hall_s', side: 's', width: 1.4, height: 2.4 },
      { id: 'hall_w', side: 'w', width: 2.4, height: 3 },
      { id: 'hall_e', side: 'e', width: 2, height: 2.8 },
      { id: 'hall_n1', side: 'n', offset: -8, width: 2.4, height: 3 },
      { id: 'hall_n2', side: 'n', offset: 8, width: 2.4, height: 3 },
    ],
  });
  for (const id of Object.keys(hall.anchors)) b.portal(hall.anchors[id], id);
  b.pair('booth', 'hall_s');
  for (const z of [-18, -9, 0, 9, 18]) {
    for (const x of [388, 412]) {
      b.box([x - 0.6, 0, z - 0.6], [x + 0.6, 14, z + 0.6], 'marble');
      b.box([x - 0.9, 0, z - 0.9], [x + 0.9, 0.4, z + 0.9], 'gold');
    }
    b.light([400, 11, z], '#ffe3b0', 1.6);
  }
  // Mirror gallery: two frames that look into each other.
  const ma = { pos: [393, 0, 12] as [number, number, number], yaw: H, width: 2, height: 3 };
  const mb = { pos: [407, 0, 12] as [number, number, number], yaw: -H, width: 2, height: 3 };
  b.portal(ma, 'mirror_a', { frame: 'glow', color: '#9ff0ff' });
  b.portal(mb, 'mirror_b', { frame: 'glow', color: '#9ff0ff' });
  b.standingFrame(ma, 'gold');
  b.standingFrame(mb, 'gold');
  b.pair('mirror_a', 'mirror_b');
  // Awakening gate.
  const gate = { pos: [400, 0, -16] as [number, number, number], yaw: 0, width: 3, height: 4.5 };
  b.portal(gate, 'gate', { frame: 'glow', color: '#ffd27a' });
  b.standingFrame(gate, 'gold');
  b.sign([400, 5.7, -15.7], 0, '觉醒之门\n集齐四枚梦之碎片', 1.1);
  b.sign([382.3, 3.7, 0], H, '无尽回廊', 1.0);
  b.sign([417.7, 3.5, 0], -H, '彭罗斯阶梯', 1.0);
  b.sign([392, 3.7, -24.7], 0, '视差画廊', 1.0);
  b.sign([408, 3.7, -24.7], 0, '罗盘之间', 1.0);
  b.sign([400, 3.4, 12], 0, '镜廊：两扇彼此凝望的门', 0.8);
  b.sign([400, 3.0, 24.7], Y, '回到庭院', 0.8);

  // ---------------- Endless corridor ----------------
  const cor = b.room({
    center: [800, 0, 0], size: [4, 3.5, 16], wall: 'plaster', floor: 'wood', ceil: 'plaster', open: ['n', 's'],
    doors: [{ id: 'cor_door', side: 'e', width: 2.4, height: 3 }],
  });
  b.portal({ pos: [800, 0, -8], yaw: 0, width: 4, height: 3.5 }, 'cor_n');
  b.portal({ pos: [800, 0, 8], yaw: Y, width: 4, height: 3.5 }, 'cor_s');
  b.pair('cor_n', 'cor_s');
  b.portal(cor.anchors.cor_door, 'cor_door');
  b.pair('cor_door', 'hall_w');
  b.box([799, 0, -8], [801, 0.015, 8], 'brick', { solid: false });
  for (const z of [-6, -2, 2, 6]) b.box([799.6, 3.42, z - 0.3], [800.4, 3.5, z + 0.3], 'glow', { solid: false });
  for (const z of [-4.5, 4.5]) {
    b.box([798.2, 1.1, z - 0.9], [798.26, 2.5, z + 0.9], 'gold', { solid: false });
    b.box([798.26, 1.25, z - 0.75], [798.29, 2.35, z + 0.75], 'night', { solid: false });
  }
  b.sign([798.32, 1.9, 0], H, '有些路，\n只能倒着走。', 0.8);
  const sanct = b.room({
    center: [800, 0, -100], size: [8, 5, 8], wall: 'night', floor: 'night', ceil: 'night',
    doors: [{ id: 'sanct_in', side: 's', width: 4, height: 3.5 }],
  });
  b.portal(sanct.anchors.sanct_in, 'sanct_in', { link: 'cor_n' });
  b.prop({ id: 'shard_corridor', type: 'shard', pos: [800, 1.3, -101], color: '#8fd3ff' });
  b.sign([800, 2.7, -103.75], 0, '倒着走的人，\n看见了来路。', 0.8);
  b.light([800, 4, -100], '#8fd3ff', 1.5);
  b.rule({ trigger: { type: 'beforeCross', portal: 'cor_n', backward: true }, actions: [{ type: 'link', portal: 'cor_n', target: 'sanct_in', mode: 'now' }] });
  b.rule({ trigger: { type: 'afterCross', portal: 'sanct_in' }, actions: [{ type: 'link', portal: 'cor_n', target: 'cor_s', mode: 'unobserved' }] });
  b.rule({ trigger: { type: 'afterCross', portal: 'cor_n' }, actions: [{ type: 'counter', name: 'loops', add: 1 }] });
  b.rule({ trigger: { type: 'counter', name: 'loops', gte: 3 }, once: true, actions: [{ type: 'message', text: '走廊似乎没有尽头……也许该换一种走法？' }] });
  b.rule({ trigger: { type: 'counter', name: 'loops', gte: 6 }, once: true, actions: [{ type: 'message', text: '提示：转过身，背对北方，倒退着穿过走廊的尽头。' }] });

  // ---------------- Penrose stairs ----------------
  buildPenrose(b, 1200, 0);
  b.portal({ pos: [1200, 0, 12.5], yaw: H, width: 2, height: 2.8 }, 'pen_door');
  b.pair('pen_door', 'hall_e');
  // Summit above the clouds.
  b.box([2790, -0.5, -12], [2810, 0, 12], 'cloud');
  const summitIn = { pos: [2800, 0, 8] as [number, number, number], yaw: Y, width: 3, height: 3.2 };
  b.portal(summitIn, 'summit_in', { link: 'pen_bot' });
  b.standingFrame(summitIn, 'marble');
  b.prop({ id: 'shard_summit', type: 'shard', pos: [2800, 1.3, -4], color: '#ffb3e6' });
  b.sign([2800, 2.4, -11.5], 0, '阶梯的尽头，是天空。', 0.9);
  for (const [x, y, z, s] of [[2780, -6, -10, 6], [2822, -9, 4, 8], [2796, -14, -30, 10], [2815, -4, -24, 4]]) {
    b.box([x - s / 2, y - s / 4, z - s / 2], [x + s / 2, y + s / 4, z + s / 2], 'cloud', { solid: false });
  }
  b.rule({ trigger: { type: 'beforeCross', portal: 'pen_top' }, actions: [{ type: 'counter', name: 'ascent', add: 1 }] });
  b.rule({ trigger: { type: 'beforeCross', portal: 'pen_bot' }, actions: [{ type: 'counter', name: 'ascent', add: -1 }] });
  b.rule({ trigger: { type: 'counter', name: 'ascent', gte: 1 }, once: true, actions: [{ type: 'message', text: '你回到了起点……但你比刚才高了 8 米。' }] });
  b.rule({
    trigger: { type: 'counter', name: 'ascent', gte: 2 },
    actions: [
      { type: 'link', portal: 'pen_top', target: 'summit_in', mode: 'unobserved' },
      { type: 'message', text: '阶梯尽头吹来了风。再向上走一圈。' },
    ],
  });
  b.rule({
    trigger: { type: 'afterCross', portal: 'summit_in' },
    actions: [
      { type: 'link', portal: 'pen_top', target: 'pen_bot', mode: 'unobserved' },
      { type: 'counter', name: 'ascent', set: 0 },
    ],
  });

  // ---------------- Compass room: doors that move when unobserved ----------------
  const cmp = b.room({
    center: [1600, 0, 0], size: [12, 5, 12], wall: 'marble', floor: 'checker', ceil: 'night',
    doors: [
      { id: 'cmp_s', side: 's', width: 2.4, height: 3 },
      { id: 'cmp_n', side: 'n', width: 2.4, height: 3 },
      { id: 'cmp_e', side: 'e', width: 2.4, height: 3 },
      { id: 'cmp_w', side: 'w', width: 2.4, height: 3 },
    ],
  });
  for (const id of Object.keys(cmp.anchors)) b.portal(cmp.anchors[id], id, id === 'cmp_s' ? {} : { frame: 'glow', color: '#c9b8ff' });
  b.pair('cmp_s', 'hall_n2');
  b.sign([1600, 3.8, 5.75], Y, '门后的房间，\n只在你移开目光时改变。', 0.8);
  b.light([1600, 4.2, 0], '#c9b8ff', 1.4);
  const chambers: [string, number, number, 'brick' | 'night' | 'hedge' | 'gold', string][] = [
    ['red', 1600, -80, 'brick', 'cmp_e'],
    ['blue', 1680, 0, 'night', 'cmp_w'],
    ['green', 1520, 0, 'hedge', 'cmp_n'],
    ['gold', 1600, 80, 'gold', 'cmp_s'],
  ];
  for (const [name, x, z, mat, back] of chambers) {
    const r = b.room({ center: [x, 0, z], size: [8, 4, 8], wall: mat, floor: 'tile', ceil: mat, doors: [{ id: `chd_${name}`, side: 's', width: 2.4, height: 3 }] });
    b.portal(r.anchors[`chd_${name}`], `chd_${name}`, { link: back });
    b.light([x, 3.4, z], name === 'gold' ? '#ffd27a' : '#ffffff', 1.0);
    if (name === 'gold') {
      b.prop({ id: 'shard_compass', type: 'shard', pos: [x, 1.3, z - 1], color: '#ffd27a' });
    } else {
      b.prop({ id: `lev_${name}`, type: 'lever', pos: [x, 0, z - 1.5], yaw: 0, state: false });
      b.rule({ trigger: { type: 'lever', prop: `lev_${name}`, state: true }, once: true, actions: [{ type: 'counter', name: 'runes', add: 1 }, { type: 'message', text: '一枚符文被点亮了。' }] });
      b.sign([x, 2.4, z - 3.75], 0, '拉下拉杆，点亮符文。', 0.7);
    }
  }
  b.link('cmp_n', 'chd_red');
  b.link('cmp_e', 'chd_blue');
  b.link('cmp_w', 'chd_green');
  const doors3 = ['cmp_n', 'cmp_e', 'cmp_w'];
  b.rule({ trigger: { type: 'interval', every: 1.2, forbids: { name: 'runes', gte: 3 } }, actions: [{ type: 'shuffle', portals: doors3, targets: ['chd_red', 'chd_blue', 'chd_green'] }] });
  b.rule({ trigger: { type: 'interval', every: 1.2, requires: { name: 'runes', gte: 3 } }, actions: [{ type: 'shuffle', portals: doors3, targets: ['chd_red', 'chd_blue', 'chd_green', 'chd_gold'] }] });
  b.rule({ trigger: { type: 'counter', name: 'runes', gte: 3 }, once: true, actions: [{ type: 'message', text: '三枚符文齐亮。金色的房间出现在了门后——找到它，别移开目光。' }] });

  // ---------------- Parallax gallery: anamorphic bridge + forced perspective ----------------
  const gal = b.room({
    center: [2000, 0, -12], size: [14, 8, 38], wall: 'plaster', floor: null, ceil: 'night',
    doors: [{ id: 'gal_s', side: 's', width: 2.4, height: 3 }],
  });
  b.portal(gal.anchors.gal_s, 'gal_s');
  b.pair('gal_s', 'hall_n1');
  b.box([1992.8, -0.5, -6], [2007.2, 0, 7.2], 'tile');
  b.box([1992.8, -0.5, -31.2], [2007.2, 0, -14], 'tile');
  b.box([1992.8, -30, -14], [1993.2, 0, -6], 'plaster');
  b.box([2006.8, -30, -14], [2007.2, 0, -6], 'plaster');
  b.box([1993.2, -30, -6.4], [2006.8, -0.5, -6], 'night');
  b.box([1993.2, -30, -14], [2006.8, -0.5, -13.6], 'night');
  b.box([1999, -0.3, -14], [2001, 0, -6], 'wood', { id: 'bridge', dynamic: true, solid: false, visible: false });
  b.box([1998.8, 0, -14], [1999, 0.6, -6], 'gold', { id: 'rail_l', dynamic: true, solid: false, visible: false });
  b.box([2001, 0, -14], [2001.2, 0.6, -6], 'gold', { id: 'rail_r', dynamic: true, solid: false, visible: false });
  b.box([2004, 0, 1.5], [2005, 0.02, 2.5], 'glow', { solid: false });
  b.prop({ id: 'anam', type: 'anamorph', viewpoint: [2004.5, 1.62, 2], blocks: ['bridge', 'rail_l', 'rail_r'], seed: 7, tolerance: 0.6 });
  b.rule({
    trigger: { type: 'solved', prop: 'anam' },
    actions: [
      { type: 'block', block: 'bridge', on: true },
      { type: 'block', block: 'rail_l', on: true },
      { type: 'block', block: 'rail_r', on: true },
      { type: 'message', text: '视角即真实。桥已成形。' },
    ],
  });
  b.sign([2006.75, 2.2, 2], -H, '站在发光的地方，\n碎片会成为桥。', 0.8);
  b.box([1993, 0, -31], [2007, 3.6, -26], 'marble');
  b.box([2004.6, 0, -25.6], [2006.4, 1.2, -23.8], 'wood');
  b.box([1997, 0, -19], [1998, 0.9, -18], 'marble');
  b.prop({ id: 'cube1', type: 'cube', pos: [1997.5, 1.1, -18.5], size: 0.4 });
  b.prop({ id: 'shard_gallery', type: 'shard', pos: [2000, 4.9, -28.5], color: '#a8ffb8' });
  b.sign([2006.75, 2.6, -19], -H, '近大远小，是真的吗？\n左键拿起方块，望向远处，再松开。', 0.75);
  b.light([2000, 7, -2], '#ffe3b0', 1.2);
  b.light([2000, 7, -22], '#ffe3b0', 1.2);

  // ---------------- Awakening ----------------
  b.box([2370, -0.5, -40], [2430, 0, 20], 'cloud');
  const awake = { pos: [2400, 0, 12] as [number, number, number], yaw: Y, width: 3, height: 4.5 };
  b.portal(awake, 'awake_in', { link: 'gate', frame: 'glow', color: '#ffd27a' });
  b.standingFrame(awake, 'gold');
  b.prop({ id: 'goal', type: 'goal', pos: [2400, 1.5, -20], radius: 3 });
  b.light([2400, 2.5, -20], '#fff1c4', 4);
  b.sign([2400, 3, 4], Y, '醒来吧。', 1.2);
  b.rule({ trigger: { type: 'shards', count: 4 }, once: true, actions: [{ type: 'link', portal: 'gate', target: 'awake_in', mode: 'now' }, { type: 'message', text: '觉醒之门已经开启。回到大厅。' }] });
  b.rule({ trigger: { type: 'start' }, once: true, actions: [{ type: 'message', text: '欢迎来到梦之宅。找到四枚梦之碎片。' }] });

  return b.build({ kind: 'story', shards: 4 });
}

/**
 * Four flights climbing 2 m each around a pillar; a portal at the top of the last flight leads
 * back to the bottom of the first one with a pure -8 m translation.
 */
function buildPenrose(b: LevelBuilder, ox: number, oz: number): void {
  const B = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Parameters<LevelBuilder['box']>[2], solid = true) =>
    b.box([ox + x0, y0, oz + z0], [ox + x1, y1, oz + z1], mat, { solid });
  const CEIL = 3.2;
  const landing = (x0: number, z0: number, top: number) => {
    B(x0, -1, z0, x0 + 3, top, z0 + 3, 'checker');
    B(x0, top + CEIL, z0, x0 + 3, top + CEIL + 0.4, z0 + 3, 'plaster');
  };
  landing(0, 11, 0);
  landing(0, 0, 2);
  landing(11, 0, 4);
  landing(11, 11, 6);
  for (let i = 0; i < 8; i++) {
    const r = 0.25 * (i + 1);
    // Flight 1: west side, towards -Z.
    B(0, -1, 10 - i, 3, r, 11 - i, 'wood');
    B(0, r + CEIL, 10 - i, 3, r + CEIL + 0.4, 11 - i, 'plaster');
    // Flight 2: north side, towards +X.
    B(3 + i, -1, 0, 4 + i, 2 + r, 3, 'wood');
    B(3 + i, 2 + r + CEIL, 0, 4 + i, 2 + r + CEIL + 0.4, 3, 'plaster');
    // Flight 3: east side, towards +Z.
    B(11, -1, 3 + i, 14, 4 + r, 4 + i, 'wood');
    B(11, 4 + r + CEIL, 3 + i, 14, 4 + r + CEIL + 0.4, 4 + i, 'plaster');
    // Flight 4: south side, towards -X.
    B(10 - i, -1, 11, 11 - i, 6 + r, 14, 'wood');
    B(10 - i, 6 + r + CEIL, 11, 11 - i, 6 + r + CEIL + 0.4, 14, 'plaster');
  }
  B(3, -1, 3, 11, 16, 11, 'marble');
  // Outer walls (west wall has the entrance on the bottom landing).
  B(-0.4, -1, -0.4, 0, 16, 11.5, 'plaster');
  B(-0.4, -1, 13.5, 0, 16, 14.4, 'plaster');
  B(-0.4, 2.8, 11.5, 0, 16, 13.5, 'plaster');
  B(14, -1, -0.4, 14.4, 16, 14.4, 'plaster');
  B(0, -1, -0.4, 14, 16, 0, 'plaster');
  B(0, -1, 14, 14, 16, 14.4, 'plaster');
  // Lamps halfway up every flight.
  B(0.0, 2.6, 6.6, 0.06, 3.0, 7.4, 'glow', false);
  B(6.6, 4.6, 0.0, 7.4, 5.0, 0.06, 'glow', false);
  B(13.94, 6.6, 6.6, 14, 7.0, 7.4, 'glow', false);
  B(6.6, 8.6, 13.94, 7.4, 9.0, 14, 'glow', false);
  b.portal({ pos: [ox + 3, 8, oz + 12.5], yaw: Math.PI / 2, width: 3, height: CEIL }, 'pen_top');
  b.portal({ pos: [ox + 3, 0, oz + 12.5], yaw: -Math.PI / 2, width: 3, height: CEIL }, 'pen_bot');
  b.pair('pen_top', 'pen_bot');
  b.sign([ox + 1.5, 1.9, oz + 13.95], Math.PI, '无论走多久，你都会回到这里。\n——但真的是同一个地方吗？', 0.7);
}
