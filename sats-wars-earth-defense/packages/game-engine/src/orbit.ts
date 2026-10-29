import type { EnemyOrbit } from '@swed/shared';

/**
 * Enemy placement is a pure function of time, so the big screen animates smoothly between
 * 10 Hz snapshots and the engine agrees on which sector an attack comes from.
 * Scene convention: RAIJIN at the origin facing -Z; bearing +90 is to its right (+X).
 */
export function enemyBearingAt(orbit: EnemyOrbit, spawnedAt: number, t: number): number {
  const k = ((t - spawnedAt) / orbit.driftPeriodMs) * Math.PI * 2;
  return orbit.bearing0 + orbit.driftAmp * Math.sin(orbit.phase + k);
}

export function enemyPositionAt(
  orbit: EnemyOrbit,
  spawnedAt: number,
  t: number,
): { x: number; y: number; z: number; bearing: number } {
  const bearing = enemyBearingAt(orbit, spawnedAt, t);
  const r = (bearing * Math.PI) / 180;
  const bob = Math.sin(orbit.phase * 3 + (t - spawnedAt) / 1300) * 1.2;
  return {
    x: Math.sin(r) * orbit.distance,
    y: orbit.altitude + bob,
    z: -Math.cos(r) * orbit.distance,
    bearing,
  };
}

/** Half-width (deg) an orbit may drift and still stay inside its starting sector. */
export function sectorMargin(bearing: number): number {
  const b = ((((bearing + 180) % 360) + 360) % 360) - 180;
  const boundaries = [-135, -45, 45, 135, 180, -180];
  return Math.min(...boundaries.map((x) => Math.abs(b - x)));
}
