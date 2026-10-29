import type { EnemyKind, GameConfig, PowerDistribution, PresetId } from './config';
import type { CityId } from './japan';
import type { Phase } from './phases';
import type { Direction, GunnerSeatId, MechPartId, SeatId, ShieldSeatId } from './seats';

/**
 * Engine-internal match state. Authoritative and server-only: it carries pilot ids and the
 * RNG. Clients only ever see PublicMatchState (toPublicState in @swed/game-engine).
 */

export interface SeatStats {
  actions: number;
  hits: number;
  damage: number;
  blocks: number;
  perfect: number;
  repairs: number;
  combos: number;
}

export interface SeatState {
  seatId: SeatId;
  pilotId: string | null;
  /** Public name: PILOT-XXXX unless the pilot chose a callsign. */
  displayName: string | null;
  connected: boolean;
  ready: boolean;
  /** Match clock when the pilot dropped; the seat is held for timings.seatHoldMs. */
  disconnectedAt: number | null;
  stats: SeatStats;
}

/** Enemies hang around RAIJIN on slow orbits; position is a pure function of time. */
export interface EnemyOrbit {
  bearing0: number;
  driftAmp: number;
  driftPeriodMs: number;
  phase: number;
  distance: number;
  altitude: number;
}

export interface EnemyState {
  id: string;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  orbit: EnemyOrbit;
  spawnedAt: number;
  arrivesAt: number;
  nextAttackAt: number;
  nextTargetCity: CityId | null;
  /** Weak point exposed by GUNNER_R's lock until this time. */
  weakUntil: number;
}

export type ThreatTarget = { type: 'CITY'; cityId: CityId } | { type: 'MECH'; part: MechPartId };

export type ThreatKind = 'BEAM' | 'DIVE' | 'CORE_LANCE';

export interface ThreatState {
  id: string;
  sourceId: string;
  kind: ThreatKind;
  dir: Direction;
  target: ThreatTarget;
  warnAt: number;
  impactAt: number;
  damage: number;
}

export interface GunnerState {
  targetId: string | null;
  lockedAt: number;
  /** FIRE is accepted from this time (charge complete and cooldown over). */
  readyAt: number;
  chargedNotified: boolean;
  lastFiredAt: number;
}

export interface ShieldState {
  dir: Direction | null;
  activeFrom: number;
  activeUntil: number;
  cooldownUntil: number;
}

export interface CityState {
  id: CityId;
  hp: number;
  lost: boolean;
}

export interface EnergyLanes {
  weapon: number;
  shield: number;
  mobility: number;
  repair: number;
}

export interface MatchStats {
  enemiesDestroyed: number;
  threatsBlocked: number;
  perfectGuards: number;
  threatsIntercepted: number;
  threatsHit: number;
  combos: number;
  bestSync: number;
  damageToBoss: number;
}

export type MatchOutcome = 'VICTORY' | 'DEFEAT';
export type DefeatReason = 'CORE_DESTROYED' | 'CITIES_LOST' | 'TIME_UP' | 'ABORTED';

export interface MatchResult {
  outcome: MatchOutcome;
  reason: 'BOSS_DESTROYED' | DefeatReason;
  at: number;
}

export interface RecentSuccess {
  t: number;
  seatId: SeatId;
  role: 'GUNNER' | 'DEFENSE' | 'POWER' | 'ENGINEER';
}

export interface ActionRecord {
  accepted: boolean;
  reason: string | null;
}

export interface MatchState {
  matchId: string;
  matchNumber: number;
  presetId: PresetId;
  config: GameConfig;
  configHash: string;
  seed: number;
  rng: number;
  /** Monotonic match clock (ms, pauses excluded). Commands carry their own t. */
  t: number;
  /** Last fixed-step simulation boundary. */
  simT: number;
  version: number;
  eventSeq: number;
  nextId: number;
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  paused: boolean;
  autoSupport: boolean;
  seats: Record<SeatId, SeatState>;
  coreHp: number;
  enemies: EnemyState[];
  threats: ThreatState[];
  cities: Record<CityId, CityState>;
  parts: Record<MechPartId, number>;
  distribution: PowerDistribution;
  distributionVersion: number;
  energy: EnergyLanes;
  gunners: Record<GunnerSeatId, GunnerState>;
  shields: Record<ShieldSeatId, ShieldState>;
  teamSync: number;
  teamCapacitor: number;
  recentSuccesses: RecentSuccess[];
  lastComboAt: number;
  spawn: { scriptedDone: number; nextSpawnAt: number };
  autoTimers: {
    gunner: Record<GunnerSeatId, number>;
    engineer: number;
    shield: Record<ShieldSeatId, number>;
  };
  /** Humans aboard when combat began; scales enemy HP for this match. */
  crewAtLaunch: number;
  stats: MatchStats;
  result: MatchResult | null;
  /** Idempotency: last results by clientActionId (bounded). */
  actionLog: Record<string, ActionRecord>;
  actionLogOrder: string[];
}

/* ------------------------------------------------------------------ public */

export interface PublicSeat {
  seatId: SeatId;
  occupied: boolean;
  displayName: string | null;
  connected: boolean;
  ready: boolean;
  /** Seat currently flown by AUTO SUPPORT (empty seat and auto support enabled). */
  auto: boolean;
  open: boolean;
  stats: SeatStats;
}

export interface PublicEnemy {
  id: string;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  orbit: EnemyOrbit;
  spawnedAt: number;
  arrivesAt: number;
  weakUntil: number;
}

export interface PublicMatchState {
  matchId: string;
  matchNumber: number;
  presetId: PresetId;
  configHash: string;
  version: number;
  t: number;
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  /** Match clock when combat ends (boss timer runs out), null outside combat. */
  combatEndsAt: number | null;
  paused: boolean;
  autoSupport: boolean;
  seats: Record<SeatId, PublicSeat>;
  humans: number;
  coreHp: number;
  coreMax: number;
  boss: { id: string; hp: number; maxHp: number } | null;
  enemies: PublicEnemy[];
  threats: ThreatState[];
  cities: Record<CityId, CityState>;
  parts: Record<MechPartId, number>;
  distribution: PowerDistribution;
  energy: EnergyLanes;
  gunners: Record<GunnerSeatId, Omit<GunnerState, 'chargedNotified'>>;
  shields: Record<ShieldSeatId, ShieldState>;
  teamSync: number;
  teamCapacitor: number;
  stats: MatchStats;
  result: MatchResult | null;
  /** Balance numbers clients need to draw gauges (costs, cooldowns). */
  hints: {
    weaponCost: number;
    shieldCost: number;
    repairCost: number;
    weaponCooldownMs: number;
    shieldCooldownMs: number;
    shieldActiveMs: number;
    shieldPerfectMs: number;
    threatWarnMs: number;
    laneMax: number;
    citiesLostForDefeat: number;
    overdriveSyncMin: number;
    overdriveCapacitorMin: number;
  };
}
