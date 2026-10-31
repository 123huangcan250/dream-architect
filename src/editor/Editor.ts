import {
  BufferGeometry,
  Float32BufferAttribute,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { cloneLevel, LevelStore, parseLevel, serializeLevel, validateLevel } from '../core/level';
import { portalCorners, portalNormal, rayPortal } from '../core/portalMath';
import { MATERIAL_KEYS, type BlockDef, type LevelData, type MaterialKey, type PortalDef, type PropDef, type Vec3T } from '../core/types';
import { raySlab } from '../core/World';
import { raySphere } from '../game/Props';
import { h } from '../game/ui';
import type { EditorHost, Game } from '../game/Game';

type Sel = { kind: 'block' | 'portal' | 'prop'; id: string };
type Tool = 'select' | 'block' | 'portal' | 'prop';

const PROP_TYPES: PropDef['type'][] = ['shard', 'lever', 'cube', 'sign', 'light', 'goal'];

export function emptyLevel(name = '新的梦境'): LevelData {
  return {
    version: 1,
    name,
    spawn: { pos: [0, 0, 6], yaw: 0 },
    env: { skyTop: '#1d1946', skyBottom: '#f4b6c2', fogColor: '#d8a7c3', fogDensity: 0.012, stars: 0.8 },
    blocks: [{ id: 'floor', min: [-12, -0.5, -12], max: [12, 0, 12], mat: 'checker' }],
    portals: [],
    props: [],
    rules: [],
    meta: {},
  };
}

/** Unified scene editor: free camera, picking, placement, inspector, validation, save/load and play-testing. */
export class Editor implements EditorHost {
  active = false;
  readonly camera = new PerspectiveCamera(75, 1, 0.05, 2000);
  readonly helpers = new Group();
  level: LevelData = emptyLevel();
  private yaw = 0;
  private pitch = -0.3;
  private sel: Sel[] = [];
  private tool: Tool = 'select';
  private snap = 0.5;
  private material: MaterialKey = 'plaster';
  private propType: PropDef['type'] = 'shard';
  private undo: string[] = [];
  private redo: string[] = [];
  private store = new LevelStore(localStorage);
  private root: HTMLElement | null = null;
  private side!: HTMLElement;
  private topbar!: HTMLElement;
  private dirty = false;
  private selLines: LineSegments;
  private portalLines: LineSegments;
  private grid = new GridHelper(200, 200, 0x8877cc, 0x443a66);
  private counter = 1;

  constructor(private game: Game) {
    this.selLines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xffd27a, depthTest: false, transparent: true }));
    this.selLines.renderOrder = 100;
    this.portalLines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0x9ff0ff, transparent: true, opacity: 0.8 }));
    (this.grid.material as LineBasicMaterial).transparent = true;
    (this.grid.material as LineBasicMaterial).opacity = 0.35;
    this.helpers.add(this.grid, this.portalLines, this.selLines);
    this.helpers.visible = false;
    game.scene.add(this.helpers);
    game.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
  }

  // ---------------------------------------------------------------- lifecycle

  open(level: LevelData = emptyLevel(), camera?: { pos: Vector3; yaw: number; pitch: number }): void {
    this.level = cloneLevel(level);
    this.undo = [];
    this.redo = [];
    this.sel = [];
    const sp = this.level.spawn;
    this.camera.position.set(sp.pos[0], sp.pos[1] + 4, sp.pos[2] + 6);
    this.yaw = sp.yaw;
    this.pitch = -0.35;
    if (camera) {
      this.camera.position.copy(camera.pos);
      this.yaw = camera.yaw;
      this.pitch = camera.pitch;
    }
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.syncCamera();
    this.counter = this.level.blocks.length + this.level.portals.length + this.level.props.length + 1;
    this.mountUi();
    this.rebuild();
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    this.helpers.visible = false;
    this.active = false;
  }

  onPlaytestEnd(): void {
    const cam = { pos: this.camera.position.clone(), yaw: this.yaw, pitch: this.pitch };
    this.open(this.level, cam);
  }

  private rebuild(): void {
    this.game.load(this.level, { play: false });
    this.game.setMode('editor');
    this.helpers.visible = true;
    this.refreshHelpers();
    this.refreshSide();
  }

  private commit(): void {
    this.undo.push(serializeLevel(this.level));
    if (this.undo.length > 100) this.undo.shift();
    this.redo = [];
    this.dirty = true;
  }

  private changed(): void {
    this.rebuild();
  }

  private uid(prefix: string): string {
    const ids = new Set([...this.level.blocks, ...this.level.portals, ...this.level.props, ...this.level.rules].map((x) => x.id));
    let id = `${prefix}${this.counter++}`;
    while (ids.has(id)) id = `${prefix}${this.counter++}`;
    return id;
  }

  // ---------------------------------------------------------------- per-frame

  update(dt: number): void {
    const inp = this.game.input;
    if (inp.buttons.has(2)) {
      this.yaw -= inp.mouseDX * 0.003;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - inp.mouseDY * 0.003));
    }
    const fast = inp.isDown('ShiftLeft') ? 3 : 1;
    const sp = 9 * fast * dt;
    const fwd = new Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const ctrl = inp.isDown('ControlLeft') || inp.isDown('ControlRight');
    if (!ctrl && inp.buttons.has(2)) {
      if (inp.isDown('KeyW')) this.camera.position.addScaledVector(fwd, sp);
      if (inp.isDown('KeyS')) this.camera.position.addScaledVector(fwd, -sp);
      if (inp.isDown('KeyD')) this.camera.position.addScaledVector(right, sp);
      if (inp.isDown('KeyA')) this.camera.position.addScaledVector(right, -sp);
      if (inp.isDown('KeyE')) this.camera.position.y += sp;
      if (inp.isDown('KeyQ')) this.camera.position.y -= sp;
    }
    if (inp.wheel) this.camera.position.addScaledVector(fwd, -inp.wheel * 1.5);
    this.syncCamera();
    this.grid.position.set(Math.round(this.camera.position.x), 0.01, Math.round(this.camera.position.z));
    this.keys(ctrl);
  }

  private keys(ctrl: boolean): void {
    const inp = this.game.input;
    const p = (c: string) => inp.wasPressed(c);
    if (ctrl && p('KeyZ')) this.doUndo();
    if (ctrl && p('KeyY')) this.doRedo();
    if (ctrl && p('KeyS')) this.save();
    if (ctrl && p('KeyD')) this.duplicate();
    if (p('Delete') || p('Backspace')) this.remove();
    if (p('KeyL') && !ctrl) this.linkSelected();
    if (p('KeyP') && !ctrl) this.playtest();
    if (p('KeyR') && !ctrl && !inp.buttons.has(2)) this.rotate();
    if (p('Digit1')) this.setTool('select');
    if (p('Digit2')) this.setTool('block');
    if (p('Digit3')) this.setTool('portal');
    if (p('Digit4')) this.setTool('prop');
    if (inp.buttons.has(2)) return;
    // Nudge selection with arrows (camera-relative), PageUp/PageDown for height. Shift resizes blocks.
    const shift = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight');
    const s = this.snap || 0.1;
    const cf = Math.abs(Math.sin(this.yaw)) > Math.abs(Math.cos(this.yaw));
    const fx = cf ? -Math.sign(Math.sin(this.yaw)) : 0, fz = cf ? 0 : -Math.sign(Math.cos(this.yaw));
    const d = new Vector3();
    if (p('ArrowUp')) d.set(fx, 0, fz);
    if (p('ArrowDown')) d.set(-fx, 0, -fz);
    if (p('ArrowRight')) d.set(-fz, 0, fx);
    if (p('ArrowLeft')) d.set(fz, 0, -fx);
    if (p('PageUp')) d.set(0, 1, 0);
    if (p('PageDown')) d.set(0, -1, 0);
    if (d.lengthSq() && this.sel.length) {
      this.commit();
      d.multiplyScalar(s);
      for (const sl of this.sel) this.translate(sl, d, shift);
      this.changed();
    }
  }

  // ---------------------------------------------------------------- picking

  private syncCamera(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
  }

  private mouseRay(e: MouseEvent): { o: Vector3; d: Vector3 } {
    this.syncCamera();
    const r = this.game.canvas.getBoundingClientRect();
    const ndc = new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return { o: rc.ray.origin.clone(), d: rc.ray.direction.clone() };
  }

  private pick(o: Vector3, d: Vector3): { sel: Sel | null; point: Vector3; normal: Vector3 } {
    let best = 500;
    let sel: Sel | null = null;
    const normal = new Vector3(0, 1, 0);
    for (const b of this.level.blocks) {
      const hit = raySlab(o, d, new Vector3(...b.min), new Vector3(...b.max), best);
      if (hit) {
        best = hit.t;
        sel = { kind: 'block', id: b.id };
        normal.copy(hit.n);
      }
    }
    for (const p of this.level.portals) {
      const t = rayPortal(p, o, d, best) ?? rayPortal({ ...p, yaw: p.yaw + Math.PI }, o, d, best);
      if (t != null && t < best) {
        best = t;
        sel = { kind: 'portal', id: p.id };
        normal.copy(portalNormal(p));
      }
    }
    for (const pr of this.level.props) {
      const pos = 'pos' in pr ? pr.pos : pr.viewpoint;
      const t = raySphere(o, d, new Vector3(...pos), 0.6);
      if (t != null && t < best) {
        best = t;
        sel = { kind: 'prop', id: pr.id };
      }
    }
    if (!sel) {
      // Nothing hit: place on the ground plane (y = 0) or 10 m ahead.
      const t = d.y < -1e-3 ? Math.min(60, -o.y / d.y) : 10;
      return { sel, point: o.clone().addScaledVector(d, t), normal };
    }
    return { sel, point: o.clone().addScaledVector(d, best), normal };
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this.active || e.button !== 0) return;
    const { o, d } = this.mouseRay(e);
    const hit = this.pick(o, d);
    const sn = (v: number) => (this.snap ? Math.round(v / this.snap) * this.snap : v);
    if (this.tool === 'select') {
      if (!hit.sel) this.sel = [];
      else if (e.shiftKey) {
        const i = this.sel.findIndex((s) => s.id === hit.sel!.id);
        if (i >= 0) this.sel.splice(i, 1);
        else this.sel.push(hit.sel);
      } else this.sel = [hit.sel];
      this.refreshHelpers();
      this.refreshSide();
      return;
    }
    const pt = hit.point.clone().addScaledVector(hit.normal, 0.001);
    this.commit();
    if (this.tool === 'block') {
      const size = 2;
      const c = [sn(pt.x), sn(pt.y), sn(pt.z)];
      const min: Vec3T = [c[0] - size / 2, c[1], c[2] - size / 2];
      const max: Vec3T = [c[0] + size / 2, c[1] + size, c[2] + size / 2];
      if (hit.normal.y < -0.5) { min[1] = c[1] - size; max[1] = c[1]; }
      const id = this.uid('b');
      this.level.blocks.push({ id, min, max, mat: this.material });
      this.sel = [{ kind: 'block', id }];
    } else if (this.tool === 'portal') {
      const yaw = Math.round(Math.atan2(this.camera.position.x - pt.x, this.camera.position.z - pt.z) / (Math.PI / 2)) * (Math.PI / 2);
      const id = this.uid('portal');
      this.level.portals.push({ id, pos: [sn(pt.x), sn(pt.y), sn(pt.z)], yaw, width: 2, height: 3, link: null, frame: 'glow', color: '#c9b8ff' });
      this.sel = [{ kind: 'portal', id }];
    } else {
      const id = this.uid(this.propType);
      const pos: Vec3T = [sn(pt.x), sn(pt.y), sn(pt.z)];
      const yaw = Math.round(Math.atan2(this.camera.position.x - pt.x, this.camera.position.z - pt.z) / (Math.PI / 2)) * (Math.PI / 2);
      const defs: Record<string, PropDef> = {
        shard: { id, type: 'shard', pos: [pos[0], pos[1] + 1.2, pos[2]] },
        lever: { id, type: 'lever', pos, yaw, state: false },
        cube: { id, type: 'cube', pos: [pos[0], pos[1] + 0.25, pos[2]], size: 0.5 },
        sign: { id, type: 'sign', pos: [pos[0], pos[1] + 1.8, pos[2]], yaw, text: '在这里写字', size: 1 },
        light: { id, type: 'light', pos: [pos[0], pos[1] + 2.5, pos[2]], color: '#ffd9a8', radius: 1 },
        goal: { id, type: 'goal', pos: [pos[0], pos[1] + 1.5, pos[2]], radius: 2 },
      };
      this.level.props.push(defs[this.propType]);
      this.sel = [{ kind: 'prop', id }];
    }
    this.changed();
  }

  // ---------------------------------------------------------------- operations

  private find(s: Sel): BlockDef | PortalDef | PropDef | undefined {
    if (s.kind === 'block') return this.level.blocks.find((b) => b.id === s.id);
    if (s.kind === 'portal') return this.level.portals.find((b) => b.id === s.id);
    return this.level.props.find((b) => b.id === s.id);
  }

  private translate(s: Sel, d: Vector3, resize: boolean): void {
    const o = this.find(s);
    if (!o) return;
    if (s.kind === 'block') {
      const b = o as BlockDef;
      if (resize) {
        for (let i = 0; i < 3; i++) {
          const v = d.getComponent(i);
          if (v > 0) b.max[i] += v;
          else if (v < 0) b.max[i] = Math.max(b.min[i] + 0.1, b.max[i] + v);
        }
      } else for (let i = 0; i < 3; i++) { b.min[i] += d.getComponent(i); b.max[i] += d.getComponent(i); }
    } else {
      const pos = 'pos' in o ? (o as { pos: Vec3T }).pos : (o as { viewpoint: Vec3T }).viewpoint;
      for (let i = 0; i < 3; i++) pos[i] += d.getComponent(i);
    }
  }

  private rotate(): void {
    if (!this.sel.length) return;
    this.commit();
    for (const s of this.sel) {
      const o = this.find(s) as { yaw?: number } | undefined;
      if (o && typeof o.yaw === 'number') o.yaw = ((o.yaw + Math.PI / 2) % (Math.PI * 2));
      if (s.kind === 'block') {
        const b = o as unknown as BlockDef;
        const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
        const hx = (b.max[0] - b.min[0]) / 2, hz = (b.max[2] - b.min[2]) / 2;
        b.min[0] = cx - hz; b.max[0] = cx + hz; b.min[2] = cz - hx; b.max[2] = cz + hx;
      }
    }
    this.changed();
  }

  private remove(): void {
    if (!this.sel.length) return;
    this.commit();
    const ids = new Set(this.sel.map((s) => s.id));
    this.level.blocks = this.level.blocks.filter((b) => !ids.has(b.id));
    this.level.props = this.level.props.filter((b) => !ids.has(b.id));
    this.level.portals = this.level.portals.filter((b) => !ids.has(b.id));
    for (const p of this.level.portals) if (p.link && ids.has(p.link)) p.link = null;
    this.sel = [];
    this.changed();
  }

  private duplicate(): void {
    if (!this.sel.length) return;
    this.commit();
    const next: Sel[] = [];
    for (const s of this.sel) {
      const o = this.find(s);
      if (!o) continue;
      const c = JSON.parse(JSON.stringify(o));
      c.id = this.uid(s.kind === 'block' ? 'b' : s.kind === 'portal' ? 'portal' : (o as PropDef).type);
      if (s.kind === 'block') { c.min[0] += 1; c.max[0] += 1; this.level.blocks.push(c); }
      else if (s.kind === 'portal') { c.pos[0] += 1; c.link = null; this.level.portals.push(c); }
      else { if (c.pos) c.pos[0] += 1; this.level.props.push(c); }
      next.push({ kind: s.kind, id: c.id });
    }
    this.sel = next;
    this.changed();
  }

  private linkSelected(): void {
    const ps = this.sel.filter((s) => s.kind === 'portal');
    if (ps.length !== 2) {
      this.game.toast('按住 Shift 选中两个传送门，再按 L 双向链接');
      return;
    }
    this.commit();
    const [a, b] = ps.map((s) => this.level.portals.find((p) => p.id === s.id)!);
    a.link = b.id;
    b.link = a.id;
    if (Math.abs(a.width - b.width) > 0.01 || Math.abs(a.height - b.height) > 0.01) {
      b.width = a.width;
      b.height = a.height;
    }
    this.changed();
  }

  private doUndo(): void {
    const s = this.undo.pop();
    if (!s) return;
    this.redo.push(serializeLevel(this.level));
    this.level = parseLevel(s);
    this.sel = [];
    this.changed();
  }

  private doRedo(): void {
    const s = this.redo.pop();
    if (!s) return;
    this.undo.push(serializeLevel(this.level));
    this.level = parseLevel(s);
    this.changed();
  }

  save(asName?: string): void {
    if (asName) this.level.name = asName;
    try {
      this.store.save(this.level);
      this.dirty = false;
      this.game.toast(`已保存「${this.level.name}」`);
    } catch (e) {
      this.game.toast(`保存失败：${(e as Error).message}`);
    }
    this.refreshSide();
  }

  private exportJson(): void {
    const blob = new Blob([serializeLevel(this.level)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${this.level.name.replace(/[\\/:*?"<>|\s]+/g, '_')}.dream.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private importJson(): void {
    const input = h('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const lvl = parseLevel(await f.text());
        this.commit();
        this.level = lvl;
        this.sel = [];
        this.changed();
        this.game.toast(`已导入「${lvl.name}」`);
      } catch (e) {
        this.game.toast(`导入失败：${(e as Error).message}`);
      }
    });
    input.click();
  }

  playtest(): void {
    const report = validateLevel(this.level);
    if (report.errors.length) {
      this.game.toast(`关卡有 ${report.errors.length} 个错误，无法试玩`);
      this.refreshSide();
      return;
    }
    const pos = this.camera.position;
    const ground = this.game.world.groundAt(pos.x, pos.z, pos.y);
    const spawn = ground > -Infinity && pos.y - ground < 30 ? { pos: [pos.x, ground, pos.z] as Vec3T, yaw: this.yaw } : this.level.spawn;
    this.close();
    this.helpers.visible = false;
    this.game.start(this.level, { playtest: true, spawn });
  }

  private setTool(t: Tool): void {
    this.tool = t;
    this.topbar?.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tool === t));
  }

  // ---------------------------------------------------------------- helpers & UI

  private refreshHelpers(): void {
    const sel: number[] = [];
    const box = (min: Vec3T, max: Vec3T) => {
      const [x0, y0, z0] = min, [x1, y1, z1] = max;
      const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) sel.push(...c[a], ...c[b]);
    };
    for (const s of this.sel) {
      const o = this.find(s);
      if (!o) continue;
      if (s.kind === 'block') box((o as BlockDef).min, (o as BlockDef).max);
      else if (s.kind === 'portal') {
        const cs = portalCorners(o as PortalDef);
        for (let i = 0; i < 4; i++) sel.push(...cs[i].toArray(), ...cs[(i + 1) % 4].toArray());
      } else {
        const p = 'pos' in o ? (o as { pos: Vec3T }).pos : (o as { viewpoint: Vec3T }).viewpoint;
        box([p[0] - 0.4, p[1] - 0.4, p[2] - 0.4], [p[0] + 0.4, p[1] + 0.4, p[2] + 0.4]);
      }
    }
    this.selLines.geometry.dispose();
    this.selLines.geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(sel, 3));
    const pl: number[] = [];
    for (const p of this.level.portals) {
      const cs = portalCorners(p);
      for (let i = 0; i < 4; i++) pl.push(...cs[i].toArray(), ...cs[(i + 1) % 4].toArray());
      const c = new Vector3(p.pos[0], p.pos[1] + p.height / 2, p.pos[2]);
      pl.push(...c.toArray(), ...c.clone().addScaledVector(portalNormal(p), 0.8).toArray());
    }
    const s = this.level.spawn.pos;
    pl.push(s[0], s[1], s[2], s[0], s[1] + 1.8, s[2]);
    pl.push(s[0], s[1] + 1.6, s[2], s[0] - Math.sin(this.level.spawn.yaw), s[1] + 1.6, s[2] - Math.cos(this.level.spawn.yaw));
    this.portalLines.geometry.dispose();
    this.portalLines.geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pl, 3));
  }

  private mountUi(): void {
    this.root?.remove();
    const tb = (label: string, fn: () => void, extra: Record<string, string> = {}) => h('button', { class: 'btn', onclick: fn, ...extra }, label);
    const matSel = h('select', { class: 'btn' }, ...MATERIAL_KEYS.map((m) => h('option', { value: m }, m)));
    matSel.value = this.material;
    matSel.addEventListener('change', () => (this.material = matSel.value as MaterialKey));
    const propSel = h('select', { class: 'btn' }, ...PROP_TYPES.map((m) => h('option', { value: m }, m)));
    propSel.value = this.propType;
    propSel.addEventListener('change', () => (this.propType = propSel.value as PropDef['type']));
    const snapSel = h('select', { class: 'btn' }, ...['0', '0.25', '0.5', '1'].map((v) => h('option', { value: v }, v === '0' ? '无吸附' : `吸附 ${v}`)));
    snapSel.value = String(this.snap);
    snapSel.addEventListener('change', () => (this.snap = Number(snapSel.value)));
    this.topbar = h(
      'div',
      { class: 'ed-top' },
      h('span', { class: 'title-l' }, 'ARCHITECT'),
      tb('选择 1', () => this.setTool('select'), { 'data-tool': 'select' }),
      tb('方块 2', () => this.setTool('block'), { 'data-tool': 'block' }),
      matSel,
      tb('传送门 3', () => this.setTool('portal'), { 'data-tool': 'portal' }),
      tb('道具 4', () => this.setTool('prop'), { 'data-tool': 'prop' }),
      propSel,
      h('div', { class: 'sep' }),
      snapSel,
      tb('链接 L', () => this.linkSelected()),
      tb('撤销', () => this.doUndo()),
      tb('重做', () => this.doRedo()),
      h('div', { class: 'sep' }),
      tb('▶ 试玩 P', () => this.playtest()),
      tb('保存', () => this.save()),
      tb('另存为', () => {
        const n = prompt('关卡名称', this.level.name);
        if (n) this.save(n);
      }),
      tb('导出', () => this.exportJson()),
      tb('导入', () => this.importJson()),
      tb('新建', () => {
        this.commit();
        this.level = emptyLevel();
        this.sel = [];
        this.changed();
      }),
      h('div', { class: 'sep' }),
      tb('退出', () => {
        if (this.dirty && !confirm('有未保存的修改，确定退出？')) return;
        this.close();
        this.game.toMenu();
      }),
    );
    this.side = h('div', { class: 'ed-side' });
    const help = h('div', { class: 'ed-help', html: '右键按住 + WASD/QE 飞行 · 滚轮推拉 · 左键 选择/放置 · Shift+左键 多选<br/>方向键/PgUp/PgDn 移动 · Shift+方向键 调整方块尺寸 · R 旋转 · Del 删除 · Ctrl+D 复制<br/>L 链接两个传送门 · Ctrl+Z/Y 撤销重做 · Ctrl+S 保存 · P 从当前视角试玩' });
    this.root = h('div', {}, this.topbar, this.side, help);
    this.game.ui.append(this.root);
    this.setTool(this.tool);
  }

  private refreshSide(): void {
    if (!this.side) return;
    const s = this.side;
    s.replaceChildren();
    const num = (label: string, get: () => number, set: (v: number) => void, step = 0.1) => {
      const i = h('input', { type: 'number', step, value: +get().toFixed(3) });
      i.addEventListener('change', () => {
        this.commit();
        set(Number(i.value));
        this.changed();
      });
      return h('div', { class: 'row' }, h('label', {}, label), i);
    };
    const v3 = (label: string, arr: Vec3T) => {
      const inputs = arr.map((v, k) => {
        const i = h('input', { type: 'number', step: 0.25, value: +v.toFixed(3) });
        i.addEventListener('change', () => {
          this.commit();
          arr[k] = Number(i.value);
          this.changed();
        });
        return i;
      });
      return h('div', { class: 'row' }, h('label', {}, label), h('div', { class: 'v3' }, ...inputs));
    };
    const text = (label: string, get: () => string, set: (v: string) => void) => {
      const i = h('input', { type: 'text', value: get() });
      i.addEventListener('change', () => {
        this.commit();
        set(i.value);
        this.changed();
      });
      return h('div', { class: 'row' }, h('label', {}, label), i);
    };
    const select = (label: string, opts: string[], get: () => string, set: (v: string) => void) => {
      const i = h('select', {}, ...opts.map((o) => h('option', { value: o }, o || '（无）')));
      i.value = get();
      i.addEventListener('change', () => {
        this.commit();
        set(i.value);
        this.changed();
      });
      return h('div', { class: 'row' }, h('label', {}, label), i);
    };
    const check = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const i = h('input', { type: 'checkbox' });
      i.checked = get();
      i.addEventListener('change', () => {
        this.commit();
        set(i.checked);
        this.changed();
      });
      return h('div', { class: 'row' }, h('label', {}, label), i);
    };

    s.append(h('h3', {}, '关卡'));
    s.append(text('名称', () => this.level.name, (v) => (this.level.name = v)));
    s.append(v3('出生点', this.level.spawn.pos));
    s.append(num('出生朝向', () => (this.level.spawn.yaw * 180) / Math.PI, (v) => (this.level.spawn.yaw = (v * Math.PI) / 180), 15));
    s.append(h('button', { class: 'btn', onclick: () => {
      this.commit();
      const p = this.camera.position;
      const g = this.game.world.groundAt(p.x, p.z, p.y);
      this.level.spawn = { pos: [p.x, g > -Infinity ? g : p.y, p.z], yaw: this.yaw };
      this.changed();
    } }, '出生点 = 当前视角'));
    s.append(text('雾颜色', () => this.level.env.fogColor, (v) => (this.level.env.fogColor = v)));
    s.append(num('雾浓度', () => this.level.env.fogDensity, (v) => (this.level.env.fogDensity = v), 0.002));

    if (this.sel.length === 1) {
      const sel = this.sel[0];
      const o = this.find(sel);
      if (o) {
        s.append(h('h3', {}, sel.kind === 'block' ? '方块' : sel.kind === 'portal' ? '传送门' : `道具 · ${(o as PropDef).type}`));
        s.append(h('div', { class: 'note' }, `ID: ${o.id}`));
        if (sel.kind === 'block') {
          const b = o as BlockDef;
          s.append(v3('最小', b.min), v3('最大', b.max));
          s.append(select('材质', MATERIAL_KEYS, () => b.mat, (v) => (b.mat = v as MaterialKey)));
          s.append(select('形状', ['box', 'ramp'], () => b.kind ?? 'box', (v) => (b.kind = v as BlockDef['kind'])));
          if (b.kind === 'ramp') s.append(select('坡向', ['x+', 'x-', 'z+', 'z-'], () => b.ramp ?? 'x+', (v) => (b.ramp = v as BlockDef['ramp'])));
          s.append(check('实体碰撞', () => b.solid !== false, (v) => (b.solid = v)));
          s.append(check('可见', () => b.visible !== false, (v) => (b.visible = v)));
          s.append(check('动态', () => !!b.dynamic, (v) => (b.dynamic = v)));
        } else if (sel.kind === 'portal') {
          const p = o as PortalDef;
          s.append(v3('位置', p.pos));
          s.append(num('朝向°', () => (p.yaw * 180) / Math.PI, (v) => (p.yaw = (v * Math.PI) / 180), 90));
          s.append(num('宽', () => p.width, (v) => (p.width = v)));
          s.append(num('高', () => p.height, (v) => (p.height = v)));
          s.append(select('链接到', ['', ...this.level.portals.filter((x) => x.id !== p.id).map((x) => x.id)], () => p.link ?? '', (v) => (p.link = v || null)));
          s.append(select('边框', ['none', 'glow', 'arch'], () => p.frame ?? 'none', (v) => (p.frame = v as PortalDef['frame'])));
          s.append(text('颜色', () => p.color ?? '#c9b8ff', (v) => (p.color = v)));
        } else {
          const pr = o as PropDef;
          if ('pos' in pr) s.append(v3('位置', pr.pos));
          if ('yaw' in pr) s.append(num('朝向°', () => (pr.yaw * 180) / Math.PI, (v) => (pr.yaw = (v * Math.PI) / 180), 90));
          if (pr.type === 'sign') {
            const ta = h('textarea', {}, pr.text);
            ta.addEventListener('change', () => { this.commit(); pr.text = ta.value; this.changed(); });
            s.append(ta, num('大小', () => pr.size ?? 1, (v) => (pr.size = v)));
          }
          if (pr.type === 'cube') s.append(num('尺寸', () => pr.size, (v) => (pr.size = v)));
          if (pr.type === 'goal') s.append(num('半径', () => pr.radius, (v) => (pr.radius = v)));
          if (pr.type === 'light') s.append(text('颜色', () => pr.color, (v) => (pr.color = v)));
          if (pr.type === 'shard') s.append(text('颜色', () => pr.color ?? '#ffd27a', (v) => (pr.color = v)));
        }
      }
    } else if (this.sel.length > 1) {
      s.append(h('h3', {}, `已选择 ${this.sel.length} 个对象`));
    }

    s.append(h('h3', {}, `规则（${this.level.rules.length}）`));
    const rules = h('textarea', { style: 'height:120px;font-family:Consolas,monospace;font-size:11px' }, JSON.stringify(this.level.rules, null, 1));
    s.append(rules, h('button', { class: 'btn', onclick: () => {
      try {
        const r = JSON.parse(rules.value);
        if (!Array.isArray(r)) throw new Error('需要数组');
        this.commit();
        this.level.rules = r;
        this.changed();
      } catch (e) {
        this.game.toast(`规则 JSON 有误：${(e as Error).message}`);
      }
    } }, '应用规则'));

    const rep = validateLevel(this.level);
    s.append(h('h3', {}, `验证 · ${rep.errors.length} 错误 / ${rep.warnings.length} 警告`));
    const iss = h('div', { class: 'ed-issues' });
    rep.errors.slice(0, 12).forEach((e) => iss.append(h('div', { class: 'err' }, `✖ ${e}`)));
    rep.warnings.slice(0, 12).forEach((e) => iss.append(h('div', { class: 'warn' }, `⚠ ${e}`)));
    if (!rep.errors.length && !rep.warnings.length) iss.append(h('div', {}, '✓ 一切正常'));
    s.append(iss);
    s.append(h('div', { class: 'note' }, `${this.level.blocks.length} 方块 · ${this.level.portals.length} 传送门 · ${this.level.props.length} 道具`));
  }
}
