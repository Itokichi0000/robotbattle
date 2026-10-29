import type { GameConfig } from './config';
import type { RegionId } from './regions';

/**
 * One raid of SATS WARS: EARTH DEFENSE: an 8-minute co-op fight in which every
 * pilot sits in one of four cockpit seats of RAIJIN or FUJIN. There are no
 * sides: everyone defends the 8 cities against the Corruptors and NULL CORE.
 *
 * Spec state names (§F3) map as: CREATED, LOBBY_OPEN, LIVE(+phase =
 * INTRO_TRAINING..FINAL_WAVE), ENDED(+phase = SUCCEEDED/FAILED → shown as
 * RESULTS for resultsSeconds, then archived by the server), PAUSED, CANCELLED.
 * BOARDING is per pilot (the phone plays it when a pilot boards).
 */
export const RAID_STATUSES = [
  'CREATED',
  'LOBBY_OPEN',
  'LIVE',
  'PAUSED',
  'ENDED',
  'CANCELLED',
] as const;
export type RaidStatus = (typeof RAID_STATUSES)[number];

export const RAID_PHASES = [
  'LOBBY',
  'INTRO_TRAINING',
  'WAVE_1',
  'WAVE_2',
  'WAVE_3',
  'FINAL_WAVE',
  'SUCCEEDED',
  'FAILED',
] as const;
export type RaidPhase = (typeof RAID_PHASES)[number];
export const COMBAT_PHASES = [
  'INTRO_TRAINING',
  'WAVE_1',
  'WAVE_2',
  'WAVE_3',
  'FINAL_WAVE',
] as const;
export type CombatPhase = (typeof COMBAT_PHASES)[number];

export const ROLES = ['GUNNER', 'GUARDIAN', 'ROUTER', 'ENGINEER'] as const;
export type Role = (typeof ROLES)[number];

export const ROBOTS = ['RAIJIN', 'FUJIN'] as const;
export type RobotId = (typeof ROBOTS)[number];

export const WEAKPOINTS = ['CORE', 'ARM', 'LEG'] as const;
export type Weakpoint = (typeof WEAKPOINTS)[number];

export const ENEMY_KINDS = ['SCOUT', 'SIEGE', 'SABOTEUR', 'BOSS'] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

export const ATTACK_KINDS = ['BEAM', 'BOMBARD', 'JAM', 'CORE_BEAM', 'SWEEP', 'NULL_BEAM'] as const;
export type AttackKind = (typeof ATTACK_KINDS)[number];

/** Where a threat comes from, for the GUARDIAN minigame (pick the right shield). */
export const DIRECTIONS = ['LEFT', 'UP', 'RIGHT'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const ENERGY_SINKS = ['RAIJIN', 'FUJIN', 'RESERVE'] as const;
export type EnergySink = (typeof ENERGY_SINKS)[number];

export interface CityState {
  cityId: RegionId;
  hp: number;
  /** Absorbs damage from the next attacks on this city (consumed as used). */
  shield: number;
  destroyed: boolean;
  /** Game ms before which an ENGINEER cannot rebuild this city again. */
  rebuildReadyAt: number;
}

export interface RobotState {
  robotId: RobotId;
  /** 0..100: scales the robot's seat effects (0.6 at 0 HP, 1.0 at full). */
  health: number;
  /** 0..100: boosts GUNNER damage (RAIJIN) / GUARDIAN shields (FUJIN); spent on use. */
  energy: number;
  /** Raijin's thunder drum / Fujin's wind ring is damaged (effects ×damagedComponentFactor). */
  componentDamaged: boolean;
}

export type EnemyAiState = 'IDLE' | 'TELEGRAPH' | 'RECOVERY';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  hp: number;
  hpMax: number;
  ai: EnemyAiState;
  /** Game ms when the current AI state ends. */
  aiUntil: number;
  /** 0..armWeakenMax: attack reduction from ARM hits. */
  weaken: number;
  /** Recent targets, to avoid hammering one city forever. */
  lastTargets: RegionId[];
  /** Hits per weak point (boss part damage visuals). */
  partHits: Record<Weakpoint, number>;
  attacks: number;
  /** Training enemies only scratch (INTRO_TRAINING). */
  training: boolean;
}

export interface Telegraph {
  id: number;
  enemyId: number;
  kind: AttackKind;
  targets: RegionId[];
  direction: Direction;
  startsAt: number;
  resolvesAt: number;
  /** Damage per target city before shields and ARM weakening. */
  damage: number;
  /** A LEG hit already delayed this attack. */
  delayed: boolean;
}

export interface SyncWindowState {
  index: number;
  /** Role -> pilot who first succeeded in it during this window. */
  roles: Partial<Record<Role, string>>;
  /** Pilots already counted in this window (one pilot counts for one role only). */
  pilots: string[];
}

export type SpecialStatus = 'LOCKED' | 'OPEN' | 'ACTIVATED' | 'FALLBACK' | 'FAILED';

export interface SpecialState {
  status: SpecialStatus;
  opensAt: number;
  closesAt: number;
  /** Required role -> distinct pilot who completed it inside the window ('AI' = assist). */
  contributors: Partial<Record<Role, string>>;
  resolvedAt: number | null;
}

export interface PilotStats {
  tasks: number;
  successes: number;
  /** Sum of success degrees (0..1), for accuracy/MVP normalisation. */
  successSum: number;
  expired: number;
  damage: number;
  shielded: number;
  energy: number;
  repairs: number;
  syncPoints: number;
}

export interface Pilot {
  pilotId: string;
  callsign: string;
  role: Role;
  robot: RobotId;
  isBot: boolean;
  joinedAt: number;
  lastActiveAt: number;
  /** Last success per role (game ms), for per-role crowd normalisation. */
  lastSuccessAt: Partial<Record<Role, number>>;
  roleChangedAt: number;
  cooldownUntil: number;
  task: Task | null;
  stats: PilotStats;
}

// ---- tasks (minigames) --------------------------------------------------------

export type RepairTarget =
  { type: 'ROBOT'; robot: RobotId } | { type: 'CITY'; cityId: RegionId } | { type: 'UNJAM' };

export type TaskTarget =
  | { kind: 'ENEMY'; enemyId: number; weakpoint: Weakpoint }
  /** GUNNER with no enemy on the field: charge Raijin's thunder drums (D-053). */
  | { kind: 'CHARGE' }
  | { kind: 'TELEGRAPH'; telegraphId: number; cityId: RegionId }
  | { kind: 'CITY_STANDBY'; cityId: RegionId }
  | { kind: 'ENERGY'; sink: EnergySink }
  | { kind: 'REPAIR'; repair: RepairTarget };

export interface RouterNode {
  id: number;
  x: number;
  y: number;
  kind: 'SOURCE' | 'RELAY' | 'BLOCKED' | 'SINK';
  sink?: EnergySink;
}

export type TaskParams =
  | {
      role: 'GUNNER';
      /** Moving reticle: x(t) = triangle(t / periodMs + phase), 0..1. */
      periodMs: number;
      phase: number;
      ringCenter: number;
      ringWidth: number;
    }
  | {
      role: 'GUARDIAN';
      /** The shield direction that blocks this threat (shown with the threat). */
      direction: Direction;
      /** Charge gauge g(t) = (t / periodMs) mod 1; release inside [greenFrom, greenTo]. */
      periodMs: number;
      greenFrom: number;
      greenTo: number;
    }
  | { role: 'ROUTER'; nodes: RouterNode[]; edges: Array<[number, number]>; maxHops: number }
  | { role: 'ENGINEER'; switchCount: number; order: number[] };

export type TaskInput =
  | { role: 'GUNNER'; stopAtMs: number }
  | { role: 'GUARDIAN'; direction: Direction; releaseAtMs: number }
  | { role: 'ROUTER'; path: number[] }
  | { role: 'ENGINEER'; sequence: number[] };

export type TaskDifficulty = 'EASY' | 'NORMAL';

export interface Task {
  taskId: string;
  role: Role;
  robot: RobotId;
  target: TaskTarget;
  params: TaskParams;
  difficulty: TaskDifficulty;
  createdAt: number;
  /** Last game ms at which a submission is accepted (duration + grace). */
  deadline: number;
}

export const TASK_ERROR_CODES = [
  'NOT_LIVE',
  'PAUSED',
  'NOT_BOARDED',
  'COOLDOWN',
  'ROLE_COOLDOWN',
  'TASK_OPEN',
  'NO_TASK',
  'TASK_MISMATCH',
  'EXPIRED',
  'INVALID_INPUT',
  'NO_TARGET',
] as const;
export type TaskErrorCode = (typeof TASK_ERROR_CODES)[number];

export type TaskEffect =
  | {
      kind: 'DAMAGE';
      enemyId: number;
      enemyKind: EnemyKind;
      weakpoint: Weakpoint;
      amount: number;
      defeated: boolean;
      /** BARRIER: the boss's core barrier held (before FINAL_WAVE it cannot fall below its floor). */
      note: 'WEAKEN' | 'DELAY' | 'BARRIER' | null;
    }
  | { kind: 'SHIELD'; cityId: RegionId; amount: number }
  | { kind: 'ENERGY'; sink: EnergySink; amount: number }
  | { kind: 'REPAIR'; repair: RepairTarget; amount: number };

export interface TaskResult {
  ok: boolean;
  code: 'OK' | TaskErrorCode;
  taskId: string | null;
  role: Role | null;
  /** 0..1 success degree computed by the server from the input. */
  success: number;
  effect: TaskEffect | null;
  syncGain: number;
  cooldownUntil: number;
  atGameMs: number;
}

// ---- results ------------------------------------------------------------------

export interface RaidStats {
  tasks: number;
  successes: number;
  enemiesDefeated: number;
  cityDamageTaken: number;
  shieldAbsorbed: number;
  energyRouted: number;
  repairs: number;
  syncSum: number;
  syncSamples: number;
  syncPeak: number;
  assistActions: number;
  /** Highest number of distinct active pilots seen. */
  peakPilots: number;
}

export type RaidOutcome = 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type RaidEndReason = 'BOSS_DEFEATED' | 'TIMEOUT' | 'CITIES_LOST' | 'ADMIN_END' | 'CANCELLED';

export interface MvpEntry {
  pilotId: string;
  callsign: string;
  value: number;
}

export interface ScoreBreakdown {
  /** Surviving city HP share × 400. */
  citySurvival: number;
  /** Time left at boss defeat × 200 (0 when failed). */
  speed: number;
  /** Average SYNC × 200. */
  coordination: number;
  /** 200 if NULL CORE fell with enough cities standing. */
  bossDefeat: number;
  total: number;
}

export interface RaidResult {
  outcome: RaidOutcome;
  reason: RaidEndReason;
  endedAtGameMs: number;
  /** Game ms of the boss kill (success only). */
  clearTimeMs: number | null;
  survivingCities: number;
  cityHpTotal: number;
  syncAverage: number;
  syncPeak: number;
  special: SpecialStatus;
  score: ScoreBreakdown;
  /** Role MVPs (+ SYNC = best cooperation) among human pilots. */
  mvps: Partial<Record<Role | 'SYNC', MvpEntry>>;
  pilots: number;
  bots: number;
  /** The assist AI helped (results are compared only with other assisted raids). */
  assisted: boolean;
  configHash: string;
  stats: RaidStats;
}

export interface RaidState {
  raidId: string;
  config: GameConfig;
  configHash: string;
  seed: number;
  /** Deterministic RNG state, part of the state so replays match exactly. */
  rng: number;
  status: RaidStatus;
  phase: RaidPhase;
  pausedFrom: RaidStatus | null;
  pauseReason: string | null;
  /** Pause-corrected server clock (ms). Never decreases. */
  clockMs: number;
  liveStartClock: number | null;
  /** Raid game time (ms since START, frozen while paused). */
  gameMs: number;
  cities: Record<RegionId, CityState>;
  robots: Record<RobotId, RobotState>;
  /** Shared final-battle energy 0..100 (ROUTER → RESERVE). */
  reserveEnergy: number;
  /** SABOTEUR jam: ROUTER tasks are harder and route half the energy until this game ms. */
  jammedUntil: number;
  enemies: Enemy[];
  telegraphs: Telegraph[];
  bossId: number | null;
  nextId: number;
  /** Index into the spawn schedule. */
  spawnIndex: number;
  sync: number;
  syncWindow: SyncWindowState;
  nextDecayAt: number;
  nextAssistAt: number;
  special: SpecialState;
  pilots: Record<string, Pilot>;
  /** Recent minigame outcomes [gameMs, success] for adaptive difficulty (pruned to its window). */
  recentSuccess: Array<[number, number]>;
  stats: RaidStats;
  result: RaidResult | null;
  seq: number;
  revision: number;
}
