// Serializable level format. Everything the editor saves and the generators emit is a LevelData.

export type Vec3T = [number, number, number];

export type MaterialKey =
  | 'plaster'
  | 'checker'
  | 'marble'
  | 'tile'
  | 'night'
  | 'grid'
  | 'wood'
  | 'glow'
  | 'brick'
  | 'hedge'
  | 'cloud'
  | 'gold';

export const MATERIAL_KEYS: MaterialKey[] = [
  'plaster', 'checker', 'marble', 'tile', 'night', 'grid', 'wood', 'glow', 'brick', 'hedge', 'cloud', 'gold',
];

export interface BlockDef {
  id: string;
  min: Vec3T;
  max: Vec3T;
  mat: MaterialKey;
  /** Ramps are solid below a surface that rises linearly towards `ramp` direction. */
  kind?: 'box' | 'ramp';
  ramp?: 'x+' | 'x-' | 'z+' | 'z-';
  /** Initial collision state (default true). */
  solid?: boolean;
  /** Initial render state (default true). */
  visible?: boolean;
  /** Dynamic blocks are toggled at runtime by rules and are rendered individually. */
  dynamic?: boolean;
}

export type FrameStyle = 'none' | 'arch' | 'glow';

export interface PortalDef {
  id: string;
  /** Bottom-centre of the portal rectangle. */
  pos: Vec3T;
  /** Rotation about +Y. The portal's front normal is (sin yaw, 0, cos yaw). */
  yaw: number;
  width: number;
  height: number;
  /** Target portal id. Entering this portal from its front puts you out of the target's front. */
  link: string | null;
  frame?: FrameStyle;
  color?: string;
}

export type PropDef =
  | { id: string; type: 'shard'; pos: Vec3T; color?: string }
  | { id: string; type: 'lever'; pos: Vec3T; yaw: number; state?: boolean }
  | { id: string; type: 'cube'; pos: Vec3T; size: number }
  | { id: string; type: 'sign'; pos: Vec3T; yaw: number; text: string; size?: number }
  | { id: string; type: 'light'; pos: Vec3T; color: string; radius?: number }
  | {
      id: string;
      type: 'anamorph';
      /** Eye position from which the scattered fragments line up. */
      viewpoint: Vec3T;
      /** Blocks that become solid once the illusion is resolved (start disabled). */
      blocks: string[];
      seed: number;
      /** Max eye distance from viewpoint (m). */
      tolerance?: number;
    }
  | { id: string; type: 'goal'; pos: Vec3T; radius: number };

export interface CounterCond {
  name: string;
  gte: number;
}

export type Trigger =
  | { type: 'start' }
  | { type: 'beforeCross'; portal: string; backward?: boolean }
  | { type: 'afterCross'; portal: string }
  | { type: 'lever'; prop: string; state: boolean }
  | { type: 'counter'; name: string; gte: number }
  | { type: 'shards'; count: number }
  | { type: 'interval'; every: number; requires?: CounterCond; forbids?: CounterCond }
  | { type: 'solved'; prop: string };

export type Action =
  | { type: 'link'; portal: string; target: string | null; mode?: 'now' | 'unobserved' }
  | { type: 'shuffle'; portals: string[]; targets: string[] }
  | { type: 'counter'; name: string; add?: number; set?: number }
  | { type: 'message'; text: string }
  | { type: 'block'; block: string; on: boolean }
  | { type: 'win' };

export interface RuleDef {
  id: string;
  trigger: Trigger;
  actions: Action[];
  once?: boolean;
}

export interface EnvDef {
  skyTop: string;
  skyBottom: string;
  fogColor: string;
  fogDensity: number;
  stars?: number;
}

export interface LevelData {
  version: 1;
  name: string;
  spawn: { pos: Vec3T; yaw: number };
  env: EnvDef;
  blocks: BlockDef[];
  portals: PortalDef[];
  props: PropDef[];
  rules: RuleDef[];
  /** Free-form metadata (generator seeds, puzzle solutions, hints...). */
  meta?: Record<string, unknown>;
}

export const DEFAULT_ENV: EnvDef = {
  skyTop: '#2a2350',
  skyBottom: '#f3b5c8',
  fogColor: '#e9b8cf',
  fogDensity: 0.014,
  stars: 0.6,
};
