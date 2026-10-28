import type {
  ClashTeamOutcome,
  ClashTeamSnapshot,
  Contribution,
  GameConfig,
  MatchResult,
  MatchState,
  ParticipantState,
  RegionKind,
  ResultReason,
  TeamId,
} from '@sats-wars/shared';
import { TEAM_IDS, otherTeam } from '@sats-wars/shared';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A region counts toward bonuses only while owned and NOT contested. */
export function countActiveRegions(state: MatchState, teamId: TeamId, kind: RegionKind): number {
  let n = 0;
  for (const id of state.regionOrder) {
    const r = state.regions[id];
    if (r.ownerTeamId === teamId && r.contestedByTeamId === null && r.kind === kind) n++;
  }
  return n;
}

/** Owned regions including contested ones (ownership is kept while contested). */
export function countOwnedRegions(state: MatchState, teamId: TeamId): number {
  let n = 0;
  for (const id of state.regionOrder) if (state.regions[id].ownerTeamId === teamId) n++;
  return n;
}

export function snapshotTeamForClash(state: MatchState, teamId: TeamId): ClashTeamSnapshot {
  const team = state.teams[teamId];
  return {
    teamId,
    hpBefore: team.hp,
    energyBefore: team.energy,
    activeAttackRegions: countActiveRegions(state, teamId, 'ATTACK'),
    activeDefenseRegions: countActiveRegions(state, teamId, 'DEFENSE'),
    activeEnergyRegions: countActiveRegions(state, teamId, 'ENERGY'),
  };
}

export interface DamageBreakdown {
  damage: number;
  special: boolean;
  energyBonus: number;
  raw: number;
}

/**
 * damage = clamp(base + atkBonus*attackRegions + energyBonus + specialBonus
 *                - defReduction*opponentDefenseRegions, min, max)
 * Pure function of the clash-start snapshot; identical for both teams.
 */
export function computeDamage(
  attacker: ClashTeamSnapshot,
  defender: ClashTeamSnapshot,
  config: GameConfig,
): DamageBreakdown {
  const special = attacker.energyBefore >= config.specialThreshold;
  const energyBonus = special
    ? 0
    : Math.min(
        config.energyBonusMax,
        Math.floor(attacker.energyBefore / 10) * config.energyBonusPer10,
      );
  const raw =
    config.baseDamage +
    config.attackRegionBonus * attacker.activeAttackRegions +
    energyBonus +
    (special ? config.specialBonus : 0) -
    config.defenseRegionReduction * defender.activeDefenseRegions;
  return {
    damage: clamp(raw, config.damageMin, config.damageMax),
    special,
    energyBonus,
    raw,
  };
}

/** Resolve both sides from the same snapshot and apply damage simultaneously. */
export function resolveClashOutcome(
  snapshot: Record<TeamId, ClashTeamSnapshot>,
  config: GameConfig,
): Record<TeamId, ClashTeamOutcome> {
  const breakdown = {
    RAIJIN: computeDamage(snapshot.RAIJIN, snapshot.FUJIN, config),
    FUJIN: computeDamage(snapshot.FUJIN, snapshot.RAIJIN, config),
  } satisfies Record<TeamId, DamageBreakdown>;
  const outcome = {} as Record<TeamId, ClashTeamOutcome>;
  for (const teamId of TEAM_IDS) {
    const self = snapshot[teamId];
    const mine = breakdown[teamId];
    const received = breakdown[otherTeam(teamId)].damage;
    const energyAfterSpecial = self.energyBefore - (mine.special ? config.specialCost : 0);
    outcome[teamId] = {
      teamId,
      damageDealt: mine.damage,
      special: mine.special,
      energyBonus: mine.energyBonus,
      hpAfter: Math.max(0, self.hpBefore - received),
      energyAfter: clamp(
        energyAfterSpecial + self.activeEnergyRegions * config.energyRegionGain,
        0,
        config.energyMax,
      ),
    };
  }
  return outcome;
}

export function contributionScore(c: Contribution): number {
  return c.captures * 3 + c.contests + c.breaks * 2 + c.shields + c.shieldBreaks + c.charges;
}

export function emptyContribution(): Contribution {
  return { captures: 0, contests: 0, breaks: 0, shields: 0, shieldBreaks: 0, charges: 0 };
}

/** Deterministic ordering: score desc, then earlier join, then id. */
export function rankParticipants(participants: ParticipantState[]): ParticipantState[] {
  return [...participants].sort((a, b) => {
    const d = contributionScore(b.contribution) - contributionScore(a.contribution);
    if (d !== 0) return d;
    if (a.joinedAtGameMs !== b.joinedAtGameMs) return a.joinedAtGameMs - b.joinedAtGameMs;
    return a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0;
  });
}

export function pickMvp(state: MatchState, teamId: TeamId): MatchResult['mvp'][TeamId] {
  const members = Object.values(state.participants).filter((p) => p.teamId === teamId);
  const top = rankParticipants(members)[0];
  if (!top || contributionScore(top.contribution) === 0) return null;
  return {
    participantId: top.participantId,
    nickname: top.nickname,
    score: contributionScore(top.contribution),
  };
}

/**
 * Decide the winner. Applied after all damage of the same tick is applied.
 * KO: the side above 0 wins. Both 0 (double KO) or time up: HP, then owned
 * regions, then draw.
 */
export function decideResult(state: MatchState, ko: boolean): MatchResult {
  const finalHp = { RAIJIN: state.teams.RAIJIN.hp, FUJIN: state.teams.FUJIN.hp };
  const regionCounts = {
    RAIJIN: countOwnedRegions(state, 'RAIJIN'),
    FUJIN: countOwnedRegions(state, 'FUJIN'),
  };
  let winnerTeamId: TeamId | null = null;
  let reason: ResultReason;
  const byRegions = (): TeamId | null =>
    regionCounts.RAIJIN === regionCounts.FUJIN
      ? null
      : regionCounts.RAIJIN > regionCounts.FUJIN
        ? 'RAIJIN'
        : 'FUJIN';
  if (ko && finalHp.RAIJIN === 0 && finalHp.FUJIN === 0) {
    winnerTeamId = byRegions();
    reason = winnerTeamId ? 'DOUBLE_KO' : 'DRAW';
  } else if (ko) {
    winnerTeamId = finalHp.RAIJIN === 0 ? 'FUJIN' : 'RAIJIN';
    reason = 'KO';
  } else if (finalHp.RAIJIN !== finalHp.FUJIN) {
    winnerTeamId = finalHp.RAIJIN > finalHp.FUJIN ? 'RAIJIN' : 'FUJIN';
    reason = 'TIME_HP';
  } else {
    winnerTeamId = byRegions();
    reason = winnerTeamId ? 'TIME_REGIONS' : 'DRAW';
  }
  return {
    winnerTeamId,
    reason,
    decidedAtGameMs: state.gameMs,
    finalHp,
    regionCounts,
    mvp: { RAIJIN: pickMvp(state, 'RAIJIN'), FUJIN: pickMvp(state, 'FUJIN') },
  };
}
