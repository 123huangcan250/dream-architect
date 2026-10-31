import { describe, expect, it } from 'vitest';
import { cloneLevel, LevelStore, MemoryStorage, parseLevel, serializeLevel, validateLevel } from '../src/core/level';
import { buildStoryLevel } from '../src/gen/storyLevel';
import { buildMazeLevel } from '../src/gen/maze';
import { buildPuzzleLevel, generatePuzzle } from '../src/gen/puzzle';
import { LevelBuilder } from '../src/gen/builder';

/** Unified level format: serialization, validation and the save system used by the editor. */
describe('level format', () => {
  const story = buildStoryLevel();

  it('round-trips through JSON', () => {
    const back = parseLevel(serializeLevel(story));
    expect(back.blocks.length).toBe(story.blocks.length);
    expect(back.portals.map((p) => [p.id, p.link])).toEqual(story.portals.map((p) => [p.id, p.link]));
    expect(back.rules).toEqual(JSON.parse(JSON.stringify(story.rules)));
    expect(serializeLevel(back)).toBe(serializeLevel(story));
  });

  it('all built-in levels validate without errors', () => {
    expect(validateLevel(story).errors).toEqual([]);
    expect(validateLevel(buildMazeLevel(10, 10, 3)).errors).toEqual([]);
    expect(validateLevel(buildPuzzleLevel(generatePuzzle(3, 2))).errors).toEqual([]);
  });

  it('detects broken links, duplicate ids, bad rules and a spawn inside geometry', () => {
    const l = cloneLevel(story);
    l.portals[0].link = 'nope';
    l.blocks[1].id = l.blocks[0].id;
    l.rules.push({ id: 'bad', trigger: { type: 'lever', prop: 'ghost', state: true }, actions: [{ type: 'block', block: 'ghost', on: true }] });
    const r = validateLevel(l);
    expect(r.errors.some((e) => e.includes('nope'))).toBe(true);
    expect(r.errors.some((e) => e.includes('重复'))).toBe(true);
    expect(r.errors.filter((e) => e.includes('ghost')).length).toBe(2);

    const b = new LevelBuilder('s', { pos: [0, 0, 0], yaw: 0 });
    b.box([-1, -1, -1], [1, 2, 1], 'marble');
    expect(validateLevel(b.build()).errors.some((e) => e.includes('出生点'))).toBe(true);
  });

  it('warns about mismatched portal sizes', () => {
    const b = new LevelBuilder('w', { pos: [0, 0, 5], yaw: 0 });
    b.box([-10, -1, -10], [10, 0, 10], 'tile');
    b.portal({ pos: [0, 0, 0], yaw: 0, width: 2, height: 3 }, 'a');
    b.portal({ pos: [5, 0, 0], yaw: 0, width: 3, height: 3 }, 'b');
    b.pair('a', 'b');
    expect(validateLevel(b.build()).warnings.some((w) => w.includes('尺寸不一致'))).toBe(true);
  });

  it('rejects unknown versions', () => {
    expect(() => parseLevel(JSON.stringify({ version: 9, blocks: [], portals: [] }))).toThrow();
    expect(() => parseLevel('not json')).toThrow();
  });

  it('save slots: save, list (most recent first), load and delete', () => {
    const store = new LevelStore(new MemoryStorage());
    const a = cloneLevel(story);
    a.name = 'A';
    const b = cloneLevel(story);
    b.name = 'B';
    store.save(a);
    store.save(b);
    expect(store.list().map((e) => e.name)).toEqual(['B', 'A']);
    expect(store.load('A')!.portals.length).toBe(story.portals.length);
    store.save(a);
    expect(store.list().map((e) => e.name)).toEqual(['A', 'B']);
    store.remove('A');
    expect(store.list().map((e) => e.name)).toEqual(['B']);
    expect(store.load('A')).toBeNull();
  });
});
