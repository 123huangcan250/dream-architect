import { Vector3 } from 'three';
import { World } from './World';
import { DEFAULT_ENV, type Action, type LevelData, type Trigger } from './types';

export interface ValidationReport {
  errors: string[];
  warnings: string[];
}

function round(v: unknown): unknown {
  if (typeof v === 'number') return Math.round(v * 10000) / 10000;
  if (Array.isArray(v)) return v.map(round);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = round(x);
    return o;
  }
  return v;
}

export function serializeLevel(level: LevelData): string {
  return JSON.stringify(round(level), null, 1);
}

/** Parses and migrates a level file. Throws on malformed input. */
export function parseLevel(text: string): LevelData {
  const raw = JSON.parse(text) as Partial<LevelData> & { version?: number };
  if (!raw || typeof raw !== 'object') throw new Error('关卡文件不是有效的 JSON 对象');
  if (raw.version !== 1) throw new Error(`不支持的关卡版本: ${String(raw.version)}`);
  if (!Array.isArray(raw.blocks) || !Array.isArray(raw.portals)) throw new Error('关卡缺少 blocks / portals');
  return {
    version: 1,
    name: raw.name ?? 'Untitled',
    spawn: raw.spawn ?? { pos: [0, 0, 0], yaw: 0 },
    env: { ...DEFAULT_ENV, ...(raw.env ?? {}) },
    blocks: raw.blocks,
    portals: raw.portals.map((p) => ({ ...p, link: p.link ?? null })),
    props: raw.props ?? [],
    rules: raw.rules ?? [],
    meta: raw.meta ?? {},
  };
}

export function cloneLevel(level: LevelData): LevelData {
  return JSON.parse(JSON.stringify(level)) as LevelData;
}

function triggerRefs(t: Trigger): { portals: string[]; props: string[] } {
  switch (t.type) {
    case 'beforeCross':
    case 'afterCross':
      return { portals: [t.portal], props: [] };
    case 'lever':
    case 'solved':
      return { portals: [], props: [t.prop] };
    default:
      return { portals: [], props: [] };
  }
}

function actionRefs(a: Action): { portals: string[]; blocks: string[] } {
  switch (a.type) {
    case 'link':
      return { portals: a.target ? [a.portal, a.target] : [a.portal], blocks: [] };
    case 'shuffle':
      return { portals: [...a.portals, ...a.targets], blocks: [] };
    case 'block':
      return { portals: [], blocks: [a.block] };
    default:
      return { portals: [], blocks: [] };
  }
}

export function validateLevel(level: LevelData): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  const dup = (id: string, kind: string) => {
    if (ids.has(id)) errors.push(`重复的 ID: ${id} (${kind})`);
    ids.add(id);
  };
  const blocks = new Set(level.blocks.map((b) => b.id));
  const portals = new Map(level.portals.map((p) => [p.id, p]));
  const props = new Set(level.props.map((p) => p.id));

  for (const b of level.blocks) {
    dup(b.id, 'block');
    if (b.min.some((v, i) => v >= b.max[i])) errors.push(`方块 ${b.id} 的 min 必须小于 max`);
  }
  for (const p of level.portals) {
    dup(p.id, 'portal');
    if (p.width <= 0.2 || p.height <= 0.2) errors.push(`传送门 ${p.id} 尺寸过小`);
    const q = (p.yaw / (Math.PI / 2)) % 1;
    if (Math.abs(q) > 1e-3 && Math.abs(Math.abs(q) - 1) > 1e-3) warnings.push(`传送门 ${p.id} 朝向不是 90° 的整数倍，碰撞将使用近似包围盒`);
    if (p.link) {
      const t = portals.get(p.link);
      if (!t) errors.push(`传送门 ${p.id} 链接到不存在的 ${p.link}`);
      else if (Math.abs(t.width - p.width) > 0.01 || Math.abs(t.height - p.height) > 0.01)
        warnings.push(`传送门 ${p.id} 与 ${p.link} 尺寸不一致，穿越处会出现错位`);
    }
  }
  for (const pr of level.props) {
    dup(pr.id, 'prop');
    if (pr.type === 'anamorph') for (const b of pr.blocks) if (!blocks.has(b)) errors.push(`错觉道具 ${pr.id} 引用了不存在的方块 ${b}`);
  }
  for (const r of level.rules) {
    dup(r.id, 'rule');
    const tr = triggerRefs(r.trigger);
    for (const p of tr.portals) if (!portals.has(p)) errors.push(`规则 ${r.id} 引用了不存在的传送门 ${p}`);
    for (const p of tr.props) if (!props.has(p)) errors.push(`规则 ${r.id} 引用了不存在的道具 ${p}`);
    for (const a of r.actions) {
      const ar = actionRefs(a);
      for (const p of ar.portals) if (!portals.has(p)) errors.push(`规则 ${r.id} 的动作引用了不存在的传送门 ${p}`);
      for (const b of ar.blocks) if (!blocks.has(b)) errors.push(`规则 ${r.id} 的动作引用了不存在的方块 ${b}`);
    }
  }

  // Spawn checks need a runtime world.
  if (errors.length === 0) {
    const world = new World(cloneLevel(level));
    const s = new Vector3(...level.spawn.pos);
    const inside = world.querySolids(s.clone().add(new Vector3(-0.25, 0.05, -0.25)), s.clone().add(new Vector3(0.25, 1.7, 0.25)));
    if (inside.some((x) => x.owner === 'block' && x.min.y < s.y + 1.7 && x.max.y > s.y + 0.05)) errors.push('出生点位于实体方块内部');
    if (world.groundAt(s.x, s.z, s.y + 0.5) === -Infinity) warnings.push('出生点下方没有地面');
    for (const p of level.portals) if (!p.link) warnings.push(`传送门 ${p.id} 未链接（将显示为封闭的雾墙）`);
  }
  return { errors, warnings };
}

export interface KeyValueStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Named level slots persisted in a key-value store (localStorage in the browser). */
export class LevelStore {
  private static INDEX = 'dream-architect:levels';
  constructor(private storage: KeyValueStorage) {}

  list(): { name: string; savedAt: number }[] {
    try {
      return JSON.parse(this.storage.getItem(LevelStore.INDEX) ?? '[]');
    } catch {
      return [];
    }
  }

  save(level: LevelData): void {
    this.storage.setItem(`dream-architect:level:${level.name}`, serializeLevel(level));
    const idx = this.list().filter((e) => e.name !== level.name);
    idx.unshift({ name: level.name, savedAt: Date.now() });
    this.storage.setItem(LevelStore.INDEX, JSON.stringify(idx));
  }

  load(name: string): LevelData | null {
    const t = this.storage.getItem(`dream-architect:level:${name}`);
    return t ? parseLevel(t) : null;
  }

  remove(name: string): void {
    this.storage.removeItem(`dream-architect:level:${name}`);
    this.storage.setItem(LevelStore.INDEX, JSON.stringify(this.list().filter((e) => e.name !== name)));
  }
}

export class MemoryStorage implements KeyValueStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
