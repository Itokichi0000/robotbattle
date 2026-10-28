import type {
  CityState,
  Enemy,
  PublicRaidSnapshot,
  RegionId,
  Role,
  Telegraph,
} from '@sats-wars/shared';
import { REGION_IDS } from '@sats-wars/shared';
import { neededRole, pendingCityDamage } from '@sats-wars/game-engine';
import { boardFrom } from './board';

/** The parts of a raid snapshot the HUDs read (the offline demo builds the same shape). */
export type RaidLike = Pick<
  PublicRaidSnapshot,
  | 'config'
  | 'status'
  | 'phase'
  | 'gameMs'
  | 'cities'
  | 'robots'
  | 'reserveEnergy'
  | 'jammedUntil'
  | 'enemies'
  | 'telegraphs'
  | 'bossId'
  | 'sync'
  | 'special'
  | 'result'
  | 'crew'
>;

export interface CityThreatView {
  seconds: number;
  damage: number;
  lethal: boolean;
}

/**
 * Display-only view of a raid for HUDs (phone, venue, demo). Everything comes
 * from the server snapshot; the engine helpers only phrase it ("東京 12秒").
 */
export interface RaidView {
  timeLeftMs: number;
  boss: Enemy | null;
  bossHpRatio: number | null;
  citiesStanding: number;
  minCities: number;
  cities: Record<RegionId, CityState>;
  threats: Partial<Record<RegionId, CityThreatView>>;
  /** Most urgent threat (soonest to land). */
  urgent: { telegraph: Telegraph; enemy: Enemy | null; cityId: RegionId; seconds: number } | null;
  needed: Role;
  specialOpen: boolean;
  specialSecondsLeft: number | null;
  crewByRole: Record<Role, number>;
}

export function raidView(s: RaidLike, gameNow: number): RaidView {
  const c = s.config;
  const boss = s.enemies.find((e) => e.id === s.bossId) ?? null;
  const board = boardFrom(s, gameNow);
  const cities = board.cities;
  const pending = pendingCityDamage(board);
  const threats: RaidView['threats'] = {};
  for (const t of s.telegraphs) {
    for (const id of t.targets) {
      const seconds = Math.max(0, (t.resolvesAt - gameNow) / 1000);
      const prev = threats[id];
      if (!prev || seconds < prev.seconds) {
        const dmg = pending[id] ?? 0;
        threats[id] = { seconds, damage: dmg, lethal: dmg >= cities[id].hp };
      }
    }
  }
  const sorted = [...s.telegraphs].sort((a, z) => a.resolvesAt - z.resolvesAt);
  const first = sorted[0];
  const crewByRole: Record<Role, number> = { GUNNER: 0, GUARDIAN: 0, ROUTER: 0, ENGINEER: 0 };
  for (const m of s.crew) crewByRole[m.role] += 1;
  return {
    timeLeftMs:
      s.status === 'LIVE' || s.status === 'PAUSED'
        ? Math.max(0, c.matchSeconds * 1000 - gameNow)
        : s.status === 'ENDED'
          ? 0
          : c.matchSeconds * 1000,
    boss,
    bossHpRatio: boss ? boss.hp / boss.hpMax : null,
    citiesStanding: REGION_IDS.filter((id) => !cities[id].destroyed).length,
    minCities: c.minimumSurvivingCities,
    cities,
    threats,
    urgent: first
      ? {
          telegraph: first,
          enemy: s.enemies.find((e) => e.id === first.enemyId) ?? null,
          cityId: first.targets[0]!,
          seconds: Math.max(0, (first.resolvesAt - gameNow) / 1000),
        }
      : null,
    needed: neededRole(board),
    specialOpen: s.special.status === 'OPEN',
    specialSecondsLeft:
      s.special.status === 'OPEN' ? Math.max(0, (s.special.closesAt - gameNow) / 1000) : null,
    crewByRole,
  };
}

export const L = (locale: 'ja' | 'en') => (ja: string, en: string) => (locale === 'ja' ? ja : en);
