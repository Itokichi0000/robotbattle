import * as THREE from 'three';
import type { Enemy, RegionId, TeamId, Telegraph } from '@sats-wars/shared';
import { REGION_CENTROIDS } from '@sats-wars/shared';
import type { CameraPresetName, FxTarget } from './director';

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
  cockpit: { position: [0, -25.4, 10.5], target: [0, -29.6, 0] },
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

export const QUALITY_SETTINGS: Record<
  Quality,
  { dpr: [number, number]; shadows: boolean; particles: number; antialias: boolean; stars: number }
> = {
  low: { dpr: [0.75, 1], shadows: false, particles: 120, antialias: false, stars: 150 },
  medium: { dpr: [1, 1.5], shadows: false, particles: 300, antialias: true, stars: 400 },
  high: { dpr: [1, 2], shadows: true, particles: 600, antialias: true, stars: 800 },
};
