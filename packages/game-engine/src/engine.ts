import type {
  EventPatch,
  Finisher,
  GameConfig,
  GameEvent,
  MatchState,
  MatchStatus,
  Phase,
  RegionId,
  RegionPaint,
  RoundEndReason,
  RoundState,
  TeamId,
  TeamState,
  ZapErrorCode,
  ZapResult,
} from '@sats-wars/shared';
import { REGION_IDS, TEAM_META, otherTeam } from '@sats-wars/shared';
import { mulberry32, shuffle } from './random';
import { decideSeason, nextRoundHp, zapOutcome } from './rules';

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Every command carries the pause-corrected match clock `t` (ms). */
export type EngineCommand =
  | { type: 'START'; t: number }
  | { type: 'TICK'; t: number }
  | { type: 'ZAP'; t: number; participantId: string; nickname: string; teamId: TeamId }
  | { type: 'PAUSE'; t: number; reason: string }
  | { type: 'RESUME'; t: number }
  | { type: 'CANCEL'; t: number; reason: string };

export type CommandOutcome =
  | { kind: 'none' }
  | { kind: 'zap'; result: ZapResult }
  | { kind: 'rejected'; reason: string };

export interface ReduceResult {
  state: MatchState;
  events: GameEvent[];
  outcome: CommandOutcome;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createMatchState(matchId: string, config: GameConfig, seed = 1): MatchState {
  const team = (teamId: TeamId): TeamState => ({
    teamId,
    robotId: TEAM_META[teamId].robotId,
    regionsWon: 0,
    zapsTotal: 0,
    specialsTotal: 0,
    kos: 0,
  });
  const regions = {} as Record<RegionId, RegionPaint>;
  for (const regionId of REGION_IDS) regions[regionId] = { regionId, ownerTeamId: null, roundIndex: null };
  return {
    matchId,
    config: structuredClone(config),
    seed,
    status: 'CREATED',
    pausedFrom: null,
    pauseReason: null,
    clockMs: 0,
    liveStartClock: null,
    gameMs: 0,
    phase: 'OPENING',
    phaseEndsAt: null,
    // A different running order every season keeps rounds feeling fresh.
    roundOrder: shuffle(REGION_IDS, mulberry32(seed)).slice(0, config.roundsPerSeason),
    roundIndex: 0,
    round: null,
    rounds: [],
    regions,
    teams: { RAIJIN: team('RAIJIN'), FUJIN: team('FUJIN') },
    result: null,
    seq: 0,
    revision: 0,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Pure reducer: (state, command) -> (newState, events, outcome).
 * The input is never mutated. Every command first advances the clock to `t`,
 * resolving phase timers in order, then applies itself. Punches arriving at
 * exactly a phase boundary see the boundary first (server time decides).
 */
export function reduce(prev: MatchState, cmd: EngineCommand): ReduceResult {
  const ctx = new Ctx(structuredClone(prev));
  advanceTo(ctx, cmd.t);
  let outcome: CommandOutcome = { kind: 'none' };
  switch (cmd.type) {
    case 'TICK':
      break;
    case 'START':
      outcome = start(ctx);
      break;
    case 'ZAP':
      outcome = { kind: 'zap', result: zap(ctx, cmd) };
      break;
    case 'PAUSE':
      outcome = pause(ctx, cmd.reason);
      break;
    case 'RESUME':
      outcome = resume(ctx);
      break;
    case 'CANCEL':
      outcome = cancel(ctx, cmd.reason);
      break;
  }
  // Revision tracks applied events so it is identical under replay.
  ctx.state.revision = ctx.state.seq;
  return { state: ctx.state, events: ctx.events, outcome };
}

/** Replay a full command log from scratch (recovery and verification). */
export function replay(
  matchId: string,
  config: GameConfig,
  seed: number,
  commands: EngineCommand[],
): { state: MatchState; events: GameEvent[] } {
  let state = createMatchState(matchId, config, seed);
  const events: GameEvent[] = [];
  for (const cmd of commands) {
    const r = reduce(state, cmd);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

class Ctx {
  events: GameEvent[] = [];
  constructor(public state: MatchState) {}

  emit<T extends GameEvent['type']>(
    type: T,
    data: Extract<GameEvent, { type: T }>['data'],
    patch: EventPatch,
  ): GameEvent {
    const s = this.state;
    s.seq += 1;
    const event = {
      matchId: s.matchId,
      seq: s.seq,
      t: s.clockMs,
      gameMs: s.gameMs,
      type,
      data,
      patch: structuredClone(patch),
    } as GameEvent;
    this.events.push(event);
    return event;
  }

  setStatus(to: MatchStatus, reason: string | null): void {
    const from = this.state.status;
    this.state.status = to;
    this.emit(
      'MATCH_STATUS_CHANGED',
      { from, to, reason },
      {
        status: to,
        pausedFrom: this.state.pausedFrom,
        liveStartClock: this.state.liveStartClock,
        phase: this.state.phase,
        phaseEndsAt: this.state.phaseEndsAt,
      },
    );
  }

  setPhase(phase: Phase, durationMs: number | null): void {
    this.state.phase = phase;
    this.state.phaseEndsAt = durationMs === null ? null : this.state.gameMs + durationMs;
  }
}

// ---------------------------------------------------------------------------
// Clock and phases
// ---------------------------------------------------------------------------

function advanceTo(ctx: Ctx, rawT: number): void {
  const s = ctx.state;
  if (s.status !== 'LIVE' || s.liveStartClock === null) return;
  const t = Math.max(s.clockMs, rawT);
  const target = t - s.liveStartClock;
  for (let guard = 0; guard < 1000; guard++) {
    if (s.status !== 'LIVE') return;
    if (s.phaseEndsAt !== null && s.phaseEndsAt <= target) {
      s.gameMs = Math.max(s.gameMs, s.phaseEndsAt);
      s.clockMs = s.liveStartClock + s.gameMs;
      endPhase(ctx);
      continue;
    }
    s.gameMs = target;
    s.clockMs = t;
    return;
  }
  throw new Error('advanceTo: phases did not converge');
}

function endPhase(ctx: Ctx): void {
  const s = ctx.state;
  switch (s.phase) {
    case 'OPENING':
      startRound(ctx, 0);
      return;
    case 'ROUND':
      endRound(ctx, 'TIME', null, null);
      return;
    case 'ROUND_END':
      if (s.roundIndex + 1 < s.roundOrder.length) startRound(ctx, s.roundIndex + 1);
      else startSeasonEnd(ctx);
      return;
    case 'SEASON_END':
      ctx.setPhase('SEASON_END', null);
      ctx.setStatus('FINISHED', 'SEASON_COMPLETE');
      return;
  }
}

function startRound(ctx: Ctx, index: number): void {
  const s = ctx.state;
  const c = s.config;
  const hpMax = nextRoundHp(c, s.rounds[s.rounds.length - 1]);
  s.roundIndex = index;
  ctx.setPhase('ROUND', c.roundMaxMs);
  const round: RoundState = {
    index,
    regionId: s.roundOrder[index]!,
    hpMax,
    hp: { RAIJIN: hpMax, FUJIN: hpMax },
    gauge: { RAIJIN: 0, FUJIN: 0 },
    zaps: { RAIJIN: 0, FUJIN: 0 },
    startedAt: s.gameMs,
    endsAt: s.phaseEndsAt!,
    endedAt: null,
    winnerTeamId: null,
    endReason: null,
    finisher: null,
  };
  s.round = round;
  ctx.emit(
    'ROUND_STARTED',
    { round },
    { phase: s.phase, phaseEndsAt: s.phaseEndsAt, roundIndex: index, round },
  );
}

function endRound(
  ctx: Ctx,
  reason: RoundEndReason,
  koWinner: TeamId | null,
  finisher: Finisher | null,
): void {
  const s = ctx.state;
  const r = s.round!;
  let winner: TeamId | null = koWinner;
  let endReason = reason;
  if (reason === 'TIME') {
    winner = r.hp.RAIJIN === r.hp.FUJIN ? null : r.hp.RAIJIN > r.hp.FUJIN ? 'RAIJIN' : 'FUJIN';
    if (!winner) endReason = 'DRAW';
  }
  r.endedAt = s.gameMs;
  r.winnerTeamId = winner;
  r.endReason = endReason;
  r.finisher = finisher;
  const changedRegions: RegionPaint[] = [];
  if (winner) {
    s.regions[r.regionId] = { regionId: r.regionId, ownerTeamId: winner, roundIndex: r.index };
    changedRegions.push(s.regions[r.regionId]);
    s.teams[winner].regionsWon += 1;
    if (endReason === 'KO') s.teams[winner].kos += 1;
  }
  const summary = {
    index: r.index,
    regionId: r.regionId,
    hpMax: r.hpMax,
    winnerTeamId: winner,
    endReason,
    durationMs: s.gameMs - r.startedAt,
    zaps: { ...r.zaps },
    finisher,
  };
  s.rounds.push(summary);
  ctx.setPhase('ROUND_END', s.config.roundEndMs);
  ctx.emit(
    'ROUND_ENDED',
    { summary, finisher },
    {
      phase: s.phase,
      phaseEndsAt: s.phaseEndsAt,
      round: r,
      regions: changedRegions,
      teams: [s.teams.RAIJIN, s.teams.FUJIN],
    },
  );
}

function startSeasonEnd(ctx: Ctx): void {
  const s = ctx.state;
  s.result = decideSeason(s);
  ctx.setPhase('SEASON_END', s.config.seasonEndMs);
  ctx.emit(
    'SEASON_ENDED',
    { result: s.result },
    { phase: s.phase, phaseEndsAt: s.phaseEndsAt, result: s.result },
  );
}

// ---------------------------------------------------------------------------
// Lifecycle commands
// ---------------------------------------------------------------------------

function start(ctx: Ctx): CommandOutcome {
  const s = ctx.state;
  if (s.status !== 'CREATED') return { kind: 'rejected', reason: `cannot start from ${s.status}` };
  s.liveStartClock = s.clockMs;
  s.gameMs = 0;
  ctx.setPhase('OPENING', s.config.openingMs);
  ctx.setStatus('LIVE', 'SEASON_START');
  // A zero-length opening goes straight into round 1.
  advanceTo(ctx, s.clockMs);
  return { kind: 'none' };
}

function pause(ctx: Ctx, reason: string): CommandOutcome {
  const s = ctx.state;
  if (s.status !== 'LIVE') return { kind: 'rejected', reason: `cannot pause from ${s.status}` };
  s.pausedFrom = s.status;
  s.pauseReason = reason;
  ctx.setStatus('PAUSED', reason);
  return { kind: 'none' };
}

function resume(ctx: Ctx): CommandOutcome {
  const s = ctx.state;
  if (s.status !== 'PAUSED' || s.pausedFrom === null)
    return { kind: 'rejected', reason: `cannot resume from ${s.status}` };
  const to = s.pausedFrom;
  s.pausedFrom = null;
  s.pauseReason = null;
  ctx.setStatus(to, 'RESUMED');
  return { kind: 'none' };
}

function cancel(ctx: Ctx, reason: string): CommandOutcome {
  const s = ctx.state;
  if (s.status === 'FINISHED' || s.status === 'CANCELLED')
    return { kind: 'rejected', reason: `cannot cancel from ${s.status}` };
  s.pausedFrom = null;
  s.result = {
    winnerTeamId: null,
    reason: 'CANCELLED',
    regionCounts: { RAIJIN: s.teams.RAIJIN.regionsWon, FUJIN: s.teams.FUJIN.regionsWon },
    decidedAtGameMs: s.gameMs,
  };
  ctx.setPhase(s.phase, null);
  ctx.setStatus('CANCELLED', reason);
  ctx.emit('SEASON_ENDED', { result: s.result }, { result: s.result });
  return { kind: 'none' };
}

// ---------------------------------------------------------------------------
// Punch
// ---------------------------------------------------------------------------

function zap(ctx: Ctx, cmd: Extract<EngineCommand, { type: 'ZAP' }>): ZapResult {
  const s = ctx.state;
  const fail = (code: ZapErrorCode): ZapResult => ({
    ok: false,
    code,
    teamId: cmd.teamId,
    damage: 0,
    special: false,
    pinch: false,
    atGameMs: s.gameMs,
    roundIndex: s.round?.index ?? null,
  });
  if (s.status === 'PAUSED') return fail('PAUSED');
  if (s.status !== 'LIVE') return fail('NOT_LIVE');
  if (s.phase !== 'ROUND' || !s.round) return fail('ROUND_NOT_ACTIVE');

  const r = s.round;
  const me = cmd.teamId;
  const foe = otherTeam(me);
  r.zaps[me] += 1;
  r.gauge[me] += 1;
  const o = zapOutcome(s.config, r.hp[me], r.hpMax, r.gauge[me]);
  if (o.special) r.gauge[me] = 0;
  r.hp[foe] = Math.max(0, r.hp[foe] - o.damage);
  s.teams[me].zapsTotal += 1;
  if (o.special) s.teams[me].specialsTotal += 1;
  const ko = r.hp[foe] === 0;
  const code = ko ? 'KO' : o.special ? 'SPECIAL' : 'HIT';
  const event = ctx.emit(
    'ZAP',
    {
      participantId: cmd.participantId,
      nickname: cmd.nickname,
      teamId: me,
      code,
      damage: o.damage,
      special: o.special,
      pinch: o.pinch,
      hp: { ...r.hp },
    },
    { round: r, teams: [s.teams[me]] },
  );
  const result: ZapResult = {
    ok: true,
    code,
    teamId: me,
    damage: o.damage,
    special: o.special,
    pinch: o.pinch,
    atGameMs: s.gameMs,
    roundIndex: r.index,
    eventSeq: event.seq,
  };
  if (ko) {
    endRound(ctx, 'KO', me, {
      participantId: cmd.participantId,
      nickname: cmd.nickname,
      teamId: me,
    });
  }
  return result;
}
