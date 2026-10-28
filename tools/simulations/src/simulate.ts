import type { GameConfig, MatchState, RoundSummary, TeamId } from '@sats-wars/shared';
import { TEAM_IDS, makeGameConfig } from '@sats-wars/shared';
import { createMatchState, mulberry32, reduce } from '@sats-wars/game-engine';

/**
 * Crowd model for ZAP BATTLE. Each team has a steady number of people with a
 * phone in hand; each person taps with exponential gaps (some fast, some
 * casual) until their top-up runs out, then someone new steps in. People only
 * tap during a fight (the button is disabled between rounds), with a short
 * reaction delay when a round starts.
 */
export interface CrowdOptions {
  playersPerTeam: Record<TeamId, number>;
  seed: number;
  config?: Partial<GameConfig>;
  /** Each person's mean seconds between taps is uniform in this range. */
  gapSec?: [number, number];
  /** Punches bought per person (picked uniformly from this list). */
  budgets?: number[];
  /** Seconds before a replacement steps in after someone runs out. */
  replaceDelaySec?: number;
}

export interface SeasonSim {
  winner: TeamId | null;
  regionCounts: Record<TeamId, number>;
  rounds: RoundSummary[];
  punches: Record<TeamId, number>;
  satsSpent: Record<TeamId, number>;
  /** Taps refused by the engine (between rounds) — never charged. */
  refused: number;
  seasonSec: number;
}

interface Person {
  gapMs: number;
  budget: number;
  next: number;
  waiting: boolean;
}

const STEP_MS = 100;

export function simulateSeason(o: CrowdOptions): SeasonSim {
  const cfg = makeGameConfig(o.config ?? {});
  const rng = mulberry32((o.seed * 2654435761) >>> 0);
  const [gMin, gMax] = o.gapSec ?? [0.35, 2.5];
  const budgets = o.budgets ?? [5, 5, 10, 10, 25];
  const replaceMs = (o.replaceDelaySec ?? 8) * 1000;
  const expo = (mean: number) => -Math.log(1 - rng()) * mean;
  const newPerson = (t: number): Person => {
    const gapMs = (gMin + rng() * (gMax - gMin)) * 1000;
    return {
      gapMs,
      budget: budgets[Math.floor(rng() * budgets.length)]!,
      // Client UI spaces taps at least ~260 ms apart.
      next: t + Math.max(260, expo(gapMs)),
      waiting: false,
    };
  };

  let state: MatchState = createMatchState('sim', cfg, o.seed);
  let t = 0;
  state = reduce(state, { type: 'START', t }).state;
  const crowd: Record<TeamId, Person[]> = {
    RAIJIN: Array.from({ length: o.playersPerTeam.RAIJIN }, () => newPerson(0)),
    FUJIN: Array.from({ length: o.playersPerTeam.FUJIN }, () => newPerson(0)),
  };
  const punches: Record<TeamId, number> = { RAIJIN: 0, FUJIN: 0 };
  let refused = 0;

  while (state.status !== 'FINISHED' && t < 3 * 3_600_000) {
    const t1 = t + STEP_MS;
    if (state.phase === 'ROUND') {
      for (const team of TEAM_IDS) {
        for (const p of crowd[team]) {
          if (p.waiting) {
            p.waiting = false;
            p.next = t + 300 + expo(900); // noticing the new round
          }
        }
      }
    }
    // Every tap due in (t, t1], in time order, so neither team is favoured by processing order.
    const due: Array<{ at: number; team: TeamId; p: Person }> = [];
    for (const team of TEAM_IDS) {
      for (const p of crowd[team]) if (!p.waiting && p.budget > 0 && p.next <= t1) due.push({ at: Math.max(p.next, t), team, p });
    }
    due.sort((a, b) => a.at - b.at);
    for (const d of due) {
      const r = reduce(state, { type: 'ZAP', t: d.at, participantId: `${d.team}-x`, nickname: 'sim', teamId: d.team });
      state = r.state;
      if (r.outcome.kind === 'zap' && r.outcome.result.ok) {
        d.p.budget--;
        punches[d.team]++;
        d.p.next = d.at + Math.max(260, expo(d.p.gapMs));
      } else {
        refused++;
        d.p.waiting = true;
      }
    }
    // Replace people who ran out of credit.
    for (const team of TEAM_IDS) {
      const list = crowd[team];
      for (let i = 0; i < list.length; i++) {
        if (list[i]!.budget === 0) {
          const fresh = newPerson(t1 + expo(replaceMs));
          fresh.waiting = state.phase !== 'ROUND';
          list[i] = fresh;
        }
      }
    }
    state = reduce(state, { type: 'TICK', t: t1 }).state;
    t = t1;
  }
  const res = state.result!;
  return {
    winner: res.winnerTeamId,
    regionCounts: res.regionCounts,
    rounds: state.rounds,
    punches,
    satsSpent: { RAIJIN: punches.RAIJIN * cfg.zapCostSats, FUJIN: punches.FUJIN * cfg.zapCostSats },
    refused,
    seasonSec: state.gameMs / 1000,
  };
}

export interface Aggregate {
  seasons: number;
  seasonWins: Record<TeamId | 'DRAW', number>;
  rounds: number;
  roundWins: Record<TeamId | 'DRAW', number>;
  koRate: number;
  timeUpRate: number;
  avgRoundSec: number;
  p10RoundSec: number;
  p90RoundSec: number;
  /** Average robot HP by round number (1-based index into the array). */
  hpByRound: number[];
  avgPunchesPerRound: Record<TeamId, number>;
  avgSeasonSec: number;
  avgSatsPerSeason: Record<TeamId, number>;
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

export function aggregate(sims: SeasonSim[]): Aggregate {
  const seasonWins = { RAIJIN: 0, FUJIN: 0, DRAW: 0 };
  const roundWins = { RAIJIN: 0, FUJIN: 0, DRAW: 0 };
  const durs: number[] = [];
  let ko = 0;
  let timeUp = 0;
  const hpSum: number[] = [];
  const hpN: number[] = [];
  const punches = { RAIJIN: 0, FUJIN: 0 };
  const sats = { RAIJIN: 0, FUJIN: 0 };
  let seasonSec = 0;
  for (const s of sims) {
    seasonWins[s.winner ?? 'DRAW']++;
    seasonSec += s.seasonSec;
    sats.RAIJIN += s.satsSpent.RAIJIN;
    sats.FUJIN += s.satsSpent.FUJIN;
    for (const r of s.rounds) {
      roundWins[r.winnerTeamId ?? 'DRAW']++;
      durs.push(r.durationMs / 1000);
      if (r.endReason === 'KO') ko++;
      else timeUp++;
      hpSum[r.index] = (hpSum[r.index] ?? 0) + r.hpMax;
      hpN[r.index] = (hpN[r.index] ?? 0) + 1;
      punches.RAIJIN += r.zaps.RAIJIN;
      punches.FUJIN += r.zaps.FUJIN;
    }
  }
  const rounds = durs.length || 1;
  return {
    seasons: sims.length,
    seasonWins,
    rounds: durs.length,
    roundWins,
    koRate: ko / rounds,
    timeUpRate: timeUp / rounds,
    avgRoundSec: durs.reduce((a, b) => a + b, 0) / rounds,
    p10RoundSec: quantile(durs, 0.1),
    p90RoundSec: quantile(durs, 0.9),
    hpByRound: hpSum.map((v, i) => v / hpN[i]!),
    avgPunchesPerRound: { RAIJIN: punches.RAIJIN / rounds, FUJIN: punches.FUJIN / rounds },
    avgSeasonSec: seasonSec / (sims.length || 1),
    avgSatsPerSeason: { RAIJIN: sats.RAIJIN / (sims.length || 1), FUJIN: sats.FUJIN / (sims.length || 1) },
  };
}
