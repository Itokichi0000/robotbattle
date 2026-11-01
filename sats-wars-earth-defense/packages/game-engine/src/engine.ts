import {
  ACTION_KINDS,
  bossHpFor,
  SQUAD_IDS,
  SQUADS,
  routeProgress,
  zoneAt,
  configHash,
  DIRECTIONS,
  boltDamageFor,
  boltTargetAt,
  mechHitFor,
  strikeNeedFor,
} from '@swed/shared';
import type {
  ActionKind,
  ActionResult,
  BoltState,
  SquadId,
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
 *   撃つ ATTACK  damages NULL CORE                       (砲撃班; anyone may shoot)
 *   守る DEFEND  fills the shield that blocks the announced strike on a squad (防衛班)
 *   直す REPAIR  restores RAIJIN's armour after a claw     (整備班)
 * Every player belongs to a team (D-035); a team nobody is in is shared by everyone, so one
 * or two people can still play. A Lightning payment starts THUNDER MODE for the whole hall
 * and grants the payer one bolt, judged here from the raw tap (position and time).
 */

export const STEP_MS = 50;
/** Free taps reach the screens as one aggregated event per action this often. */
export const FREE_FLUSH_MS = 200;
const ACTION_LOG_MAX = 600;
/** A throw's claimed time may differ this much from the server's (network, clock drift). */
export const BOLT_CLOCK_SLACK_MS = 1_500;
/** Demo-bot bolts are thrown this long after they are granted. */
const BOT_BOLT_DELAY_MS = 1_500;

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
  | { type: 'LAUNCH_PUSH'; t: number; pilotId: string }
  | {
      type: 'LIGHTNING';
      t: number;
      intentId: string;
      pilotId: string | null;
      virtual: boolean;
      bot?: boolean;
      settleMs: number | null;
    }
  | {
      type: 'BOLT_THROW';
      t: number;
      pilotId: string;
      boltId: string;
      x: number;
      y: number;
      /** The pilot's match time when they tapped (trusted only within BOLT_CLOCK_SLACK_MS). */
      at: number;
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
    lightning: 0,
    virtual: 0,
    bolts: 0,
    boltHits: 0,
    feverActions: 0,
    launched: 0,
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
  const squads = Object.fromEntries(
    SQUAD_IDS.map((id) => [id, { id, hp: 100, lost: false }]),
  ) as MatchState['squads'];
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
      ATTACK: { n: 0, value: 0, fever: 0 },
      DEFEND: { n: 0, value: 0, fever: 0 },
      REPAIR: { n: 0, value: 0, fever: 0 },
    },
    lastFlushAt: 0,
    players: {},
    playersAtLaunch: 0,
    mechHp: c.mech.max,
    shield: 0,
    enemies: [],
    threats: [],
    squads,
    nextStrikeAt: 0,
    nextClawAt: 0,
    launched: [],
    feverUntil: 0,
    bolts: [],
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

/** People per team among the players counted right now. */
export function teamCounts(s: MatchState, at = s.t): Record<ActionKind, number> {
  const out = zeroCounts();
  for (const p of countedPlayers(s, at)) out[p.role] += 1;
  return out;
}

/**
 * What a player's phone may do: their own team's job, plus the job of any team nobody is in
 * (one player does everything; two share the third job). Shooting is always allowed: it is
 * what guards and engineers do while their own job is done.
 */
export function jobsOf(s: MatchState, pilotId: string, at = s.t): ActionKind[] {
  const p = s.players[pilotId];
  if (!p) return [];
  const counts = teamCounts(s, at);
  const jobs: ActionKind[] = [p.role];
  for (const k of ACTION_KINDS) if (counts[k] === 0 && !jobs.includes(k)) jobs.push(k);
  return jobs;
}

/**
 * A short-handed team's taps count for more (fair share, never less than ×1, at most ×2):
 * with four people there is one guard and one engineer, and the strike need grows with the
 * whole crowd. Shooting is everyone's, so it is never scaled. A team nobody is in is shared
 * by everyone and is not scaled either.
 */
export function teamScale(s: MatchState, kind: ActionKind, at = s.t): number {
  if (kind === 'ATTACK') return 1;
  const counts = teamCounts(s, at);
  const n = countedPlayers(s, at).length;
  const doers = counts[kind] > 0 ? counts[kind] : n;
  return Math.min(2, Math.max(1, n / (3 * Math.max(1, doers))));
}

/** The team a newcomer joins: the smallest one (ties go 撃つ → 守る → 直す). */
function teamForNewcomer(s: MatchState, at: number): ActionKind {
  const counts = teamCounts(s, at);
  let best: ActionKind = 'ATTACK';
  for (const k of ACTION_KINDS) if (counts[k] < counts[best]) best = k;
  return best;
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
  // The group launch: everyone who swiped up adds to the starting shield.
  const counted = new Set(countedPlayers(s, at).map((p) => p.pilotId));
  const launched = s.launched.filter((id) => counted.has(id)).length;
  s.stats.launched = launched;
  s.shield = Math.round((c.launch.shieldAtFull * launched) / s.playersAtLaunch);
  s.feverUntil = 0;
  s.bolts = [];
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
  s.bolts = [];
  enterPhase(ctx, outcome, at);
  emit(ctx, at, { type: 'match_result', outcome, result: s.result });
}

function defeat(ctx: Ctx, at: number, reason: DefeatReason): void {
  finish(ctx, at, 'DEFEAT', reason);
}

/* ------------------------------------------------------------------ battle */

function aliveSquads(s: MatchState): SquadId[] {
  return SQUAD_IDS.filter((id) => !s.squads[id].lost);
}

function lostSquads(s: MatchState): number {
  return SQUAD_IDS.length - aliveSquads(s).length;
}

function announce(ctx: Ctx, at: number): void {
  const s = ctx.s;
  const c = s.config;
  const boss = bossOf(s);
  if (!boss) return;
  const players = playerCount(s, at);
  if (at >= s.nextStrikeAt) {
    // One squad strike at a time, so the hall always knows which squad to save. The mothership
    // attacks the squads of the area it is flying through (Mars → Moon → Earth, D-034); once
    // those are gone it fires at whoever is left.
    const pending = s.threats.some((th) => th.target.type === 'SQUAD');
    const alive = aliveSquads(s);
    if (!pending && alive.length > 0) {
      const zone = zoneAt(routeProgress(s, c.timings.battleMs, at));
      const near = alive.filter((id) => SQUADS[id].zone === zone);
      const squadId = randomPick(s, near.length > 0 ? near : alive);
      const th: ThreatState = {
        id: newId(s, 'th'),
        sourceId: boss.id,
        kind: 'CORE_LANCE',
        dir: randomPick(s, DIRECTIONS),
        target: { type: 'SQUAD', squadId },
        warnAt: at,
        impactAt: at + c.strikes.warnMs,
        damage: strikeNeedFor(c, players),
      };
      s.threats.push(th);
      emit(ctx, at, {
        type: 'threat_warning',
        threatId: th.id,
        sourceId: boss.id,
        target: 'SQUAD',
        squadId,
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
      squadId: null,
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
    if (th.target.type === 'SQUAD') {
      const squadId = th.target.squadId;
      if (s.shield >= th.damage) {
        s.shield -= th.damage;
        s.stats.strikesBlocked += 1;
        emit(ctx, th.impactAt, {
          type: 'strike_blocked',
          threatId: th.id,
          squadId,
          dir: th.dir,
          need: th.damage,
        });
      } else {
        s.shield = 0;
        s.squads[squadId] = { id: squadId, hp: 0, lost: true };
        s.stats.strikesHit += 1;
        emit(ctx, th.impactAt, { type: 'strike_hit', threatId: th.id, squadId, dir: th.dir });
        if (lostSquads(s) >= s.config.strikes.lostForDefeat) {
          defeat(ctx, th.impactAt, 'SQUADS_LOST');
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

/** How big a Lightning bolt is right now, before the weak-point bonus (same for everyone). */
export function boltDamage(s: MatchState): number {
  const boss = bossOf(s);
  return boltDamageFor(s.config, boss?.maxHp ?? bossHpFor(s.config, playerCount(s)));
}

export function feverOn(s: { feverUntil: number }, at: number): boolean {
  return at < s.feverUntil;
}

/** Applies one action's effect; returns the value (HP dealt, shield or armour added). */
function applyEffect(ctx: Ctx, at: number, kind: ActionKind, amount: number, big: boolean): number {
  const s = ctx.s;
  const c = s.config;
  if (kind === 'ATTACK') {
    const boss = bossOf(s);
    if (!boss || boss.hp <= 0) return 0;
    const dealt = Math.min(boss.hp, amount);
    boss.hp -= dealt;
    if (big) boss.weakUntil = at + 1_500;
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
      value: Math.round(p.value),
      count: p.n,
      fever: p.fever > 0,
    });
    s.pendingFree[kind] = { n: 0, value: 0, fever: 0 };
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
  resolveBolts(ctx, now);
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
  return { free: zeroCounts(), lightning: 0, damage: 0 };
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
  const role = teamForNewcomer(s, at);
  s.players[pilotId] = {
    pilotId,
    displayName,
    bot,
    connected: true,
    disconnectedAt: null,
    joinedAt: at,
    role,
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
  if (kind !== 'ATTACK' && !jobsOf(s, pilotId, at).includes(kind)) return refuse('WRONG_TEAM');
  if (at < p.freeReadyAt) return refuse('COOLDOWN', p.freeReadyAt);
  p.freeReadyAt = at + s.config.free.cooldownMs;
  const fever = feverOn(s, at);
  const amount =
    s.config.free.effect[kind] *
    teamScale(s, kind, at) *
    (fever ? s.config.paid.feverMultiplier : 1);
  const value = applyEffect(ctx, at, kind, amount, false);
  p.stats.free[kind] += 1;
  if (kind === 'ATTACK') p.stats.damage += value;
  s.stats.free[kind] += 1;
  if (fever) s.stats.feverActions += 1;
  s.pendingFree[kind].n += 1;
  s.pendingFree[kind].value += value;
  if (fever) s.pendingFree[kind].fever += 1;
  remember(s, clientActionId, true, null);
  checkVictory(ctx, at);
  return { clientActionId, accepted: true, readyAt: p.freeReadyAt };
}

/**
 * A confirmed Lightning payment: THUNDER MODE for everyone (reset to its full length, never
 * stacked) and one bolt for the payer to throw.
 */
function lightning(ctx: Ctx, cmd: Extract<EngineCommand, { type: 'LIGHTNING' }>): boolean {
  const s = ctx.s;
  const c = s.config;
  if (s.phase !== 'BATTLE' || s.paidApplied.includes(cmd.intentId)) return false;
  // A pause never eats a settled payment: it lands the moment it is confirmed.
  flushFree(ctx, cmd.t, true);
  s.paidApplied.push(cmd.intentId);
  s.feverUntil = cmd.t + c.paid.feverMs;
  const bolt: BoltState = {
    id: cmd.intentId,
    pilotId: cmd.pilotId,
    startedAt: cmd.t,
    expiresAt: cmd.t + c.paid.boltWindowMs,
    virtual: cmd.virtual,
    bot: !!cmd.bot,
  };
  s.bolts.push(bolt);
  s.stats.lightning += 1;
  if (cmd.virtual) s.stats.virtual += 1;
  const p = cmd.pilotId ? s.players[cmd.pilotId] : undefined;
  if (p) p.stats.lightning += 1;
  emit(ctx, cmd.t, {
    type: 'lightning',
    boltId: bolt.id,
    virtual: cmd.virtual,
    bot: !!cmd.bot,
    settleMs: cmd.virtual ? null : cmd.settleMs,
    feverUntil: s.feverUntil,
  });
  return true;
}

/** Throws a bolt: a hit on the weak point is worth `boltHitMultiplier` ×. */
function throwBolt(ctx: Ctx, at: number, bolt: BoltState, hit: boolean, auto: boolean): void {
  const s = ctx.s;
  s.bolts = s.bolts.filter((b) => b.id !== bolt.id);
  const base = boltDamage(s);
  const dealt = applyEffect(
    ctx,
    at,
    'ATTACK',
    base * (hit ? s.config.paid.boltHitMultiplier : 1),
    true,
  );
  s.stats.bolts += 1;
  if (hit) s.stats.boltHits += 1;
  const p = bolt.pilotId ? s.players[bolt.pilotId] : undefined;
  if (p) p.stats.damage += dealt;
  emit(ctx, at, { type: 'bolt_thrown', boltId: bolt.id, hit, damage: dealt, auto });
  checkVictory(ctx, at);
}

/** Judges a payer's tap against where the weak point was at that moment. */
export function boltHits(
  c: GameConfig,
  bolt: { id: string; startedAt: number; expiresAt: number },
  x: number,
  y: number,
  claimedAt: number,
  serverAt: number,
): boolean {
  const at =
    Math.abs(claimedAt - serverAt) <= BOLT_CLOCK_SLACK_MS
      ? Math.min(bolt.expiresAt, Math.max(bolt.startedAt, claimedAt))
      : serverAt;
  const target = boltTargetAt(bolt.id, at - bolt.startedAt);
  return Math.hypot(target.x - x, target.y - y) <= c.paid.boltRadius;
}

function boltThrow(ctx: Ctx, cmd: Extract<EngineCommand, { type: 'BOLT_THROW' }>): ActionResult {
  const s = ctx.s;
  const res = (accepted: boolean, reasonCode?: ReasonCode): ActionResult => ({
    clientActionId: cmd.boltId,
    accepted,
    ...(reasonCode ? { reasonCode } : {}),
  });
  if (s.phase !== 'BATTLE') return res(false, 'NOT_IN_COMBAT');
  const bolt = s.bolts.find((b) => b.id === cmd.boltId && b.pilotId === cmd.pilotId);
  if (!bolt) return res(false, 'NO_BOLT');
  const hit = boltHits(s.config, bolt, cmd.x, cmd.y, cmd.at, cmd.t);
  throwBolt(ctx, cmd.t, bolt, hit, false);
  return res(true);
}

/** Bolts nobody threw in time are thrown for the payer; demo bots throw theirs. */
function resolveBolts(ctx: Ctx, now: number): void {
  const s = ctx.s;
  for (const bolt of [...s.bolts]) {
    if (s.result) return;
    if (bolt.pilotId === null && now >= bolt.startedAt + BOT_BOLT_DELAY_MS) {
      throwBolt(ctx, now, bolt, randomBetween(s, 0, 1) < 0.5, true);
    } else if (now >= bolt.expiresAt) {
      throwBolt(ctx, now, bolt, false, true);
    }
  }
}

/** The group launch: one swipe per player during the countdown and the launch. */
function launchPush(ctx: Ctx, at: number, pilotId: string): ActionResult {
  const s = ctx.s;
  const res = (accepted: boolean, reasonCode?: ReasonCode): ActionResult => ({
    clientActionId: `launch:${pilotId}`,
    accepted,
    ...(reasonCode ? { reasonCode } : {}),
  });
  if (!s.players[pilotId]) return res(false, 'NOT_JOINED');
  if (s.phase !== 'COUNTDOWN' && s.phase !== 'DEPLOYMENT') return res(false, 'NOT_LAUNCHING');
  if (!s.launched.includes(pilotId)) {
    s.launched.push(pilotId);
    emit(ctx, at, {
      type: 'launch_push',
      launched: s.launched.filter((id) => s.players[id]).length,
      players: playerCount(s, at),
    });
  }
  return res(true);
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
    case 'LIGHTNING':
      control(lightning(ctx, { ...cmd, t: at }));
      break;
    case 'BOLT_THROW':
      outcome = { kind: 'action', result: boltThrow(ctx, { ...cmd, t: at }) };
      break;
    case 'LAUNCH_PUSH':
      outcome = { kind: 'action', result: launchPush(ctx, at, cmd.pilotId) };
      break;
  }
  ctx.s.version += 1;
  return { state: ctx.s, events: ctx.events, outcome };
}

/** RESULTS has run its course: the server should open the next match. */
export function isRoundOver(s: MatchState): boolean {
  return s.phase === 'RESULTS' && s.phaseEndsAt === null;
}
