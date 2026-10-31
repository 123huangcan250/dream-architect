import {
  ColorManagement,
  Group,
  HalfFloatType,
  LinearSRGBColorSpace,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  Color,
} from 'three';
import { CHAR, createCharacter, eyePosition, forwardOf, stepCharacter, type CharacterState } from '../core/character';
import { cloneLevel } from '../core/level';
import { TopologySystem } from '../core/topology';
import type { LevelData, Vec3T } from '../core/types';
import { World } from '../core/World';
import { cellAt, cellCenter, solveMaze, type Maze } from '../gen/maze';
import { describeAction, roomAt, solvePuzzle, type PuzzleSpec } from '../gen/puzzle';
import { PortalRenderer, type RenderStats } from '../render/PortalRenderer';
import { POST_FRAG, POST_VERT, shared } from '../render/shaders';
import { WorldView } from '../render/WorldView';
import { DreamAudio } from './Audio';
import { Input } from './Input';
import { glowSprite, Props } from './Props';
import { h, loadSettings, saveSettings, settingsPanel, type Settings } from './ui';

export type GameMode = 'menu' | 'play' | 'paused' | 'editor' | 'won';

export interface EditorHost {
  active: boolean;
  update(dt: number): void;
  camera: PerspectiveCamera;
  helpers: Group;
  onPlaytestEnd(): void;
}

export class Game {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(75, 1, 0.05, 2000);
  readonly input: Input;
  readonly audio = new DreamAudio();
  readonly settings: Settings = loadSettings();
  private mainRT: WebGLRenderTarget;
  private postScene = new Scene();
  private postCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private postMat: ShaderMaterial;

  level!: LevelData;
  world!: World;
  view!: WorldView;
  props!: Props;
  topo!: TopologySystem;
  portals!: PortalRenderer;
  player!: CharacterState;
  mode: GameMode = 'menu';
  editor: EditorHost | null = null;
  playtest = false;

  private observed = new Set<string>();
  private checkpoint = { pos: new Vector3(), yaw: 0 };
  private stats = { start: 0, crossings: 0, falls: 0 };
  private lastStats: RenderStats | null = null;
  private frameMs = 16;
  private adaptTimer = 0;
  private shift = 0;
  private fade = 0;
  private time = 0;
  private last = performance.now();
  private guide: Group | null = null;
  private guideTimer = 0;
  private attractT = 0;
  private stepAcc = 0;

  // HUD
  readonly ui: HTMLElement;
  private hud!: HTMLElement;
  private hudCross!: HTMLElement;
  private hudPrompt!: HTMLElement;
  private hudShards!: HTMLElement;
  private hudToasts!: HTMLElement;
  private hudMeter!: HTMLElement;
  private hudStats!: HTMLElement;
  private hudAlt!: HTMLElement;
  private hudHeld!: HTMLElement;
  private hudClick!: HTMLElement;
  private overlay: HTMLElement | null = null;
  onMenu: (() => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    ColorManagement.enabled = false;
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.setClearColor(new Color('#120e26'));
    this.ui = uiRoot;
    this.input = new Input(canvas);
    this.mainRT = new WebGLRenderTarget(4, 4, { samples: 4, type: HalfFloatType });
    this.postMat = new ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.mainRT.texture },
        uResolution: { value: new Vector2() },
        uTime: shared.uTime,
        uShift: { value: 0 },
        uFade: { value: 0 },
        uFadeColor: { value: new Color('#fff6ec') },
        uAberration: { value: 1 },
      },
    });
    this.postScene.add(new Mesh(new PlaneGeometry(2, 2), this.postMat));
    this.buildHud();
    this.input.onLockChange = (locked) => {
      if (!locked && this.mode === 'play') this.pause();
    };
    canvas.addEventListener('click', () => {
      this.audio.start();
      if (this.mode === 'play') this.input.lock();
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- level lifecycle

  load(level: LevelData, opts: { play?: boolean; spawn?: { pos: Vec3T; yaw: number } } = {}): void {
    this.unload();
    this.level = cloneLevel(level);
    this.world = new World(this.level);
    this.view = new WorldView(this.world);
    this.scene.add(this.view.root);
    const playing = opts.play !== false;
    this.props = new Props(this.world, {
      collect: (id) => this.onCollect(id),
      lever: (id, s) => {
        this.topo.lever(id, s);
        this.shift = 1;
        this.audio.play('shift');
      },
      solved: (id) => {
        this.topo.solved(id);
        this.shift = 0.8;
      },
      goal: () => this.win(),
      sound: (n) => this.audio.play(n),
    }, this.level.props);
    this.scene.add(this.props.root);
    this.portals = new PortalRenderer(this.renderer, this.scene, this.view, this.world);
    this.portals.lights = this.props.lights;
    this.portals.cullables = this.props.cull;
    this.applySettings();
    this.resize();
    const env = this.level.env;
    shared.uSkyTop.value.set(env.skyTop);
    shared.uSkyBottom.value.set(env.skyBottom);
    shared.uFogColor.value.set(env.fogColor);
    shared.uFogDensity.value = env.fogDensity;
    shared.uStars.value = env.stars ?? 0.6;
    const spawn = opts.spawn ?? this.level.spawn;
    this.player = createCharacter(new Vector3(...spawn.pos), spawn.yaw);
    this.checkpoint = { pos: this.player.pos.clone(), yaw: spawn.yaw };
    this.topo = new TopologySystem(this.world, this.level.rules, {
      isObserved: (id) => this.observed.has(id),
      isStraddling: (id) => this.world.straddled({ pos: this.player.pos, radius: CHAR.radius, yMin: this.player.pos.y, yMax: this.player.pos.y + CHAR.height }).some((p) => p.id === id),
      message: (t) => this.toast(t),
      win: () => this.win(),
    }, 7);
    this.stats = { start: performance.now(), crossings: 0, falls: 0 };
    this.fade = 0;
    this.updateShardHud();
    if (playing) {
      this.topo.start();
      this.setMode('play');
    }
  }

  private unload(): void {
    if (!this.world) return;
    this.scene.remove(this.view.root);
    this.scene.remove(this.props.root);
    this.view.dispose();
    this.props.dispose();
    this.portals.dispose();
    this.clearGuide();
  }

  setMode(m: GameMode): void {
    this.mode = m;
    this.hud.classList.toggle('hidden', m !== 'play');
    if (m === 'play') {
      this.closeOverlay();
      this.input.lock();
    } else this.input.unlock();
    if (this.editor) this.editor.active = m === 'editor';
  }

  applySettings(): void {
    const s = this.settings;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    if (this.portals) {
      this.portals.opts.maxDepth = s.maxDepth;
      this.portals.opts.maxPasses = s.maxPasses;
      this.portals.opts.clipMode = s.clipMode;
      if (this.portals.opts.quality !== s.quality) {
        this.portals.opts.quality = s.quality;
        this.resize();
      }
    }
    this.audio.setVolume(s.volume);
    this.hudStats?.classList.toggle('hidden', !s.showStats);
  }

  resize(): void {
    const w = window.innerWidth, hgt = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, 1.5) * this.settings.quality * (this.settings.adaptive ? this.dynScale : 1);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(Math.round(w * pr), Math.round(hgt * pr), false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${hgt}px`;
    const W = Math.round(w * pr), H = Math.round(hgt * pr);
    this.mainRT.setSize(W, H);
    this.postMat.uniforms.uResolution.value.set(W, H);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
    if (this.editor) {
      this.editor.camera.aspect = w / hgt;
      this.editor.camera.updateProjectionMatrix();
    }
    this.portals?.setSize(W, H);
  }

  // ---------------------------------------------------------------- loop

  private frame(t: number): void {
    requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.frameMs = this.frameMs * 0.92 + (t - this.last) * 0.08;
    this.last = t;
    this.time += dt;
    shared.uTime.value = this.time;
    if (!this.world) return;
    let cam = this.camera;
    if (this.mode === 'play') this.updatePlay(dt);
    else if (this.mode === 'editor' && this.editor) {
      this.editor.update(dt);
      cam = this.editor.camera;
    } else if (this.mode === 'menu') this.updateAttract(dt);
    if (this.mode === 'play' || this.mode === 'won' || this.mode === 'paused') this.updateCamera();
    this.shift = Math.max(0, this.shift - dt * 1.2);
    if (this.mode === 'won') this.fade = Math.min(0.85, this.fade + dt * 0.5);
    this.adapt(dt);
    this.render(cam);
    this.input.endFrame();
  }

  private adapt(dt: number): void {
    if (!this.settings.adaptive || !this.portals) return;
    this.adaptTimer += dt;
    if (this.adaptTimer < 0.5) return;
    this.adaptTimer = 0;
    const o = this.portals.opts;
    // First trade recursion budget, then resolution; recover in the opposite order.
    if (this.frameMs > 24) {
      if (o.maxPasses > 10) o.maxPasses -= 2;
      else if (this.dynScale > 0.6 && ++this.slowTicks > 3) {
        this.dynScale = Math.max(0.6, this.dynScale - 0.1);
        this.slowTicks = 0;
        this.resize();
      }
    } else if (this.frameMs < 15) {
      this.slowTicks = 0;
      if (this.dynScale < 1 && ++this.fastTicks > 6) {
        this.dynScale = Math.min(1, this.dynScale + 0.1);
        this.fastTicks = 0;
        this.resize();
      } else if (this.dynScale >= 1 && o.maxPasses < this.settings.maxPasses) o.maxPasses += 1;
    }
  }

  private dynScale = 1;
  private slowTicks = 0;
  private fastTicks = 0;

  private render(cam: PerspectiveCamera): void {
    this.lastStats = this.portals.render(cam, this.mainRT);
    if (this.mode === 'play' || this.mode === 'menu') this.observed = this.lastStats.observed;
    this.postMat.uniforms.uShift.value = this.shift;
    this.postMat.uniforms.uFade.value = this.fade;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
    if (this.settings.showStats && this.mode !== 'menu') this.drawStats();
  }

  private updateAttract(dt: number): void {
    this.attractT += dt;
    const t = this.attractT * 0.05;
    this.camera.position.set(400 + Math.sin(t) * 3, 2.2, 20 - Math.cos(t * 0.7) * 2);
    this.camera.rotation.set(0.02, Math.sin(t * 1.3) * 0.35, 0, 'YXZ');
    this.camera.updateMatrixWorld();
    this.topo.update(dt);
  }

  private updateCamera(): void {
    const p = this.player;
    this.camera.position.copy(eyePosition(p));
    this.camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
  }

  private viewDir(): Vector3 {
    return new Vector3(0, 0, -1).applyEuler(this.camera.rotation);
  }

  private updatePlay(dt: number): void {
    const p = this.player;
    const inp = this.input;
    const sens = 0.0022 * this.settings.sensitivity;
    p.yaw -= inp.mouseDX * sens;
    p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch - inp.mouseDY * sens));
    const move = {
      x: (inp.isDown('KeyD') ? 1 : 0) - (inp.isDown('KeyA') ? 1 : 0),
      y: (inp.isDown('KeyW') ? 1 : 0) - (inp.isDown('KeyS') ? 1 : 0),
      jump: inp.isDown('Space'),
      run: inp.isDown('ShiftLeft') || inp.isDown('ShiftRight'),
    };
    const events = stepCharacter(this.world, p, move, dt, {
      beforeCross: (portal, backward) => this.topo.beforeCross(portal.id, backward),
    });
    for (const e of events) {
      this.stats.crossings++;
      this.topo.afterCross(e.portal.id);
      this.checkpoint = { pos: p.pos.clone(), yaw: p.yaw };
      this.shift = Math.max(this.shift, 0.12);
      this.audio.play('portal');
    }
    if (p.onGround && (move.x || move.y)) {
      this.stepAcc += dt * (move.run ? 2.6 : 1.8);
      if (this.stepAcc > 1) {
        this.stepAcc = 0;
        this.audio.play('step');
      }
    }
    if (p.pos.y < this.world.floorY - 25) {
      this.stats.falls++;
      p.pos.copy(this.checkpoint.pos);
      p.vel.set(0, 0, 0);
      p.yaw = this.checkpoint.yaw;
      this.props.release();
      this.toast('你从梦里坠落……又回到了这里。');
      this.shift = 1;
    }
    this.updateCamera();
    const eye = eyePosition(p);
    const dir = this.viewDir();
    // Interaction.
    const hit = this.world.raycast(eye, dir, 4, 3);
    const target = this.props.held ? null : this.props.pick(hit.segments, 3.2);
    this.hudCross.classList.toggle('active', !!target);
    this.hudPrompt.classList.toggle('hidden', !target);
    if (target) this.hudPrompt.textContent = target.kind === 'lever' ? 'E · 拉动拉杆' : '左键 · 拿起';
    if (target?.kind === 'lever' && inp.wasPressed('KeyE')) this.props.toggleLever(target.id);
    if (inp.buttonPressed(0)) {
      if (this.props.held) this.props.release();
      else if (target?.kind === 'cube') this.props.grab(target.id, eye, this.props.standingOn(p.pos));
    }
    if (target?.kind === 'cube' && inp.wasPressed('KeyE')) this.props.grab(target.id, eye, this.props.standingOn(p.pos));
    else if (this.props.held && inp.wasPressed('KeyE')) this.props.release();
    this.props.updateHeld(eye, dir);
    this.hudHeld.classList.toggle('hidden', !this.props.held);
    if (this.props.held) this.hudHeld.textContent = `尺寸 ${this.props.heldInfo.size.toFixed(2)} m · 距离 ${this.props.heldInfo.distance.toFixed(1)} m · 再次点击放下`;
    const { align } = this.props.update(dt, eye, dir, p.pos);
    this.hudMeter.classList.toggle('hidden', !align);
    if (align) (this.hudMeter.querySelector('i') as HTMLElement).style.width = `${Math.round(align.score * 100)}%`;
    this.topo.update(dt);
    // Altimeter for portal-accumulated height.
    const alt = p.portalLift;
    this.hudAlt.classList.toggle('hidden', Math.abs(alt) < 0.5);
    this.hudAlt.textContent = `梦境海拔 ${alt >= 0 ? '+' : ''}${(alt + p.pos.y - this.level.spawn.pos[1]).toFixed(1)} m`;
    // Mode specific helpers.
    if (inp.wasPressed('KeyG')) this.showGuide();
    if (inp.wasPressed('KeyH')) this.showHint();
    if (inp.wasPressed('F3')) {
      this.settings.showStats = !this.settings.showStats;
      saveSettings(this.settings);
      this.applySettings();
    }
    if (this.guide) {
      this.guideTimer -= dt;
      if (this.guideTimer <= 0) this.clearGuide();
    }
  }

  private onCollect(_id: string): void {
    const n = this.props.collected.size;
    this.topo.setShards(n);
    this.updateShardHud();
    this.toast(`梦之碎片 ${n} / ${this.props.shardTotal}`);
    this.shift = Math.max(this.shift, 0.5);
  }

  // ---------------------------------------------------------------- helpers: guide & hints

  private showGuide(): void {
    const maze = this.level.meta?.maze as Maze | undefined;
    if (!maze) return;
    const goal = this.level.meta!.goal as number;
    const from = cellAt(maze, this.player.pos.x, this.player.pos.z);
    if (from < 0) return;
    const path = solveMaze(maze, from, goal);
    if (!path) return;
    this.clearGuide();
    const g = new Group();
    path.slice(1, 16).forEach((c, i) => {
      const [x, z] = cellCenter(maze, c);
      const s = glowSprite(i === path.length - 2 ? '#ffd27a' : '#8fd3ff', 1.1, 1);
      s.position.set(x, 0.9, z);
      g.add(s);
    });
    this.scene.add(g);
    this.guide = g;
    this.guideTimer = 10;
    this.toast(`距离金光还有 ${path.length - 1} 步（穿过传送门也算一步）`);
  }

  private clearGuide(): void {
    if (this.guide) this.scene.remove(this.guide);
    this.guide = null;
  }

  private showHint(): void {
    const spec = this.level.meta?.puzzle as PuzzleSpec | undefined;
    if (!spec) return;
    const room = roomAt(spec, this.player.pos.x, this.player.pos.z);
    if (room < 0) return;
    let levers = 0, shards = 0;
    spec.levers.forEach((_, i) => this.props.leverState.get(`lever${i}`) && (levers |= 1 << i));
    spec.shards.forEach((_, i) => this.props.collected.has(`shard${i}`) && (shards |= 1 << i));
    const sol = solvePuzzle(spec, { room, levers, shards });
    if (!sol) this.toast('这里似乎是死路……试试回到起点重新思考。');
    else this.toast(`提示（剩余 ${sol.length} 步）：${describeAction(spec, sol[0])}`);
  }

  // ---------------------------------------------------------------- HUD / overlays

  private buildHud(): void {
    this.hudCross = h('div', { class: 'cross' });
    this.hudPrompt = h('div', { class: 'prompt hidden' });
    this.hudShards = h('div', { class: 'shards' });
    this.hudToasts = h('div', { class: 'toasts' });
    this.hudMeter = h('div', { class: 'meter hidden' }, '视角对齐', h('div', { class: 'bar' }, h('i')));
    this.hudStats = h('div', { class: 'stats hidden' });
    this.hudAlt = h('div', { class: 'alt hidden' });
    this.hudHeld = h('div', { class: 'held hidden' });
    this.hudClick = h('div', { class: 'clickhint hidden' }, '点击画面继续');
    this.hud = h('div', { class: 'hud hidden' }, this.hudCross, this.hudPrompt, this.hudShards, this.hudToasts, this.hudMeter, this.hudStats, this.hudAlt, this.hudHeld);
    this.ui.append(this.hud, this.hudClick);
  }

  private updateShardHud(): void {
    this.hudShards.replaceChildren();
    const total = this.props?.shardTotal ?? 0;
    if (!total) return;
    for (let i = 0; i < total; i++) this.hudShards.append(h('div', { class: `shard-ico ${i < this.props.collected.size ? 'on' : ''}` }));
    this.hudShards.append(h('span', {}, `${this.props.collected.size} / ${total}`));
  }

  toast(text: string): void {
    const t = h('div', { class: 'toast' }, text);
    this.hudToasts.append(t);
    while (this.hudToasts.children.length > 3) this.hudToasts.firstChild!.remove();
    setTimeout(() => t.remove(), 5600);
  }

  private drawStats(): void {
    const s = this.lastStats;
    if (!s) return;
    const p = this.player.pos;
    this.hudStats.textContent =
      `FPS      ${(1000 / this.frameMs).toFixed(0)}  (${this.frameMs.toFixed(1)} ms)\n` +
      `视图     ${s.passes} / ${this.portals.opts.maxPasses}   最深 ${s.maxDepth}\n` +
      `DrawCall ${s.drawCalls}   三角形 ${(s.triangles / 1000).toFixed(1)}k\n` +
      `RT 池    ${s.targets}   可见门 ${s.observed.size}\n` +
      `裁剪     ${this.portals.opts.clipMode}\n` +
      `位置     ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}\n` +
      `穿越     ${this.stats.crossings}   拓扑变换 ${this.topo.shiftCount}`;
  }

  showOverlay(el: HTMLElement): void {
    this.closeOverlay();
    this.overlay = el;
    this.ui.append(el);
  }

  closeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  pause(): void {
    if (this.mode !== 'play') return;
    this.setMode('paused');
    this.props.release();
    const panel = h(
      'div',
      { class: 'panel' },
      h('h2', {}, '梦境暂停'),
      h('p', { class: 'note' }, this.level.name),
      h(
        'div',
        { class: 'btns' },
        h('button', { class: 'btn primary', onclick: () => this.setMode('play') }, '继续'),
        h('button', { class: 'btn', onclick: () => this.showOverlay(settingsPanel(this.settings, () => this.applySettings(), () => this.pauseAgain())) }, '设置'),
        h('button', { class: 'btn', onclick: () => this.start(this.levelSource, { playtest: this.playtest, spawn: this.playtestSpawn }) }, '重新开始'),
        this.playtest ? h('button', { class: 'btn', onclick: () => this.endPlaytest() }, '返回编辑器') : null,
        h('button', { class: 'btn', onclick: () => this.toMenu() }, '主菜单'),
      ),
      h('p', { class: 'note' }, 'WASD 移动 · Shift 奔跑 · 空格 跳跃 · E 互动 · 左键 拿起/放下 · G 迷宫指引 · H 谜题提示 · F3 性能统计'),
    );
    this.showOverlay(panel);
  }

  private pauseAgain(): void {
    this.mode = 'play';
    this.pause();
  }

  /** The level as originally loaded (for restarts). */
  levelSource!: LevelData;
  private playtestSpawn: { pos: Vec3T; yaw: number } | undefined;

  start(level: LevelData, opts: { playtest?: boolean; spawn?: { pos: Vec3T; yaw: number } } = {}): void {
    this.levelSource = level;
    this.playtest = !!opts.playtest;
    this.playtestSpawn = opts.spawn;
    this.audio.start();
    this.load(level, { play: true, spawn: opts.spawn });
  }

  endPlaytest(): void {
    this.closeOverlay();
    this.playtest = false;
    this.editor?.onPlaytestEnd();
  }

  toMenu(): void {
    this.closeOverlay();
    this.playtest = false;
    this.onMenu?.();
  }

  private win(): void {
    if (this.mode !== 'play') return;
    this.setMode('won');
    this.audio.play('win');
    const secs = (performance.now() - this.stats.start) / 1000;
    const mm = Math.floor(secs / 60), ss = Math.floor(secs % 60);
    const panel = h(
      'div',
      { class: 'win' },
      h('h1', {}, '你醒了'),
      h('p', {}, this.level.name),
      h('div', { class: 'statline', html: `用时 ${mm}:${String(ss).padStart(2, '0')} &nbsp;·&nbsp; 穿越传送门 ${this.stats.crossings} 次 &nbsp;·&nbsp; 空间重构 ${this.topo.shiftCount} 次<br/>梦之碎片 ${this.props.collected.size} / ${this.props.shardTotal}` }),
      h(
        'div',
        { class: 'btns' },
        h('button', { class: 'btn primary', onclick: () => this.start(this.levelSource) }, '再做一次这个梦'),
        this.playtest ? h('button', { class: 'btn', onclick: () => this.endPlaytest() }, '返回编辑器') : null,
        h('button', { class: 'btn', onclick: () => this.toMenu() }, '主菜单'),
      ),
    );
    this.showOverlay(panel);
  }

  /** Exposes the forward vector for tools/tests in the browser console. */
  get forward(): Vector3 {
    return forwardOf(this.player.yaw);
  }
}
