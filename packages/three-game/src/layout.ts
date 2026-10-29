import * as THREE from 'three';
import type { Enemy, RegionId, TeamId, Telegraph } from '@sats-wars/shared';
import { REGION_CENTROIDS } from '@sats-wars/shared';
import type { CameraPresetName, FxTarget, ShotName } from './director';

/**
 * World layout of the arena (units ≈ metres; robots ~4 tall). RAIJIN and
 * FUJIN stand on the same side, wide apart so the hologram of Japan between
 * them stays readable, turned toward NULL CORE looming behind the map.
 */
export const ROBOT_HOME: Record<TeamId, { x: number; z: number; ry: number }> = {
  RAIJIN: { x: -4.6, z: 0.6, ry: Math.PI / 2 + 0.35 },
  FUJIN: { x: 4.6, z: 0.6, ry: -Math.PI / 2 - 0.35 },
};

/**
 * NULL CORE hovers above and behind the map: from the overview camera it sits
 * between the hologram's top edge (~7°) and the top of the frame (~18°), so the
 * map never hides it.
 */
export const BOSS_POSITION = new THREE.Vector3(0, 14.2, -17);
export const BOSS_SCALE = 3.2;

/** Shared reserve reactor (ROUTER → RESERVE) on the stage floor between the robots. */
export const RESERVE_POSITION = new THREE.Vector3(0, 1.0, 2.4);

/** Fraction of the distance to the centre a robot covers when fully advanced. */
export const ADVANCE_FRACTION = 0.62;

export const MAP_TRANSFORM = {
  position: new THREE.Vector3(0, 6.4, -8.5),
  rotation: new THREE.Euler(-0.62, 0, 0),
  scale: 0.66,
};

const mapMatrix = new THREE.Matrix4().compose(
  MAP_TRANSFORM.position,
  new THREE.Quaternion().setFromEuler(MAP_TRANSFORM.rotation),
  new THREE.Vector3(MAP_TRANSFORM.scale, MAP_TRANSFORM.scale, MAP_TRANSFORM.scale),
);

/** World position of a region centroid on the hologram map. */
export function regionWorldPosition(regionId: RegionId, lift = 0.2): THREE.Vector3 {
  const c = REGION_CENTROIDS[regionId];
  return new THREE.Vector3(c.x, c.y, lift / MAP_TRANSFORM.scale).applyMatrix4(mapMatrix);
}

export function robotWorldPosition(teamId: TeamId, height = 2): THREE.Vector3 {
  const h = ROBOT_HOME[teamId];
  return new THREE.Vector3(h.x, height, h.z);
}

/**
 * Escort drones float over the city they are aiming at (so the threat reads on
 * the map); idle ones wait in a row near the boss. Deterministic from state.
 */
export function enemyWorldPosition(
  e: Pick<Enemy, 'id' | 'kind'>,
  telegraphs: Telegraph[],
  index = 0,
): THREE.Vector3 {
  if (e.kind === 'BOSS') return BOSS_POSITION.clone();
  const tg = telegraphs.find((t) => t.enemyId === e.id);
  if (tg && tg.targets[0]) return regionWorldPosition(tg.targets[0], 2.6);
  // Idle escorts flank NULL CORE (left/right alternately) instead of covering it.
  const side = index % 2 === 0 ? -1 : 1;
  const k = Math.floor(index / 2) % 3;
  return new THREE.Vector3(side * (7.5 + k * 2.4), 12.5 + k * 0.7, -13);
}

export interface TargetContext {
  enemies: Enemy[];
  telegraphs: Telegraph[];
}

/** World position of an effect target; null if it no longer exists. */
export function resolveFxTarget(t: FxTarget | null, ctx: TargetContext): THREE.Vector3 | null {
  if (!t) return null;
  switch (t.kind) {
    case 'city':
      return regionWorldPosition(t.id, 0.4);
    case 'robot':
      return robotWorldPosition(t.id, 2.6);
    case 'reserve':
      return RESERVE_POSITION.clone();
    case 'enemy': {
      const escorts = ctx.enemies.filter((e) => e.kind !== 'BOSS');
      const e = ctx.enemies.find((x) => x.id === t.id);
      if (!e) return t.id >= 0 ? BOSS_POSITION.clone() : null;
      return enemyWorldPosition(e, ctx.telegraphs, escorts.indexOf(e));
    }
  }
}

export const CAMERA_PRESETS: Record<
  CameraPresetName,
  { position: [number, number, number]; target: [number, number, number] }
> = {
  intro: { position: [0, 13, 27], target: [0, 5, -4] },
  overview: { position: [0, 6.5, 19], target: [0, 5.2, -4.5] },
  boss: { position: [0, 11, 4], target: [0, 14.5, -17] },
  // High enough that the gods (z≈0.6) stay below the frame while the map fills it.
  mapFocus: { position: [0, 11.5, 6.5], target: [0, 6.2, -8.5] },
  special: { position: [0, 3.2, 10], target: [0, 6, -10] },
  final: { position: [0, 4.0, 13], target: [0, 3.0, 0] },
  // Short beats (2 s) on what just happened.
  cityDefense: { position: [6.5, 8.5, 2.5], target: [0, 6.2, -8.5] },
  gunnerImpact: { position: [-8.5, 4.2, 6], target: [2, 9, -12] },
  routerPulse: { position: [0, 3.2, 8.5], target: [0, 1.2, 2.4] },
  repairRecovery: { position: [0, 3.6, 9.5], target: [0, 2.8, 0.6] },
  specialCharge: { position: [0, 2.6, 7.5], target: [0, 3.4, 0.6] },
  // Inside the machine: the pilots' seat bay (COCKPIT_POSITION), out of the arena's view.
  cockpit: { position: [0, -26, 9.5], target: [0, -29.3, -2.5] },
  // Pre-launch hangar (pilot screens): low and close so the machines read big.
  // The single-robot views put it left of centre, clear of the station list.
  // 3/4 front of each machine (it faces the map, half turned from the room).
  hangar: { position: [0, 2.2, 13.5], target: [0, 2.6, 0] },
  hangarRaijin: { position: [1.33, 2.4, 7.64], target: [-3.53, 2.1, -0.3] },
  hangarFujin: { position: [-1.33, 2.6, 7.64], target: [5.67, 2.4, 1.5] },
};

type Pose = { position: [number, number, number]; target: [number, number, number] };

/**
 * Cinematic moves (director shots): eased from `from` to `to` over `duration`
 * director seconds, then held. `cityFall` is relative to the fallen city.
 */
export const CAMERA_SHOTS: Record<ShotName, { from: Pose; to: Pose; duration: number }> = {
  // Low between the two gods, looking up as they power up.
  specialRise: {
    from: { position: [0, 0.9, 9.6], target: [0, 3.4, 0.6] },
    to: { position: [0, 1.5, 8.2], target: [0, 4.6, 0] },
    duration: 1.6,
  },
  // From behind the robots, pushing toward NULL CORE as the bolt and the wind fly.
  specialLaunch: {
    from: { position: [0, 3.2, 12.5], target: [0, 7.5, -12] },
    to: { position: [0, 6, 4.5], target: [0, 12.5, -16] },
    duration: 1.2,
  },
  bossImpact: {
    from: { position: [6, 11, -5], target: [0, 14, -17] },
    to: { position: [3.6, 12.2, -8.5], target: [0, 14.2, -17] },
    duration: 1.8,
  },
  // A slow slide across the heroes after the blow.
  heroes: {
    from: { position: [-3, 2, 8], target: [0, 3, 0.4] },
    to: { position: [3, 2.5, 9], target: [0, 3.3, 0.4] },
    duration: 2,
  },
  bossReveal: {
    from: { position: [0, 2.2, 10], target: [0, 8, -10] },
    to: { position: [0, 9, 3], target: [0, 14.5, -17] },
    duration: 3,
  },
  // Beside NULL CORE, looking down at the map as its beam answers.
  bossGlare: {
    from: { position: [5, 17, -10], target: [0, 6.4, -8.5] },
    to: { position: [3, 15, -4.5], target: [0, 6.4, -8.5] },
    duration: 2.2,
  },
  // Low on the stage, looking up as NULL CORE breaks apart.
  bossDown: {
    from: { position: [-6, 3.5, 7], target: [0, 13, -17] },
    to: { position: [-3, 5.5, 3], target: [0, 14, -17] },
    duration: 2.4,
  },
  cityFall: {
    from: { position: [0, 3.8, 7], target: [0, 0, 0] },
    to: { position: [0, 2.6, 4.6], target: [0, 0, 0] },
    duration: 2,
  },
};

/** The virtual cockpit bay sits under the stage (hidden by the floor from the arena cameras). */
export const COCKPIT_POSITION = new THREE.Vector3(0, -30, 0);

/** The Corruptors' colour: ink black / violet / red, outside the brand palette so "enemy" reads instantly. */
export const ALIEN_COLOR = '#B65CFF';
export const CORRUPT_RED = '#FF3B5C';

export const TEAM_COLORS: Record<TeamId | 'NEUTRAL', string> = {
  RAIJIN: '#F7931A',
  FUJIN: '#25C8D7',
  NEUTRAL: '#41506E',
};

export type Quality = 'low' | 'medium' | 'high';

export interface QualityConfig {
  dpr: [number, number];
  shadows: boolean;
  antialias: boolean;
  stars: number;
  /** Particle pools: glowing sprites (sparks, embers, flashes), smoke puffs, metal debris; pooled impact lights. */
  fx: { glow: number; smoke: number; debris: number; lights: number };
  /**
   * Post-processing (bloom on emissive parts, vignette, flash and colour fringe
   * on big moments). null = render straight to the screen (cheapest).
   */
  post: {
    bloom: number;
    radius: number;
    threshold: number;
    /** Bloom buffer size relative to the screen. */
    bloomScale: number;
    /** MSAA samples of the HDR buffer. */
    samples: number;
    aberration: boolean;
  } | null;
  /** Strength of the stage's reflected light on metal (procedural, no image files). */
  envIntensity: number;
}

export const QUALITY_SETTINGS: Record<Quality, QualityConfig> = {
  low: {
    dpr: [0.75, 1],
    shadows: false,
    antialias: false,
    stars: 150,
    fx: { glow: 240, smoke: 0, debris: 0, lights: 0 },
    post: null,
    envIntensity: 0.35,
  },
  medium: {
    dpr: [1, 1.5],
    shadows: false,
    antialias: true,
    stars: 400,
    fx: { glow: 700, smoke: 60, debris: 36, lights: 1 },
    post: {
      // Bloom passes bright pixels through at full value and the robots' glow
      // parts run far above 1, so a little goes a long way.
      bloom: 0.32,
      radius: 0.3,
      threshold: 1.1,
      bloomScale: 0.5,
      samples: 4,
      aberration: false,
    },
    envIntensity: 0.45,
  },
  high: {
    dpr: [1, 2],
    shadows: true,
    antialias: true,
    stars: 800,
    fx: { glow: 1600, smoke: 140, debris: 96, lights: 2 },
    post: { bloom: 0.4, radius: 0.35, threshold: 1, bloomScale: 1, samples: 4, aberration: true },
    envIntensity: 0.5,
  },
};
