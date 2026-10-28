import type { PublicMatchSnapshot, RegionId, TeamId } from '@sats-wars/shared';
import { REGION_INFO, TEAM_META, otherTeam } from '@sats-wars/shared';
import { punchesToKo, punchesToSpecial } from '@sats-wars/game-engine';

/**
 * Display-only view of the battle for HUDs (phone + venue). Every number comes
 * from the server snapshot; the engine helpers only translate them into
 * friendly hints like "あと12発でKO".
 */
export interface BattleView {
  phase: PublicMatchSnapshot['phase'];
  /** Seconds left in the current phase (null when paused/not running). */
  secondsLeft: number | null;
  roundNumber: number;
  roundsTotal: number;
  regionId: RegionId | null;
  regionJa: string;
  regionEn: string;
  /** Region of the round after this one, for intermission screens. */
  nextRegionId: RegionId | null;
  hpMax: number;
  hp: Record<TeamId, number>;
  /** Punches `team` still needs to knock out the other robot. */
  toKo: Record<TeamId, number>;
  /** Punches until `team`'s next special. */
  toSpecial: Record<TeamId, number>;
  /** Robot at or below the pinch threshold (its punches hit ×1.5). */
  pinch: Record<TeamId, boolean>;
  regionsWon: Record<TeamId, number>;
}

export function battleView(snap: PublicMatchSnapshot, clockMs: number): BattleView {
  const c = snap.config;
  const r = snap.round;
  const running = snap.status === 'LIVE';
  const secondsLeft =
    running && snap.phaseEndsAt !== null ? Math.max(0, Math.ceil((snap.phaseEndsAt - clockMs) / 1000)) : null;
  const regionId = r?.regionId ?? snap.roundOrder[snap.roundIndex] ?? null;
  // OPENING has no round yet; otherwise the next fight is the one after roundIndex.
  const nextRegionId = snap.roundOrder[snap.phase === 'OPENING' ? 0 : snap.roundIndex + 1] ?? null;
  const hpMax = r?.hpMax ?? c.hpInitial;
  const hp = r ? r.hp : { RAIJIN: hpMax, FUJIN: hpMax };
  const gauge = r?.gauge ?? { RAIJIN: 0, FUJIN: 0 };
  const round = { hp, hpMax, gauge };
  const both = <T,>(f: (t: TeamId) => T): Record<TeamId, T> => ({ RAIJIN: f('RAIJIN'), FUJIN: f('FUJIN') });
  return {
    phase: snap.phase,
    secondsLeft,
    roundNumber: (r?.index ?? snap.roundIndex) + 1,
    roundsTotal: c.roundsPerSeason,
    regionId,
    regionJa: regionId ? REGION_INFO[regionId].labelJa : '',
    regionEn: regionId ? REGION_INFO[regionId].labelEn : '',
    nextRegionId,
    hpMax,
    hp,
    toKo: both((t) => punchesToKo(c, round, t)),
    toSpecial: both((t) => punchesToSpecial(c, gauge[t])),
    pinch: both((t) => !!r && hp[t] > 0 && hp[t] <= hpMax * c.pinchHpRatio),
    regionsWon: both((t) => snap.teams[t].regionsWon),
  };
}

export const teamName = (t: TeamId, locale: 'ja' | 'en') =>
  locale === 'ja' ? TEAM_META[t].nameJa : TEAM_META[t].nameEn;

export { otherTeam };
