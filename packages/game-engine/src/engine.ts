import type {
  ActionErrorCode,
  ActionOkCode,
  ActionResult,
  ActionType,
  ClashRecord,
  EventPatch,
  GameConfig,
  GameEvent,
  MatchState,
  MatchStatus,
  RegionId,
  RegionState,
  TeamId,
  TeamState,
} from '@sats-wars/shared';
import { TEAM_IDS, TEAM_META, otherTeam } from '@sats-wars/shared';
import { decideResult, emptyContribution, resolveClashOutcome, snapshotTeamForClash } from './rules';

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Every command carries the pause-corrected match clock `t` (ms). */
export type EngineCommand =
  | { type: 'OPEN_LOBBY'; t: number }
  | { type: 'START_LIVE'; t: number }
  | { type: 'TICK'; t: number }
  | {
      type: 'ADD_PARTICIPANT';
      t: number;
      participantId: string;
      teamId: TeamId;
      nickname: string;
      isBot: boolean;
      ap: number;
    }
  | {
      type: 'ACTION';
      t: number;
      participantId: string;
      clientActionId: string;
      actionType: ActionType;
      regionId: RegionId | null;
    }
  | { type: 'PAUSE'; t: number; reason: string }
  | { type: 'RESUME'; t: number }
  | { type: 'CANCEL'; t: number; reason: string };

export type CommandOutcome =
  | { kind: 'none' }
  | { kind: 'action'; result: ActionResult }
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
  const regions = {} as Record<RegionId, RegionState>;
  for (const { regionId, kind } of config.regions) {
    regions[regionId] = {
      regionId,
      kind,
      ownerTeamId: null,
      contestedByTeamId: null,
      contestedUntil: null,
      shieldCharges: 0,
      shieldExpiresAt: null,
      updatedAt: 0,
      revision: 0,
    };
  }
  const team = (teamId: TeamId): TeamState => ({
    teamId,
    robotId: TEAM_META[teamId].robotId,
    hp: config.hpMax,
    energy: 0,
    participantCount: 0,
    apRemaining: 0,
    apTotal: 0,
    actionCount: 0,
  });
  return {
    matchId,
    config: structuredClone(config),
    seed,
    status: 'CREATED',
    pausedFrom: null,
    pauseReason: null,
    clockMs: 0,
    lobbyOpenedAtClock: null,
    liveStartClock: null,
    gameMs: 0,
    teams: { RAIJIN: team('RAIJIN'), FUJIN: team('FUJIN') },
    regions,
    regionOrder: config.regions.map((r) => r.regionId),
    participants: {},
    processedActions: {},
    nextClashIndex: 0,
    clashes: [],
    finalizingStartGameMs: null,
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
 * The input state is never mutated. Every command first advances the clock to
 * `t`, resolving any scheduled timers (contest/shield expiry, clashes, phase
 * changes) in deterministic order, then applies itself.
 */
export function reduce(prev: MatchState, cmd: EngineCommand): ReduceResult {
  const ctx = new Ctx(structuredClone(prev));
  advanceTo(ctx, cmd.t);
  let outcome: CommandOutcome = { kind: 'none' };
  switch (cmd.type) {
    case 'TICK':
      break;
    case 'OPEN_LOBBY':
      outcome = openLobby(ctx);
      break;
    case 'START_LIVE':
      outcome = startLiveCommand(ctx);
      break;
    case 'ADD_PARTICIPANT':
      outcome = addParticipant(ctx, cmd);
      break;
    case 'ACTION':
      outcome = { kind: 'action', result: applyAction(ctx, cmd) };
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

/** Replay a full command log from scratch. Used for recovery and verification. */
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

  touchRegion(region: RegionState): void {
    region.updatedAt = this.state.gameMs;
    region.revision += 1;
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
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Clock advance and scheduled items
// ---------------------------------------------------------------------------

type Scheduled =
  | { at: number; prio: 0; kind: 'CONTEST_EXPIRY'; regionId: RegionId; order: number }
  | { at: number; prio: 1; kind: 'SHIELD_EXPIRY'; regionId: RegionId; order: number }
  | { at: number; prio: 2; kind: 'CLASH'; order: 0 }
  | { at: number; prio: 3; kind: 'ACTION_CLOSE'; order: 0 }
  | { at: number; prio: 4; kind: 'FINISH'; order: 0 };

function endingMs(config: GameConfig): number {
  return config.matchMs - config.actionCloseMs;
}

function nextScheduled(state: MatchState): Scheduled | null {
  const items: Scheduled[] = [];
  if (state.status === 'LIVE') {
    state.regionOrder.forEach((id, order) => {
      const r = state.regions[id];
      if (r.contestedUntil !== null)
        items.push({ at: r.contestedUntil, prio: 0, kind: 'CONTEST_EXPIRY', regionId: id, order });
      if (r.shieldExpiresAt !== null)
        items.push({ at: r.shieldExpiresAt, prio: 1, kind: 'SHIELD_EXPIRY', regionId: id, order });
    });
    const clashAt = state.config.clashTimesMs[state.nextClashIndex];
    if (clashAt !== undefined) items.push({ at: clashAt, prio: 2, kind: 'CLASH', order: 0 });
    items.push({ at: state.config.actionCloseMs, prio: 3, kind: 'ACTION_CLOSE', order: 0 });
  } else if (state.status === 'FINALIZING' && state.finalizingStartGameMs !== null) {
    items.push({
      at: state.finalizingStartGameMs + endingMs(state.config),
      prio: 4,
      kind: 'FINISH',
      order: 0,
    });
  }
  items.sort((a, b) => a.at - b.at || a.prio - b.prio || a.order - b.order);
  return items[0] ?? null;
}

function advanceTo(ctx: Ctx, rawT: number): void {
  const s = ctx.state;
  // The clock only moves while running, and never backwards.
  if (s.status !== 'LOBBY' && s.status !== 'LIVE' && s.status !== 'FINALIZING') return;
  const t = Math.max(s.clockMs, rawT);
  // Guard against runaway loops on malformed state.
  for (let guard = 0; guard < 10_000; guard++) {
    if (s.status === 'LOBBY') {
      if (s.liveStartClock !== null && s.liveStartClock <= t) {
        s.clockMs = s.liveStartClock;
        startLive(ctx, 'LOBBY_COUNTDOWN_ENDED');
        continue;
      }
      s.clockMs = t;
      s.gameMs = s.liveStartClock !== null ? s.clockMs - s.liveStartClock : 0;
      return;
    }
    if (s.status === 'LIVE' || s.status === 'FINALIZING') {
      const liveStart = s.liveStartClock ?? 0;
      const targetGameMs = t - liveStart;
      const next = nextScheduled(s);
      if (next && next.at <= targetGameMs) {
        s.gameMs = Math.max(s.gameMs, next.at);
        s.clockMs = liveStart + s.gameMs;
        processScheduled(ctx, next);
        continue;
      }
      s.gameMs = targetGameMs;
      s.clockMs = t;
      return;
    }
    return;
  }
  throw new Error('advanceTo: scheduler did not converge');
}

function processScheduled(ctx: Ctx, item: Scheduled): void {
  const s = ctx.state;
  switch (item.kind) {
    case 'CONTEST_EXPIRY': {
      const r = s.regions[item.regionId];
      r.contestedByTeamId = null;
      r.contestedUntil = null;
      ctx.touchRegion(r);
      ctx.emit(
        'CONTEST_EXPIRED',
        { regionId: r.regionId, ownerTeamId: r.ownerTeamId },
        { regions: [r] },
      );
      return;
    }
    case 'SHIELD_EXPIRY': {
      const r = s.regions[item.regionId];
      r.shieldCharges = 0;
      r.shieldExpiresAt = null;
      ctx.touchRegion(r);
      ctx.emit('SHIELD_EXPIRED', { regionId: r.regionId }, { regions: [r] });
      return;
    }
    case 'CLASH':
      resolveClash(ctx);
      return;
    case 'ACTION_CLOSE':
      enterFinalizing(ctx, false);
      return;
    case 'FINISH':
      ctx.setStatus('FINISHED', 'ENDING_COMPLETE');
      return;
  }
}

function resolveClash(ctx: Ctx): void {
  const s = ctx.state;
  const clashIndex = s.nextClashIndex;
  const snapshot = {
    RAIJIN: snapshotTeamForClash(s, 'RAIJIN'),
    FUJIN: snapshotTeamForClash(s, 'FUJIN'),
  };
  const outcome = resolveClashOutcome(snapshot, s.config);
  for (const teamId of TEAM_IDS) {
    s.teams[teamId].hp = outcome[teamId].hpAfter;
    s.teams[teamId].energy = outcome[teamId].energyAfter;
  }
  const ko = TEAM_IDS.filter((id) => s.teams[id].hp <= 0);
  const isLast = clashIndex === s.config.clashTimesMs.length - 1;
  const clash: ClashRecord = {
    clashIndex,
    atGameMs: s.gameMs,
    snapshot,
    outcome,
    ko,
    isFinal: isLast || ko.length > 0,
  };
  s.clashes.push(clash);
  s.nextClashIndex += 1;
  ctx.emit('CLASH_RESOLVED', { clash }, { teams: [s.teams.RAIJIN, s.teams.FUJIN] });
  if (ko.length > 0) enterFinalizing(ctx, true);
}

function enterFinalizing(ctx: Ctx, ko: boolean): void {
  const s = ctx.state;
  if (s.status !== 'LIVE') return;
  // Contests in progress simply end; ownership does not change.
  s.finalizingStartGameMs = s.gameMs;
  s.result = decideResult(s, ko);
  ctx.setStatus('FINALIZING', ko ? 'KO' : 'ACTIONS_CLOSED');
  ctx.emit('MATCH_RESULT', { result: s.result }, { result: s.result });
}

function startLive(ctx: Ctx, reason: string): void {
  const s = ctx.state;
  s.liveStartClock = s.clockMs;
  s.gameMs = 0;
  ctx.setStatus('LIVE', reason);
}

// ---------------------------------------------------------------------------
// Lifecycle commands
// ---------------------------------------------------------------------------

function openLobby(ctx: Ctx): CommandOutcome {
  const s = ctx.state;
  if (s.status !== 'CREATED') return { kind: 'rejected', reason: `cannot open lobby from ${s.status}` };
  s.lobbyOpenedAtClock = s.clockMs;
  s.liveStartClock = s.config.autoStartAfterLobby ? s.clockMs + s.config.lobbyMs : null;
  s.gameMs = s.liveStartClock !== null ? s.clockMs - s.liveStartClock : 0;
  ctx.setStatus('LOBBY', 'LOBBY_OPENED');
  return { kind: 'none' };
}

function startLiveCommand(ctx: Ctx): CommandOutcome {
  const s = ctx.state;
  if (s.status !== 'LOBBY' && s.status !== 'CREATED')
    return { kind: 'rejected', reason: `cannot start from ${s.status}` };
  if (s.status === 'CREATED') s.lobbyOpenedAtClock = s.clockMs;
  startLive(ctx, 'ADMIN_START');
  return { kind: 'none' };
}

function pause(ctx: Ctx, reason: string): CommandOutcome {
  const s = ctx.state;
  if (s.status !== 'LOBBY' && s.status !== 'LIVE' && s.status !== 'FINALIZING')
    return { kind: 'rejected', reason: `cannot pause from ${s.status}` };
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
    decidedAtGameMs: s.gameMs,
    finalHp: { RAIJIN: s.teams.RAIJIN.hp, FUJIN: s.teams.FUJIN.hp },
    regionCounts: { RAIJIN: 0, FUJIN: 0 },
    mvp: { RAIJIN: null, FUJIN: null },
  };
  ctx.setStatus('CANCELLED', reason);
  ctx.emit('MATCH_RESULT', { result: s.result }, { result: s.result });
  return { kind: 'none' };
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

function canAddParticipant(s: MatchState): boolean {
  const effective = s.status === 'PAUSED' ? s.pausedFrom : s.status;
  return effective === 'LOBBY' || effective === 'LIVE' || effective === 'CREATED';
}

function addParticipant(
  ctx: Ctx,
  cmd: Extract<EngineCommand, { type: 'ADD_PARTICIPANT' }>,
): CommandOutcome {
  const s = ctx.state;
  if (s.participants[cmd.participantId]) return { kind: 'none' }; // idempotent
  if (!canAddParticipant(s))
    return { kind: 'rejected', reason: `cannot add participant in ${s.status}` };
  const ap = Math.max(0, Math.floor(cmd.ap));
  s.participants[cmd.participantId] = {
    participantId: cmd.participantId,
    teamId: cmd.teamId,
    nickname: cmd.nickname,
    isBot: cmd.isBot,
    apTotal: ap,
    apRemaining: ap,
    joinedAtGameMs: Math.max(0, s.gameMs),
    contribution: emptyContribution(),
  };
  const team = s.teams[cmd.teamId];
  team.participantCount += 1;
  team.apRemaining += ap;
  team.apTotal += ap;
  ctx.emit(
    'PARTICIPANT_JOINED',
    {
      participantId: cmd.participantId,
      teamId: cmd.teamId,
      nickname: cmd.nickname,
      isBot: cmd.isBot,
    },
    { teams: [team] },
  );
  return { kind: 'none' };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function applyAction(ctx: Ctx, cmd: Extract<EngineCommand, { type: 'ACTION' }>): ActionResult {
  const s = ctx.state;
  const key = `${cmd.participantId}:${cmd.clientActionId}`;
  const cached = s.processedActions[key];
  if (cached) return { ...cached, duplicate: true };

  const p = s.participants[cmd.participantId];
  const ap = p?.apRemaining ?? 0;
  const fail = (code: ActionErrorCode): ActionResult => ({
    ok: false,
    code,
    actionType: cmd.actionType,
    regionId: cmd.regionId,
    apBefore: ap,
    apAfter: ap,
    atGameMs: s.gameMs,
  });

  if (!p) return fail('UNKNOWN_PARTICIPANT');
  if (s.status === 'PAUSED') return fail('MATCH_PAUSED');
  if (s.status === 'FINALIZING' || s.status === 'FINISHED') return fail('ACTIONS_CLOSED');
  if (s.status !== 'LIVE') return fail('MATCH_NOT_LIVE');
  if (s.gameMs >= s.config.actionCloseMs) return fail('ACTIONS_CLOSED');
  if (p.apRemaining <= 0) return fail('NO_AP');

  const myTeam = p.teamId;
  const team = s.teams[myTeam];
  let code: ActionOkCode;
  const changedRegions: RegionState[] = [];

  if (cmd.actionType === 'CHARGE') {
    if (team.energy >= s.config.energyMax) return fail('ENERGY_FULL');
    team.energy = Math.min(s.config.energyMax, team.energy + s.config.chargeAmount);
    p.contribution.charges += 1;
    code = 'CHARGED';
  } else {
    if (cmd.regionId === null) return fail('REGION_REQUIRED');
    const r = s.regions[cmd.regionId];
    if (!r) return fail('INVALID_REGION');
    if (cmd.actionType === 'ATTACK') {
      if (r.ownerTeamId === null) {
        capture(r, myTeam);
        p.contribution.captures += 1;
        code = 'CAPTURED';
      } else if (r.ownerTeamId === myTeam) {
        if (r.contestedByTeamId === null) return fail('OWN_REGION_NOT_CONTESTED');
        clearContest(r);
        p.contribution.breaks += 1;
        code = 'CONTEST_BROKEN';
      } else if (r.contestedByTeamId === myTeam) {
        capture(r, myTeam);
        p.contribution.captures += 1;
        code = 'CAPTURED';
      } else if (r.shieldCharges > 0) {
        r.shieldCharges -= 1;
        if (r.shieldCharges === 0) r.shieldExpiresAt = null;
        p.contribution.shieldBreaks += 1;
        code = 'SHIELD_BROKEN';
      } else {
        r.contestedByTeamId = myTeam;
        r.contestedUntil = s.gameMs + s.config.contestWindowMs;
        p.contribution.contests += 1;
        code = 'CONTEST_STARTED';
      }
    } else {
      // DEFEND
      if (r.ownerTeamId !== myTeam) return fail('NOT_OWN_REGION');
      if (r.contestedByTeamId !== null) {
        clearContest(r);
        p.contribution.breaks += 1;
        code = 'CONTEST_BROKEN';
      } else if (r.shieldCharges >= s.config.shieldMax) {
        return fail('SHIELD_ALREADY_ACTIVE');
      } else {
        r.shieldCharges += 1;
        r.shieldExpiresAt = s.gameMs + s.config.shieldDurationMs;
        p.contribution.shields += 1;
        code = 'SHIELD_PLACED';
      }
    }
    ctx.touchRegion(r);
    changedRegions.push(r);
  }

  const apBefore = p.apRemaining;
  p.apRemaining -= 1;
  team.apRemaining -= 1;
  team.actionCount += 1;
  const event = ctx.emit(
    'ACTION_APPLIED',
    {
      participantId: p.participantId,
      nickname: p.nickname,
      teamId: myTeam,
      actionType: cmd.actionType,
      regionId: cmd.actionType === 'CHARGE' ? null : cmd.regionId,
      code,
    },
    { regions: changedRegions, teams: [team, s.teams[otherTeam(myTeam)]] },
  );
  const result: ActionResult = {
    ok: true,
    code,
    actionType: cmd.actionType,
    regionId: cmd.actionType === 'CHARGE' ? null : cmd.regionId,
    apBefore,
    apAfter: p.apRemaining,
    atGameMs: s.gameMs,
    eventSeq: event.seq,
  };
  s.processedActions[key] = result;
  return result;
}

function capture(r: RegionState, teamId: TeamId): void {
  r.ownerTeamId = teamId;
  r.contestedByTeamId = null;
  r.contestedUntil = null;
  r.shieldCharges = 0;
  r.shieldExpiresAt = null;
}

function clearContest(r: RegionState): void {
  r.contestedByTeamId = null;
  r.contestedUntil = null;
}
