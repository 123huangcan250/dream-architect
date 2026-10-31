import { Rng } from './rng';
import type { Action, RuleDef, Trigger } from './types';
import type { World } from './World';

export interface TopologyContext {
  /** True if the portal was drawn (at any recursion depth) in the last frame. */
  isObserved(portalId: string): boolean;
  /** True if the player's body overlaps the portal's doorway. */
  isStraddling(portalId: string): boolean;
  message?(text: string): void;
  win?(): void;
  onShift?(portalId: string): void;
}

/**
 * Dynamic topology: evaluates level rules and rewires portals. Relinks of portals the player
 * can currently see (or stands in) are deferred, so the world never visibly "pops".
 */
export class TopologySystem {
  readonly counters = new Map<string, number>();
  /** Deferred relinks: portal -> target. */
  readonly pending = new Map<string, string | null>();
  private fired = new Set<string>();
  private counterState = new Map<string, boolean>();
  private timers = new Map<string, number>();
  private crossingPortal: string | null = null;
  private rng: Rng;
  shardCount = 0;
  /** Relinks caused by rules (levers, traversal, counters). */
  shiftCount = 0;
  /** Unobserved background reshuffles. */
  shuffleCount = 0;

  constructor(private world: World, private rules: RuleDef[], private ctx: TopologyContext, seed = 1) {
    this.rng = new Rng(seed);
  }

  start(): void {
    this.fire((t) => t.type === 'start');
  }

  beforeCross(portalId: string, backward: boolean): void {
    this.crossingPortal = portalId;
    try {
      this.fire((t) => t.type === 'beforeCross' && t.portal === portalId && (t.backward === undefined || t.backward === backward));
    } finally {
      this.crossingPortal = null;
    }
  }

  afterCross(portalId: string): void {
    this.fire((t) => t.type === 'afterCross' && t.portal === portalId);
  }

  lever(propId: string, state: boolean): void {
    this.fire((t) => t.type === 'lever' && t.prop === propId && t.state === state);
  }

  solved(propId: string): void {
    this.fire((t) => t.type === 'solved' && t.prop === propId);
  }

  setShards(count: number): void {
    this.shardCount = count;
    this.fire((t) => t.type === 'shards' && count >= t.count);
  }

  update(dt: number): void {
    for (const r of this.rules) {
      if (r.trigger.type !== 'interval') continue;
      const { requires, forbids } = r.trigger;
      if (requires && (this.counters.get(requires.name) ?? 0) < requires.gte) continue;
      if (forbids && (this.counters.get(forbids.name) ?? 0) >= forbids.gte) continue;
      const t = (this.timers.get(r.id) ?? 0) + dt;
      if (t >= r.trigger.every) {
        this.timers.set(r.id, 0);
        this.run(r);
      } else this.timers.set(r.id, t);
    }
    this.flush();
  }

  /** Applies deferred relinks whose portals are no longer observed. */
  flush(): void {
    for (const [pid, target] of [...this.pending]) {
      if (this.ctx.isObserved(pid) || this.ctx.isStraddling(pid)) continue;
      this.pending.delete(pid);
      this.applyLink(pid, target);
    }
  }

  private fire(match: (t: Trigger) => boolean): void {
    for (const r of this.rules) if (match(r.trigger)) this.run(r);
  }

  private run(r: RuleDef): void {
    if (r.once && this.fired.has(r.id)) return;
    this.fired.add(r.id);
    for (const a of r.actions) this.apply(a);
  }

  private applyLink(pid: string, target: string | null, count = true): void {
    const p = this.world.portals.get(pid);
    if (!p || p.def.link === target) return;
    this.world.setLink(pid, target);
    if (count) this.shiftCount++;
    else this.shuffleCount++;
    this.ctx.onShift?.(pid);
  }

  private canApplyNow(pid: string): boolean {
    if (pid === this.crossingPortal) return true;
    return !this.ctx.isStraddling(pid);
  }

  apply(a: Action): void {
    switch (a.type) {
      case 'link': {
        const mode = a.mode ?? 'now';
        if (mode === 'now' && this.canApplyNow(a.portal)) {
          this.pending.delete(a.portal);
          this.applyLink(a.portal, a.target);
        } else if (mode === 'unobserved' && a.portal !== this.crossingPortal && !this.ctx.isObserved(a.portal) && !this.ctx.isStraddling(a.portal)) {
          this.pending.delete(a.portal);
          this.applyLink(a.portal, a.target);
        } else {
          this.pending.set(a.portal, a.target);
        }
        break;
      }
      case 'shuffle':
        this.shuffle(a.portals, a.targets);
        break;
      case 'counter': {
        const v = a.set ?? (this.counters.get(a.name) ?? 0) + (a.add ?? 0);
        this.counters.set(a.name, v);
        this.checkCounters();
        break;
      }
      case 'message':
        this.ctx.message?.(a.text);
        break;
      case 'block':
        this.world.setBlock(a.block, a.on);
        break;
      case 'win':
        this.ctx.win?.();
        break;
    }
  }

  private checkCounters(): void {
    for (const r of this.rules) {
      if (r.trigger.type !== 'counter') continue;
      const ok = (this.counters.get(r.trigger.name) ?? 0) >= r.trigger.gte;
      const was = this.counterState.get(r.id) ?? false;
      this.counterState.set(r.id, ok);
      if (ok && !was) this.run(r);
    }
  }

  /**
   * Reassigns destinations of the unobserved portals among `targets`, keeping every
   * destination unique and leaving observed portals untouched.
   */
  shuffle(portals: string[], targets: string[]): void {
    const free: string[] = [];
    const frozen = new Set<string>();
    for (const pid of portals) {
      if (this.ctx.isObserved(pid) || this.ctx.isStraddling(pid)) {
        const link = this.world.portals.get(pid)?.def.link;
        if (link) frozen.add(link);
      } else free.push(pid);
    }
    const avail = this.rng.shuffle(targets.filter((t) => !frozen.has(t)));
    for (const pid of free) {
      const t = avail.pop();
      if (t === undefined) break;
      this.pending.delete(pid);
      this.applyLink(pid, t, false);
    }
  }
}
