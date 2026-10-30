import type { EnemyKind, GameConfig, PowerDistribution, PresetId } from './config';
import type { CityId } from './japan';
import type { Phase } from './phases';
import type {
  Direction,
  EngineerSeatId,
  GunnerSeatId,
  MechPartId,
  RoleId,
  SeatId,
  ShieldSeatId,
} from './seats';

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
  /** Circuits re-routed (POWER B) and power plans sent (POWER A). */
  routes: number;
  /** OVERDRIVE confirmations. */
  syncs: number;
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
  /** Operator demo bot (clearly labelled); a human taking the seat replaces it. */
  bot: boolean;
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

export const POWER_LANES = ['weapon', 'shield', 'mobility', 'repair'] as const;
export type PowerLane = (typeof POWER_LANES)[number];

/** One router tile: I = straight, L = corner. rot is quarter turns clockwise. */
export interface RouterTile {
  type: 'I' | 'L';
  rot: number;
}

/**
 * POWER B's puzzle: rotate tiles on a 3×3 grid so power flows from the left edge at
 * entryRow to the right edge at exitRow. Tiles are row-major (index = row * 3 + col).
 */
export interface RouterPuzzle {
  entryRow: number;
  exitRow: number;
  tiles: RouterTile[];
}

export interface CircuitState {
  broken: boolean;
  brokenAt: number;
  puzzle: RouterPuzzle | null;
}

/** ENGINEER job: tap the numbered bolts in order before it expires. */
export interface RepairJob {
  part: MechPartId;
  /** Bolt slots (0..slots-1) in the order they must be tightened. */
  bolts: number[];
  startedAt: number;
  expiresAt: number;
}

export interface EngineerState {
  job: RepairJob | null;
  cooldownUntil: number;
}

export type OverdriveStatus = 'IDLE' | 'READY' | 'CHARGING';

export interface OverdriveState {
  status: OverdriveStatus;
  readyAt: number;
  windowStartedAt: number;
  windowEndsAt: number;
  /** Roles that pressed SYNC NOW (or were proxied by AUTO SUPPORT) in this window. */
  confirmed: RoleId[];
  /** Roles with nobody aboard, confirmed by the clearly labelled AUTO SUPPORT. */
  autoRoles: RoleId[];
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
  repairs: number;
  routesFixed: number;
  overloads: number;
  overdrives: number;
  overdriveFails: number;
  pulses: number;
  /** REACTOR BLACKOUT crises: started, and how each ended. */
  blackouts: number;
  blackoutsByPulse: number;
  blackoutsByRoute: number;
  blackoutsFailed: number;
  /** Shots released the moment the charge completed. */
  perfectShots: number;
  /** LINK CHAINs that reached all four systems. */
  fullLinks: number;
}

export type MatchOutcome = 'VICTORY' | 'DEFEAT';
export type DefeatReason = 'CORE_DESTROYED' | 'CITIES_LOST' | 'TIME_UP' | 'ABORTED';

export interface MatchResult {
  outcome: MatchOutcome;
  reason: 'BOSS_DESTROYED' | DefeatReason;
  at: number;
}

export interface ActionRecord {
  accepted: boolean;
  reason: string | null;
}

/**
 * LINK CHAIN (spec §6.6, made visible): a success by one system opens the link; each success
 * by a different system within the window extends it and pays SYNC. Four systems = FULL LINK.
 */
export interface LinkState {
  roles: RoleId[];
  seats: SeatId[];
  expiresAt: number;
}

/**
 * REACTOR BLACKOUT: the reactor goes dark (no energy regen) and the crew has until `endsAt`.
 * POWER B can re-route the core circuit, or anyone can send a GRID PULSE (Lightning). With
 * nobody on POWER B, AUTO SUPPORT restores it at `autoAt`.
 */
export interface CrisisState {
  kind: 'BLACKOUT';
  startedAt: number;
  endsAt: number;
  autoAt: number | null;
  puzzle: RouterPuzzle;
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
  lastComboAt: number;
  link: LinkState | null;
  crisis: CrisisState | null;
  /** Waves whose scheduled crisis has already happened. */
  crisisFired: Array<'WAVE_1' | 'WAVE_2' | 'BOSS'>;
  /** Energy regen is boosted until then (after a GRID PULSE or a crew re-route). */
  overchargeUntil: number;
  spawn: { scriptedDone: number; nextSpawnAt: number };
  circuits: Record<PowerLane, CircuitState>;
  /** Next circuit overload (match clock); null when none is scheduled in this wave. */
  nextOverloadAt: number | null;
  /** POWER A: last plan that counted as a teamwork success (anti-spam). */
  powerSuccessAt: number;
  engineers: Record<EngineerSeatId, EngineerState>;
  overdrive: OverdriveState;
  /** Shared energy pulses (Lightning) applied to this match, by payment intent id. */
  pulsesApplied: string[];
  autoTimers: {
    gunner: Record<GunnerSeatId, number>;
    engineer: number;
    shield: Record<ShieldSeatId, number>;
    power: number;
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
  /** Operator demo bot. */
  bot: boolean;
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
  /** POWER A sends plans against this version; a stale plan is refused (spec §5.5). */
  distributionVersion: number;
  energy: EnergyLanes;
  gunners: Record<GunnerSeatId, Omit<GunnerState, 'chargedNotified'>>;
  shields: Record<ShieldSeatId, ShieldState>;
  circuits: Record<PowerLane, CircuitState>;
  engineers: Record<EngineerSeatId, EngineerState>;
  overdrive: OverdriveState;
  teamSync: number;
  teamCapacitor: number;
  link: LinkState | null;
  crisis: CrisisState | null;
  overchargeUntil: number;
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
    overdriveWindowMs: number;
    repairCooldownMs: number;
    repairAmount: number;
    repairSlots: number;
    powerLaneMax: number;
    pulseGain: number;
    pulseAmountSats: number;
    linkWindowMs: number;
    /** Damage bonus per extra system already in the LINK (gunner shots). */
    linkDamagePerRole: number;
    /** FIRE within this many ms after the charge completes = PERFECT SHOT. */
    perfectShotMs: number;
  };
}
