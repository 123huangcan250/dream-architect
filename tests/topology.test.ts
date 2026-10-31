import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LevelBuilder } from '../src/gen/builder';
import { buildStoryLevel } from '../src/gen/storyLevel';
import { TopologySystem } from '../src/core/topology';
import { World } from '../src/core/World';
import type { RuleDef } from '../src/core/types';
import { char, makeWorld, settle, simulate } from './helpers';

/** Mechanic: dynamically restructured room topology. */
function hub(rules: RuleDef[]) {
  const b = new LevelBuilder('hub');
  const r = b.room({ center: [0, 0, 0], size: [10, 4, 10], doors: [
    { id: 'n', side: 'n' }, { id: 'e', side: 'e' }, { id: 'w', side: 'w' },
  ] });
  for (const id of ['n', 'e', 'w']) b.portal(r.anchors[id], id);
  ['A', 'B', 'C', 'D'].forEach((name, i) => {
    const room = b.room({ center: [100 + i * 50, 0, 0], size: [6, 4, 6], doors: [{ id: name, side: 's' }] });
    b.portal(room.anchors[name], name, { link: 'n' });
  });
  b.link('n', 'A');
  b.link('e', 'B');
  b.link('w', 'C');
  rules.forEach((x) => b.rule(x));
  b.prop({ id: 'lever', type: 'lever', pos: [0, 0, 2], yaw: 0 });
  return new World(b.build());
}

function system(w: World, observed: Set<string>, straddling = new Set<string>()) {
  const messages: string[] = [];
  const t = new TopologySystem(w, w.level.rules, {
    isObserved: (id) => observed.has(id),
    isStraddling: (id) => straddling.has(id),
    message: (m) => messages.push(m),
  }, 3);
  return { t, messages };
}

describe('dynamic topology', () => {
  it('lever rules relink immediately, and back again', () => {
    const w = hub([
      { id: 'on', trigger: { type: 'lever', prop: 'lever', state: true }, actions: [{ type: 'link', portal: 'n', target: 'D' }] },
      { id: 'off', trigger: { type: 'lever', prop: 'lever', state: false }, actions: [{ type: 'link', portal: 'n', target: 'A' }] },
    ]);
    const { t } = system(w, new Set(['n']));
    t.lever('lever', true);
    expect(w.portals.get('n')!.def.link).toBe('D');
    t.lever('lever', false);
    expect(w.portals.get('n')!.def.link).toBe('A');
    expect(t.shiftCount).toBe(2);
  });

  it('a relink never happens under the feet of a player standing in the doorway', () => {
    const w = hub([{ id: 'r', trigger: { type: 'lever', prop: 'lever', state: true }, actions: [{ type: 'link', portal: 'n', target: 'D' }] }]);
    const straddling = new Set(['n']);
    const { t } = system(w, new Set(), straddling);
    t.lever('lever', true);
    expect(w.portals.get('n')!.def.link).toBe('A');
    expect(t.pending.get('n')).toBe('D');
    straddling.clear();
    t.update(0.016);
    expect(w.portals.get('n')!.def.link).toBe('D');
  });

  it('"unobserved" relinks wait until the portal is out of sight', () => {
    const w = hub([{ id: 'r', trigger: { type: 'start' }, actions: [{ type: 'link', portal: 'e', target: 'D', mode: 'unobserved' }] }]);
    const observed = new Set(['e']);
    const { t } = system(w, observed);
    t.start();
    for (let i = 0; i < 10; i++) t.update(0.1);
    expect(w.portals.get('e')!.def.link).toBe('B');
    observed.delete('e');
    t.update(0.1);
    expect(w.portals.get('e')!.def.link).toBe('D');
  });

  it('shuffles only unobserved doors and keeps destinations unique', () => {
    const w = hub([{ id: 's', trigger: { type: 'interval', every: 0.5 }, actions: [{ type: 'shuffle', portals: ['n', 'e', 'w'], targets: ['A', 'B', 'C', 'D'] }] }]);
    const observed = new Set(['n']);
    const { t } = system(w, observed);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      t.update(0.1);
      const links = ['n', 'e', 'w'].map((id) => w.portals.get(id)!.def.link!);
      expect(links[0]).toBe('A'); // observed: frozen
      expect(new Set(links).size).toBe(3);
      seen.add(links[1]);
    }
    // The unobserved east door visited every other room over time.
    expect([...seen].sort()).toEqual(['B', 'C', 'D']);
    expect(t.shuffleCount).toBeGreaterThan(10);
  });

  it('interval rules respect counter gates', () => {
    const w = hub([
      { id: 'a', trigger: { type: 'interval', every: 0.2, forbids: { name: 'k', gte: 1 } }, actions: [{ type: 'counter', name: 'ticksA', add: 1 }] },
      { id: 'b', trigger: { type: 'interval', every: 0.2, requires: { name: 'k', gte: 1 } }, actions: [{ type: 'counter', name: 'ticksB', add: 1 }] },
    ]);
    const { t } = system(w, new Set());
    for (let i = 0; i < 10; i++) t.update(0.1);
    t.apply({ type: 'counter', name: 'k', set: 1 });
    for (let i = 0; i < 10; i++) t.update(0.1);
    expect(t.counters.get('ticksA')).toBe(5);
    expect(t.counters.get('ticksB')).toBe(5);
  });

  it('counter triggers are edge-triggered', () => {
    const w = hub([
      { id: 'inc', trigger: { type: 'lever', prop: 'lever', state: true }, actions: [{ type: 'counter', name: 'c', add: 1 }] },
      { id: 'msg', trigger: { type: 'counter', name: 'c', gte: 2 }, actions: [{ type: 'message', text: 'two' }] },
    ]);
    const { t, messages } = system(w, new Set());
    for (let i = 0; i < 5; i++) t.lever('lever', true);
    expect(messages).toEqual(['two']);
    t.apply({ type: 'counter', name: 'c', set: 0 });
    t.lever('lever', true);
    t.lever('lever', true);
    expect(messages).toEqual(['two', 'two']);
  });

  it('shard count opens the awakening gate in the story', () => {
    const w = makeWorld(buildStoryLevel());
    const { t, messages } = system(w, new Set());
    t.setShards(3);
    expect(w.portals.get('gate')!.def.link).toBeNull();
    t.setShards(4);
    expect(w.portals.get('gate')!.def.link).toBe('awake_in');
    expect(messages.length).toBe(1);
  });

  it('compass room: a door you keep looking at never changes, so you can walk through it', () => {
    const w = makeWorld(buildStoryLevel());
    const c = char(1600, 0, 0, Math.PI / 2); // facing west door
    settle(w, c);
    const observed = new Set(['cmp_w']);
    const t = new TopologySystem(w, w.level.rules, {
      isObserved: (id) => observed.has(id),
      isStraddling: (id) => w.straddled({ pos: c.pos, radius: 0.3, yMin: c.pos.y, yMax: c.pos.y + 1.8 }).some((p) => p.id === id),
    });
    const before = w.portals.get('cmp_w')!.def.link;
    let ev: ReturnType<typeof simulate> = [];
    for (let i = 0; i < 120 && ev.length === 0; i++) {
      t.update(1 / 60);
      ev = simulate(w, c, { y: 1 }, 1 / 60);
    }
    expect(ev[0].portal.id).toBe('cmp_w');
    const dest = w.portals.get(before!)!;
    expect(c.pos.distanceTo(new Vector3(...dest.def.pos))).toBeLessThan(2);
  });
});
