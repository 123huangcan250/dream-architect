import './styles.css';
import { Editor } from './editor/Editor';
import { Game } from './game/Game';
import { h, settingsPanel } from './game/ui';
import { buildStoryLevel } from './gen/storyLevel';
import { buildMazeLevel } from './gen/maze';
import { buildPuzzleLevel, generatePuzzle, solvePuzzle } from './gen/puzzle';
import { LevelStore, parseLevel } from './core/level';
import type { LevelData } from './core/types';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui')!;
const game = new Game(canvas, uiRoot);
const editor = new Editor(game);
game.editor = editor;
const store = new LevelStore(localStorage);
const story = buildStoryLevel();

let title: HTMLElement | null = null;

function showTitle(): void {
  game.load(story, { play: false });
  game.setMode('menu');
  title?.remove();
  const item = (label: string, sub: string, fn: () => void) =>
    h('button', { class: 'menu-btn', onclick: () => { game.audio.start(); game.audio.play('ui'); fn(); } }, label, h('small', {}, sub));
  title = h(
    'div',
    { class: 'title' },
    h(
      'div',
      { class: 'col' },
      h('h1', { class: 'logo' }, 'DREAM', h('br'), 'ARCHITECT'),
      h('div', { class: 'sub' }, '梦 境 建 筑 师'),
      item('开始梦境', '梦之宅 · 剧情关卡：四枚碎片，四种悖论', () => play(story)),
      item('迷梦回廊', '程序生成 · 环面拓扑与虫洞的迷宫', () => mazePanel()),
      item('悖论谜题', '生成器 + 求解器 · 每个种子都是一道新题', () => puzzlePanel()),
      item('场景编辑器', '搭建你自己的不可能建筑', () => openEditor()),
      item('我的关卡', '读取已保存或导入的关卡', () => levelsPanel()),
      item('设置', '画质 · 递归深度 · 灵敏度', () => game.showOverlay(settingsPanel(game.settings, () => game.applySettings(), () => game.closeOverlay()))),
      h('div', { class: 'foot' }, '基于 Portal 的非欧几何空间引擎 · Three.js + TypeScript + GLSL', h('br'), '建议使用鼠标与键盘 · 点击画面锁定视角 · Esc 暂停'),
    ),
  );
  uiRoot.append(title);
}

function hideTitle(): void {
  title?.remove();
  title = null;
  game.closeOverlay();
}

function play(level: LevelData): void {
  hideTitle();
  game.start(level);
}

function openEditor(level?: LevelData): void {
  hideTitle();
  editor.open(level);
}

function mazePanel(): void {
  const size = h('input', { type: 'number', min: 4, max: 20, value: 9 });
  const seed = h('input', { type: 'number', value: Math.floor(Math.random() * 99999) });
  const holes = h('input', { type: 'number', min: 0, max: 6, value: 3 });
  const wrap = h('input', { type: 'checkbox' });
  wrap.checked = true;
  game.showOverlay(
    h(
      'div',
      { class: 'panel' },
      h('h2', {}, '迷梦回廊'),
      h('p', { class: 'note' }, '迷宫的东边缘连着西边缘、南边缘连着北边缘（环面拓扑），死胡同里藏着虫洞。按 G 用寻路显示前往金光的最短路径——路径会穿过传送门。'),
      h('div', { class: 'row' }, h('label', {}, '尺寸'), size),
      h('div', { class: 'row' }, h('label', {}, '种子'), seed),
      h('div', { class: 'row' }, h('label', {}, '虫洞对数'), holes),
      h('div', { class: 'row' }, h('label', {}, '环面拓扑'), wrap),
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', onclick: () => {
          const n = Math.max(4, Math.min(20, Number(size.value)));
          play(buildMazeLevel(n, n, Number(seed.value) >>> 0, { wrap: wrap.checked, wormholes: Number(holes.value), braid: 0.2 }));
        } }, '进入'),
        h('button', { class: 'btn', onclick: () => {
          const n = Math.max(4, Math.min(20, Number(size.value)));
          openEditor(buildMazeLevel(n, n, Number(seed.value) >>> 0, { wrap: wrap.checked, wormholes: Number(holes.value), braid: 0.2 }));
        } }, '在编辑器中打开'),
        h('button', { class: 'btn', onclick: () => game.closeOverlay() }, '返回')),
    ),
  );
}

function puzzlePanel(): void {
  const diff = h('select', {}, h('option', { value: '1' }, '入梦'), h('option', { value: '2' }, '深梦'), h('option', { value: '3' }, '悖论'));
  const seed = h('input', { type: 'number', value: Math.floor(Math.random() * 99999) });
  const info = h('p', { class: 'note' }, '生成器会随机构造房间与门的拓扑（单向门、自环、拉杆切换的链接），再用广度优先求解器验证：只接受「可解」且「必须改变空间结构才能解」的谜题。');
  const preview = h('p', { class: 'note' });
  const gen = () => {
    const spec = generatePuzzle(Number(seed.value) >>> 0, Number(diff.value));
    const sol = solvePuzzle(spec)!;
    preview.textContent = `「${spec.title}」 · ${spec.rooms} 个房间 · ${spec.levers.length} 根拉杆 · ${spec.shards.length} 枚碎片 · 最短解 ${sol.length} 步`;
    return spec;
  };
  seed.addEventListener('change', gen);
  diff.addEventListener('change', gen);
  gen();
  game.showOverlay(
    h(
      'div',
      { class: 'panel' },
      h('h2', {}, '悖论谜题'),
      info,
      h('div', { class: 'row' }, h('label', {}, '难度'), diff),
      h('div', { class: 'row' }, h('label', {}, '种子'), seed),
      preview,
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', onclick: () => play(buildPuzzleLevel(gen())) }, '进入'),
        h('button', { class: 'btn', onclick: () => { seed.value = String(Math.floor(Math.random() * 99999)); gen(); } }, '换一题'),
        h('button', { class: 'btn', onclick: () => game.closeOverlay() }, '返回')),
    ),
  );
}

function levelsPanel(): void {
  const list = h('div', { class: 'list' });
  const render = () => {
    list.replaceChildren();
    const items = store.list();
    if (!items.length) list.append(h('div', { class: 'note' }, '还没有保存的关卡。去编辑器里建一个吧。'));
    for (const it of items) {
      list.append(h('div', { class: 'item' },
        h('span', {}, it.name),
        h('button', { class: 'btn', onclick: () => { const l = store.load(it.name); if (l) play(l); } }, '游玩'),
        h('button', { class: 'btn', onclick: () => { const l = store.load(it.name); if (l) openEditor(l); } }, '编辑'),
        h('button', { class: 'btn', onclick: () => { if (confirm(`删除「${it.name}」？`)) { store.remove(it.name); render(); } } }, '删除')));
    }
  };
  render();
  const importBtn = h('button', { class: 'btn', onclick: () => {
    const input = h('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const l = parseLevel(await f.text());
        store.save(l);
        render();
      } catch (e) {
        alert(`导入失败：${(e as Error).message}`);
      }
    });
    input.click();
  } }, '导入 JSON');
  game.showOverlay(h('div', { class: 'panel' }, h('h2', {}, '我的关卡'), list, h('div', { class: 'btns' }, importBtn, h('button', { class: 'btn', onclick: () => game.closeOverlay() }, '返回'))));
}

game.onMenu = () => {
  editor.close();
  showTitle();
};

showTitle();

// Debug handle for the console.
(window as unknown as { dream: unknown }).dream = { game, editor };
