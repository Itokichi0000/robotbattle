import {
  bearingToDirection,
  CITY_IDS,
  configHash,
  ENGINEER_COVERAGE,
  isCombatPhase,
  isSeatOpen,
  MECH_PART_IDS,
  POWER_LANES,
  PRESETS,
  ROLE_IDS,
  ROLES,
  roleOf,
  SEAT_IDS,
  SHIELD_COVERAGE,
  shieldSeatFor,
} from '@swed/shared';
import type {
  ActionResult,
  CityId,
  DefeatReason,
  Direction,
  EnemyKind,
  EnemyState,
  EngineerSeatId,
  GameConfig,
  GunnerSeatId,
  MatchEvent,
  MatchEventBody,
  MatchResult,
  MatchState,
  MechPartId,
  Phase,
  PilotActionInput,
  PowerDistribution,
  PowerLane,
  PresetId,
  ReasonCode,
  RoleId,
  SeatId,
  SeatRequestResult,
  SeatState,
  ShieldSeatId,
  SpawnSpec,
  ThreatState,
  ThreatTarget,
} from '@swed/shared';
import { recommendTarget } from './hints';
import { enemyBearingAt, sectorMargin } from './orbit';
import { nextRandom, randomBetween, randomPick, weightedPick } from './rng';
import { generatePuzzle, routeConnects } from './router';

/**
 * The SATS WARS rules, as pure functions: reduce(state, command) and advanceTo(state, t).
 * The server is the only caller that owns a live match; tests and tools replay commands.
 * Time is the pause-corrected match clock in ms. Timers run on a fixed 50 ms grid aligned
 * to absolute time, so the same command log always yields the same state.
 */

export const STEP_MS = 50;
const ACTION_LOG_LIMIT = 512;

export type EngineCommand =
  | { type: 'ATTRACT'; t: number }
  | { type: 'OPEN_LOBBY'; t: number }
  | { type: 'START'; t: number }
  | { type: 'SKIP_DEPLOY'; t: number }
  | { type: 'PAUSE'; t: number }
  | { type: 'RESUME'; t: number }
  | { type: 'END'; t: number }
  | { type: 'SET_AUTO_SUPPORT'; t: number; enabled: boolean }
  | {
      type: 'SEAT_JOIN';
      t: number;
      seatId: SeatId;
      pilotId: string;
      displayName: string;
      /** Operator demo bot: shown as such; a human joining the seat replaces it. */
      bot?: boolean;
    }
  | { type: 'SEAT_LEAVE'; t: number; pilotId: string }
  | { type: 'SEAT_KICK'; t: number; seatId: SeatId }
  /** Staff hide or restore a callsign: changes the public name only. */
  | { type: 'SEAT_RENAME'; t: number; seatId: SeatId; displayName: string }
  | { type: 'SEAT_READY'; t: number; pilotId: string }
  | { type: 'SEAT_CONNECTION'; t: number; pilotId: string; connected: boolean }
  | {
      type: 'PILOT_ACTION';
      t: number;
      pilotId: string;
      seatId: SeatId;
      clientActionId: string;
      action: PilotActionInput;
    }
  /** A settled Lightning (or VIRTUAL sandbox) energy pulse. Applied once per intent id. */
  | { type: 'SATS_PULSE'; t: number; intentId: string; seatId: SeatId | null; virtual: boolean };

export type CommandOutcome =
  | { kind: 'none' }
  | { kind: 'control'; ok: boolean; reasonCode?: ReasonCode }
  | { kind: 'seat'; result: SeatRequestResult }
  | { kind: 'action'; result: ActionResult };

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
  presetId?: PresetId;
  config?: GameConfig;
  seed: number;
  autoSupport?: boolean;
  /** Start in ATTRACT (venue idle loop) instead of LOBBY. */
  attract?: boolean;
}

function emptyStats() {
  return {
    actions: 0,
    hits: 0,
    damage: 0,
    blocks: 0,
    perfect: 0,
    repairs: 0,
    combos: 0,
    routes: 0,
    syncs: 0,
  };
}

function emptySeat(seatId: SeatId): SeatState {
  return {
    seatId,
    pilotId: null,
    displayName: null,
    connected: false,
    ready: false,
    disconnectedAt: null,
    bot: false,
    stats: emptyStats(),
  };
}

function idleOverdrive(): MatchState['overdrive'] {
  return {
    status: 'IDLE',
    readyAt: 0,
    windowStartedAt: 0,
    windowEndsAt: 0,
    confirmed: [],
    autoRoles: [],
  };
}

export function createMatch(input: CreateMatchInput): MatchState {
  const presetId = input.presetId ?? input.config?.presetId ?? 'STANDARD';
  const config = structuredClone(input.config ?? PRESETS[presetId]);
  const seats = Object.fromEntries(SEAT_IDS.map((s) => [s, emptySeat(s)])) as Record<
    SeatId,
    SeatState
  >;
  const cities = Object.fromEntries(
    CITY_IDS.map((id) => [id, { id, hp: config.cities.hp, lost: false }]),
  ) as MatchState['cities'];
  const parts = Object.fromEntries(MECH_PART_IDS.map((p) => [p, 100])) as Record<
    MechPartId,
    number
  >;
  const e = config.energy.start;
  return {
    matchId: input.matchId,
    matchNumber: input.matchNumber ?? 1,
    presetId,
    config,
    configHash: configHash(config),
    seed: input.seed >>> 0,
    rng: input.seed >>> 0,
    t: 0,
    simT: 0,
    version: 1,
    eventSeq: 0,
    nextId: 1,
    phase: input.attract ? 'ATTRACT' : 'LOBBY',
    phaseStartedAt: 0,
    phaseEndsAt: null,
    paused: false,
    autoSupport: input.autoSupport ?? true,
    seats,
    coreHp: config.core.max,
    enemies: [],
    threats: [],
    cities,
    parts,
    distribution: { ...config.power.defaultDistribution },
    distributionVersion: 1,
    energy: { weapon: e, shield: e, mobility: e, repair: e },
    gunners: {
      GUNNER_L: {
        targetId: null,
        lockedAt: 0,
        readyAt: 0,
        chargedNotified: true,
        lastFiredAt: -1e9,
      },
      GUNNER_R: {
        targetId: null,
        lockedAt: 0,
        readyAt: 0,
        chargedNotified: true,
        lastFiredAt: -1e9,
      },
    },
    shields: {
      SHIELD_L: { dir: null, activeFrom: 0, activeUntil: 0, cooldownUntil: 0 },
      SHIELD_R: { dir: null, activeFrom: 0, activeUntil: 0, cooldownUntil: 0 },
    },
    teamSync: 0,
    teamCapacitor: 0,
    recentSuccesses: [],
    lastComboAt: 0,
    spawn: { scriptedDone: 0, nextSpawnAt: 0 },
    circuits: Object.fromEntries(
      POWER_LANES.map((l) => [l, { broken: false, brokenAt: 0, puzzle: null }]),
    ) as MatchState['circuits'],
    nextOverloadAt: null,
    powerSuccessAt: -1e9,
    engineers: {
      ENGINEER_LEGS: { job: null, cooldownUntil: 0 },
      ENGINEER_CORE: { job: null, cooldownUntil: 0 },
    },
    overdrive: idleOverdrive(),
    pulsesApplied: [],
    autoTimers: {
      gunner: { GUNNER_L: 0, GUNNER_R: 0 },
      engineer: 0,
      shield: { SHIELD_L: 0, SHIELD_R: 0 },
      power: 0,
    },
    crewAtLaunch: 0,
    stats: {
      enemiesDestroyed: 0,
      threatsBlocked: 0,
      perfectGuards: 0,
      threatsIntercepted: 0,
      threatsHit: 0,
      combos: 0,
      bestSync: 0,
      damageToBoss: 0,
      repairs: 0,
      routesFixed: 0,
      overloads: 0,
      overdrives: 0,
      overdriveFails: 0,
      pulses: 0,
    },
    result: null,
    actionLog: {},
    actionLogOrder: [],
  };
}

/* ------------------------------------------------------------------ context */

/** Mutable working copy for one reduce/advance call. */
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

export function humansAboard(s: MatchState): number {
  return SEAT_IDS.filter((id) => s.seats[id].pilotId !== null).length;
}

function isHuman(s: MatchState, seat: SeatId): boolean {
  return s.seats[seat].pilotId !== null;
}

function isAuto(s: MatchState, seat: SeatId): boolean {
  return s.autoSupport && !isHuman(s, seat);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function wear(s: MatchState, part: MechPartId, amount: number): void {
  s.parts[part] = Math.max(0, Math.round((s.parts[part] - amount) * 10) / 10);
}

/* ---------------------------------------------------------------- phases */

const NEXT_TIMED: Partial<Record<Phase, Phase>> = {
  COUNTDOWN: 'DEPLOYMENT',
  DEPLOYMENT: 'WAVE_1',
  WAVE_1: 'WAVE_2',
  WAVE_2: 'BOSS',
  VICTORY: 'RESULTS',
  DEFEAT: 'RESULTS',
};

function phaseDuration(c: GameConfig, p: Phase): number | null {
  switch (p) {
    case 'COUNTDOWN':
      return c.timings.countdownMs;
    case 'DEPLOYMENT':
      return c.timings.deploymentMs;
    case 'WAVE_1':
      return c.timings.wave1Ms;
    case 'WAVE_2':
      return c.timings.wave2Ms;
    case 'BOSS':
      return c.timings.bossMs;
    case 'VICTORY':
      return c.timings.victoryMs;
    case 'DEFEAT':
      return c.timings.defeatMs;
    case 'RESULTS':
      return c.timings.resultsMs;
    default:
      return null;
  }
}

function enterPhase(ctx: Ctx, to: Phase, at: number): void {
  const s = ctx.s;
  const from = s.phase;
  s.phase = to;
  s.phaseStartedAt = at;
  const d = phaseDuration(s.config, to);
  s.phaseEndsAt = d === null ? null : at + d;

  if (to === 'WAVE_1') {
    s.crewAtLaunch = humansAboard(s);
    s.autoTimers.gunner = { GUNNER_L: at + 2_000, GUNNER_R: at + 3_200 };
    s.autoTimers.engineer = at + s.config.auto.engineerEveryMs;
  }
  if (to === 'WAVE_1' || to === 'WAVE_2' || to === 'BOSS') {
    s.spawn = { scriptedDone: 0, nextSpawnAt: at + s.config.waves[to].spawnEveryMs };
    const first = s.config.router.firstAtMs[to];
    s.nextOverloadAt = first === null ? null : at + first;
    s.autoTimers.power = at + 4_000;
  }
  if (to === 'VICTORY' || to === 'DEFEAT') {
    s.threats = [];
    s.paused = false;
    s.overdrive = idleOverdrive();
    s.nextOverloadAt = null;
  }
  emit(ctx, at, { type: 'phase_changed', from, to, endsAt: s.phaseEndsAt });
}

function finish(
  ctx: Ctx,
  at: number,
  outcome: 'VICTORY' | 'DEFEAT',
  reason: MatchResult['reason'],
): void {
  const s = ctx.s;
  if (s.result) return;
  s.result = { outcome, reason, at };
  if (outcome === 'VICTORY') {
    // The swarm breaks when its core falls.
    for (const e of s.enemies) {
      emit(ctx, at, { type: 'enemy_destroyed', enemyId: e.id, kind: e.kind, bySeat: null });
    }
    s.enemies = [];
  }
  enterPhase(ctx, outcome, at);
  emit(ctx, at, { type: 'match_result', outcome, result: s.result });
}

function defeat(ctx: Ctx, at: number, reason: DefeatReason): void {
  finish(ctx, at, 'DEFEAT', reason);
}

/* --------------------------------------------------------------- spawning */

function enemyScale(s: MatchState): number {
  const crew = Math.max(1, s.crewAtLaunch);
  return Math.min(1, s.config.difficulty.hpBase + s.config.difficulty.hpPerPilot * crew);
}

/** Small crews face slower attack cadence so two pilots can still hold Japan (§5.7). */
function attackSlow(s: MatchState): number {
  const crew = Math.max(1, s.crewAtLaunch);
  return 1 + s.config.difficulty.slowPerMissing * Math.max(0, 8 - crew);
}

function aliveCities(s: MatchState): CityId[] {
  return CITY_IDS.filter((id) => !s.cities[id].lost);
}

function spawnEnemy(ctx: Ctx, at: number, spec: SpawnSpec, waveStart: number): EnemyState {
  const s = ctx.s;
  const def = s.config.enemies[spec.kind];
  const maxHp = Math.round(def.hp * enemyScale(s));
  const isBoss = spec.kind === 'NULL_CORE';
  const margin = sectorMargin(spec.bearing);
  const driftAmp = isBoss ? 3 : Math.min(randomBetween(s, 4, 12), Math.max(0, margin - 3));
  const arrivesAt = at + def.arriveMs;
  const firstAttack =
    spec.firstAttackAtMs !== undefined
      ? Math.max(arrivesAt, waveStart + spec.firstAttackAtMs)
      : arrivesAt + randomBetween(s, def.attackMinMs * 0.4, def.attackMaxMs * 0.7);
  const enemy: EnemyState = {
    id: newId(s, 'e'),
    kind: spec.kind,
    hp: maxHp,
    maxHp,
    orbit: {
      bearing0: spec.bearing,
      driftAmp,
      driftPeriodMs: Math.round(randomBetween(s, 14_000, 22_000)),
      phase: randomBetween(s, 0, Math.PI * 2),
      distance: randomBetween(s, def.distance[0], def.distance[1]),
      altitude: randomBetween(s, def.altitude[0], def.altitude[1]),
    },
    spawnedAt: at,
    arrivesAt,
    nextAttackAt: Math.round(firstAttack),
    nextTargetCity: spec.firstTargetCity ?? null,
    weakUntil: 0,
  };
  s.enemies.push(enemy);
  emit(ctx, at, { type: 'enemy_spawned', enemyId: enemy.id, kind: enemy.kind });
  return enemy;
}

function runSpawner(ctx: Ctx, now: number): void {
  const s = ctx.s;
  if (s.phase !== 'WAVE_1' && s.phase !== 'WAVE_2' && s.phase !== 'BOSS') return;
  const wave = s.config.waves[s.phase];
  const start = s.phaseStartedAt;
  while (s.spawn.scriptedDone < wave.scripted.length) {
    const next = wave.scripted[s.spawn.scriptedDone]!;
    if (start + next.atMs > now) break;
    spawnEnemy(ctx, now, next, start);
    s.spawn.scriptedDone += 1;
  }
  if (now >= s.spawn.nextSpawnAt) {
    s.spawn.nextSpawnAt = now + wave.spawnEveryMs;
    const alive = s.enemies.filter((e) => e.kind !== 'NULL_CORE').length;
    if (alive < wave.maxAlive) {
      const pick = weightedPick(s, wave.pool);
      const range = randomPick(s, wave.bearings);
      spawnEnemy(
        ctx,
        now,
        { kind: pick.kind, bearing: randomBetween(s, range[0], range[1]) },
        start,
      );
    }
  }
}

/* ---------------------------------------------------------------- threats */

const MECH_PARTS_BY_DIR: Record<Direction, MechPartId[]> = {
  FRONT: ['CORE', 'ARM_L', 'ARM_R'],
  LEFT: ['SHOULDER_L', 'ARM_L', 'LEG_L'],
  RIGHT: ['SHOULDER_R', 'ARM_R', 'LEG_R'],
  REAR: ['LEG_L', 'LEG_R'],
};

const THREAT_KIND: Record<EnemyKind, ThreatState['kind']> = {
  DRONE: 'BEAM',
  STRIKER: 'DIVE',
  NULL_CORE: 'CORE_LANCE',
};

function launchAttacks(ctx: Ctx, now: number): void {
  const s = ctx.s;
  if (!isCombatPhase(s.phase)) return;
  const wave = s.config.waves[s.phase as 'WAVE_1' | 'WAVE_2' | 'BOSS'];
  for (const e of s.enemies) {
    if (now < e.arrivesAt || now < e.nextAttackAt) continue;
    if (s.threats.some((th) => th.sourceId === e.id)) continue;
    const def = s.config.enemies[e.kind];
    const dir = bearingToDirection(enemyBearingAt(e.orbit, e.spawnedAt, now));
    let target: ThreatTarget;
    const cities = aliveCities(s);
    const scriptedCity =
      e.nextTargetCity && !s.cities[e.nextTargetCity].lost ? e.nextTargetCity : null;
    if (scriptedCity) {
      target = { type: 'CITY', cityId: scriptedCity };
    } else if (cities.length === 0 || nextRandom(s) < wave.mechTargetShare) {
      target = { type: 'MECH', part: randomPick(s, MECH_PARTS_BY_DIR[dir]) };
    } else {
      target = { type: 'CITY', cityId: randomPick(s, cities) };
    }
    e.nextTargetCity = null;
    const threat: ThreatState = {
      id: newId(s, 't'),
      sourceId: e.id,
      kind: THREAT_KIND[e.kind],
      dir,
      target,
      warnAt: now,
      impactAt: now + s.config.timings.threatWarnMs,
      damage: def.damage,
    };
    s.threats.push(threat);
    e.nextAttackAt =
      threat.impactAt +
      Math.round(randomBetween(s, def.attackMinMs, def.attackMaxMs) * attackSlow(s));
    emit(ctx, now, {
      type: 'threat_warning',
      threatId: threat.id,
      sourceId: e.id,
      kind: threat.kind,
      dir,
      target,
      impactAt: threat.impactAt,
    });
  }
}

function resolveImpacts(ctx: Ctx, now: number): void {
  const s = ctx.s;
  const due = s.threats
    .filter((th) => th.impactAt <= now)
    .sort((a, b) => a.impactAt - b.impactAt || (a.id < b.id ? -1 : 1));
  if (due.length === 0) return;
  s.threats = s.threats.filter((th) => th.impactAt > now);
  for (const th of due) {
    if (s.result) return;
    resolveThreat(ctx, th);
  }
}

function shoulderOf(seat: ShieldSeatId): MechPartId {
  return seat === 'SHIELD_L' ? 'SHOULDER_L' : 'SHOULDER_R';
}

function resolveThreat(ctx: Ctx, th: ThreatState): void {
  const s = ctx.s;
  const at = th.impactAt;
  const seat = shieldSeatFor(th.dir);
  const sh = s.shields[seat];
  let remaining = th.damage;
  if (sh.dir === th.dir && sh.activeFrom <= at && at <= sh.activeUntil) {
    const ratio = clamp(0.5 + 0.5 * (s.parts[shoulderOf(seat)] / 100), 0, 1);
    const perfect = at - sh.activeFrom <= s.config.shields.perfectMs;
    remaining = Math.round(th.damage * (1 - ratio));
    wear(s, shoulderOf(seat), s.config.mech.wear.perBlock);
    s.stats.threatsBlocked += 1;
    const st = s.seats[seat].stats;
    st.blocks += 1;
    if (perfect) {
      st.perfect += 1;
      s.stats.perfectGuards += 1;
    }
    s.teamCapacitor = clamp(
      s.teamCapacitor + (perfect ? s.config.capacitor.perPerfect : s.config.capacitor.perBlock),
      0,
      s.config.capacitor.max,
    );
    emit(ctx, at, {
      type: 'threat_blocked',
      threatId: th.id,
      seatId: seat,
      dir: th.dir,
      perfect,
      ratio,
      auto: false,
    });
    recordSuccess(ctx, at, seat, false);
  } else if (isAuto(s, seat) && at >= s.autoTimers.shield[seat]) {
    // AUTO SUPPORT reacts late and only half-blocks: a human shield is always better.
    const ratio = s.config.auto.shieldBlockRatio;
    remaining = Math.round(th.damage * (1 - ratio));
    s.autoTimers.shield[seat] = at + s.config.auto.shieldCooldownMs;
    wear(s, shoulderOf(seat), s.config.mech.wear.perBlock);
    s.stats.threatsBlocked += 1;
    emit(ctx, at, {
      type: 'shield_deployed',
      seatId: seat,
      dir: th.dir,
      until: at + 600,
      auto: true,
    });
    emit(ctx, at, {
      type: 'threat_blocked',
      threatId: th.id,
      seatId: seat,
      dir: th.dir,
      perfect: false,
      ratio,
      auto: true,
    });
    recordSuccess(ctx, at, seat, true);
  }
  if (remaining > 0) applyHit(ctx, th, remaining);
}

function applyHit(ctx: Ctx, th: ThreatState, damage: number): void {
  const s = ctx.s;
  const at = th.impactAt;
  let dmg = damage;
  if (th.target.type === 'CITY') {
    const city = s.cities[th.target.cityId];
    s.coreHp = Math.max(0, Math.round(s.coreHp - dmg * s.config.cities.coreShareOfCityHit));
    if (!city.lost) {
      city.hp = Math.max(0, Math.round(city.hp - dmg));
      if (city.hp <= 0) {
        city.lost = true;
        emit(ctx, at, { type: 'city_lost', cityId: city.id });
      } else {
        emit(ctx, at, { type: 'city_damaged', cityId: city.id, hp: city.hp });
      }
    }
  } else {
    const legs = (s.parts.LEG_L + s.parts.LEG_R) / 200;
    if (s.energy.mobility >= s.config.mech.evadeCost && legs > 0.3) {
      // Legs and thrusters sidestep part of the blow when the mobility lane can pay;
      // damaged legs sidestep less (engineers keep RAIJIN nimble).
      s.energy.mobility -= s.config.mech.evadeCost;
      wear(s, 'LEG_L', s.config.mech.wear.perEvade);
      wear(s, 'LEG_R', s.config.mech.wear.perEvade);
      const ratio = s.config.mech.evadeRatio + (1 - s.config.mech.evadeRatio) * (1 - legs) * 0.8;
      dmg = Math.round(dmg * ratio);
    }
    const part = th.target.part;
    s.parts[part] = Math.max(0, Math.round(s.parts[part] - dmg * s.config.mech.partDamageRatio));
    s.coreHp = Math.max(0, Math.round(s.coreHp - dmg * s.config.mech.coreShareOfMechHit));
    emit(ctx, at, { type: 'part_damaged', part, hp: s.parts[part] });
  }
  s.stats.threatsHit += 1;
  emit(ctx, at, {
    type: 'incoming_hit',
    threatId: th.id,
    dir: th.dir,
    target: th.target,
    damage: dmg,
  });
  checkDefeat(ctx, at);
}

function checkDefeat(ctx: Ctx, at: number): void {
  const s = ctx.s;
  if (s.result || !isCombatPhase(s.phase)) return;
  if (s.coreHp <= 0) return defeat(ctx, at, 'CORE_DESTROYED');
  const lost = CITY_IDS.filter((id) => s.cities[id].lost).length;
  if (lost >= s.config.cities.lostForDefeat) defeat(ctx, at, 'CITIES_LOST');
}

/* ------------------------------------------------------------ cooperation */

function recordSuccess(ctx: Ctx, at: number, seatId: SeatId, auto: boolean): void {
  const s = ctx.s;
  const role = roleOf(seatId);
  if (!auto) s.teamSync = clamp(s.teamSync + s.config.sync.perAction, 0, 100);
  s.recentSuccesses.push({ t: at, seatId, role });
  const windowStart = at - s.config.sync.windowMs;
  s.recentSuccesses = s.recentSuccesses.filter((r) => r.t >= windowStart);
  const roles = [...new Set(s.recentSuccesses.map((r) => r.role))] as RoleId[];
  const humanRoles = new Set(
    s.recentSuccesses.filter((r) => isHuman(s, r.seatId)).map((r) => r.role),
  ).size;
  if (roles.length >= 2 && humanRoles >= 1) {
    // AUTO SUPPORT can complete a link, but people linking with people is worth more.
    const weight = humanRoles >= 2 ? 1 : 0.5;
    const gain = Math.round(
      s.config.sync.gainByRoles[Math.min(4, roles.length) as 2 | 3 | 4] * weight,
    );
    s.teamSync = clamp(s.teamSync + gain, 0, 100);
    s.teamCapacitor = clamp(
      s.teamCapacitor + Math.round(s.config.capacitor.perCombo * weight),
      0,
      s.config.capacitor.max,
    );
    s.stats.combos += 1;
    s.stats.bestSync = Math.max(s.stats.bestSync, s.teamSync);
    for (const seat of new Set(s.recentSuccesses.map((r) => r.seatId))) {
      if (isHuman(s, seat)) s.seats[seat].stats.combos += 1;
    }
    s.lastComboAt = at;
    // A combo consumes its links: the next one needs fresh teamwork.
    s.recentSuccesses = [];
    emit(ctx, at, { type: 'team_combo', roles, gain, sync: s.teamSync });
  }
  s.stats.bestSync = Math.max(s.stats.bestSync, s.teamSync);
}

/* ---------------------------------------------------------------- weapons */

function weaponFactor(s: MatchState): number {
  return 0.75 + (s.distribution.weapon / 100) * 0.75;
}

function armOf(seat: GunnerSeatId): MechPartId {
  return seat === 'GUNNER_L' ? 'ARM_L' : 'ARM_R';
}

function damageEnemy(
  ctx: Ctx,
  at: number,
  enemy: EnemyState,
  damage: number,
  bySeat: SeatId | null,
): boolean {
  const s = ctx.s;
  enemy.hp = Math.max(0, enemy.hp - damage);
  if (enemy.kind === 'NULL_CORE') s.stats.damageToBoss += damage;
  if (enemy.hp > 0) return false;
  s.enemies = s.enemies.filter((e) => e.id !== enemy.id);
  s.stats.enemiesDestroyed += 1;
  emit(ctx, at, { type: 'enemy_destroyed', enemyId: enemy.id, kind: enemy.kind, bySeat });
  // Killing an attacker before impact cancels its attack: gunners protect cities too.
  for (const th of s.threats.filter((x) => x.sourceId === enemy.id)) {
    s.stats.threatsIntercepted += 1;
    emit(ctx, at, { type: 'threat_intercepted', threatId: th.id, enemyId: enemy.id });
  }
  s.threats = s.threats.filter((x) => x.sourceId !== enemy.id);
  for (const g of Object.values(s.gunners)) {
    if (g.targetId === enemy.id) {
      g.targetId = null;
      g.chargedNotified = true;
    }
  }
  if (enemy.kind === 'NULL_CORE') finish(ctx, at, 'VICTORY', 'BOSS_DESTROYED');
  return true;
}

function fireWeapon(
  ctx: Ctx,
  at: number,
  seat: GunnerSeatId,
  enemy: EnemyState,
  auto: boolean,
): void {
  const s = ctx.s;
  const cfg = s.config.weapons;
  const arm = s.parts[armOf(seat)];
  const weak = enemy.weakUntil > at;
  const base = cfg.seats[seat].damage * (auto ? s.config.auto.gunnerDamageRatio : 1);
  const damage = Math.max(
    1,
    Math.round(
      base * (0.5 + 0.5 * (arm / 100)) * weaponFactor(s) * (weak ? cfg.weakMultiplier : 1),
    ),
  );
  s.energy.weapon -= cfg.energyCost;
  wear(s, armOf(seat), s.config.mech.wear.perShot);
  const st = s.seats[seat].stats;
  if (!auto) {
    st.hits += 1;
    st.damage += damage;
  }
  s.teamCapacitor = clamp(
    s.teamCapacitor + (auto ? 0 : s.config.capacitor.perHit),
    0,
    s.config.capacitor.max,
  );
  // Announce the shot before the kill so the screen draws the beam, then the explosion.
  emit(ctx, at, {
    type: 'weapon_fired',
    seatId: seat,
    enemyId: enemy.id,
    damage,
    weak,
    auto,
    killed: enemy.hp - damage <= 0,
  });
  damageEnemy(ctx, at, enemy, damage, auto ? null : seat);
  if (!s.result) recordSuccess(ctx, at, seat, auto);
}

function lock(
  ctx: Ctx,
  at: number,
  seat: GunnerSeatId,
  targetId: string | undefined,
): ReasonCode | null {
  const s = ctx.s;
  const target = targetId
    ? s.enemies.find((e) => e.id === targetId)
    : recommendTarget(s.enemies, s.threats, at);
  if (!target) return targetId ? 'TARGET_LOST' : 'NO_TARGET';
  if (at < target.arrivesAt) return 'TARGET_ARRIVING';
  const g = s.gunners[seat];
  const cfg = s.config.weapons;
  if (g.targetId !== target.id) {
    const charge = cfg.seats[seat].chargeMs / weaponFactor(s);
    g.targetId = target.id;
    g.lockedAt = at;
    g.readyAt = Math.round(Math.max(at + charge, g.lastFiredAt + cfg.cooldownMs));
    g.chargedNotified = false;
  }
  const weakPoint = seat === 'GUNNER_R';
  if (weakPoint) target.weakUntil = at + cfg.weakPointMs;
  emit(ctx, at, { type: 'target_locked', seatId: seat, enemyId: target.id, weakPoint });
  return null;
}

function fire(ctx: Ctx, at: number, seat: GunnerSeatId): ReasonCode | null {
  const s = ctx.s;
  const g = s.gunners[seat];
  const cfg = s.config.weapons;
  if (!g.targetId) return 'NO_TARGET';
  const target = s.enemies.find((e) => e.id === g.targetId);
  if (!target) {
    g.targetId = null;
    return 'TARGET_LOST';
  }
  if (s.parts[armOf(seat)] <= 0) return 'WEAPON_BROKEN';
  if (at < g.readyAt) return at < g.lastFiredAt + cfg.cooldownMs ? 'COOLDOWN' : 'CHARGING';
  if (s.energy.weapon < cfg.energyCost) return 'NO_ENERGY';
  g.lastFiredAt = at;
  g.readyAt = at + cfg.cooldownMs;
  g.chargedNotified = false;
  fireWeapon(ctx, at, seat, target, false);
  return null;
}

function deployShield(ctx: Ctx, at: number, seat: ShieldSeatId, dir: Direction): ReasonCode | null {
  const s = ctx.s;
  if (!SHIELD_COVERAGE[seat].includes(dir)) return 'BAD_DIRECTION';
  const sh = s.shields[seat];
  const cfg = s.config.shields;
  if (at < sh.cooldownUntil) return 'COOLDOWN';
  if (s.energy.shield < cfg.energyCost) return 'NO_ENERGY';
  s.energy.shield -= cfg.energyCost;
  sh.dir = dir;
  sh.activeFrom = at;
  sh.activeUntil = at + cfg.activeMs;
  sh.cooldownUntil = at + cfg.cooldownMs;
  emit(ctx, at, { type: 'shield_deployed', seatId: seat, dir, until: sh.activeUntil, auto: false });
  return null;
}

/* ------------------------------------------------------------------ power */

function shift(a: PowerDistribution, b: PowerDistribution): number {
  return (
    (Math.abs(a.weapon - b.weapon) +
      Math.abs(a.shield - b.shield) +
      Math.abs(a.mobility - b.mobility) +
      Math.abs(a.repair - b.repair)) /
    2
  );
}

function validDistribution(s: MatchState, d: PowerDistribution): boolean {
  const { laneMin, laneMax } = s.config.power;
  const v = [d.weapon, d.shield, d.mobility, d.repair];
  return (
    v.every((x) => Number.isInteger(x) && x >= laneMin && x <= laneMax) &&
    v.reduce((a, b) => a + b, 0) === 100
  );
}

function applyPower(ctx: Ctx, at: number, seat: SeatId, d: PowerDistribution, auto: boolean): void {
  const s = ctx.s;
  const moved = shift(s.distribution, d);
  s.distribution = { ...d };
  s.distributionVersion += 1;
  emit(ctx, at, { type: 'power_routed', seatId: seat, distribution: { ...d }, auto });
  // A real re-plan is teamwork; nudging a slider back and forth is not.
  if (moved >= s.config.power.minShift && at - s.powerSuccessAt >= s.config.power.successEveryMs) {
    s.powerSuccessAt = at;
    recordSuccess(ctx, at, seat, auto);
  }
}

function setPower(
  ctx: Ctx,
  at: number,
  d: PowerDistribution,
  baseVersion: number,
): ReasonCode | null {
  const s = ctx.s;
  if (!validDistribution(s, d)) return 'BAD_DISTRIBUTION';
  // Two phones on one seat (or a stale screen) must not silently overwrite each other.
  if (baseVersion !== s.distributionVersion) return 'STALE_VERSION';
  applyPower(ctx, at, 'POWER_CORE', d, false);
  s.seats.POWER_CORE.stats.routes += 1;
  return null;
}

/* ---------------------------------------------------------------- circuits */

function runOverloads(ctx: Ctx, now: number): void {
  const s = ctx.s;
  if (s.nextOverloadAt === null || now < s.nextOverloadAt) return;
  const wave = s.phase as 'WAVE_1' | 'WAVE_2' | 'BOSS';
  const every = s.config.router.everyMs[wave];
  s.nextOverloadAt = every === null ? null : now + Math.round(every * randomBetween(s, 0.8, 1.2));
  const intact = POWER_LANES.filter((l) => !s.circuits[l].broken);
  if (POWER_LANES.length - intact.length >= s.config.router.maxBroken || intact.length === 0)
    return;
  // The busiest lane is the likeliest to overload: pushing everything into guns has a cost.
  const lane = weightedPick(
    s,
    intact.map((l) => ({ lane: l, weight: 5 + s.distribution[l] })),
  ).lane;
  s.circuits[lane] = { broken: true, brokenAt: now, puzzle: generatePuzzle(s) };
  wear(s, 'CORE', s.config.mech.wear.perOverload);
  s.stats.overloads += 1;
  emit(ctx, now, { type: 'circuit_overload', lane });
}

function restoreCircuit(ctx: Ctx, at: number, lane: PowerLane, auto: boolean): void {
  const s = ctx.s;
  s.circuits[lane] = { broken: false, brokenAt: 0, puzzle: null };
  s.stats.routesFixed += 1;
  emit(ctx, at, { type: 'circuit_restored', lane, seatId: 'POWER_ROUTER', auto });
  recordSuccess(ctx, at, 'POWER_ROUTER', auto);
}

function routeSubmit(
  ctx: Ctx,
  at: number,
  lane: PowerLane,
  rotations: number[],
): ReasonCode | null {
  const s = ctx.s;
  const c = s.circuits[lane];
  if (!c.broken || !c.puzzle) return 'CIRCUIT_OK';
  if (!routeConnects(c.puzzle, rotations)) return 'ROUTE_INCOMPLETE';
  restoreCircuit(ctx, at, lane, false);
  s.seats.POWER_ROUTER.stats.routes += 1;
  return null;
}

/* ----------------------------------------------------------------- repair */

function repairFactor(s: MatchState): number {
  return 0.6 + (s.distribution.repair / 100) * 2;
}

function repairStart(
  ctx: Ctx,
  at: number,
  seat: EngineerSeatId,
  part: MechPartId,
): ReasonCode | null {
  const s = ctx.s;
  if (!ENGINEER_COVERAGE[seat].includes(part)) return 'NOT_YOUR_PART';
  if (s.parts[part] >= 100) return 'PART_OK';
  const eng = s.engineers[seat];
  if (at < eng.cooldownUntil) return 'COOLDOWN';
  if (s.energy.repair < s.config.repair.energyCost) return 'NO_ENERGY';
  const slots = Array.from({ length: s.config.repair.slots }, (_, i) => i);
  const bolts: number[] = [];
  for (let i = 0; i < s.config.repair.bolts; i++) {
    const pick = Math.floor(nextRandom(s) * slots.length);
    bolts.push(slots.splice(pick, 1)[0]!);
  }
  eng.job = { part, bolts, startedAt: at, expiresAt: at + s.config.repair.jobMs };
  emit(ctx, at, { type: 'repair_started', seatId: seat, part });
  return null;
}

function repairFinish(
  ctx: Ctx,
  at: number,
  seat: EngineerSeatId,
  part: MechPartId,
  order: number[],
): ReasonCode | null {
  const s = ctx.s;
  const eng = s.engineers[seat];
  const job = eng.job;
  if (!job || job.part !== part) return 'NO_JOB';
  if (at > job.expiresAt) {
    eng.job = null;
    return 'JOB_EXPIRED';
  }
  if (order.length !== job.bolts.length || order.some((b, i) => b !== job.bolts[i])) {
    return 'WRONG_ORDER';
  }
  if (s.energy.repair < s.config.repair.energyCost) return 'NO_ENERGY';
  s.energy.repair -= s.config.repair.energyCost;
  const gain = Math.round(s.config.repair.amount * repairFactor(s));
  s.parts[part] = Math.min(100, s.parts[part] + gain);
  eng.job = null;
  eng.cooldownUntil = at + s.config.repair.cooldownMs;
  s.seats[seat].stats.repairs += 1;
  s.stats.repairs += 1;
  emit(ctx, at, { type: 'part_repaired', part, hp: s.parts[part], seatId: seat, auto: false });
  recordSuccess(ctx, at, seat, false);
  return null;
}

/* -------------------------------------------------------------- overdrive */

function roleHasCrew(s: MatchState, role: RoleId): boolean {
  return ROLES[role].seats.some((id) => isHuman(s, id));
}

function confirmRole(ctx: Ctx, at: number, role: RoleId, seatId: SeatId | null, auto: boolean) {
  const od = ctx.s.overdrive;
  if (od.confirmed.includes(role)) return;
  od.confirmed.push(role);
  emit(ctx, at, { type: 'overdrive_sync', role, seatId, auto });
  if (ROLE_IDS.every((r) => od.confirmed.includes(r))) fireOverdrive(ctx, at);
}

function fireOverdrive(ctx: Ctx, at: number): void {
  const s = ctx.s;
  const od = s.overdrive;
  const cfg = s.config.overdrive;
  const autoRoles = [...od.autoRoles];
  s.overdrive = idleOverdrive();
  s.teamCapacitor = 0;
  s.teamSync = cfg.syncAfter;
  s.stats.overdrives += 1;
  emit(ctx, at, { type: 'overdrive_fired', damage: cfg.damage, roles: [...ROLE_IDS], autoRoles });
  const boss = bossOf(s);
  if (boss) damageEnemy(ctx, at, boss, cfg.damage, null);
}

function syncNow(ctx: Ctx, at: number, seat: SeatId): ReasonCode | null {
  const s = ctx.s;
  const od = s.overdrive;
  const role = roleOf(seat);
  if (od.status === 'READY') {
    od.status = 'CHARGING';
    od.windowStartedAt = at;
    od.windowEndsAt = at + s.config.overdrive.windowMs;
    od.confirmed = [];
    // Roles with nobody aboard are confirmed by AUTO SUPPORT, and say so (spec §6.7).
    od.autoRoles = s.autoSupport ? ROLE_IDS.filter((r) => !roleHasCrew(s, r)) : [];
    emit(ctx, at, {
      type: 'overdrive_window',
      endsAt: od.windowEndsAt,
      autoRoles: [...od.autoRoles],
    });
  } else if (od.status !== 'CHARGING') {
    return 'OVERDRIVE_NOT_READY';
  }
  s.seats[seat].stats.syncs += 1;
  confirmRole(ctx, at, role, seat, false);
  return null;
}

function runOverdrive(ctx: Ctx, now: number): void {
  const s = ctx.s;
  const od = s.overdrive;
  const cfg = s.config.overdrive;
  if (s.phase !== 'BOSS' || !bossOf(s)) {
    if (od.status !== 'IDLE') s.overdrive = idleOverdrive();
    return;
  }
  if (od.status === 'IDLE' && s.teamSync >= cfg.syncMin && s.teamCapacitor >= cfg.capacitorMin) {
    od.status = 'READY';
    od.readyAt = now;
    emit(ctx, now, { type: 'overdrive_ready' });
    return;
  }
  if (od.status !== 'CHARGING') return;
  if (now >= od.windowStartedAt + cfg.autoConfirmMs) {
    for (const r of od.autoRoles) {
      if (s.overdrive.status !== 'CHARGING') return;
      confirmRole(ctx, now, r, null, true);
    }
  }
  if (s.overdrive.status === 'CHARGING' && now >= od.windowEndsAt) {
    const missing = ROLE_IDS.filter((r) => !od.confirmed.includes(r));
    s.overdrive = idleOverdrive();
    s.teamCapacitor = Math.round(s.teamCapacitor * cfg.failCapacitorKeep);
    s.stats.overdriveFails += 1;
    emit(ctx, now, { type: 'overdrive_failed', missing });
  }
}

/* ----------------------------------------------------------- auto support */

function runAutoSupport(ctx: Ctx, now: number): void {
  const s = ctx.s;
  if (!s.autoSupport || !isCombatPhase(s.phase)) return;
  for (const seat of ['GUNNER_L', 'GUNNER_R'] as const) {
    if (isHuman(s, seat) || now < s.autoTimers.gunner[seat]) continue;
    s.autoTimers.gunner[seat] = now + s.config.auto.gunnerEveryMs;
    const target = recommendTarget(s.enemies, s.threats, now);
    if (!target || now < target.arrivesAt) continue;
    if (s.energy.weapon < s.config.weapons.energyCost + 10) continue;
    fireWeapon(ctx, now, seat, target, true);
    if (s.result) return;
  }
  if (now >= s.autoTimers.engineer) {
    s.autoTimers.engineer = now + s.config.auto.engineerEveryMs;
    for (const seat of ['ENGINEER_CORE', 'ENGINEER_LEGS'] as EngineerSeatId[]) {
      if (isHuman(s, seat)) continue;
      const parts = ENGINEER_COVERAGE[seat].filter((p) => s.parts[p] < 100);
      if (parts.length === 0 || s.energy.repair < s.config.repair.energyCost) continue;
      const worst = parts.reduce((a, b) => (s.parts[b] < s.parts[a] ? b : a));
      s.energy.repair -= s.config.repair.energyCost;
      s.parts[worst] = Math.min(100, s.parts[worst] + s.config.auto.engineerAmount);
      emit(ctx, now, {
        type: 'part_repaired',
        part: worst,
        hp: s.parts[worst],
        seatId: seat,
        auto: true,
      });
      recordSuccess(ctx, now, seat, true);
    }
  }
  if (!isHuman(s, 'POWER_ROUTER')) {
    for (const lane of POWER_LANES) {
      const c = s.circuits[lane];
      if (c.broken && now >= c.brokenAt + s.config.auto.routerFixMs) {
        restoreCircuit(ctx, now, lane, true);
      }
    }
  }
  if (!isHuman(s, 'POWER_CORE') && now >= s.autoTimers.power) {
    s.autoTimers.power = now + 8_000;
    const want = autoPlan(s);
    if (shift(want, s.distribution) >= s.config.power.minShift) {
      applyPower(ctx, now, 'POWER_CORE', want, true);
    }
  }
}

/** AUTO SUPPORT's power plan: sensible, never clever (a human POWER A should beat it). */
function autoPlan(s: MatchState): PowerDistribution {
  const d = { ...s.config.power.defaultDistribution };
  if (bossOf(s)) {
    d.weapon += 10;
    d.mobility -= 5;
    d.repair -= 5;
  }
  const worst = Math.min(...Object.values(s.parts));
  if (worst < 55 && d.weapon - 10 >= s.config.power.laneMin) {
    d.weapon -= 10;
    d.repair += 10;
  }
  return d;
}

/* -------------------------------------------------------------- simulation */

function regenEnergy(s: MatchState, dtSec: number): void {
  const coreFactor = 0.5 + 0.5 * (s.parts.CORE / 100);
  const total = s.config.energy.regenPerSec * coreFactor * dtSec;
  const max = s.config.energy.laneMax;
  const d = s.distribution;
  // A cut circuit starves its lane until POWER B re-routes it.
  const f = (lane: PowerLane) => (s.circuits[lane].broken ? s.config.router.brokenRegenFactor : 1);
  s.energy.weapon = Math.min(max, s.energy.weapon + (total * d.weapon * f('weapon')) / 100);
  s.energy.shield = Math.min(max, s.energy.shield + (total * d.shield * f('shield')) / 100);
  s.energy.mobility = Math.min(max, s.energy.mobility + (total * d.mobility * f('mobility')) / 100);
  s.energy.repair = Math.min(max, s.energy.repair + (total * d.repair * f('repair')) / 100);
}

function releaseTimedOutSeats(ctx: Ctx, now: number): void {
  const s = ctx.s;
  for (const id of SEAT_IDS) {
    const seat = s.seats[id];
    if (
      seat.pilotId &&
      seat.disconnectedAt !== null &&
      now - seat.disconnectedAt >= s.config.timings.seatHoldMs
    ) {
      releaseSeat(ctx, now, id, 'TIMEOUT');
    }
  }
}

function step(ctx: Ctx, now: number, dtSec: number): void {
  const s = ctx.s;
  releaseTimedOutSeats(ctx, now);
  if (s.phaseEndsAt !== null && now >= s.phaseEndsAt) {
    const at = s.phaseEndsAt;
    if (s.phase === 'BOSS') {
      defeat(ctx, at, 'TIME_UP');
    } else {
      const next = NEXT_TIMED[s.phase];
      if (next) enterPhase(ctx, next, at);
      else s.phaseEndsAt = null; // RESULTS: the server rolls the next round.
    }
  }
  if (!isCombatPhase(s.phase)) return;
  regenEnergy(s, dtSec);
  runSpawner(ctx, now);
  launchAttacks(ctx, now);
  resolveImpacts(ctx, now);
  if (!isCombatPhase(s.phase)) return;
  for (const seat of ['GUNNER_L', 'GUNNER_R'] as const) {
    const g = s.gunners[seat];
    if (g.targetId && !g.chargedNotified && now >= g.readyAt) {
      g.chargedNotified = true;
      emit(ctx, now, { type: 'weapon_charged', seatId: seat, enemyId: g.targetId });
    }
  }
  runOverloads(ctx, now);
  runAutoSupport(ctx, now);
  if (!isCombatPhase(s.phase)) return;
  for (const id of ['ENGINEER_LEGS', 'ENGINEER_CORE'] as const) {
    const job = s.engineers[id].job;
    if (job && now > job.expiresAt) s.engineers[id].job = null;
  }
  runOverdrive(ctx, now);
  if (now - s.lastComboAt > s.config.sync.decayAfterMs) {
    s.teamSync = Math.max(0, s.teamSync - s.config.sync.decayPerSec * dtSec);
  }
}

function advanceCtx(ctx: Ctx, t: number): void {
  const s = ctx.s;
  if (t <= s.t) return;
  if (s.paused) {
    // The server's clock stops while paused; tolerate a stray tick without simulating.
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

/* ----------------------------------------------------------------- seats */

function releaseSeat(
  ctx: Ctx,
  at: number,
  seatId: SeatId,
  reason: 'LEFT' | 'TIMEOUT' | 'KICKED' | 'ROUND_OVER' | 'REPLACED',
): void {
  const s = ctx.s;
  const keep = s.seats[seatId].stats;
  s.seats[seatId] = { ...emptySeat(seatId), stats: keep };
  if (seatId === 'GUNNER_L' || seatId === 'GUNNER_R') {
    s.gunners[seatId].targetId = null;
    s.gunners[seatId].chargedNotified = true;
  }
  if (seatId === 'ENGINEER_LEGS' || seatId === 'ENGINEER_CORE') s.engineers[seatId].job = null;
  emit(ctx, at, { type: 'seat_released', seatId, reason });
}

function seatOf(s: MatchState, pilotId: string): SeatId | null {
  return SEAT_IDS.find((id) => s.seats[id].pilotId === pilotId) ?? null;
}

const SEAT_CHANGE_PHASES: readonly Phase[] = ['ATTRACT', 'LOBBY'];
const JOIN_CLOSED_PHASES: readonly Phase[] = ['VICTORY', 'DEFEAT', 'RESULTS'];

function joinSeat(
  ctx: Ctx,
  at: number,
  seatId: SeatId,
  pilotId: string,
  displayName: string,
  bot = false,
): SeatRequestResult {
  const s = ctx.s;
  if (JOIN_CLOSED_PHASES.includes(s.phase)) return { ok: false, reasonCode: 'ROUND_CLOSED' };
  if (!isSeatOpen(s.config, seatId)) return { ok: false, reasonCode: 'SEAT_NOT_OPEN' };
  const current = seatOf(s, pilotId);
  if (current === seatId) {
    const seat = s.seats[seatId];
    if (!seat.connected) {
      seat.connected = true;
      seat.disconnectedAt = null;
      emit(ctx, at, { type: 'seat_connection', seatId, connected: true });
    }
    return { ok: true, seatId };
  }
  const occupant = s.seats[seatId].pilotId;
  if (occupant && occupant !== pilotId) {
    // A demo bot steps aside for a human; humans never replace each other.
    if (!s.seats[seatId].bot || bot) return { ok: false, reasonCode: 'SEAT_TAKEN' };
    releaseSeat(ctx, at, seatId, 'REPLACED');
  }
  if (current) {
    if (!SEAT_CHANGE_PHASES.includes(s.phase)) return { ok: false, reasonCode: 'SEAT_LOCKED' };
    releaseSeat(ctx, at, current, 'LEFT');
  }
  const seat = s.seats[seatId];
  seat.pilotId = pilotId;
  seat.displayName = displayName;
  seat.connected = true;
  seat.ready = false;
  seat.disconnectedAt = null;
  seat.bot = bot;
  seat.stats = emptyStats();
  emit(ctx, at, { type: 'seat_assigned', seatId, displayName });
  if (s.phase === 'ATTRACT') enterPhase(ctx, 'LOBBY', at);
  return { ok: true, seatId };
}

/* ---------------------------------------------------------------- reduce */

function remember(s: MatchState, id: string, accepted: boolean, reason: ReasonCode | null): void {
  s.actionLog[id] = { accepted, reason };
  s.actionLogOrder.push(id);
  while (s.actionLogOrder.length > ACTION_LOG_LIMIT) {
    const old = s.actionLogOrder.shift()!;
    delete s.actionLog[old];
  }
}

function pilotAction(
  ctx: Ctx,
  cmd: Extract<EngineCommand, { type: 'PILOT_ACTION' }>,
  at: number,
): ActionResult {
  const s = ctx.s;
  const seat = s.seats[cmd.seatId];
  const reject = (reasonCode: ReasonCode): ActionResult => {
    remember(s, cmd.clientActionId, false, reasonCode);
    return {
      clientActionId: cmd.clientActionId,
      accepted: false,
      reasonCode,
      resultingStateVersion: s.version,
    };
  };
  if (seat.pilotId !== cmd.pilotId) return reject('NOT_YOUR_SEAT');
  if (s.paused) return reject('PAUSED');
  if (!isCombatPhase(s.phase)) return reject('NOT_IN_COMBAT');
  const role = roleOf(cmd.seatId);
  const a = cmd.action;
  let reason: ReasonCode | null;
  if (a.actionType === 'LOCK' || a.actionType === 'FIRE') {
    if (role !== 'GUNNER') return reject('WRONG_ROLE');
    const g = cmd.seatId as GunnerSeatId;
    reason = a.actionType === 'LOCK' ? lock(ctx, at, g, a.payload.targetId) : fire(ctx, at, g);
  } else if (a.actionType === 'DEPLOY_SHIELD') {
    if (role !== 'DEFENSE') return reject('WRONG_ROLE');
    reason = deployShield(ctx, at, cmd.seatId as ShieldSeatId, a.payload.dir);
  } else if (a.actionType === 'SET_POWER') {
    if (cmd.seatId !== 'POWER_CORE') return reject('WRONG_ROLE');
    reason = setPower(ctx, at, a.payload.distribution, a.payload.baseVersion);
  } else if (a.actionType === 'ROUTE_SUBMIT') {
    if (cmd.seatId !== 'POWER_ROUTER') return reject('WRONG_ROLE');
    reason = routeSubmit(ctx, at, a.payload.lane, a.payload.rotations);
  } else if (a.actionType === 'REPAIR_START' || a.actionType === 'REPAIR_FINISH') {
    if (role !== 'ENGINEER') return reject('WRONG_ROLE');
    const e = cmd.seatId as EngineerSeatId;
    reason =
      a.actionType === 'REPAIR_START'
        ? repairStart(ctx, at, e, a.payload.part)
        : repairFinish(ctx, at, e, a.payload.part, a.payload.order);
  } else if (a.actionType === 'SYNC_NOW') {
    reason = syncNow(ctx, at, cmd.seatId);
  } else {
    return reject('INVALID');
  }
  if (reason) return reject(reason);
  seat.stats.actions += 1;
  remember(s, cmd.clientActionId, true, null);
  return { clientActionId: cmd.clientActionId, accepted: true, resultingStateVersion: s.version };
}

const PAUSABLE: readonly Phase[] = ['COUNTDOWN', 'DEPLOYMENT', 'WAVE_1', 'WAVE_2', 'BOSS'];

export function reduce(state: MatchState, cmd: EngineCommand): ReduceResult {
  // Duplicate pilot actions return the remembered answer without touching state.
  if (cmd.type === 'PILOT_ACTION') {
    const prior = state.actionLog[cmd.clientActionId];
    if (prior) {
      return {
        state,
        events: [],
        outcome: {
          kind: 'action',
          result: {
            clientActionId: cmd.clientActionId,
            accepted: prior.accepted,
            ...(prior.reason ? { reasonCode: prior.reason as ReasonCode } : {}),
            resultingStateVersion: state.version,
          },
        },
      };
    }
  }
  const ctx: Ctx = { s: structuredClone(state), events: [] };
  const at = Math.max(cmd.t, state.t);
  advanceCtx(ctx, at);
  const s = ctx.s;
  s.version += 1;
  const control = (ok: boolean, reasonCode?: ReasonCode): CommandOutcome => ({
    kind: 'control',
    ok,
    ...(reasonCode ? { reasonCode } : {}),
  });
  let outcome: CommandOutcome = { kind: 'none' };

  switch (cmd.type) {
    case 'ATTRACT':
      if (s.phase !== 'LOBBY') outcome = control(false);
      else {
        enterPhase(ctx, 'ATTRACT', at);
        outcome = control(true);
      }
      break;
    case 'OPEN_LOBBY':
      if (s.phase !== 'ATTRACT') outcome = control(s.phase === 'LOBBY');
      else {
        enterPhase(ctx, 'LOBBY', at);
        outcome = control(true);
      }
      break;
    case 'START':
      if (s.phase !== 'LOBBY' && s.phase !== 'ATTRACT') outcome = control(false);
      else {
        enterPhase(ctx, 'COUNTDOWN', at);
        outcome = control(true);
      }
      break;
    case 'SKIP_DEPLOY':
      if (s.phase !== 'COUNTDOWN' && s.phase !== 'DEPLOYMENT') outcome = control(false);
      else {
        enterPhase(ctx, 'WAVE_1', at);
        outcome = control(true);
      }
      break;
    case 'PAUSE':
      if (s.paused || !PAUSABLE.includes(s.phase)) outcome = control(false);
      else {
        s.paused = true;
        emit(ctx, at, { type: 'match_paused' });
        outcome = control(true);
      }
      break;
    case 'RESUME':
      if (!s.paused) outcome = control(false);
      else {
        s.paused = false;
        emit(ctx, at, { type: 'match_resumed' });
        outcome = control(true);
      }
      break;
    case 'END':
      if (!PAUSABLE.includes(s.phase)) outcome = control(false);
      else {
        s.paused = false;
        defeat(ctx, at, 'ABORTED');
        outcome = control(true);
      }
      break;
    case 'SET_AUTO_SUPPORT':
      if (s.autoSupport !== cmd.enabled) {
        s.autoSupport = cmd.enabled;
        emit(ctx, at, { type: 'auto_support_changed', enabled: cmd.enabled });
      }
      outcome = control(true);
      break;
    case 'SEAT_JOIN':
      outcome = {
        kind: 'seat',
        result: joinSeat(ctx, at, cmd.seatId, cmd.pilotId, cmd.displayName, cmd.bot ?? false),
      };
      break;
    case 'SEAT_LEAVE': {
      const seat = seatOf(s, cmd.pilotId);
      if (seat) releaseSeat(ctx, at, seat, 'LEFT');
      outcome = { kind: 'seat', result: { ok: true, seatId: null } };
      break;
    }
    case 'SEAT_KICK':
      if (s.seats[cmd.seatId].pilotId) {
        releaseSeat(ctx, at, cmd.seatId, 'KICKED');
        outcome = control(true);
      } else outcome = control(false);
      break;
    case 'SEAT_RENAME':
      if (s.seats[cmd.seatId].pilotId) s.seats[cmd.seatId].displayName = cmd.displayName;
      outcome = control(!!s.seats[cmd.seatId].pilotId);
      break;
    case 'SEAT_READY': {
      const seat = seatOf(s, cmd.pilotId);
      if (!seat) outcome = { kind: 'seat', result: { ok: false, reasonCode: 'NOT_YOUR_SEAT' } };
      else {
        if (!s.seats[seat].ready) {
          s.seats[seat].ready = true;
          emit(ctx, at, { type: 'seat_ready', seatId: seat });
        }
        outcome = { kind: 'seat', result: { ok: true, seatId: seat } };
      }
      break;
    }
    case 'SEAT_CONNECTION': {
      const seat = seatOf(s, cmd.pilotId);
      if (seat && s.seats[seat].connected !== cmd.connected) {
        s.seats[seat].connected = cmd.connected;
        s.seats[seat].disconnectedAt = cmd.connected ? null : at;
        emit(ctx, at, { type: 'seat_connection', seatId: seat, connected: cmd.connected });
      }
      break;
    }
    case 'PILOT_ACTION':
      outcome = { kind: 'action', result: pilotAction(ctx, cmd, at) };
      break;
    case 'SATS_PULSE': {
      // Money already settled; the pulse lands once, only while the fight is on.
      if (s.pulsesApplied.includes(cmd.intentId)) outcome = control(false, 'INVALID');
      else if (!isCombatPhase(s.phase)) outcome = control(false, 'NOT_IN_COMBAT');
      else {
        const gain = s.config.pulses.capacitorGain;
        s.pulsesApplied.push(cmd.intentId);
        s.teamCapacitor = clamp(s.teamCapacitor + gain, 0, s.config.capacitor.max);
        s.stats.pulses += 1;
        emit(ctx, at, {
          type: 'sats_pulse_settled',
          seatId: cmd.seatId,
          gain,
          virtual: cmd.virtual,
        });
        outcome = control(true);
      }
      break;
    }
  }
  return { state: s, events: ctx.events, outcome };
}

/** RESULTS has played out: the server should roll the next round. */
export function isRoundOver(s: MatchState): boolean {
  return s.phase === 'RESULTS' && s.phaseEndsAt === null;
}

export function bossOf<E extends { kind: EnemyKind }>(s: { enemies: readonly E[] }): E | null {
  return s.enemies.find((e) => e.kind === 'NULL_CORE') ?? null;
}
