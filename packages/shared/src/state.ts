import type { GameConfig } from './config';
import type { RegionId } from './regions';
import type { TeamId } from './teams';

/**
 * A "match" is one season: up to 8 short rounds, each fought over one region
 * of Japan. Status is the lifecycle; phase is where the show currently is.
 */
export const MATCH_STATUSES = ['CREATED', 'LIVE', 'FINISHED', 'PAUSED', 'CANCELLED'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const PHASES = ['OPENING', 'ROUND', 'ROUND_END', 'SEASON_END'] as const;
export type Phase = (typeof PHASES)[number];

export interface RegionPaint {
  regionId: RegionId;
  ownerTeamId: TeamId | null;
  /** Round in which the region was won (null while unclaimed or drawn). */
  roundIndex: number | null;
}

export interface TeamState {
  teamId: TeamId;
  robotId: 'raijin' | 'fujin';
  regionsWon: number;
  zapsTotal: number;
  specialsTotal: number;
  kos: number;
}

export interface Finisher {
  participantId: string;
  nickname: string;
  teamId: TeamId;
}

export type RoundEndReason = 'KO' | 'TIME' | 'DRAW';

export interface RoundState {
  index: number;
  regionId: RegionId;
  hpMax: number;
  hp: Record<TeamId, number>;
  /** Punches since the team's last special (special fires when it reaches specialEvery). */
  gauge: Record<TeamId, number>;
  zaps: Record<TeamId, number>;
  startedAt: number;
  endsAt: number;
  endedAt: number | null;
  winnerTeamId: TeamId | null;
  endReason: RoundEndReason | null;
  finisher: Finisher | null;
}

export interface RoundSummary {
  index: number;
  regionId: RegionId;
  hpMax: number;
  winnerTeamId: TeamId | null;
  endReason: RoundEndReason;
  durationMs: number;
  zaps: Record<TeamId, number>;
  finisher: Finisher | null;
}

export type SeasonResultReason = 'REGIONS' | 'DRAW' | 'CANCELLED';

export interface SeasonResult {
  winnerTeamId: TeamId | null;
  reason: SeasonResultReason;
  regionCounts: Record<TeamId, number>;
  decidedAtGameMs: number;
}

export interface MatchState {
  matchId: string;
  config: GameConfig;
  seed: number;
  status: MatchStatus;
  pausedFrom: MatchStatus | null;
  pauseReason: string | null;
  /** Pause-corrected match clock (ms). Never decreases. */
  clockMs: number;
  /** clockMs when the season started (LIVE). */
  liveStartClock: number | null;
  /** Game ms since the season started. */
  gameMs: number;
  phase: Phase;
  phaseEndsAt: number | null;
  roundOrder: RegionId[];
  roundIndex: number;
  round: RoundState | null;
  rounds: RoundSummary[];
  regions: Record<RegionId, RegionPaint>;
  teams: Record<TeamId, TeamState>;
  result: SeasonResult | null;
  seq: number;
  revision: number;
}

export const ZAP_OK_CODES = ['HIT', 'SPECIAL', 'KO'] as const;
export type ZapOkCode = (typeof ZAP_OK_CODES)[number];

export const ZAP_ERROR_CODES = ['NOT_LIVE', 'PAUSED', 'ROUND_NOT_ACTIVE'] as const;
export type ZapErrorCode = (typeof ZAP_ERROR_CODES)[number];

export interface ZapResult {
  ok: boolean;
  code: ZapOkCode | ZapErrorCode;
  teamId: TeamId;
  damage: number;
  special: boolean;
  pinch: boolean;
  atGameMs: number;
  roundIndex: number | null;
  eventSeq?: number;
}
