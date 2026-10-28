import * as THREE from 'three';
import type { RegionId, TeamId } from '@sats-wars/shared';
import { REGION_CENTROIDS } from '@sats-wars/shared';
import type { CameraPresetName } from './director';

/** World layout of the arena (units ≈ metres; robots ~4 tall). The gods stand wide apart so the map between them stays readable. */
export const ROBOT_HOME: Record<TeamId, { x: number; z: number; ry: number }> = {
  RAIJIN: { x: -4.6, z: 0.6, ry: Math.PI / 2 - 0.55 },
  FUJIN: { x: 4.6, z: 0.6, ry: -Math.PI / 2 + 0.55 },
};

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

export const CAMERA_PRESETS: Record<
  CameraPresetName,
  { position: [number, number, number]; target: [number, number, number] }
> = {
  intro: { position: [0, 13, 27], target: [0, 4, -2] },
  overview: { position: [0, 6.0, 18.5], target: [0, 4.0, -2.4] },
  // High enough that the gods (z≈0.6) stay below the frame while the map fills it.
  mapFocus: { position: [0, 11.5, 6.5], target: [0, 6.2, -8.5] },
  clash: { position: [0, 3.3, 9.2], target: [0, 2.5, 0] },
  specialRAIJIN: { position: [-0.8, 3.4, 11], target: [-3.0, 3.2, 0.4] },
  specialFUJIN: { position: [0.8, 3.8, 12], target: [3.0, 3.8, 0.4] },
  final: { position: [0, 4.0, 13], target: [0, 3.0, 0] },
  victoryRAIJIN: { position: [-1.2, 3.4, 10.5], target: [-3.0, 3.2, 0.4] },
  victoryFUJIN: { position: [1.2, 3.6, 10.5], target: [3.0, 3.4, 0.4] },
};

/** The invaders' colour: outside the brand palette on purpose, so "enemy" reads instantly. */
export const ALIEN_COLOR = '#B65CFF';

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
