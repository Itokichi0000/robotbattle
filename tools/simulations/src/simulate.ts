import type { GameConfig, MatchState, TeamId } from '@sats-wars/shared';
import { DEFAULT_GAME_CONFIG } from '@sats-wars/shared';
import {
  type EngineCommand,
  type StrategyName,
  chooseAction,
  countOwnedRegions,
  createMatchState,
  mulberry32,
  reduce,
} from '@sats-wars/game-engine';

export interface SimOptions {
  playersPerTeam: Record<TeamId, number>;
  strategy: Record<TeamId, StrategyName>;
  seed: number;
  config?: GameConfig;
  /** Fraction of players that join after the start (late joiners). */
  lateJoinFraction?: number;
}

export interface SimResult {
  winner: TeamId | null;
  reason: string;
  endGameMs: number;
  finalHp: Record<TeamId, number>;
  regions: Record<TeamId, number>;
  specials: Record<TeamId, number>;
  actionsOk: number;
  actionsRejected: number;
  ko: boolean;
}

interface PlannedSpend {
  t: number;
  participantId: string;
  teamId: TeamId;
}

/**
 * One headless match: players join over time and spend AP at random moments,
 * choosing actions with the given strategy at that moment (they see current state).
 */
export function simulateMatch(opts: SimOptions): SimResult {
  const cfg = opts.config ?? DEFAULT_GAME_CONFIG;
  const rng = mulberry32(opts.seed);
  let state: MatchState = createMatchState(`sim-${opts.seed}`, cfg, opts.seed);
  const apply = (cmd: EngineCommand) => {
    const r = reduce(state, cmd);
    state = r.state;
    return r;
  };
  apply({ type: 'OPEN_LOBBY', t: 0 });
  apply({ type: 'START_LIVE', t: 0 });

  const joins: Array<{ t: number; participantId: string; teamId: TeamId }> = [];
  const spends: PlannedSpend[] = [];
  const late = opts.lateJoinFraction ?? 0.3;
  for (const teamId of ['RAIJIN', 'FUJIN'] as TeamId[]) {
    for (let i = 0; i < opts.playersPerTeam[teamId]; i++) {
      const participantId = `${teamId}-${i}`;
      const joinT = rng() < late ? Math.floor(rng() * cfg.joinCloseMs) : 0;
      joins.push({ t: joinT, participantId, teamId });
      for (let k = 0; k < cfg.apPerParticipant; k++) {
        const t = joinT + 500 + Math.floor(rng() * (cfg.actionCloseMs - 1000 - joinT));
        spends.push({ t, participantId, teamId });
      }
    }
  }
  type Ev = {
    t: number;
    kind: 'join' | 'spend';
    participantId: string;
    teamId: TeamId;
    order: number;
  };
  const evs: Ev[] = [
    ...joins.map((j, i) => ({ ...j, kind: 'join' as const, order: i })),
    ...spends.map((s, i) => ({ ...s, kind: 'spend' as const, order: 100_000 + i })),
  ].sort((a, b) => a.t - b.t || a.order - b.order);

  let ok = 0;
  let rejected = 0;
  let n = 0;
  for (const e of evs) {
    if (state.status !== 'LIVE') break;
    if (e.kind === 'join') {
      apply({
        type: 'ADD_PARTICIPANT',
        t: e.t,
        participantId: e.participantId,
        teamId: e.teamId,
        nickname: e.participantId,
        isBot: true,
        ap: cfg.apPerParticipant,
      });
      continue;
    }
    apply({ type: 'TICK', t: e.t });
    if (state.status !== 'LIVE') break;
    const plan = chooseAction(state, e.teamId, opts.strategy[e.teamId], rng);
    if (!plan) continue;
    const r = apply({
      type: 'ACTION',
      t: e.t,
      participantId: e.participantId,
      clientActionId: `c${n++}`,
      actionType: plan.actionType,
      regionId: plan.regionId,
    });
    if (r.outcome.kind === 'action' && r.outcome.result.ok) ok++;
    else rejected++;
  }
  apply({ type: 'TICK', t: cfg.matchMs + 60_000 });
  const res = state.result!;
  return {
    winner: res.winnerTeamId,
    reason: res.reason,
    endGameMs: res.decidedAtGameMs,
    finalHp: res.finalHp,
    regions: {
      RAIJIN: countOwnedRegions(state, 'RAIJIN'),
      FUJIN: countOwnedRegions(state, 'FUJIN'),
    },
    specials: {
      RAIJIN: state.clashes.filter((c) => c.outcome.RAIJIN.special).length,
      FUJIN: state.clashes.filter((c) => c.outcome.FUJIN.special).length,
    },
    actionsOk: ok,
    actionsRejected: rejected,
    ko: res.reason === 'KO' || res.reason === 'DOUBLE_KO',
  };
}

export interface Aggregate {
  n: number;
  raijinWins: number;
  fujinWins: number;
  draws: number;
  koRate: number;
  avgEndSec: number;
  avgHpLeft: Record<TeamId, number>;
  avgRegions: Record<TeamId, number>;
  avgSpecials: Record<TeamId, number>;
  rejectRate: number;
}

export function aggregate(results: SimResult[]): Aggregate {
  const n = results.length;
  const avg = (f: (r: SimResult) => number) => results.reduce((a, r) => a + f(r), 0) / n;
  const ok = results.reduce((a, r) => a + r.actionsOk, 0);
  const rej = results.reduce((a, r) => a + r.actionsRejected, 0);
  return {
    n,
    raijinWins: results.filter((r) => r.winner === 'RAIJIN').length,
    fujinWins: results.filter((r) => r.winner === 'FUJIN').length,
    draws: results.filter((r) => r.winner === null).length,
    koRate: avg((r) => (r.ko ? 1 : 0)),
    avgEndSec: avg((r) => r.endGameMs) / 1000,
    avgHpLeft: { RAIJIN: avg((r) => r.finalHp.RAIJIN), FUJIN: avg((r) => r.finalHp.FUJIN) },
    avgRegions: { RAIJIN: avg((r) => r.regions.RAIJIN), FUJIN: avg((r) => r.regions.FUJIN) },
    avgSpecials: { RAIJIN: avg((r) => r.specials.RAIJIN), FUJIN: avg((r) => r.specials.FUJIN) },
    rejectRate: rej / Math.max(1, ok + rej),
  };
}
