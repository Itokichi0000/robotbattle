import * as THREE from 'three';
import type { Enemy, RegionId, TeamId, Telegraph } from '@sats-wars/shared';
import { REGION_CENTROIDS } from '@sats-wars/shared';
import type { CameraPresetName, FxTarget, ShotName } from './director';

/**
 * World layout of the arena (units ≈ metres; robots ~4 tall). Two stages
 * share the same game and cues (D-073):
 *  - `table`: the war table — RAIJIN and FUJIN either side of the hologram of
 *    Japan, NULL CORE looming behind the map (pilot screens, `?stage=table`);
 *  - `battlefield`: the Tokyo Bay defence line for the venue screen — both
 *    machines on a coastal deck facing the sea, NULL CORE over the water, the
 *    eight cities as lights along the horizon.
 * `applyStage` switches every exported layout object in place, so importers
 * keep their references. One stage per page.
 */
export type StageName = 'table' | 'battlefield';

type Home = { x: number; z: number; ry: number };

const HOMES: Record<StageName, Record<TeamId, Home>> = {
  // Wide apart so the hologram between them stays readable, turned toward it.
  table: {
    RAIJIN: { x: -4.6, z: 0.6, ry: Math.PI / 2 + 0.35 },
    FUJIN: { x: 4.6, z: 0.6, ry: -Math.PI / 2 - 0.35 },
  },
  // Side by side facing the sea (-Z), toed in a little toward NULL CORE.
  battlefield: {
    RAIJIN: { x: -2.8, z: 1.2, ry: Math.PI - 0.12 },
    FUJIN: { x: 2.8, z: 1.6, ry: Math.PI + 0.12 },
  },
};

export const ROBOT_HOME: Record<TeamId, Home> = {
  RAIJIN: { ...HOMES.table.RAIJIN },
  FUJIN: { ...HOMES.table.FUJIN },
};

/**
 * Table: NULL CORE hovers above and behind the map — from the overview camera
 * it sits between the hologram's top edge (~7°) and the top of the frame
 * (~18°), so the map never hides it. Battlefield: over the bay, close enough
 * to dwarf the machines from behind their shoulders.
 */
const BOSS: Record<StageName, { position: [number, number, number]; scale: number }> = {
  table: { position: [0, 14.2, -17], scale: 3.2 },
  battlefield: { position: [0, 12.5, -34], scale: 5 },
};
export const BOSS_POSITION = new THREE.Vector3(...BOSS.table.position);
export let BOSS_SCALE = BOSS.table.scale;

/** Shared reserve reactor (ROUTER → RESERVE) on the stage floor between the robots. */
const RESERVE: Record<StageName, [number, number, number]> = {
  table: [0, 1.0, 2.4],
  // just in front of the machines, the thing they stand guard over
  battlefield: [0, 0, -1.4],
};
export const RESERVE_POSITION = new THREE.Vector3(...RESERVE.table);

/** Fraction of the distance to the centre a robot covers when fully advanced. */
export const ADVANCE_FRACTION = 0.62;

export let STAGE: StageName = 'table';

/**
 * Where a robot stands when `advance` (0..1) of the way into the fight: on the
 * table toward the map in the middle, on the battlefield forward to the edge
 * of the deck.
 */
export function advancedPosition(teamId: TeamId, advance: number): { x: number; z: number } {
  const h = ROBOT_HOME[teamId];
  if (STAGE === 'battlefield') return { x: h.x * (1 - 0.18 * advance), z: h.z - 3.2 * advance };
  return { x: h.x * (1 - ADVANCE_FRACTION * advance), z: h.z };
}

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

/**
 * The cities on the battlefield horizon, west (Kyushu) to east (Hokkaido) from
 * left to right as on the tactical map: an arc ~420 m out across the bay, far
 * enough to read as skylines rather than a block next door.
 */
export const HORIZON_CITY_RADIUS = 420;
const HORIZON_ORDER: RegionId[] = [
  'kyushu',
  'shikoku',
  'chugoku',
  'kinki',
  'chubu',
  'kanto',
  'tohoku',
  'hokkaido',
];
/** Sea level under the battlefield deck. */
export const SEA_LEVEL = -2.4;

export function horizonCityPosition(regionId: RegionId): THREE.Vector3 {
  const i = HORIZON_ORDER.indexOf(regionId);
  const a = THREE.MathUtils.degToRad(-40 + (80 * i) / (HORIZON_ORDER.length - 1));
  return new THREE.Vector3(
    Math.sin(a) * HORIZON_CITY_RADIUS,
    SEA_LEVEL,
    -Math.cos(a) * HORIZON_CITY_RADIUS,
  );
}

/** World position of a city: its centroid on the hologram map, or its skyline on the horizon. */
export function regionWorldPosition(regionId: RegionId, lift = 0.2): THREE.Vector3 {
  if (STAGE === 'battlefield')
    return horizonCityPosition(regionId).add(new THREE.Vector3(0, 12 + lift * 20, 0));
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
  const side = index % 2 === 0 ? -1 : 1;
  const k = Math.floor(index / 2) % 3;
  if (STAGE === 'battlefield') {
    // Peeled off NULL CORE toward its city, low enough to read against the sky.
    if (tg && tg.targets[0]) {
      const dir = regionWorldPosition(tg.targets[0]).sub(BOSS_POSITION).setY(0).normalize();
      return BOSS_POSITION.clone()
        .addScaledVector(dir, 15 + k * 3)
        .setY(7 + k * 1.2);
    }
    return new THREE.Vector3(side * (11 + k * 3.2), 8.5 + k * 1.1, -27 + k * 2);
  }
  if (tg && tg.targets[0]) return regionWorldPosition(tg.targets[0], 2.6);
  // Idle escorts flank NULL CORE (left/right alternately) instead of covering it.
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

type Preset = { position: [number, number, number]; target: [number, number, number] };

const TABLE_PRESETS: Record<CameraPresetName, Preset> = {
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

type Pose = Preset;
type Shot = { from: Pose; to: Pose; duration: number };

/**
 * Cinematic moves (director shots): eased from `from` to `to` over `duration`
 * director seconds, then held. `cityFall` is relative to the fallen city.
 */
const TABLE_SHOTS: Record<ShotName, Shot> = {
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

/**
 * Battlefield cameras: third person by default — low behind the machines'
 * shoulders with NULL CORE over the bay between them — and front-on for the
 * hero beats. Same names and timings as the table.
 */
const BATTLEFIELD_PRESETS: Record<CameraPresetName, Preset> = {
  intro: { position: [0, 9.5, 24], target: [0, 6, -22] },
  overview: { position: [0, 3.4, 14.5], target: [0, 5.6, -18] },
  boss: { position: [7, 7.5, -9], target: [0, 12.5, -34] },
  // Threats: the horizon with the cities, over the machines' heads.
  mapFocus: { position: [0, 7.5, 13], target: [0, 6, -300] },
  special: { position: [0, 1.6, 9], target: [0, 8.5, -22] },
  final: { position: [0.6, 3.2, -9.5], target: [0, 3.1, 1.2] },
  cityDefense: { position: [9, 4.5, 7], target: [-40, 10, -300] },
  gunnerImpact: { position: [-6.2, 5.6, 6.5], target: [3, 9, -26] },
  routerPulse: { position: [0.8, 2.6, 6.5], target: [0, 0.9, -1.4] },
  repairRecovery: { position: [-1.5, 3.2, -7.5], target: [0, 2.8, 1.4] },
  specialCharge: { position: [0, 1.8, -6.5], target: [0, 3.6, 1.2] },
  cockpit: TABLE_PRESETS.cockpit,
  hangar: { position: [0, 2.4, -11], target: [0, 2.6, 1.4] },
  hangarRaijin: { position: [-1.2, 2.5, -6.2], target: [-3.4, 2.3, 1.2] },
  hangarFujin: { position: [1.2, 2.6, -6.2], target: [3.4, 2.4, 1.6] },
};

const BATTLEFIELD_SHOTS: Record<ShotName, Shot> = {
  // Low in front of the two gods, looking up as they power up.
  specialRise: {
    from: { position: [0, 0.9, -7.5], target: [0, 3.4, 1.2] },
    to: { position: [0, 1.5, -6], target: [0, 4.8, 1] },
    duration: 1.6,
  },
  // From behind the machines, pushing out over the water toward NULL CORE.
  specialLaunch: {
    from: { position: [0, 3.2, 13], target: [0, 8, -22] },
    to: { position: [0, 6.5, 0], target: [0, 12.5, -34] },
    duration: 1.2,
  },
  bossImpact: {
    from: { position: [13, 12, -15], target: [0, 12.5, -34] },
    to: { position: [9, 11.5, -19], target: [0, 12.5, -34] },
    duration: 1.8,
  },
  heroes: {
    from: { position: [-4.5, 2, -8.5], target: [0, 3, 1.2] },
    to: { position: [4.5, 2.5, -9], target: [0, 3.3, 1.2] },
    duration: 2,
  },
  bossReveal: {
    from: { position: [0, 2.2, 12.5], target: [0, 6, -22] },
    to: { position: [0, 7, 2], target: [0, 12.5, -34] },
    duration: 3,
  },
  // Over NULL CORE's shoulder, down at the machines on the deck.
  bossGlare: {
    from: { position: [8, 16, -24], target: [0, 2, 1] },
    to: { position: [5, 14, -20], target: [0, 2, 1] },
    duration: 2.2,
  },
  bossDown: {
    from: { position: [-7, 2.5, 9], target: [0, 12.5, -34] },
    to: { position: [-4, 4, 2], target: [0, 12.5, -34] },
    duration: 2.4,
  },
  // Relative to the fallen city: from out on the water toward its skyline.
  cityFall: {
    from: { position: [0, 16, 150], target: [0, 4, 0] },
    to: { position: [0, 10, 105], target: [0, 6, 0] },
    duration: 2,
  },
};

export const CAMERA_PRESETS: Record<CameraPresetName, Preset> = { ...TABLE_PRESETS };
export const CAMERA_SHOTS: Record<ShotName, Shot> = { ...TABLE_SHOTS };

/** Switches the layout objects above to a stage (in place; idempotent). */
export function applyStage(stage: StageName): void {
  if (STAGE === stage) return;
  STAGE = stage;
  Object.assign(ROBOT_HOME.RAIJIN, HOMES[stage].RAIJIN);
  Object.assign(ROBOT_HOME.FUJIN, HOMES[stage].FUJIN);
  BOSS_POSITION.set(...BOSS[stage].position);
  BOSS_SCALE = BOSS[stage].scale;
  RESERVE_POSITION.set(...RESERVE[stage]);
  Object.assign(CAMERA_PRESETS, stage === 'battlefield' ? BATTLEFIELD_PRESETS : TABLE_PRESETS);
  Object.assign(CAMERA_SHOTS, stage === 'battlefield' ? BATTLEFIELD_SHOTS : TABLE_SHOTS);
}

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
