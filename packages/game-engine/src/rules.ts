import type {
  CityState,
  Enemy,
  EnergySink,
  Facility,
  GameConfig,
  RaidPhase,
  RaidState,
  RegionId,
  RepairTarget,
  RobotId,
  RobotState,
  Role,
  Telegraph,
  Weakpoint,
} from '@sats-wars/shared';
import { CITY_INFO, REGION_IDS } from '@sats-wars/shared';

/** Read-only view the helpers need (also buildable from a public snapshot). */
export type Board = Pick<
  RaidState,
  'config' | 'cities' | 'robots' | 'enemies' | 'telegraphs' | 'bossId' | 'reserveEnergy' | 'jammedUntil' | 'gameMs' | 'phase'
>;

export const ms = (seconds: number) => seconds * 1000;

export function standingCities(cities: Record<RegionId, CityState>): RegionId[] {
  return REGION_IDS.filter((id) => !cities[id].destroyed);
}

/** A facility works while its city stands. */
export function facilityActive(b: Pick<Board, 'cities'>, f: Facility): boolean {
  const id = REGION_IDS.find((r) => CITY_INFO[r].facility === f)!;
  return !b.cities[id].destroyed;
}

/** Phase for a game time (combat only). */
export function phaseAt(c: GameConfig, gameMs: number): RaidPhase {
  const p = c.phaseStartsSeconds;
  if (gameMs >= ms(p.FINAL_WAVE)) return 'FINAL_WAVE';
  if (gameMs >= ms(p.WAVE_3)) return 'WAVE_3';
  if (gameMs >= ms(p.WAVE_2)) return 'WAVE_2';
  if (gameMs >= ms(p.WAVE_1)) return 'WAVE_1';
  return 'INTRO_TRAINING';
}

/** Pilots seen (boarded, asked for or finished a task) within the active window. */
export function activePilotIds(s: Pick<RaidState, 'pilots' | 'gameMs' | 'config'>): string[] {
  const since = s.gameMs - ms(s.config.activeWindowSeconds);
  return Object.values(s.pilots)
    .filter((p) => p.lastActiveAt >= since)
    .map((p) => p.pilotId);
}

/** Enemy HP multiplier from the (smoothed) number of active pilots. */
export function difficultyScale(c: GameConfig, activePilots: number): number {
  return Math.min(c.difficultyMaxScale, Math.max(c.difficultyMinScale, activePilots / c.difficultyReferencePilots));
}

/**
 * Crowd normalisation per seat: a seat runs at full strength with up to
 * `roleFairShare` of the active crew in it (at least one pilot). More pilots
 * succeeding in the same seat recently share that strength, so spreading over
 * all four seats is always stronger than piling onto one.
 */
export function roleScale(s: Pick<RaidState, 'pilots' | 'gameMs' | 'config'>, role: Role, includePilotId?: string): number {
  const since = s.gameMs - ms(s.config.activeWindowSeconds);
  const ids = new Set(
    Object.values(s.pilots)
      .filter((p) => (p.lastSuccessAt[role] ?? -Infinity) >= since)
      .map((p) => p.pilotId),
  );
  if (includePilotId) ids.add(includePilotId);
  const fair = Math.max(1, activePilotIds(s).length * s.config.roleFairShare);
  return Math.min(1, fair / Math.max(1, ids.size));
}

/** Seat effect multiplier of a robot: health, damaged component and stored energy. */
export function robotPower(c: GameConfig, r: RobotState): number {
  const health = 0.6 + (0.4 * r.health) / 100;
  const component = r.componentDamaged ? c.damagedComponentFactor : 1;
  return health * component * (1 + (c.energyBoostMax * r.energy) / 100);
}

export const ROBOT_FOR_ROLE: Partial<Record<Role, RobotId>> = { GUNNER: 'RAIJIN', GUARDIAN: 'FUJIN' };

export function liveEnemies(b: Pick<Board, 'enemies'>): Enemy[] {
  return b.enemies.filter((e) => e.hp > 0);
}

/** Threats in the order they will land. */
export function upcomingTelegraphs(b: Pick<Board, 'telegraphs'>): Telegraph[] {
  return [...b.telegraphs].sort((a, z) => a.resolvesAt - z.resolvesAt || a.id - z.id);
}

/** Damage each city would take from the pending telegraphs (after current shields). */
export function pendingCityDamage(b: Pick<Board, 'telegraphs' | 'cities' | 'enemies'>): Partial<Record<RegionId, number>> {
  const raw: Partial<Record<RegionId, number>> = {};
  for (const t of b.telegraphs) {
    const e = b.enemies.find((x) => x.id === t.enemyId);
    const dmg = Math.round(t.damage * (1 - (e?.weaken ?? 0)));
    for (const id of t.targets) raw[id] = (raw[id] ?? 0) + dmg;
  }
  const out: Partial<Record<RegionId, number>> = {};
  for (const id of REGION_IDS) {
    const d = (raw[id] ?? 0) - b.cities[id].shield;
    if (d > 0 && !b.cities[id].destroyed) out[id] = d;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recommendations ("今の緊急ミッション") — also the default target of a seat
// ---------------------------------------------------------------------------

export function recommendGunnerTarget(b: Board): { enemyId: number; weakpoint: Weakpoint } | null {
  const enemies = liveEnemies(b);
  if (!enemies.length) return null;
  const boss = enemies.find((e) => e.id === b.bossId);
  const pending = pendingCityDamage(b);
  const lethal = (t: Telegraph) => t.targets.some((id) => (pending[id] ?? 0) >= b.cities[id].hp);
  // Stop an escort whose attack would destroy a city; otherwise the boss is the job.
  const urgent = upcomingTelegraphs(b).find((t) => t.enemyId !== b.bossId && lethal(t) && enemies.some((e) => e.id === t.enemyId));
  if (urgent) return { enemyId: urgent.enemyId, weakpoint: 'CORE' };
  if (boss) return { enemyId: boss.id, weakpoint: boss.weaken < b.config.gunner.armWeakenMax && boss.partHits.ARM < 2 ? 'ARM' : 'CORE' };
  const next = upcomingTelegraphs(b).find((t) => enemies.some((e) => e.id === t.enemyId));
  if (next) return { enemyId: next.enemyId, weakpoint: 'CORE' };
  return { enemyId: [...enemies].sort((a, z) => a.hp - z.hp || a.id - z.id)[0]!.id, weakpoint: 'CORE' };
}

/** The threat a GUARDIAN should cover: soonest one that would really hurt. */
export function recommendGuardianTarget(b: Board): { telegraphId: number; cityId: RegionId } | { cityId: RegionId } {
  const pending = pendingCityDamage(b);
  for (const t of upcomingTelegraphs(b)) {
    const city = t.targets.find((id) => (pending[id] ?? 0) > 0);
    if (city) return { telegraphId: t.id, cityId: city };
  }
  const first = upcomingTelegraphs(b)[0];
  if (first) return { telegraphId: first.id, cityId: first.targets[0]! };
  // No threat: pre-shield the weakest standing city.
  const standing = standingCities(b.cities).sort((a, z) => b.cities[a].hp + b.cities[a].shield - (b.cities[z].hp + b.cities[z].shield));
  return { cityId: standing[0] ?? 'kanto' };
}

export function recommendSink(b: Board): EnergySink {
  const late = b.phase === 'WAVE_3' || b.phase === 'FINAL_WAVE';
  if (late && b.reserveEnergy < b.config.special.energyMinimum) return 'RESERVE';
  return b.robots.RAIJIN.energy <= b.robots.FUJIN.energy ? 'RAIJIN' : 'FUJIN';
}

export function recommendRepair(b: Board): RepairTarget {
  if (b.jammedUntil > b.gameMs) return { type: 'UNJAM' };
  const robots = (['RAIJIN', 'FUJIN'] as const).filter((r) => b.robots[r].componentDamaged);
  if (robots.length) return { type: 'ROBOT', robot: robots.sort((a, z) => b.robots[a].health - b.robots[z].health)[0]! };
  const rebuild = REGION_IDS.find((id) => b.cities[id].destroyed && b.cities[id].rebuildReadyAt <= b.gameMs);
  if (rebuild) return { type: 'CITY', cityId: rebuild };
  const hurt = standingCities(b.cities)
    .filter((id) => b.cities[id].hp < b.config.cityMaxHp)
    .sort((a, z) => b.cities[a].hp - b.cities[z].hp);
  if (hurt[0]) return { type: 'CITY', cityId: hurt[0] };
  return { type: 'ROBOT', robot: b.robots.RAIJIN.health <= b.robots.FUJIN.health ? 'RAIJIN' : 'FUJIN' };
}

/** Which seat the raid needs most right now (shown as "必要な役割"). */
export function neededRole(b: Board): Role {
  const pending = pendingCityDamage(b);
  if (Object.keys(pending).length) return 'GUARDIAN';
  if (b.jammedUntil > b.gameMs || b.robots.RAIJIN.componentDamaged || b.robots.FUJIN.componentDamaged) return 'ENGINEER';
  if ((b.phase === 'WAVE_3' || b.phase === 'FINAL_WAVE') && b.reserveEnergy < b.config.special.energyMinimum) return 'ROUTER';
  return 'GUNNER';
}
