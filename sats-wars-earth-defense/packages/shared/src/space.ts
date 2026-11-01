/**
 * The setting (D-034): the alien mothership NULL CORE flies from Mars past the Moon to Earth
 * during the battle. Six allied squads hold the route, two in each area; the mothership
 * attacks the squads of the area it is passing. Reaching Earth is the time limit.
 *
 * Route coordinates are a flat tactical plane for the big screen's hologram (x grows toward
 * Earth). They are a diagram, not astronomy.
 */

export const ZONE_IDS = ['MARS', 'MOON', 'EARTH'] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

export interface ZoneDef {
  id: ZoneId;
  /** Area name on the HUD. */
  nameJa: string;
  nameEn: string;
  /** The planet the area is named after (and the one in the sky on the big screen). */
  planetJa: string;
}

export const ZONES: Record<ZoneId, ZoneDef> = {
  MARS: { id: 'MARS', nameJa: '火星宙域', nameEn: 'MARS SECTOR', planetJa: '火星' },
  MOON: { id: 'MOON', nameJa: '月宙域', nameEn: 'MOON SECTOR', planetJa: '月' },
  EARTH: { id: 'EARTH', nameJa: '地球軌道', nameEn: 'EARTH ORBIT', planetJa: '地球' },
};

export const SQUAD_IDS = [
  'MARS_BASE',
  'PHOBOS',
  'LUNAR_FLEET',
  'MOON_BASE',
  'STATION',
  'EARTH_GUARD',
] as const;
export type SquadId = (typeof SQUAD_IDS)[number];

export interface MapPoint {
  x: number;
  y: number;
}

export interface SquadDef {
  id: SquadId;
  nameJa: string;
  nameEn: string;
  zone: ZoneId;
  /** Position on the route hologram. */
  at: MapPoint;
}

export const SQUADS: Record<SquadId, SquadDef> = {
  MARS_BASE: {
    id: 'MARS_BASE',
    nameJa: '火星基地',
    nameEn: 'MARS BASE',
    zone: 'MARS',
    at: { x: -10, y: -2.4 },
  },
  PHOBOS: {
    id: 'PHOBOS',
    nameJa: 'フォボス砲台',
    nameEn: 'PHOBOS BATTERY',
    zone: 'MARS',
    at: { x: -6.5, y: 2.6 },
  },
  LUNAR_FLEET: {
    id: 'LUNAR_FLEET',
    nameJa: '月軌道艦隊',
    nameEn: 'LUNAR FLEET',
    zone: 'MOON',
    at: { x: -1, y: 2.6 },
  },
  MOON_BASE: {
    id: 'MOON_BASE',
    nameJa: '月面基地',
    nameEn: 'MOON BASE',
    zone: 'MOON',
    at: { x: 2, y: -2.4 },
  },
  STATION: {
    id: 'STATION',
    nameJa: '宇宙ステーション',
    nameEn: 'SPACE STATION',
    zone: 'EARTH',
    at: { x: 6.5, y: 2.6 },
  },
  EARTH_GUARD: {
    id: 'EARTH_GUARD',
    nameJa: '地球防衛隊',
    nameEn: 'EARTH GUARD',
    zone: 'EARTH',
    at: { x: 10, y: -2.4 },
  },
};

/** Where the planets sit on the route hologram (Mars at the start, Earth at the end). */
export const PLANET_POINTS: Record<ZoneId, MapPoint> = {
  MARS: { x: -11.5, y: 0 },
  MOON: { x: 1, y: 0 },
  EARTH: { x: 11.5, y: 0 },
};

/**
 * How far the mothership has flown, 0 (at Mars, battle start) .. 1 (at Earth, time up).
 * Before the battle it waits at Mars; after it, the trip is over.
 */
export function routeProgress(
  s: { phase: string; t: number; phaseStartedAt: number },
  battleMs: number,
  at: number = s.t,
): number {
  if (s.phase === 'BATTLE') return Math.min(1, Math.max(0, (at - s.phaseStartedAt) / battleMs));
  if (s.phase === 'VICTORY' || s.phase === 'DEFEAT' || s.phase === 'RESULTS') return 1;
  return 0;
}

/** The area the mothership is in: thirds of the trip. */
export function zoneAt(progress: number): ZoneId {
  return progress < 1 / 3 ? 'MARS' : progress < 2 / 3 ? 'MOON' : 'EARTH';
}

/** The mothership's point on the route hologram (straight from Mars to Earth). */
export function mothershipPoint(progress: number): MapPoint {
  const a = PLANET_POINTS.MARS;
  const b = PLANET_POINTS.EARTH;
  return { x: a.x + (b.x - a.x) * progress, y: 0 };
}
