import type { GameConfig } from './config';
import type { RegionId, RegionKind } from './regions';
import type { TeamId } from './teams';

export const MATCH_STATUSES = [
  'CREATED',
  'LOBBY',
  'LIVE',
  'FINALIZING',
  'FINISHED',
  'PAUSED',
  'CANCELLED',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const ACTION_TYPES = ['ATTACK', 'DEFEND', 'CHARGE'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface RegionState {
  regionId: RegionId;
  kind: RegionKind;
  ownerTeamId: TeamId | null;
  contestedByTeamId: TeamId | null;
  /** Game ms at which the contest window closes. */
  contestedUntil: number | null;
  shieldCharges: number;
  shieldExpiresAt: number | null;
  /** Game ms of the last change. */
  updatedAt: number;
  revision: number;
}

export interface TeamState {
  teamId: TeamId;
  robotId: 'raijin' | 'fujin';
  hp: number;
  energy: number;
  participantCount: number;
  /** Sum of remaining AP across active participants (for fairness display). */
  apRemaining: number;
  apTotal: number;
  actionCount: number;
}

export interface Contribution {
  captures: number;
  contests: number;
  /** Contest broken (recapture defense) via ATTACK or DEFEND. */
  breaks: number;
  shields: number;
  shieldBreaks: number;
  charges: number;
}

export interface ParticipantState {
  participantId: string;
  teamId: TeamId;
  nickname: string;
  isBot: boolean;
  apTotal: number;
  apRemaining: number;
  joinedAtGameMs: number;
  contribution: Contribution;
}

export interface ClashTeamSnapshot {
  teamId: TeamId;
  hpBefore: number;
  energyBefore: number;
  activeAttackRegions: number;
  activeDefenseRegions: number;
  activeEnergyRegions: number;
}

export interface ClashTeamOutcome {
  teamId: TeamId;
  /** Damage dealt BY this team to the opponent. */
  damageDealt: number;
  special: boolean;
  energyBonus: number;
  hpAfter: number;
  energyAfter: number;
}

export interface ClashRecord {
  clashIndex: number;
  atGameMs: number;
  snapshot: Record<TeamId, ClashTeamSnapshot>;
  outcome: Record<TeamId, ClashTeamOutcome>;
  ko: TeamId[];
  isFinal: boolean;
}

export type ResultReason = 'KO' | 'DOUBLE_KO' | 'TIME_HP' | 'TIME_REGIONS' | 'DRAW' | 'CANCELLED';

export interface MatchResult {
  winnerTeamId: TeamId | null;
  reason: ResultReason;
  decidedAtGameMs: number;
  finalHp: Record<TeamId, number>;
  regionCounts: Record<TeamId, number>;
  mvp: Record<TeamId, { participantId: string; nickname: string; score: number } | null>;
}

export interface MatchState {
  matchId: string;
  config: GameConfig;
  seed: number;
  status: MatchStatus;
  /** Status to return to on RESUME. */
  pausedFrom: MatchStatus | null;
  pauseReason: string | null;
  /** Pause-corrected match clock (ms since lobby opened). Never decreases. */
  clockMs: number;
  /** clockMs at which the lobby opened (0 normally). */
  lobbyOpenedAtClock: number | null;
  /** clockMs at which LIVE began (or is scheduled to begin, while in LOBBY). */
  liveStartClock: number | null;
  /** Game ms (0 at LIVE start). Negative/0 before LIVE. */
  gameMs: number;
  teams: Record<TeamId, TeamState>;
  regions: Record<RegionId, RegionState>;
  regionOrder: RegionId[];
  participants: Record<string, ParticipantState>;
  /** participantId:clientActionId -> cached result, for idempotent retries. */
  processedActions: Record<string, ActionResult>;
  nextClashIndex: number;
  clashes: ClashRecord[];
  finalizingStartGameMs: number | null;
  result: MatchResult | null;
  seq: number;
  revision: number;
}

export const ACTION_OK_CODES = [
  'CAPTURED',
  'SHIELD_BROKEN',
  'CONTEST_STARTED',
  'CONTEST_BROKEN',
  'SHIELD_PLACED',
  'CHARGED',
] as const;
export type ActionOkCode = (typeof ACTION_OK_CODES)[number];

export const ACTION_ERROR_CODES = [
  'MATCH_NOT_LIVE',
  'MATCH_PAUSED',
  'ACTIONS_CLOSED',
  'UNKNOWN_PARTICIPANT',
  'NO_AP',
  'INVALID_REGION',
  'REGION_REQUIRED',
  'OWN_REGION_NOT_CONTESTED',
  'NOT_OWN_REGION',
  'SHIELD_ALREADY_ACTIVE',
  'ENERGY_FULL',
] as const;
export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number];

export interface ActionResult {
  ok: boolean;
  code: ActionOkCode | ActionErrorCode;
  actionType: ActionType;
  regionId: RegionId | null;
  apBefore: number;
  apAfter: number;
  atGameMs: number;
  /** True when this is a cached replay of an earlier identical clientActionId. */
  duplicate?: boolean;
  /** Event seq produced by this action, when ok. */
  eventSeq?: number;
}
