import type {
  AttackKind,
  BoardPatch,
  CityHit,
  CityState,
  CrewMember,
  Enemy,
  EnemyConfig,
  EnemyKind,
  EnergySink,
  GameConfig,
  GameEvent,
  MvpEntry,
  Pilot,
  RaidEndReason,
  RaidPhase,
  RaidResult,
  RaidState,
  RaidStats,
  RaidStatus,
  RegionId,
  RepairTarget,
  RobotId,
  Role,
  Task,
  TaskDifficulty,
  TaskEffect,
  TaskErrorCode,
  TaskInput,
  TaskResult,
  TaskTarget,
  Telegraph,
  Weakpoint,
} from '@sats-wars/shared';
import { COMBAT_PHASES, REGION_IDS, ROLES, configHash } from '@sats-wars/shared';
import {
  ROBOT_FOR_ROLE,
  activePilotIds,
  difficultyScale,
  facilityActive,
  liveEnemies,
  ms,
  phaseAt,
  recommendGuardianTarget,
  recommendGunnerTarget,
  recommendRepair,
  recommendSink,
  robotPower,
  roleScale,
  standingCities,
} from './rules';
import { engineerParams, evaluateTask, guardianParams, gunnerParams, randomDirection, routerParams } from './tasks';

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface TaskChoice {
  enemyId?: number;
  weakpoint?: Weakpoint;
  telegraphId?: number;
  cityId?: RegionId;
  sink?: EnergySink;
  repair?: RepairTarget;
  difficulty?: TaskDifficulty;
}

/** Every command carries the pause-corrected server clock `t` (ms). */
export type EngineCommand =
  | { type: 'OPEN_LOBBY'; t: number }
  | { type: 'START'; t: number }
  | { type: 'TICK'; t: number }
  | { type: 'BOARD'; t: number; pilotId: string; callsign: string; role: Role; robot?: RobotId; isBot?: boolean }
  | { type: 'CHANGE_ROLE'; t: number; pilotId: string; role: Role; robot?: RobotId }
  | { type: 'REQUEST_TASK'; t: number; pilotId: string; choice?: TaskChoice }
  | { type: 'SUBMIT_TASK'; t: number; pilotId: string; taskId: string; input: TaskInput }
  | { type: 'PAUSE'; t: number; reason: string }
  | { type: 'RESUME'; t: number }
  | { type: 'END'; t: number; reason: string }
  | { type: 'CANCEL'; t: number; reason: string };

export type BoardCode = 'OK' | 'ALREADY_BOARDED' | 'JOIN_CLOSED' | 'RAID_FULL' | 'NOT_OPEN';
export type RoleChangeCode = 'OK' | 'ROLE_COOLDOWN' | 'NOT_BOARDED' | 'NOT_OPEN';

export type CommandOutcome =
  | { kind: 'none' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'board'; code: BoardCode; pilot: Pilot | null }
  | { kind: 'role'; code: RoleChangeCode; pilot: Pilot | null }
  | { kind: 'task'; code: 'OK' | TaskErrorCode; task: Task | null; cooldownUntil: number }
  | { kind: 'submit'; result: TaskResult };

export interface ReduceResult {
  state: RaidState;
  events: GameEvent[];
  outcome: CommandOutcome;
}

/** Pilot id used for the low-population assist AI. */
export const ASSIST_PILOT_ID = 'AI';
const ASSIST_CALLSIGN = '補佐AI';

const emptyStats = (): RaidStats => ({
  tasks: 0,
  successes: 0,
  enemiesDefeated: 0,
  cityDamageTaken: 0,
  shieldAbsorbed: 0,
  energyRouted: 0,
  repairs: 0,
  syncSum: 0,
  syncSamples: 0,
  syncPeak: 0,
  assistActions: 0,
  peakPilots: 0,
});

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createRaidState(raidId: string, config: GameConfig, seed = 1): RaidState {
  const cities = {} as Record<RegionId, CityState>;
  for (const cityId of REGION_IDS) cities[cityId] = { cityId, hp: config.cityMaxHp, shield: 0, destroyed: false, rebuildReadyAt: 0 };
  const sp = config.special;
  return {
    raidId,
    config: structuredClone(config),
    configHash: configHash(config),
    seed,
    rng: seed >>> 0,
    status: 'CREATED',
    phase: 'LOBBY',
    pausedFrom: null,
    pauseReason: null,
    clockMs: 0,
    liveStartClock: null,
    gameMs: 0,
    cities,
    robots: {
      RAIJIN: { robotId: 'RAIJIN', health: 100, energy: 20, componentDamaged: false },
      FUJIN: { robotId: 'FUJIN', health: 100, energy: 20, componentDamaged: false },
    },
    reserveEnergy: 0,
    jammedUntil: 0,
    enemies: [],
    telegraphs: [],
    bossId: null,
    nextId: 1,
    spawnIndex: 0,
    sync: 0,
    syncWindow: { index: -1, roles: {}, pilots: [] },
    nextDecayAt: ms(config.phaseStartsSeconds.WAVE_1),
    nextAssistAt: ms(config.assistIntervalSeconds),
    special: {
      status: 'LOCKED',
      opensAt: ms(sp.availableAfterSeconds),
      closesAt: ms(sp.availableAfterSeconds + sp.activationWindowSeconds),
      contributors: {},
      resolvedAt: null,
    },
    pilots: {},
    stats: emptyStats(),
    result: null,
    seq: 0,
    revision: 0,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Pure reducer: (state, command) -> (newState, events, outcome). The input is
 * never mutated. Time-driven rules (phases, spawns, enemy AI, SYNC decay, the
 * special window, the 8-minute limit) run inside `advanceTo` in exact game-time
 * order, so the same command log always replays to the same raid.
 */
export function reduce(prev: RaidState, cmd: EngineCommand): ReduceResult {
  const ctx = new Ctx(structuredClone(prev));
  advanceTo(ctx, cmd.t);
  let outcome: CommandOutcome = { kind: 'none' };
  switch (cmd.type) {
    case 'TICK':
      break;
    case 'OPEN_LOBBY':
      outcome = openLobby(ctx);
      break;
    case 'START':
      outcome = start(ctx);
      break;
    case 'BOARD':
      outcome = board(ctx, cmd);
      break;
    case 'CHANGE_ROLE':
      outcome = changeRole(ctx, cmd);
      break;
    case 'REQUEST_TASK':
      outcome = requestTask(ctx, cmd.pilotId, cmd.choice ?? {});
      break;
    case 'SUBMIT_TASK':
      outcome = { kind: 'submit', result: submitTask(ctx, cmd.pilotId, cmd.taskId, cmd.input) };
      break;
    case 'PAUSE':
      outcome = pause(ctx, cmd.reason);
      break;
    case 'RESUME':
      outcome = resume(ctx);
      break;
    case 'END':
      outcome = adminEnd(ctx, cmd.reason);
      break;
    case 'CANCEL':
      outcome = cancel(ctx, cmd.reason);
      break;
  }
  ctx.state.revision = ctx.state.seq;
  return { state: ctx.state, events: ctx.events, outcome };
}

/** Replay a full command log from scratch (recovery and verification). */
export function replay(raidId: string, config: GameConfig, seed: number, commands: EngineCommand[]): { state: RaidState; events: GameEvent[] } {
  let state = createRaidState(raidId, config, seed);
  const events: GameEvent[] = [];
  for (const cmd of commands) {
    const r = reduce(state, cmd);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

export function crewOf(s: RaidState): CrewMember[] {
  return Object.values(s.pilots).map((p) => ({ pilotId: p.pilotId, callsign: p.callsign, role: p.role, robot: p.robot, isBot: p.isBot }));
}

class Ctx {
  events: GameEvent[] = [];
  constructor(public state: RaidState) {}

  board(withCrew = false): BoardPatch {
    const s = this.state;
    return {
      status: s.status,
      phase: s.phase,
      pausedFrom: s.pausedFrom,
      liveStartClock: s.liveStartClock,
      cities: REGION_IDS.map((id) => s.cities[id]),
      robots: [s.robots.RAIJIN, s.robots.FUJIN],
      reserveEnergy: s.reserveEnergy,
      jammedUntil: s.jammedUntil,
      enemies: s.enemies,
      telegraphs: s.telegraphs,
      bossId: s.bossId,
      sync: s.sync,
      special: s.special,
      stats: s.stats,
      result: s.result,
      ...(withCrew ? { crew: crewOf(s) } : {}),
    };
  }

  emit<T extends GameEvent['type']>(type: T, data: Extract<GameEvent, { type: T }>['data'], withCrew = false): void {
    const s = this.state;
    s.seq += 1;
    this.events.push({
      raidId: s.raidId,
      seq: s.seq,
      t: s.clockMs,
      gameMs: s.gameMs,
      type,
      data,
      patch: structuredClone(this.board(withCrew)),
    } as GameEvent);
  }

  setStatus(to: RaidStatus, reason: string | null): void {
    const from = this.state.status;
    this.state.status = to;
    this.emit('RAID_STATUS_CHANGED', { from, to, reason });
  }

  setPhase(to: RaidPhase): void {
    const from = this.state.phase;
    if (from === to) return;
    this.state.phase = to;
    this.emit('PHASE_CHANGED', { from, to });
  }

  /** mulberry32 step on the state's own RNG, so replays are identical. */
  rand = (): number => {
    const s = this.state;
    s.rng = (s.rng + 0x6d2b79f5) >>> 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  between([lo, hi]: [number, number]): number {
    return Math.round(lo + this.rand() * (hi - lo));
  }
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

type TimerKind = 'PHASE' | 'SPAWN' | 'ENEMY' | 'SPECIAL_OPEN' | 'SPECIAL_CLOSE' | 'DECAY' | 'ASSIST' | 'TIMEOUT';

function nextTimer(s: RaidState): { at: number; kind: TimerKind; enemyId?: number } | null {
  const c = s.config;
  const cands: Array<{ at: number; kind: TimerKind; enemyId?: number }> = [];
  const p = c.phaseStartsSeconds;
  for (const ph of ['WAVE_1', 'WAVE_2', 'WAVE_3', 'FINAL_WAVE'] as const) {
    if (COMBAT_PHASES.indexOf(s.phase as (typeof COMBAT_PHASES)[number]) < COMBAT_PHASES.indexOf(ph)) {
      cands.push({ at: ms(p[ph]), kind: 'PHASE' });
      break;
    }
  }
  const spawn = c.spawns[s.spawnIndex];
  if (spawn) cands.push({ at: ms(spawn.atSeconds), kind: 'SPAWN' });
  for (const e of s.enemies) cands.push({ at: e.aiUntil, kind: 'ENEMY', enemyId: e.id });
  if (s.special.status === 'LOCKED') cands.push({ at: s.special.opensAt, kind: 'SPECIAL_OPEN' });
  if (s.special.status === 'OPEN') cands.push({ at: s.special.closesAt, kind: 'SPECIAL_CLOSE' });
  cands.push({ at: s.nextDecayAt, kind: 'DECAY' });
  cands.push({ at: s.nextAssistAt, kind: 'ASSIST' });
  cands.push({ at: ms(c.matchSeconds), kind: 'TIMEOUT' });
  // Stable order for ties: list order above (phase before spawns before AI...).
  let best: (typeof cands)[number] | null = null;
  for (const x of cands) if (!best || x.at < best.at) best = x;
  return best;
}

function advanceTo(ctx: Ctx, rawT: number): void {
  const s = ctx.state;
  const t = Math.max(s.clockMs, rawT);
  if (s.status === 'LIVE' && s.liveStartClock !== null) {
    const target = t - s.liveStartClock;
    for (let guard = 0; guard < 10_000 && s.status === 'LIVE'; guard++) {
      const next = nextTimer(s);
      if (!next || next.at > target) break;
      s.gameMs = Math.max(s.gameMs, next.at);
      s.clockMs = s.liveStartClock + s.gameMs;
      runTimer(ctx, next.kind, next.enemyId);
    }
    if (s.status === 'LIVE') s.gameMs = Math.max(s.gameMs, target);
  }
  s.clockMs = t;
}

function runTimer(ctx: Ctx, kind: TimerKind, enemyId?: number): void {
  const s = ctx.state;
  const c = s.config;
  switch (kind) {
    case 'PHASE':
      ctx.setPhase(phaseAt(c, s.gameMs));
      return;
    case 'SPAWN': {
      const sp = c.spawns[s.spawnIndex]!;
      s.spawnIndex += 1;
      spawnEnemy(ctx, sp.kind);
      return;
    }
    case 'ENEMY':
      stepEnemy(ctx, enemyId!);
      return;
    case 'SPECIAL_OPEN':
      s.special.status = 'OPEN';
      ctx.emit('SPECIAL_WINDOW_OPENED', { closesAt: s.special.closesAt });
      return;
    case 'SPECIAL_CLOSE':
      closeSpecial(ctx);
      return;
    case 'DECAY': {
      s.nextDecayAt = s.gameMs + ms(c.sync.decayEverySeconds);
      s.stats.syncSum += s.sync;
      s.stats.syncSamples += 1;
      const amount = Math.max(0, c.sync.decayAmount - (facilityActive(s, 'COMMAND') ? 1 : 0));
      if (s.sync > 0 && amount > 0) {
        const before = s.sync;
        s.sync = Math.max(0, s.sync - amount);
        ctx.emit('SYNC_CHANGED', { sync: s.sync, delta: s.sync - before, reason: 'DECAY' });
      }
      return;
    }
    case 'ASSIST':
      s.nextAssistAt = s.gameMs + ms(c.assistIntervalSeconds);
      assistTurn(ctx);
      return;
    case 'TIMEOUT':
      endRaid(ctx, s.bossId !== null && liveEnemies(s).some((e) => e.id === s.bossId) ? 'TIMEOUT' : 'BOSS_DEFEATED');
      return;
  }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function enemyConfig(c: GameConfig, kind: EnemyKind): EnemyConfig {
  switch (kind) {
    case 'SCOUT':
      return c.scout;
    case 'SIEGE':
      return c.siege;
    case 'SABOTEUR':
      return c.saboteur;
    case 'BOSS':
      return { ...c.boss, hp: c.bossBaseHp };
  }
}

function currentScale(s: RaidState): number {
  return difficultyScale(s.config, activePilotIds(s).length);
}

function spawnEnemy(ctx: Ctx, kind: EnemyKind): void {
  const s = ctx.state;
  const cfg = enemyConfig(s.config, kind);
  const hp = Math.max(1, Math.round(cfg.hp * currentScale(s)));
  const enemy: Enemy = {
    id: s.nextId++,
    kind,
    hp,
    hpMax: hp,
    ai: 'IDLE',
    // First move soon after entering (the boss poses first).
    aiUntil: s.gameMs + (kind === 'BOSS' ? 4000 : 1500),
    weaken: 0,
    lastTargets: [],
    partHits: { CORE: 0, ARM: 0, LEG: 0 },
    attacks: 0,
    training: s.phase === 'INTRO_TRAINING',
  };
  s.enemies.push(enemy);
  if (kind === 'BOSS') s.bossId = enemy.id;
  ctx.emit('ENEMY_SPAWNED', { enemy: structuredClone(enemy) });
}

function pickTargets(ctx: Ctx, e: Enemy, count: number): RegionId[] {
  const s = ctx.state;
  if (e.training) return ['kanto'];
  const standing = standingCities(s.cities);
  const out: RegionId[] = [];
  for (let k = 0; k < count && standing.length > out.length; k++) {
    // Avoid the same city three times in a row; prefer hurt cities a little.
    let pool = standing.filter((id) => !out.includes(id));
    const recent = e.lastTargets.slice(-2);
    if (recent.length === 2 && recent[0] === recent[1]) {
      const alt = pool.filter((id) => id !== recent[0]);
      if (alt.length) pool = alt;
    }
    const w = pool.map((id) => 1 + (1.5 * (s.config.cityMaxHp - s.cities[id].hp)) / s.config.cityMaxHp);
    let r = ctx.rand() * w.reduce((a, b) => a + b, 0);
    let pick = pool[pool.length - 1]!;
    for (let i = 0; i < pool.length; i++) {
      r -= w[i]!;
      if (r <= 0) {
        pick = pool[i]!;
        break;
      }
    }
    out.push(pick);
  }
  return out;
}

/** Aim the next attack. Returns false when there is no city left to target. */
function telegraphFor(ctx: Ctx, e: Enemy): boolean {
  const s = ctx.state;
  const c = s.config;
  const cfg = enemyConfig(c, e.kind);
  let kind: AttackKind;
  let damage = cfg.damage;
  let count = 1;
  switch (e.kind) {
    case 'SCOUT':
      kind = 'BEAM';
      break;
    case 'SIEGE':
      kind = 'BOMBARD';
      break;
    case 'SABOTEUR':
      kind = 'JAM';
      break;
    case 'BOSS': {
      const sweep = e.hp <= e.hpMax * c.boss.sweepBelowHpRatio && e.attacks % 2 === 1;
      kind = sweep ? 'SWEEP' : 'CORE_BEAM';
      if (sweep) {
        damage = c.boss.sweepDamage;
        count = 3;
      }
      break;
    }
  }
  if (e.training) damage = Math.round(damage * c.trainingDamageRatio);
  // Radar and jammer buy reaction time while their cities stand.
  const bonus = (facilityActive(s, 'RADAR') ? 1000 : 0) + (facilityActive(s, 'JAMMER') ? 1000 : 0);
  const duration = ctx.between(cfg.telegraphMs as [number, number]) + bonus;
  const targets = pickTargets(ctx, e, count);
  if (!targets.length) return false;
  const tg: Telegraph = {
    id: s.nextId++,
    enemyId: e.id,
    kind,
    targets,
    direction: randomDirection(ctx.rand),
    startsAt: s.gameMs,
    resolvesAt: s.gameMs + duration,
    damage,
    delayed: false,
  };
  e.lastTargets = [...e.lastTargets, ...targets].slice(-4);
  e.ai = 'TELEGRAPH';
  e.aiUntil = tg.resolvesAt;
  s.telegraphs.push(tg);
  ctx.emit('ENEMY_TELEGRAPH', { telegraph: structuredClone(tg), enemyKind: e.kind });
  return true;
}

function stepEnemy(ctx: Ctx, enemyId: number): void {
  const s = ctx.state;
  const e = s.enemies.find((x) => x.id === enemyId);
  if (!e) return;
  if (e.ai === 'TELEGRAPH') {
    const tg = s.telegraphs.find((x) => x.enemyId === e.id);
    if (tg) resolveAttack(ctx, e, tg);
    if (s.status !== 'LIVE') return;
    e.ai = 'RECOVERY';
    e.aiUntil = s.gameMs + ctx.between(enemyConfig(s.config, e.kind).recoveryMs as [number, number]);
    return;
  }
  // IDLE or RECOVERY over: aim the next attack.
  if (!telegraphFor(ctx, e)) e.aiUntil = s.gameMs + 2000;
}

function hitCity(ctx: Ctx, cityId: RegionId, raw: number): CityHit {
  const s = ctx.state;
  const city = s.cities[cityId];
  if (city.destroyed) return { cityId, damage: 0, absorbed: 0, hpAfter: 0, destroyed: true };
  const absorbed = Math.min(city.shield, raw);
  city.shield -= absorbed;
  const damage = raw - absorbed;
  city.hp = Math.max(0, city.hp - damage);
  s.stats.shieldAbsorbed += absorbed;
  s.stats.cityDamageTaken += damage;
  const destroyed = city.hp === 0;
  return { cityId, damage, absorbed, hpAfter: city.hp, destroyed };
}

function applyCityHits(ctx: Ctx, hits: CityHit[]): void {
  const s = ctx.state;
  for (const h of hits) {
    const city = s.cities[h.cityId];
    if (h.destroyed && !city.destroyed && city.hp === 0) {
      city.destroyed = true;
      city.shield = 0;
      ctx.emit('CITY_DESTROYED', { cityId: h.cityId });
    }
  }
  if (standingCities(s.cities).length < s.config.minimumSurvivingCities) endRaid(ctx, 'CITIES_LOST');
}

function damageRobot(s: RaidState, robot: RobotId, amount: number): void {
  const r = s.robots[robot];
  r.health = Math.max(0, r.health - amount);
  r.componentDamaged = r.health < 50;
}

function resolveAttack(ctx: Ctx, e: Enemy, tg: Telegraph): void {
  const s = ctx.state;
  const c = s.config;
  s.telegraphs = s.telegraphs.filter((x) => x.id !== tg.id);
  e.attacks += 1;
  const raw = Math.round(tg.damage * (1 - e.weaken));
  const hits = tg.targets.map((id) => hitCity(ctx, id, raw));
  let jammedUntil: number | null = null;
  let energyDrained = 0;
  let robotHit: RobotId | null = null;
  if (tg.kind === 'JAM') {
    jammedUntil = s.gameMs + ms(c.saboteur.jamSeconds);
    s.jammedUntil = jammedUntil;
    energyDrained = Math.min(s.reserveEnergy, c.saboteur.energyDrain);
    s.reserveEnergy -= energyDrained;
  }
  // Heavy attacks wear the robots: Fujin takes bombardments and sweeps on its
  // barrier, Raijin stands in front of the core beam.
  if (tg.kind === 'BOMBARD' || tg.kind === 'SWEEP') robotHit = 'FUJIN';
  if (tg.kind === 'CORE_BEAM') robotHit = 'RAIJIN';
  if (robotHit) damageRobot(s, robotHit, tg.kind === 'CORE_BEAM' ? 15 : 12);
  ctx.emit('ATTACK_RESOLVED', { telegraphId: tg.id, enemyId: e.id, enemyKind: e.kind, kind: tg.kind, hits, jammedUntil, energyDrained, robotHit });
  applyCityHits(ctx, hits);
}

function defeatEnemy(ctx: Ctx, e: Enemy, pilotId: string | null, callsign: string | null): void {
  const s = ctx.state;
  s.enemies = s.enemies.filter((x) => x.id !== e.id);
  s.telegraphs = s.telegraphs.filter((x) => x.enemyId !== e.id);
  s.stats.enemiesDefeated += 1;
  ctx.emit('ENEMY_DEFEATED', { enemyId: e.id, kind: e.kind, pilotId, callsign });
  if (e.id === s.bossId) endRaid(ctx, 'BOSS_DEFEATED');
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function openLobby(ctx: Ctx): CommandOutcome {
  const s = ctx.state;
  if (s.status !== 'CREATED') return { kind: 'rejected', reason: `cannot open lobby from ${s.status}` };
  ctx.setStatus('LOBBY_OPEN', 'LOBBY');
  return { kind: 'none' };
}

function start(ctx: Ctx): CommandOutcome {
  const s = ctx.state;
  if (s.status !== 'CREATED' && s.status !== 'LOBBY_OPEN') return { kind: 'rejected', reason: `cannot start from ${s.status}` };
  s.liveStartClock = s.clockMs;
  s.gameMs = 0;
  // Lobby pilots count as active at the start (difficulty of the first spawns).
  for (const p of Object.values(s.pilots)) p.lastActiveAt = 0;
  ctx.setStatus('LIVE', 'RAID_START');
  ctx.setPhase('INTRO_TRAINING');
  return { kind: 'none' };
}

function pause(ctx: Ctx, reason: string): CommandOutcome {
  const s = ctx.state;
  if (s.status !== 'LIVE' && s.status !== 'LOBBY_OPEN') return { kind: 'rejected', reason: `cannot pause from ${s.status}` };
  s.pausedFrom = s.status;
  s.pauseReason = reason;
  ctx.setStatus('PAUSED', reason);
  return { kind: 'none' };
}

function resume(ctx: Ctx): CommandOutcome {
  const s = ctx.state;
  if (s.status !== 'PAUSED' || s.pausedFrom === null) return { kind: 'rejected', reason: `cannot resume from ${s.status}` };
  const to = s.pausedFrom;
  s.pausedFrom = null;
  s.pauseReason = null;
  // The game clock does not run while paused: re-anchor so gameMs continues.
  if (s.liveStartClock !== null) s.liveStartClock = s.clockMs - s.gameMs;
  ctx.setStatus(to, 'RESUMED');
  return { kind: 'none' };
}

function adminEnd(ctx: Ctx, reason: string): CommandOutcome {
  const s = ctx.state;
  if (s.status !== 'LIVE' && s.status !== 'PAUSED') return { kind: 'rejected', reason: `cannot end from ${s.status}` };
  s.pausedFrom = null;
  endRaid(ctx, 'ADMIN_END', reason);
  return { kind: 'none' };
}

function cancel(ctx: Ctx, reason: string): CommandOutcome {
  const s = ctx.state;
  if (s.status === 'ENDED' || s.status === 'CANCELLED') return { kind: 'rejected', reason: `cannot cancel from ${s.status}` };
  s.pausedFrom = null;
  s.result = buildResult(s, 'CANCELLED', 'CANCELLED');
  ctx.setStatus('CANCELLED', reason);
  ctx.emit('RAID_ENDED', { result: s.result });
  return { kind: 'none' };
}

function endRaid(ctx: Ctx, reason: RaidEndReason, statusReason?: string): void {
  const s = ctx.state;
  if (s.status === 'ENDED' || s.status === 'CANCELLED') return;
  const bossAlive = s.bossId !== null && s.enemies.some((e) => e.id === s.bossId);
  const won = reason === 'BOSS_DEFEATED' && !bossAlive && standingCities(s.cities).length >= s.config.minimumSurvivingCities;
  const outcome = won ? 'SUCCEEDED' : 'FAILED';
  s.stats.syncSum += s.sync;
  s.stats.syncSamples += 1;
  s.result = buildResult(s, outcome, reason);
  s.telegraphs = [];
  for (const p of Object.values(s.pilots)) p.task = null;
  ctx.setStatus('ENDED', statusReason ?? reason);
  ctx.setPhase(outcome);
  ctx.emit('RAID_ENDED', { result: s.result });
}

function buildResult(s: RaidState, outcome: RaidResult['outcome'], reason: RaidEndReason): RaidResult {
  const c = s.config;
  const standing = standingCities(s.cities);
  const cityHpTotal = REGION_IDS.reduce((a, id) => a + s.cities[id].hp, 0);
  const success = outcome === 'SUCCEEDED';
  const clearTimeMs = success ? s.gameMs : null;
  const syncAverage = s.stats.syncSamples ? s.stats.syncSum / s.stats.syncSamples : s.sync;
  const citySurvival = Math.round((400 * cityHpTotal) / (REGION_IDS.length * c.cityMaxHp));
  const window = ms(c.matchSeconds - c.phaseStartsSeconds.WAVE_3);
  const speed = success ? Math.round(Math.max(0, Math.min(200, (200 * (ms(c.matchSeconds) - s.gameMs)) / window))) : 0;
  const coordination = Math.round((200 * syncAverage) / c.sync.max);
  const bossDefeat = success ? 200 : 0;
  const pilots = Object.values(s.pilots);
  return {
    outcome,
    reason,
    endedAtGameMs: s.gameMs,
    clearTimeMs,
    survivingCities: standing.length,
    cityHpTotal,
    syncAverage: Math.round(syncAverage * 10) / 10,
    syncPeak: s.stats.syncPeak,
    special: s.special.status,
    score: { citySurvival, speed, coordination, bossDefeat, total: citySurvival + speed + coordination + bossDefeat },
    mvps: pickMvps(s),
    pilots: pilots.filter((p) => !p.isBot).length,
    bots: pilots.filter((p) => p.isBot).length,
    assisted: s.stats.assistActions > 0,
    configHash: s.configHash,
    stats: structuredClone(s.stats),
  };
}

/**
 * Role MVPs. Ranked by contribution per minute aboard (min 1 min) so a late
 * joiner is not buried by people who had more time; bots only when no human
 * contributed.
 */
function pickMvps(s: RaidState): RaidResult['mvps'] {
  const pilots = Object.values(s.pilots);
  const humans = pilots.filter((p) => !p.isBot);
  const pick = (value: (p: Pilot) => number): MvpEntry | undefined => {
    for (const pool of [humans, pilots]) {
      const ranked = pool
        .filter((p) => value(p) > 0)
        .map((p) => ({ p, rate: value(p) / Math.max(1, (s.gameMs - Math.max(0, p.joinedAt)) / 60_000) }))
        .sort((a, z) => z.rate - a.rate || z.p.stats.successSum - a.p.stats.successSum || a.p.pilotId.localeCompare(z.p.pilotId));
      if (ranked[0]) return { pilotId: ranked[0].p.pilotId, callsign: ranked[0].p.callsign, value: Math.round(value(ranked[0].p)) };
    }
    return undefined;
  };
  const out: RaidResult['mvps'] = {};
  const set = (k: Role | 'SYNC', v: MvpEntry | undefined) => {
    if (v) out[k] = v;
  };
  set('GUNNER', pick((p) => p.stats.damage));
  set('GUARDIAN', pick((p) => p.stats.shielded));
  set('ROUTER', pick((p) => p.stats.energy));
  set('ENGINEER', pick((p) => p.stats.repairs));
  set('SYNC', pick((p) => p.stats.syncPoints));
  return out;
}

// ---------------------------------------------------------------------------
// Pilots
// ---------------------------------------------------------------------------

function robotFor(s: RaidState, role: Role, wanted?: RobotId): RobotId {
  const fixed = ROBOT_FOR_ROLE[role];
  if (fixed) return fixed;
  if (wanted) return wanted;
  // Support seats go to the robot with fewer support pilots.
  const support = (r: RobotId) => Object.values(s.pilots).filter((p) => p.robot === r && (p.role === 'ROUTER' || p.role === 'ENGINEER')).length;
  return support('FUJIN') < support('RAIJIN') ? 'FUJIN' : 'RAIJIN';
}

function board(ctx: Ctx, cmd: Extract<EngineCommand, { type: 'BOARD' }>): CommandOutcome {
  const s = ctx.state;
  const c = s.config;
  const existing = s.pilots[cmd.pilotId];
  if (existing) return { kind: 'board', code: 'ALREADY_BOARDED', pilot: existing };
  const open = s.status === 'LOBBY_OPEN' || s.status === 'CREATED' || ((s.status === 'LIVE' || s.status === 'PAUSED') && s.liveStartClock !== null);
  if (!open) return { kind: 'board', code: 'NOT_OPEN', pilot: null };
  if (s.liveStartClock !== null && s.gameMs > ms(c.cutoffForPaidJoinAtSeconds)) return { kind: 'board', code: 'JOIN_CLOSED', pilot: null };
  if (Object.keys(s.pilots).length >= c.maxPilots) return { kind: 'board', code: 'RAID_FULL', pilot: null };
  const robot = robotFor(s, cmd.role, cmd.robot);
  const pilot: Pilot = {
    pilotId: cmd.pilotId,
    callsign: cmd.callsign,
    role: cmd.role,
    robot,
    isBot: !!cmd.isBot,
    joinedAt: s.gameMs,
    lastActiveAt: s.gameMs,
    lastSuccessAt: {},
    roleChangedAt: -Infinity,
    cooldownUntil: s.gameMs,
    task: null,
    stats: { tasks: 0, successes: 0, successSum: 0, expired: 0, damage: 0, shielded: 0, energy: 0, repairs: 0, syncPoints: 0 },
  };
  s.pilots[cmd.pilotId] = pilot;
  s.stats.peakPilots = Math.max(s.stats.peakPilots, activePilotIds(s).length);
  ctx.emit('PILOT_BOARDED', { pilotId: pilot.pilotId, callsign: pilot.callsign, role: pilot.role, robot, isBot: pilot.isBot }, true);
  return { kind: 'board', code: 'OK', pilot };
}

function changeRole(ctx: Ctx, cmd: Extract<EngineCommand, { type: 'CHANGE_ROLE' }>): CommandOutcome {
  const s = ctx.state;
  const p = s.pilots[cmd.pilotId];
  if (!p) return { kind: 'role', code: 'NOT_BOARDED', pilot: null };
  if (s.status === 'ENDED' || s.status === 'CANCELLED') return { kind: 'role', code: 'NOT_OPEN', pilot: p };
  const inCombat = s.liveStartClock !== null;
  if (inCombat && s.gameMs - p.roleChangedAt < ms(s.config.roleChangeCooldownSeconds)) return { kind: 'role', code: 'ROLE_COOLDOWN', pilot: p };
  if (p.role === cmd.role && (!cmd.robot || cmd.robot === p.robot)) return { kind: 'role', code: 'OK', pilot: p };
  const from = p.role;
  p.role = cmd.role;
  p.robot = robotFor(s, cmd.role, cmd.robot);
  p.task = null;
  if (inCombat) p.roleChangedAt = s.gameMs;
  p.lastActiveAt = s.gameMs;
  ctx.emit('PILOT_ROLE_CHANGED', { pilotId: p.pilotId, callsign: p.callsign, role: p.role, robot: p.robot, isBot: p.isBot, from }, true);
  return { kind: 'role', code: 'OK', pilot: p };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function liveCheck(s: RaidState): TaskErrorCode | null {
  if (s.status === 'PAUSED') return 'PAUSED';
  if (s.status !== 'LIVE') return 'NOT_LIVE';
  return null;
}

function resolveTarget(s: RaidState, role: Role, choice: TaskChoice): TaskTarget | null {
  switch (role) {
    case 'GUNNER': {
      const enemies = liveEnemies(s);
      const chosen = choice.enemyId !== undefined ? enemies.find((e) => e.id === choice.enemyId) : undefined;
      const rec = recommendGunnerTarget(s);
      const enemyId = chosen?.id ?? rec?.enemyId;
      if (enemyId === undefined) return null;
      return { kind: 'ENEMY', enemyId, weakpoint: choice.weakpoint ?? (chosen ? 'CORE' : rec!.weakpoint) };
    }
    case 'GUARDIAN': {
      const tg = choice.telegraphId !== undefined ? s.telegraphs.find((t) => t.id === choice.telegraphId) : undefined;
      if (tg) {
        const city = choice.cityId && tg.targets.includes(choice.cityId) ? choice.cityId : tg.targets[0]!;
        return { kind: 'TELEGRAPH', telegraphId: tg.id, cityId: city };
      }
      if (choice.cityId && !s.cities[choice.cityId].destroyed) {
        const onCity = s.telegraphs.find((t) => t.targets.includes(choice.cityId!));
        return onCity ? { kind: 'TELEGRAPH', telegraphId: onCity.id, cityId: choice.cityId } : { kind: 'CITY_STANDBY', cityId: choice.cityId };
      }
      const rec = recommendGuardianTarget(s);
      return 'telegraphId' in rec ? { kind: 'TELEGRAPH', telegraphId: rec.telegraphId, cityId: rec.cityId } : { kind: 'CITY_STANDBY', cityId: rec.cityId };
    }
    case 'ROUTER':
      return { kind: 'ENERGY', sink: choice.sink ?? recommendSink(s) };
    case 'ENGINEER':
      return { kind: 'REPAIR', repair: choice.repair ?? recommendRepair(s) };
  }
}

function makeParams(ctx: Ctx, role: Role, target: TaskTarget, difficulty: TaskDifficulty) {
  const s = ctx.state;
  switch (role) {
    case 'GUNNER':
      return gunnerParams(ctx.rand, difficulty, facilityActive(s, 'SENSOR') ? 1.25 : 1);
    case 'GUARDIAN': {
      const tg = target.kind === 'TELEGRAPH' ? s.telegraphs.find((t) => t.id === target.telegraphId) : undefined;
      return guardianParams(ctx.rand, difficulty, tg?.direction ?? randomDirection(ctx.rand));
    }
    case 'ROUTER':
      return routerParams(ctx.rand, difficulty, target.kind === 'ENERGY' ? target.sink : 'RESERVE', s.jammedUntil > s.gameMs);
    case 'ENGINEER':
      return engineerParams(ctx.rand, difficulty);
  }
}

function requestTask(ctx: Ctx, pilotId: string, choice: TaskChoice): CommandOutcome {
  const s = ctx.state;
  const p = s.pilots[pilotId];
  const fail = (code: TaskErrorCode, task: Task | null = null): CommandOutcome => ({ kind: 'task', code, task, cooldownUntil: p?.cooldownUntil ?? 0 });
  if (!p) return fail('NOT_BOARDED');
  // Asking for a mission is presence even when there is nothing to do.
  p.lastActiveAt = s.gameMs;
  const live = liveCheck(s);
  if (live) return fail(live);
  if (p.task && p.task.deadline >= s.gameMs) return fail('TASK_OPEN', p.task);
  if (p.task) {
    // Ran out of time without submitting.
    p.stats.expired += 1;
    p.task = null;
  }
  if (s.gameMs < p.cooldownUntil) return fail('COOLDOWN');
  const target = resolveTarget(s, p.role, choice);
  if (!target) return fail('NO_TARGET');
  const difficulty = choice.difficulty ?? 'NORMAL';
  const c = s.config;
  const task: Task = {
    taskId: `${s.raidId}-t${s.nextId++}`,
    role: p.role,
    robot: p.robot,
    target,
    params: makeParams(ctx, p.role, target, difficulty),
    difficulty,
    createdAt: s.gameMs,
    deadline: s.gameMs + ms(c.miniGameDurationSeconds + c.inputGraceSeconds),
  };
  p.task = task;
  p.lastActiveAt = s.gameMs;
  return { kind: 'task', code: 'OK', task, cooldownUntil: p.cooldownUntil };
}

function submitTask(ctx: Ctx, pilotId: string, taskId: string, input: TaskInput): TaskResult {
  const s = ctx.state;
  const c = s.config;
  const p = s.pilots[pilotId];
  const result = (code: 'OK' | TaskErrorCode, extra: Partial<TaskResult> = {}): TaskResult => ({
    ok: code === 'OK',
    code,
    taskId,
    role: p?.role ?? null,
    success: 0,
    effect: null,
    syncGain: 0,
    cooldownUntil: p?.cooldownUntil ?? 0,
    atGameMs: s.gameMs,
    ...extra,
  });
  if (!p) return result('NOT_BOARDED');
  const live = liveCheck(s);
  if (live) return result(live);
  const task = p.task;
  if (!task) return result('NO_TASK');
  if (task.taskId !== taskId) return result('TASK_MISMATCH');
  p.lastActiveAt = s.gameMs;
  if (s.gameMs > task.deadline) {
    p.task = null;
    p.stats.expired += 1;
    return result('EXPIRED');
  }
  const ev = evaluateTask(task.params, input, s.gameMs - task.createdAt, ms(c.miniGameDurationSeconds));
  // Malformed input still closes the task (no free retries by probing).
  p.task = null;
  p.stats.tasks += 1;
  s.stats.tasks += 1;
  p.cooldownUntil = s.gameMs + ms(c.normalActionCooldownSeconds);
  if (!ev.valid) return result('INVALID_INPUT', { cooldownUntil: p.cooldownUntil });
  const success = ev.success;
  const target: TaskTarget = task.role === 'ROUTER' && ev.sink ? { kind: 'ENERGY', sink: ev.sink } : task.target;
  const { effect, syncGain } = applyAction(ctx, p, task.role, task.robot, target, success);
  return result('OK', { success, effect, syncGain, cooldownUntil: p.cooldownUntil });
}

/** Shared by pilots and the assist AI. */
function applyAction(
  ctx: Ctx,
  actor: Pilot | null,
  role: Role,
  robot: RobotId,
  target: TaskTarget,
  success: number,
): { effect: TaskEffect | null; syncGain: number } {
  const s = ctx.state;
  const c = s.config;
  const actorId = actor?.pilotId ?? ASSIST_PILOT_ID;
  const callsign = actor?.callsign ?? ASSIST_CALLSIGN;
  const scale = actor ? roleScale(s, role, success > 0 ? actorId : undefined) : 1;
  let effect: TaskEffect | null = null;

  if (success > 0) {
    if (actor) {
      actor.stats.successes += 1;
      actor.stats.successSum += success;
      actor.lastSuccessAt[role] = s.gameMs;
    }
    s.stats.successes += 1;
    switch (role) {
      case 'GUNNER': {
        if (target.kind !== 'ENEMY') break;
        const enemies = liveEnemies(s);
        // The target may have died meanwhile: the shot goes to the recommended one.
        let e = enemies.find((x) => x.id === target.enemyId);
        let weakpoint = target.weakpoint;
        if (!e) {
          const rec = recommendGunnerTarget(s);
          e = rec ? enemies.find((x) => x.id === rec.enemyId) : undefined;
          weakpoint = rec?.weakpoint ?? 'CORE';
        }
        if (!e) break;
        const raijin = s.robots.RAIJIN;
        const armor = e.kind === 'BOSS' && s.phase === 'FINAL_WAVE' && s.special.status !== 'ACTIVATED' ? c.boss.finalArmorFactor : 1;
        const amount = Math.max(1, Math.round(c.gunner.damage[weakpoint] * success * scale * robotPower(c, raijin) * armor));
        raijin.energy = Math.max(0, raijin.energy - c.gunner.energyPerHit);
        e.hp = Math.max(0, e.hp - amount);
        e.partHits[weakpoint] += 1;
        let note: 'WEAKEN' | 'DELAY' | null = null;
        if (weakpoint === 'ARM') {
          e.weaken = Math.min(c.gunner.armWeakenMax, e.weaken + c.gunner.armWeaken * success);
          note = 'WEAKEN';
        }
        if (weakpoint === 'LEG') {
          const tg = s.telegraphs.find((t) => t.enemyId === e!.id);
          if (tg && !tg.delayed) {
            tg.delayed = true;
            tg.resolvesAt += ms(c.gunner.legDelaySeconds);
            e.aiUntil = tg.resolvesAt;
            note = 'DELAY';
          }
        }
        if (actor) actor.stats.damage += amount;
        effect = { kind: 'DAMAGE', enemyId: e.id, enemyKind: e.kind, weakpoint, amount, defeated: e.hp === 0, note };
        break;
      }
      case 'GUARDIAN': {
        const cityId = target.kind === 'TELEGRAPH' || target.kind === 'CITY_STANDBY' ? target.cityId : null;
        if (!cityId) break;
        const city = s.cities[cityId];
        if (city.destroyed) break;
        const fujin = s.robots.FUJIN;
        const standby = target.kind === 'CITY_STANDBY' ? c.guardian.standbyRatio : 1;
        const bastion = facilityActive(s, 'BASTION') ? 1.2 : 1;
        const amount = Math.max(1, Math.round(c.guardian.shield * success * scale * robotPower(c, fujin) * standby * bastion));
        const added = Math.min(c.cityShieldMax - city.shield, amount);
        city.shield += added;
        fujin.energy = Math.max(0, fujin.energy - 8);
        if (actor) actor.stats.shielded += added;
        effect = { kind: 'SHIELD', cityId, amount: added };
        break;
      }
      case 'ROUTER': {
        if (target.kind !== 'ENERGY') break;
        const jam = s.jammedUntil > s.gameMs ? 0.5 : 1;
        const hub = facilityActive(s, 'HUB') ? 1.2 : 1;
        const plant = target.sink === 'RESERVE' && facilityActive(s, 'RESERVE_PLANT') ? 1.2 : 1;
        const amount = Math.max(1, Math.round(c.router.energy * success * scale * jam * hub * plant));
        let added: number;
        if (target.sink === 'RESERVE') {
          added = Math.min(100 - s.reserveEnergy, amount);
          s.reserveEnergy += added;
        } else {
          const r = s.robots[target.sink];
          added = Math.min(100 - r.energy, amount);
          r.energy += added;
        }
        s.stats.energyRouted += added;
        if (actor) actor.stats.energy += added;
        effect = { kind: 'ENERGY', sink: target.sink, amount: added };
        break;
      }
      case 'ENGINEER': {
        if (target.kind !== 'REPAIR') break;
        const dock = facilityActive(s, 'DOCK') ? 1.25 : 1;
        const rep = target.repair;
        let amount = 0;
        if (rep.type === 'UNJAM') {
          if (success >= 0.5 && s.jammedUntil > s.gameMs) {
            s.jammedUntil = s.gameMs;
            amount = 1;
          }
        } else if (rep.type === 'ROBOT') {
          const r = s.robots[rep.robot];
          const before = r.health;
          r.health = Math.min(100, r.health + Math.round(c.engineer.repairRobot * success * scale * dock));
          r.componentDamaged = r.health < 50;
          amount = r.health - before;
        } else {
          const city = s.cities[rep.cityId];
          if (city.destroyed) {
            if (success >= 0.75 && city.rebuildReadyAt <= s.gameMs) {
              city.destroyed = false;
              city.hp = c.cityRebuildHp;
              city.rebuildReadyAt = s.gameMs + ms(c.cityRebuildCooldownSeconds);
              amount = c.cityRebuildHp;
              ctx.emit('CITY_REBUILT', { cityId: rep.cityId, pilotId: actorId, callsign });
            }
          } else {
            const before = city.hp;
            city.hp = Math.min(c.cityMaxHp, city.hp + Math.round(c.engineer.repairCity * success * scale * dock));
            amount = city.hp - before;
          }
        }
        s.stats.repairs += amount > 0 ? 1 : 0;
        if (actor) actor.stats.repairs += amount;
        effect = { kind: 'REPAIR', repair: rep, amount };
        break;
      }
    }
  }

  const syncGain = success >= 0.5 ? syncContribution(s, actorId, role) : 0;
  if (actor) actor.stats.syncPoints += syncGain;
  ctx.emit('TASK_RESOLVED', { pilotId: actorId, callsign, role, robot, success, effect, syncGain, assist: !actor });
  if (syncGain > 0) ctx.emit('SYNC_CHANGED', { sync: s.sync, delta: syncGain, reason: 'COOP' });
  if (success >= 0.5) specialContribution(ctx, actorId, callsign, role);
  // Order matters: the boss may fall to this hit (win) after SYNC/special bookkeeping.
  if (effect?.kind === 'DAMAGE' && effect.defeated) {
    const e = s.enemies.find((x) => x.id === effect!.enemyId);
    if (e) defeatEnemy(ctx, e, actor ? actorId : null, callsign);
  }
  s.stats.peakPilots = Math.max(s.stats.peakPilots, activePilotIds(s).length);
  return { effect, syncGain };
}

// ---------------------------------------------------------------------------
// SYNC RATE
// ---------------------------------------------------------------------------

/**
 * Different seats succeeding within the same 20-second window raise SYNC.
 * One pilot counts for one seat per window (hopping seats does not fake a team).
 */
function syncContribution(s: RaidState, pilotId: string, role: Role): number {
  const c = s.config;
  const index = Math.floor(s.gameMs / ms(c.sync.windowSeconds));
  if (s.syncWindow.index !== index) s.syncWindow = { index, roles: {}, pilots: [] };
  const w = s.syncWindow;
  if (w.roles[role] || w.pilots.includes(pilotId)) return 0;
  w.roles[role] = pilotId;
  w.pilots.push(pilotId);
  const n = Object.keys(w.roles).length;
  const gain = n === 2 ? c.sync.gainTwoRoles : n === 3 ? c.sync.gainThreeRoles : n === 4 ? c.sync.gainFourRoles : 0;
  const before = s.sync;
  s.sync = Math.min(c.sync.max, s.sync + gain);
  s.stats.syncPeak = Math.max(s.stats.syncPeak, s.sync);
  return s.sync - before;
}

// ---------------------------------------------------------------------------
// 神雷風陣 SHINRAI FUJIN
// ---------------------------------------------------------------------------

const SPECIAL_ROLES: Role[] = ['GUNNER', 'GUARDIAN', 'ROUTER'];

function specialContribution(ctx: Ctx, pilotId: string, callsign: string, role: Role): void {
  const s = ctx.state;
  const sp = s.special;
  if (sp.status !== 'OPEN' || !SPECIAL_ROLES.includes(role)) return;
  if (!sp.contributors[role] && !Object.values(sp.contributors).includes(pilotId)) {
    sp.contributors[role] = pilotId;
    ctx.emit('SPECIAL_PROGRESS', { role, pilotId, callsign });
  }
  tryActivateSpecial(ctx);
}

function tryActivateSpecial(ctx: Ctx): void {
  const s = ctx.state;
  const c = s.config.special;
  const sp = s.special;
  if (sp.status !== 'OPEN' || s.status !== 'LIVE') return;
  const filled = SPECIAL_ROLES.filter((r) => sp.contributors[r]).length;
  const distinct = new Set(Object.values(sp.contributors)).size;
  if (filled < SPECIAL_ROLES.length || distinct < Math.min(c.requiredDistinctPilots, SPECIAL_ROLES.length)) return;
  if (s.sync < c.syncMinimum || s.reserveEnergy < c.energyMinimum) return;
  resolveSpecial(ctx, 'ACTIVATED');
}

function closeSpecial(ctx: Ctx): void {
  const s = ctx.state;
  if (s.special.status !== 'OPEN') return;
  tryActivateSpecial(ctx);
  if (s.special.status !== 'OPEN') return;
  const filled = SPECIAL_ROLES.filter((r) => s.special.contributors[r]).length;
  resolveSpecial(ctx, filled >= 2 || s.sync >= s.config.special.fallbackSyncMinimum ? 'FALLBACK' : 'FAILED');
}

function resolveSpecial(ctx: Ctx, outcome: 'ACTIVATED' | 'FALLBACK' | 'FAILED'): void {
  const s = ctx.state;
  const c = s.config.special;
  const sp = s.special;
  sp.status = outcome;
  sp.resolvedAt = s.gameMs;
  const boss = s.enemies.find((e) => e.id === s.bossId);
  // Special damage scales with the boss (sized for the crowd at its arrival).
  const bossScale = boss ? boss.hpMax / s.config.bossBaseHp : 1;
  let damage = 0;
  let cityHits: CityHit[] = [];
  if (outcome === 'ACTIVATED') {
    damage = Math.round(c.damage * bossScale);
    const before = s.sync;
    s.sync = Math.max(0, s.sync - 30);
    s.reserveEnergy = 0;
    if (before !== s.sync) ctx.emit('SYNC_CHANGED', { sync: s.sync, delta: s.sync - before, reason: 'SPECIAL' });
  } else if (outcome === 'FALLBACK') {
    damage = Math.round(c.fallbackDamage * bossScale);
  } else {
    // NULL BEAM: the boss punishes the missed chance on every city.
    cityHits = standingCities(s.cities).map((id) => hitCity(ctx, id, c.failBeamDamage));
  }
  if (boss && damage > 0) boss.hp = Math.max(0, boss.hp - damage);
  ctx.emit('SPECIAL_RESOLVED', { outcome, damage, cityHits, contributors: Object.values(sp.contributors) as string[] });
  if (cityHits.length) applyCityHits(ctx, cityHits);
  if (boss && boss.hp === 0 && s.status === 'LIVE') defeatEnemy(ctx, boss, null, null);
}

// ---------------------------------------------------------------------------
// Assist AI (few pilots)
// ---------------------------------------------------------------------------

/**
 * With fewer than `assistBelowPilots` active pilots an assist AI performs one
 * modest action per interval in the most neglected seat, so two people can
 * still reach the special. Every assist is counted and marks the result.
 */
function assistTurn(ctx: Ctx): void {
  const s = ctx.state;
  const c = s.config;
  if (s.status !== 'LIVE' || s.phase === 'INTRO_TRAINING') return;
  const humansActive = activePilotIds(s).length;
  if (humansActive >= c.assistBelowPilots) return;
  const lastSuccess = (role: Role) => Math.max(-1, ...Object.values(s.pilots).map((p) => p.lastSuccessAt[role] ?? -1));
  let roles: Role[] = [...ROLES].sort((a, z) => lastSuccess(a) - lastSuccess(z));
  if (s.special.status === 'OPEN') {
    const missing = SPECIAL_ROLES.filter((r) => !s.special.contributors[r]);
    if (missing.length) roles = missing;
  }
  for (const role of roles) {
    const target = resolveTarget(s, role, {});
    if (!target) continue;
    s.stats.assistActions += 1;
    applyAction(ctx, null, role, ROBOT_FOR_ROLE[role] ?? 'RAIJIN', target, c.assistSuccess);
    return;
  }
}
