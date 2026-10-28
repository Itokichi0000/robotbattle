import type { GameConfig } from './config';
import type { RegionId } from './regions';

/**
 * A "match" is one campaign of EARTH DEFENSE: everyone on the same side
 * (RAIJIN and FUJIN fight together) against alien waves, until Japan falls.
 */
export const MATCH_STATUSES = ['CREATED', 'LIVE', 'FINISHED', 'PAUSED', 'CANCELLED'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const ENEMY_KINDS = ['SCOUT', 'WALKER', 'MOTHERSHIP'] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

export interface Enemy {
  id: number;
  kind: EnemyKind;
  regionId: RegionId;
  hp: number;
  hpMax: number;
  /** Damage dealt to its region's city at every alien turn. */
  attack: number;
}

export interface RegionState {
  regionId: RegionId;
  cityHp: number;
  /** Captured by aliens (city at 0). Kill every alien there to liberate it. */
  fallen: boolean;
  /** Barrier points that absorb damage at the next alien turn (then vanish). */
  shield: number;
}

/** A landing announced in advance: it happens at the next alien turn. */
export interface Landing {
  kind: EnemyKind;
  regionId: RegionId;
  /** Spreading out of an already captured neighbour. */
  spread: boolean;
}

export interface CampaignStats {
  actions: number;
  kills: number;
  alienTurns: number;
  regionsLost: number;
  regionsLiberated: number;
  combos: number;
}

export interface CampaignResult {
  reason: 'JAPAN_FALLEN' | 'CANCELLED';
  /** Last wave that was fully cleared (0 if none). */
  wavesCleared: number;
  reachedWave: number;
  stats: CampaignStats;
  endedAtGameMs: number;
}

export interface MatchState {
  matchId: string;
  config: GameConfig;
  seed: number;
  /** Deterministic RNG state (landings), part of the state so replay matches. */
  rng: number;
  status: MatchStatus;
  pausedFrom: MatchStatus | null;
  pauseReason: string | null;
  /** Pause-corrected match clock (ms). Never decreases. */
  clockMs: number;
  liveStartClock: number | null;
  gameMs: number;
  wave: number;
  /** Aliens of the current wave not yet landed (announced ones excluded). */
  waveRemaining: number;
  /** Player actions since the last alien turn. */
  actionsThisTurn: number;
  combo: number;
  regions: Record<RegionId, RegionState>;
  enemies: Enemy[];
  incoming: Landing[];
  nextEnemyId: number;
  stats: CampaignStats;
  result: CampaignResult | null;
  seq: number;
  revision: number;
}

export const PLAYER_ACTIONS = ['RAIJIN', 'FUJIN', 'SHIELD', 'COMBO', 'AUTO'] as const;
export type PlayerAction = (typeof PLAYER_ACTIONS)[number];
/** What actually happened (AUTO resolves to one of these). */
export type ResolvedAction = Exclude<PlayerAction, 'AUTO'>;

export const ACTION_ERROR_CODES = [
  'NOT_LIVE',
  'PAUSED',
  'NO_TARGET',
  'REGION_FALLEN',
  'ALREADY_SHIELDED',
  'COMBO_NOT_READY',
] as const;
export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number];

export interface ActionResult {
  ok: boolean;
  code: 'OK' | ActionErrorCode;
  action: ResolvedAction | null;
  regionId: RegionId | null;
  damage: number;
  kills: number;
  liberated: boolean;
  /** This action completed the turn and the aliens moved. */
  triggeredAlienTurn: boolean;
  atGameMs: number;
  eventSeq?: number;
}
