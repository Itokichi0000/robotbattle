import {
  ACTION_KINDS,
  bossHpFor,
  CITY_IDS,
  configHash,
  DIRECTIONS,
  mechHitFor,
  paidAttackFor,
  strikeNeedFor,
} from '@swed/shared';
import type {
  ActionKind,
  ActionResult,
  CityId,
  DefeatReason,
  GameConfig,
  MatchEvent,
  MatchEventBody,
  MatchState,
  MatchStats,
  Phase,
  PlayerState,
  ReasonCode,
  ThreatState,
} from '@swed/shared';
import { randomBetween, randomPick } from './rng';

/**
 * D-033 crowd raid: deterministic, pure rules. `reduce(state, command)` applies one command;
 * `advanceTo(state, t)` runs the timers (phases, strikes, claws, shield decay) in fixed
 * 50 ms steps. Everything random comes from the mulberry32 state inside the match.
 *
 *   撃つ ATTACK  damages NULL CORE
 *   守る DEFEND  fills the shield, which blocks the announced strike on a city
 *   直す REPAIR  restores RAIJIN's armour after a claw
 * Free taps are small; a Lightning (21 sats) action is the same action ×20.
 */

export const STEP_MS = 50;
/** Free taps reach the screens as one aggregated event per action this often. */
export const FREE_FLUSH_MS = 200;
const ACTION_LOG_MAX = 600;

export type EngineCommand =
  | { type: 'START'; t: number }
  | { type: 'SKIP_DEPLOY'; t: number }
  | { type: 'PAUSE'; t: number }
  | { type: 'RESUME'; t: number }
  | { type: 'END'; t: number }
  | { type: 'SET_AUTO_START'; t: number; enabled: boolean }
  | { type: 'PLAYER_JOIN'; t: number; pilotId: string; displayName: string; bot?: boolean }
  | { type: 'PLAYER_CONNECTION'; t: number; pilotId: string; connected: boolean }
  | { type: 'PLAYER_LEAVE'; t: number; pilotId: string }
  | { type: 'PLAYER_RENAME'; t: number; pilotId: string; displayName: string }
  | { type: 'ACTION'; t: number; pilotId: string; clientActionId: string; kind: ActionKind }
  | {
      type: 'PAID_ACTION';
      t: number;
      intentId: string;
      pilotId: string | null;
      kind: ActionKind;
      virtual: boolean;
      bot?: boolean;
      settleMs: number | null;
    };

export type CommandOutcome =
  { kind: 'control'; ok: boolean } | { kind: 'action'; result: ActionResult };

export interface ReduceResult {
  state: MatchState;
  events: MatchEvent[];
  outcome: CommandOutcome;
}

export interface AdvanceResult {
  state: MatchState;
  events: MatchEvent[];
}

export interface CreateMatchInput {
  matchId: string;
  matchNumber?: number;
  config: GameConfig;
  seed: number;
  autoStart?: boolean;
}

function zeroCounts() {
  return { ATTACK: 0, DEFEND: 0, REPAIR: 0 };
}

function emptyStats(): MatchStats {
  return {
    free: zeroCounts(),
    paid: zeroCounts(),
    lightning: 0,
    virtual: 0,
    damageToBoss: 0,
    strikesBlocked: 0,
    strikesHit: 0,
    mechHits: 0,
    repaired: 0,
    peakPlayers: 0,
  };
}

export function createMatch(input: CreateMatchInput): MatchState {
  const c = input.config;
  const cities = Object.fromEntries(
    CITY_IDS.map((id) => [id, { id, hp: 100, lost: false }]),
  ) as MatchState['cities'];
  return {
    matchId: input.matchId,
    matchNumber: input.matchNumber ?? 1,
    presetId: c.presetId,
    config: c,
    configHash: configHash(c),
    seed: input.seed >>> 0,
    rng: input.seed >>> 0,
    t: 0,
    simT: 0,
    version: 0,
    eventSeq: 0,
    nextId: 1,
    phase: 'LOBBY',
    phaseStartedAt: 0,
    phaseEndsAt: null,
    paused: false,
    autoStartAt: null,
    autoStartEnabled: input.autoStart ?? true,
    pendingFree: {
      ATTACK: { n: 0, value: 0 },
      DEFEND: { n: 0, value: 0 },
      REPAIR: { n: 0, value: 0 },
    },
    lastFlushAt: 0,
    players: {},
    playersAtLaunch: 0,
    mechHp: c.mech.max,
    shield: 0,
    enemies: [],
    threats: [],
    cities,
    nextStrikeAt: 0,
    nextClawAt: 0,
    paidApplied: [],
    stats: emptyStats(),
    result: null,
    actionLog: {},
    actionLogOrder: [],
  };
}

/* ------------------------------------------------------------------ context */

interface Ctx {
  s: MatchState;
  events: MatchEvent[];
}

function emit(ctx: Ctx, t: number, body: MatchEventBody): void {
  ctx.s.eventSeq += 1;
  ctx.events.push({ ...body, seq: ctx.s.eventSeq, t } as MatchEvent);
}

function newId(s: MatchState, prefix: string): string {
  const id = `${prefix}${s.nextId}`;
  s.nextId += 1;
  return id;
}

/** People and bots that count right now (a dropped phone counts for a while). */
export function countedPlayers(s: MatchState, at = s.t): PlayerState[] {
  const hold = s.config.timings.playerHoldMs;
  return Object.values(s.players).filter(
    (p) => p.connected || (p.disconnectedAt !== null && at - p.disconnectedAt < hold),
  );
}

export function playerCount(s: MatchState, at = s.t): number {
  return countedPlayers(s, at).length;
}

export function bossOf<E extends { kind: string }>(s: { enemies: readonly E[] }): E | null {
  return s.enemies.find((e) => e.kind === 'NULL_CORE') ?? null;
}

/* ------------------------------------------------------------------ phases */

const NEXT_TIMED: Partial<Record<Phase, Phase>> = {
  COUNTDOWN: 'DEPLOYMENT',
  DEPLOYMENT: 'BATTLE',
  VICTORY: 'RESULTS',
  DEFEAT: 'RESULTS',
};

function phaseDuration(c: GameConfig, p: Phase): number | null {
  const T = c.timings;
  switch (p) {
    case 'COUNTDOWN':
      return T.countdownMs;
    case 'DEPLOYMENT':
      return T.deploymentMs;
    case 'BATTLE':
      return T.battleMs;
    case 'VICTORY':
      return T.victoryMs;
    case 'DEFEAT':
      return T.defeatMs;
    case 'RESULTS':
      return T.resultsMs;
    default:
      return null;
  }
}

function enterPhase(ctx: Ctx, to: Phase, at: number): void {
  const s = ctx.s;
  const from = s.phase;
  const dur = phaseDuration(s.config, to);
  s.phase = to;
  s.phaseStartedAt = at;
  s.phaseEndsAt = dur === null ? null : at + dur;
  s.autoStartAt = null;
  if (to === 'BATTLE') startBattle(ctx, at);
  if (to !== 'BATTLE') s.threats = [];
  emit(ctx, at, { type: 'phase_changed', from, to, endsAt: s.phaseEndsAt });
}

function startBattle(ctx: Ctx, at: number): void {
  const s = ctx.s;
  const c = s.config;
  s.playersAtLaunch = Math.max(1, playerCount(s, at));
  s.mechHp = c.mech.max;
  s.shield = 0;
  s.threats = [];
  s.nextStrikeAt = at + c.strikes.firstAtMs;
  s.nextClawAt = at + c.mech.hitFirstAtMs;
  const hp = bossHpFor(c, s.playersAtLaunch);
  const boss = {
    id: newId(s, 'e'),
    kind: 'NULL_CORE' as const,
    hp,
    maxHp: hp,
    orbit: {
      bearing0: 6,
      driftAmp: 3,
      driftPeriodMs: Math.round(randomBetween(s, 16_000, 22_000)),
      phase: randomBetween(s, 0, Math.PI * 2),
      distance: 120,
      altitude: 52,
    },
    spawnedAt: at,
    arrivesAt: at + 1_500,
    weakUntil: 0,
  };
  s.enemies = [boss];
  emit(ctx, at, { type: 'boss_spawned', enemyId: boss.id, hp });
}

function finish(ctx: Ctx, at: number, outcome: 'VICTORY' | 'DEFEAT', reason: string): void {
  const s = ctx.s;
  if (s.result) return;
  flushFree(ctx, at, true);
  s.result = { outcome, reason: reason as never, at };
  s.threats = [];
  enterPhase(ctx, outcome, at);
  emit(ctx, at, { type: 'match_result', outcome, result: s.result });
}

function defeat(ctx: Ctx, at: number, reason: DefeatReason): void {
  finish(ctx, at, 'DEFEAT', reason);
}

/* ------------------------------------------------------------------ battle */

function aliveCities(s: MatchState): CityId[] {
  return CITY_IDS.filter((id) => !s.cities[id].lost);
}

function lostCities(s: MatchState): number {
  return CITY_IDS.length - aliveCities(s).length;
}

function announce(ctx: Ctx, at: number): void {
  const s = ctx.s;
  const c = s.config;
  const boss = bossOf(s);
  if (!boss) return;
  const players = playerCount(s, at);
  if (at >= s.nextStrikeAt) {
    // One city strike at a time, so the hall always knows which city to save.
    const pending = s.threats.some((th) => th.target.type === 'CITY');
    const alive = aliveCities(s);
    if (!pending && alive.length > 0) {
      const cityId = randomPick(s, alive);
      const th: ThreatState = {
        id: newId(s, 'th'),
        sourceId: boss.id,
        kind: 'CORE_LANCE',
        dir: randomPick(s, DIRECTIONS),
        target: { type: 'CITY', cityId },
        warnAt: at,
        impactAt: at + c.strikes.warnMs,
        damage: strikeNeedFor(c, players),
      };
      s.threats.push(th);
      emit(ctx, at, {
        type: 'threat_warning',
        threatId: th.id,
        sourceId: boss.id,
        target: 'CITY',
        cityId,
        dir: th.dir,
        impactAt: th.impactAt,
        amount: th.damage,
      });
    }
    s.nextStrikeAt = at + c.strikes.everyMs;
  }
  if (at >= s.nextClawAt) {
    const th: ThreatState = {
      id: newId(s, 'th'),
      sourceId: boss.id,
      kind: 'BEAM',
      dir: 'FRONT',
      target: { type: 'MECH', part: 'CORE' },
      warnAt: at,
      impactAt: at + c.mech.hitWarnMs,
      damage: mechHitFor(c, players),
    };
    s.threats.push(th);
    emit(ctx, at, {
      type: 'threat_warning',
      threatId: th.id,
      sourceId: boss.id,
      target: 'MECH',
      cityId: null,
      dir: th.dir,
      impactAt: th.impactAt,
      amount: th.damage,
    });
    s.nextClawAt = at + c.mech.hitEveryMs;
  }
}

function resolveImpacts(ctx: Ctx, now: number): void {
  const s = ctx.s;
  const due = s.threats.filter((th) => th.impactAt <= now).sort((a, b) => a.impactAt - b.impactAt);
  if (due.length === 0) return;
  s.threats = s.threats.filter((th) => th.impactAt > now);
  for (const th of due) {
    if (s.result) return;
    if (th.target.type === 'CITY') {
      const cityId = th.target.cityId;
      if (s.shield >= th.damage) {
        s.shield -= th.damage;
        s.stats.strikesBlocked += 1;
        emit(ctx, th.impactAt, {
          type: 'strike_blocked',
          threatId: th.id,
          cityId,
          dir: th.dir,
          need: th.damage,
        });
      } else {
        s.shield = 0;
        s.cities[cityId] = { id: cityId, hp: 0, lost: true };
        s.stats.strikesHit += 1;
        emit(ctx, th.impactAt, { type: 'strike_hit', threatId: th.id, cityId, dir: th.dir });
        if (lostCities(s) >= s.config.strikes.lostForDefeat) {
          defeat(ctx, th.impactAt, 'CITIES_LOST');
          return;
        }
      }
    } else {
      s.mechHp = Math.max(0, s.mechHp - th.damage);
      s.stats.mechHits += 1;
      emit(ctx, th.impactAt, {
        type: 'mech_hit',
        threatId: th.id,
        damage: th.damage,
        hp: s.mechHp,
      });
      if (s.mechHp <= 0) {
        defeat(ctx, th.impactAt, 'MECH_DESTROYED');
        return;
      }
    }
  }
}

/** How big one Lightning action is right now (the same for everyone). */
export function paidEffect(s: MatchState, kind: ActionKind): number {
  if (kind !== 'ATTACK') return s.config.paid.effect[kind];
  const boss = bossOf(s);
  return paidAttackFor(s.config, boss?.maxHp ?? bossHpFor(s.config, playerCount(s)));
}

/** Applies one action's effect; returns the value (HP dealt, shield or armour added). */
function applyEffect(
  ctx: Ctx,
  at: number,
  kind: ActionKind,
  amount: number,
  paid: boolean,
): number {
  const s = ctx.s;
  const c = s.config;
  if (kind === 'ATTACK') {
    const boss = bossOf(s);
    if (!boss || boss.hp <= 0) return 0;
    const dealt = Math.min(boss.hp, amount);
    boss.hp -= dealt;
    if (paid) boss.weakUntil = at + 1_500;
    s.stats.damageToBoss += dealt;
    return dealt;
  }
  if (kind === 'DEFEND') {
    const before = s.shield;
    s.shield = Math.min(c.shield.max, s.shield + amount);
    return Math.round(s.shield - before);
  }
  const before = s.mechHp;
  s.mechHp = Math.min(c.mech.max, s.mechHp + amount);
  const added = Math.round(s.mechHp - before);
  s.stats.repaired += added;
  return added;
}

function checkVictory(ctx: Ctx, at: number): void {
  const boss = bossOf(ctx.s);
  if (boss && boss.hp <= 0 && !ctx.s.result) {
    emit(ctx, at, { type: 'boss_destroyed', enemyId: boss.id });
    finish(ctx, at, 'VICTORY', 'BOSS_DESTROYED');
  }
}

function flushFree(ctx: Ctx, at: number, force = false): void {
  const s = ctx.s;
  if (!force && at - s.lastFlushAt < FREE_FLUSH_MS) return;
  s.lastFlushAt = at;
  for (const kind of ACTION_KINDS) {
    const p = s.pendingFree[kind];
    if (p.n === 0) continue;
    emit(ctx, at, {
      type: 'action',
      kind,
      paid: false,
      virtual: false,
      bot: false,
      value: Math.round(p.value),
      count: p.n,
      settleMs: null,
    });
    s.pendingFree[kind] = { n: 0, value: 0 };
  }
}

/* -------------------------------------------------------------------- step */

function step(ctx: Ctx, now: number, dtSec: number): void {
  const s = ctx.s;
  if (s.phase === 'LOBBY') {
    const n = playerCount(s, now);
    if (!s.autoStartEnabled || s.config.timings.lobbyAutoStartMs <= 0 || n === 0) {
      s.autoStartAt = null;
    } else if (s.autoStartAt === null) {
      s.autoStartAt = now + s.config.timings.lobbyAutoStartMs;
    } else if (now >= s.autoStartAt) {
      enterPhase(ctx, 'COUNTDOWN', s.autoStartAt);
    }
    return;
  }
  if (s.phaseEndsAt !== null && now >= s.phaseEndsAt) {
    const at = s.phaseEndsAt;
    if (s.phase === 'BATTLE') {
      defeat(ctx, at, 'TIME_UP');
      return;
    }
    const next = NEXT_TIMED[s.phase];
    if (next) enterPhase(ctx, next, at);
    else s.phaseEndsAt = null; // RESULTS over: the server opens the next match.
  }
  if (s.phase !== 'BATTLE') return;
  s.shield = Math.max(0, s.shield - s.config.shield.decayPerSec * dtSec);
  announce(ctx, now);
  resolveImpacts(ctx, now);
  if (s.phase !== 'BATTLE') return;
  s.stats.peakPlayers = Math.max(s.stats.peakPlayers, playerCount(s, now));
  flushFree(ctx, now);
}

function advanceCtx(ctx: Ctx, t: number): void {
  const s = ctx.s;
  if (t <= s.t) return;
  if (s.paused) {
    s.t = t;
    s.simT = Math.floor(t / STEP_MS) * STEP_MS;
    return;
  }
  while (s.simT + STEP_MS <= t) {
    s.simT += STEP_MS;
    step(ctx, s.simT, STEP_MS / 1000);
  }
  s.t = t;
}

export function advanceTo(state: MatchState, t: number): AdvanceResult {
  if (t <= state.t) return { state, events: [] };
  const ctx: Ctx = { s: structuredClone(state), events: [] };
  advanceCtx(ctx, t);
  ctx.s.version += 1;
  return { state: ctx.s, events: ctx.events };
}

/* ----------------------------------------------------------------- players */

function emptyPlayerStats(): PlayerState['stats'] {
  return { free: zeroCounts(), paid: zeroCounts(), damage: 0 };
}

function join(ctx: Ctx, at: number, pilotId: string, displayName: string, bot: boolean): void {
  const s = ctx.s;
  const existing = s.players[pilotId];
  if (existing) {
    existing.connected = true;
    existing.disconnectedAt = null;
    existing.displayName = displayName;
    return;
  }
  const before = playerCount(s, at);
  s.players[pilotId] = {
    pilotId,
    displayName,
    bot,
    connected: true,
    disconnectedAt: null,
    joinedAt: at,
    freeReadyAt: 0,
    stats: emptyPlayerStats(),
  };
  const after = playerCount(s, at);
  if (s.phase === 'BATTLE') growBoss(s, after, before);
  emit(ctx, at, { type: 'player_joined', players: after, bot });
}

/** Latecomers make the boss proportionally tougher; the HP bar keeps its percentage. */
function growBoss(s: MatchState, players: number, before: number): void {
  const boss = bossOf(s);
  if (!boss || players <= before) return;
  const max = bossHpFor(s.config, Math.max(players, s.playersAtLaunch));
  if (max <= boss.maxHp) return;
  boss.hp = Math.round((boss.hp * max) / boss.maxHp);
  boss.maxHp = max;
}

function remember(s: MatchState, id: string, accepted: boolean, reason: ReasonCode | null): void {
  s.actionLog[id] = { accepted, reason };
  s.actionLogOrder.push(id);
  while (s.actionLogOrder.length > ACTION_LOG_MAX) {
    const old = s.actionLogOrder.shift()!;
    delete s.actionLog[old];
  }
}

function freeAction(
  ctx: Ctx,
  at: number,
  pilotId: string,
  clientActionId: string,
  kind: ActionKind,
): ActionResult {
  const s = ctx.s;
  const seen = s.actionLog[clientActionId];
  if (seen) {
    return {
      clientActionId,
      accepted: seen.accepted,
      ...(seen.reason ? { reasonCode: seen.reason as ReasonCode } : {}),
    };
  }
  const refuse = (reasonCode: ReasonCode, readyAt?: number): ActionResult => {
    // Cooldown refusals are not remembered: the same key may be retried a moment later.
    if (reasonCode !== 'COOLDOWN') remember(s, clientActionId, false, reasonCode);
    return { clientActionId, accepted: false, reasonCode, ...(readyAt ? { readyAt } : {}) };
  };
  const p = s.players[pilotId];
  if (!p) return refuse('NOT_JOINED');
  if (s.phase !== 'BATTLE') return refuse('NOT_IN_COMBAT');
  if (s.paused) return refuse('PAUSED');
  if (at < p.freeReadyAt) return refuse('COOLDOWN', p.freeReadyAt);
  p.freeReadyAt = at + s.config.free.cooldownMs;
  const value = applyEffect(ctx, at, kind, s.config.free.effect[kind], false);
  p.stats.free[kind] += 1;
  if (kind === 'ATTACK') p.stats.damage += value;
  s.stats.free[kind] += 1;
  s.pendingFree[kind].n += 1;
  s.pendingFree[kind].value += value;
  remember(s, clientActionId, true, null);
  checkVictory(ctx, at);
  return { clientActionId, accepted: true, readyAt: p.freeReadyAt };
}

function paidAction(ctx: Ctx, cmd: Extract<EngineCommand, { type: 'PAID_ACTION' }>): boolean {
  const s = ctx.s;
  if (s.phase !== 'BATTLE' || s.paidApplied.includes(cmd.intentId)) return false;
  // A pause never eats a settled payment: it lands the moment it is confirmed.
  flushFree(ctx, cmd.t, true);
  const value = applyEffect(ctx, cmd.t, cmd.kind, paidEffect(s, cmd.kind), true);
  s.paidApplied.push(cmd.intentId);
  s.stats.paid[cmd.kind] += 1;
  s.stats.lightning += 1;
  if (cmd.virtual) s.stats.virtual += 1;
  const p = cmd.pilotId ? s.players[cmd.pilotId] : undefined;
  if (p) {
    p.stats.paid[cmd.kind] += 1;
    if (cmd.kind === 'ATTACK') p.stats.damage += value;
  }
  emit(ctx, cmd.t, {
    type: 'action',
    kind: cmd.kind,
    paid: true,
    virtual: cmd.virtual,
    bot: !!cmd.bot,
    value,
    count: 1,
    settleMs: cmd.virtual ? null : cmd.settleMs,
  });
  checkVictory(ctx, cmd.t);
  return true;
}

/* ------------------------------------------------------------------ reduce */

export function reduce(state: MatchState, cmd: EngineCommand): ReduceResult {
  const ctx: Ctx = { s: structuredClone(state), events: [] };
  advanceCtx(ctx, cmd.t);
  const s = ctx.s;
  const at = Math.max(cmd.t, s.t);
  let outcome: CommandOutcome = { kind: 'control', ok: false };
  const control = (ok: boolean) => (outcome = { kind: 'control', ok });
  switch (cmd.type) {
    case 'START':
      if (s.phase === 'LOBBY') {
        enterPhase(ctx, 'COUNTDOWN', at);
        control(true);
      }
      break;
    case 'SKIP_DEPLOY':
      if (s.phase === 'COUNTDOWN' || s.phase === 'DEPLOYMENT') {
        enterPhase(ctx, 'BATTLE', at);
        control(true);
      }
      break;
    case 'PAUSE':
      if (!s.paused && s.phase !== 'LOBBY' && s.phase !== 'RESULTS') {
        s.paused = true;
        emit(ctx, at, { type: 'match_paused' });
        control(true);
      }
      break;
    case 'RESUME':
      if (s.paused) {
        s.paused = false;
        emit(ctx, at, { type: 'match_resumed' });
        control(true);
      }
      break;
    case 'END':
      if (s.phase === 'BATTLE' || s.phase === 'COUNTDOWN' || s.phase === 'DEPLOYMENT') {
        s.paused = false;
        defeat(ctx, at, 'ABORTED');
        control(true);
      }
      break;
    case 'SET_AUTO_START':
      s.autoStartEnabled = cmd.enabled;
      if (!cmd.enabled) s.autoStartAt = null;
      control(true);
      break;
    case 'PLAYER_JOIN':
      join(ctx, at, cmd.pilotId, cmd.displayName.slice(0, 24), !!cmd.bot);
      control(true);
      break;
    case 'PLAYER_CONNECTION': {
      const p = s.players[cmd.pilotId];
      if (p) {
        const before = playerCount(s, at);
        p.connected = cmd.connected;
        p.disconnectedAt = cmd.connected ? null : at;
        if (cmd.connected && s.phase === 'BATTLE') growBoss(s, playerCount(s, at), before);
        control(true);
      }
      break;
    }
    case 'PLAYER_LEAVE':
      if (s.players[cmd.pilotId]) {
        delete s.players[cmd.pilotId];
        emit(ctx, at, { type: 'player_left', players: playerCount(s, at) });
        control(true);
      }
      break;
    case 'PLAYER_RENAME': {
      const p = s.players[cmd.pilotId];
      if (p) {
        p.displayName = cmd.displayName.slice(0, 24);
        control(true);
      }
      break;
    }
    case 'ACTION':
      outcome = {
        kind: 'action',
        result: freeAction(ctx, at, cmd.pilotId, cmd.clientActionId, cmd.kind),
      };
      break;
    case 'PAID_ACTION':
      control(paidAction(ctx, { ...cmd, t: at }));
      break;
  }
  ctx.s.version += 1;
  return { state: ctx.s, events: ctx.events, outcome };
}

/** RESULTS has run its course: the server should open the next match. */
export function isRoundOver(s: MatchState): boolean {
  return s.phase === 'RESULTS' && s.phaseEndsAt === null;
}
