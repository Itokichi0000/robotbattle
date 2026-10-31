import type { ActionKind, EnemyKind, GameConfig, PresetId } from './config';
import type { CityId } from './japan';
import type { Phase } from './phases';
import type { Direction, MechPartId } from './seats';

/**
 * Engine-internal match state (D-033 crowd raid). Authoritative and server-only: it carries
 * pilot ids and the RNG. Clients only ever see PublicMatchState (toPublicState).
 */

export interface ActionCounts {
  ATTACK: number;
  DEFEND: number;
  REPAIR: number;
}

export interface PlayerStats {
  free: ActionCounts;
  paid: ActionCounts;
  damage: number;
}

export interface PlayerState {
  pilotId: string;
  /** Public name: PILOT-XXXX unless the pilot chose a callsign. */
  displayName: string;
  /** Operator demo bot (clearly labelled). */
  bot: boolean;
  connected: boolean;
  /** Match clock when the player dropped; still counted for `playerHoldMs`. */
  disconnectedAt: number | null;
  joinedAt: number;
  /** Next free action is accepted from this match time. */
  freeReadyAt: number;
  stats: PlayerStats;
}

/** The boss hangs in front of RAIJIN on a slow orbit; position is a pure function of time. */
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
  /** Kept for the 3D scene's weak-point glow; set briefly after a Lightning attack. */
  weakUntil: number;
}

export type ThreatTarget = { type: 'CITY'; cityId: CityId } | { type: 'MECH'; part: MechPartId };

export type ThreatKind = 'BEAM' | 'DIVE' | 'CORE_LANCE';

/**
 * Something NULL CORE has announced. CITY strikes are blocked by the shield (守る); MECH
 * claws always land and are fixed afterwards (直す).
 */
export interface ThreatState {
  id: string;
  sourceId: string;
  kind: ThreatKind;
  dir: Direction;
  target: ThreatTarget;
  warnAt: number;
  impactAt: number;
  /** CITY: shield needed to block. MECH: armour damage. */
  damage: number;
}

export interface CityState {
  id: CityId;
  hp: number;
  lost: boolean;
}

export interface MatchStats {
  free: ActionCounts;
  paid: ActionCounts;
  /** Lightning (or VIRTUAL) actions applied, and how many were VIRTUAL. */
  lightning: number;
  virtual: number;
  damageToBoss: number;
  strikesBlocked: number;
  strikesHit: number;
  mechHits: number;
  repaired: number;
  /** Most players counted at once. */
  peakPlayers: number;
}

export type MatchOutcome = 'VICTORY' | 'DEFEAT';
export type DefeatReason = 'MECH_DESTROYED' | 'CITIES_LOST' | 'TIME_UP' | 'ABORTED';

export interface MatchResult {
  outcome: MatchOutcome;
  reason: 'BOSS_DESTROYED' | DefeatReason;
  at: number;
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
  simT: number;
  version: number;
  eventSeq: number;
  nextId: number;
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  paused: boolean;
  /** Lobby: match time the sortie starts by itself (null = waiting for the first player). */
  autoStartAt: number | null;
  autoStartEnabled: boolean;
  /** Free taps since the last flush, sent to screens as one event per action (crowd-proof). */
  pendingFree: Record<ActionKind, { n: number; value: number }>;
  lastFlushAt: number;
  players: Record<string, PlayerState>;
  /** Players counted when the battle began; sizes the boss and its attacks. */
  playersAtLaunch: number;
  mechHp: number;
  shield: number;
  enemies: EnemyState[];
  threats: ThreatState[];
  cities: Record<CityId, CityState>;
  nextStrikeAt: number;
  nextClawAt: number;
  /** Lightning actions already applied, by payment intent id (never twice). */
  paidApplied: string[];
  stats: MatchStats;
  result: MatchResult | null;
  /** Idempotency: last results by clientActionId (bounded). */
  actionLog: Record<string, ActionRecord>;
  actionLogOrder: string[];
}

/* ------------------------------------------------------------------ public */

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
  paused: boolean;
  autoStartAt: number | null;
  /** Players counted right now (people + labelled demo bots). */
  players: number;
  humans: number;
  bots: number;
  playersAtLaunch: number;
  mechHp: number;
  mechMax: number;
  shield: number;
  shieldMax: number;
  boss: { id: string; hp: number; maxHp: number } | null;
  enemies: PublicEnemy[];
  threats: ThreatState[];
  cities: Record<CityId, CityState>;
  stats: MatchStats;
  result: MatchResult | null;
  /** The numbers phones and the big screen need to explain the game. */
  hints: {
    free: Record<ActionKind, number>;
    paid: Record<ActionKind, number>;
    freeCooldownMs: number;
    /** Shield lost per second; a strike needs this much headroom until impact. */
    shieldDecayPerSec: number;
    paidAmountSats: number;
    paidPerPilot: number;
    citiesLostForDefeat: number;
    battleMs: number;
  };
}
