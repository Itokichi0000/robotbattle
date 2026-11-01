import type { ActionKind, EnemyKind, GameConfig, PresetId } from './config';
import type { SquadId } from './space';
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
  /** Lightning payments of this pilot that were applied. */
  lightning: number;
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
  /** The player's team (D-035): the action their phone screen is built around. */
  role: ActionKind;
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

export type ThreatTarget = { type: 'SQUAD'; squadId: SquadId } | { type: 'MECH'; part: MechPartId };

export type ThreatKind = 'BEAM' | 'DIVE' | 'CORE_LANCE';

/**
 * Something NULL CORE has announced. SQUAD strikes are blocked by the shield (守る); MECH
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
  /** SQUAD: shield needed to block. MECH: armour damage. */
  damage: number;
}

export interface SquadState {
  id: SquadId;
  hp: number;
  lost: boolean;
}

/**
 * A Lightning payer's bolt (D-035): granted when the payment is confirmed, thrown by the payer
 * on their phone (or for them when the window runs out). `pilotId` null = demo bot.
 */
export interface BoltState {
  id: string;
  pilotId: string | null;
  startedAt: number;
  expiresAt: number;
  virtual: boolean;
  bot: boolean;
}

export interface MatchStats {
  free: ActionCounts;
  /** Lightning (or VIRTUAL) payments applied, and how many were VIRTUAL. */
  lightning: number;
  virtual: number;
  /** Bolts thrown, and how many hit the weak point. */
  bolts: number;
  boltHits: number;
  /** Free actions made during THUNDER MODE. */
  feverActions: number;
  /** Players who swiped up for the group launch. */
  launched: number;
  damageToBoss: number;
  strikesBlocked: number;
  strikesHit: number;
  mechHits: number;
  repaired: number;
  /** Most players counted at once. */
  peakPlayers: number;
}

export type MatchOutcome = 'VICTORY' | 'DEFEAT';
export type DefeatReason = 'MECH_DESTROYED' | 'SQUADS_LOST' | 'TIME_UP' | 'ABORTED';

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
  pendingFree: Record<ActionKind, { n: number; value: number; fever: number }>;
  lastFlushAt: number;
  players: Record<string, PlayerState>;
  /** Players counted when the battle began; sizes the boss and its attacks. */
  playersAtLaunch: number;
  mechHp: number;
  shield: number;
  enemies: EnemyState[];
  threats: ThreatState[];
  squads: Record<SquadId, SquadState>;
  nextStrikeAt: number;
  nextClawAt: number;
  /** Pilots who swiped up during the countdown/launch (D-035). */
  launched: string[];
  /** THUNDER MODE runs until this match time (0 = never). */
  feverUntil: number;
  bolts: BoltState[];
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
  squads: Record<SquadId, SquadState>;
  /** People per team right now (players counted, bots included). */
  teams: Record<ActionKind, number>;
  /** Group launch: how many of the players have swiped up. */
  launched: number;
  feverUntil: number;
  /** Bolts waiting to be thrown (ids are payment intent ids; never who paid). */
  bolts: Array<{ id: string; startedAt: number; expiresAt: number }>;
  stats: MatchStats;
  result: MatchResult | null;
  /** The numbers phones and the big screen need to explain the game. */
  hints: {
    free: Record<ActionKind, number>;
    /** Short-handed teams' taps count for more (×1–×2); multiply `free` by it. */
    teamScale: Record<ActionKind, number>;
    feverMs: number;
    feverMultiplier: number;
    /** The payer's bolt now (before the weak-point bonus) and the bonus. */
    bolt: number;
    boltHitMultiplier: number;
    boltRadius: number;
    launchShield: number;
    freeCooldownMs: number;
    /** Shield lost per second; a strike needs this much headroom until impact. */
    shieldDecayPerSec: number;
    paidAmountSats: number;
    paidPerPilot: number;
    squadsLostForDefeat: number;
    battleMs: number;
  };
}
