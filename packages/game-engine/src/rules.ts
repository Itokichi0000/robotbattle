import type { GameConfig, MatchState, RoundState, RoundSummary, SeasonResult, TeamId } from '@sats-wars/shared';

/** Expected damage per punch including specials (used to size rounds). */
export function averageZapDamage(c: GameConfig): number {
  return (c.zapDamage * (c.specialEvery - 1) + c.specialDamage) / c.specialEvery;
}

const roundTo10 = (v: number) => Math.round(v / 10) * 10;

/**
 * Robot HP for the next round. Round 1 uses hpInitial; afterwards HP follows
 * the crowd: the busier team's punch rate × targetRoundSec × average damage,
 * limited to hpMaxChangeFactor per step and [hpMin, hpCap]. Both robots
 * always get the same HP, so the scaling never favours a side.
 */
export function nextRoundHp(c: GameConfig, prev: RoundSummary | undefined): number {
  if (!prev) return c.hpInitial;
  const durSec = Math.max(1, prev.durationMs / 1000);
  const rate = Math.max(prev.zaps.RAIJIN, prev.zaps.FUJIN) / durSec;
  const target = rate * c.targetRoundSec * averageZapDamage(c);
  const lo = prev.hpMax / c.hpMaxChangeFactor;
  const hi = prev.hpMax * c.hpMaxChangeFactor;
  const v = Math.min(hi, Math.max(lo, target));
  return Math.min(c.hpCap, Math.max(c.hpMin, roundTo10(v)));
}

/**
 * Round-1 HP for the next season, so a big crowd doesn't get two-second
 * rounds every time a season restarts at `hpInitial`. Halved to stay safe if
 * the crowd is leaving; never below the configured `hpInitial`.
 */
export function carryOverHp(c: GameConfig, lastRound: RoundSummary | undefined): number {
  if (!lastRound) return c.hpInitial;
  return Math.max(c.hpInitial, Math.min(c.hpCap, roundTo10(nextRoundHp(c, lastRound) / 2)));
}

export interface ZapOutcome {
  damage: number;
  special: boolean;
  pinch: boolean;
}

/**
 * Damage of one punch. Every `specialEvery`-th punch of a team in a round is a
 * special. A robot at or below `pinchHpRatio` of its HP hits `pinchMultiplier`
 * times harder (comeback chance), specials included.
 */
export function zapOutcome(
  c: GameConfig,
  ownHp: number,
  hpMax: number,
  gaugeAfter: number,
): ZapOutcome {
  const special = gaugeAfter >= c.specialEvery;
  const pinch = ownHp <= hpMax * c.pinchHpRatio;
  const base = special ? c.specialDamage : c.zapDamage;
  return { damage: Math.round(base * (pinch ? c.pinchMultiplier : 1)), special, pinch };
}

/**
 * How many more punches `attacker` needs to KO the other robot if only that
 * team kept punching (specials and pinch included). Display hint for the
 * "あと○発でKO" counters; the server still decides every hit.
 */
export function punchesToKo(
  c: GameConfig,
  round: Pick<RoundState, 'hp' | 'hpMax' | 'gauge'>,
  attacker: TeamId,
): number {
  const foe: TeamId = attacker === 'RAIJIN' ? 'FUJIN' : 'RAIJIN';
  let hp = round.hp[foe];
  let gauge = round.gauge[attacker];
  let n = 0;
  while (hp > 0 && n < 10_000) {
    gauge += 1;
    const o = zapOutcome(c, round.hp[attacker], round.hpMax, gauge);
    if (o.special) gauge = 0;
    hp -= o.damage;
    n++;
  }
  return n;
}

/** Punches until the team's next special (1 = the very next punch). */
export function punchesToSpecial(c: GameConfig, gauge: number): number {
  return Math.max(1, c.specialEvery - gauge);
}

export function decideSeason(state: MatchState): SeasonResult {
  const regionCounts: Record<TeamId, number> = { RAIJIN: 0, FUJIN: 0 };
  for (const r of Object.values(state.regions)) if (r.ownerTeamId) regionCounts[r.ownerTeamId]++;
  const winnerTeamId: TeamId | null =
    regionCounts.RAIJIN === regionCounts.FUJIN
      ? null
      : regionCounts.RAIJIN > regionCounts.FUJIN
        ? 'RAIJIN'
        : 'FUJIN';
  return {
    winnerTeamId,
    reason: winnerTeamId ? 'REGIONS' : 'DRAW',
    regionCounts,
    decidedAtGameMs: state.gameMs,
  };
}
