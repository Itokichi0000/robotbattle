import type {
  Finisher,
  MatchStatus,
  Phase,
  RegionPaint,
  RoundState,
  RoundSummary,
  SeasonResult,
  TeamState,
  ZapOkCode,
} from './state';
import type { TeamId } from './teams';

/**
 * Post-state included with every event so clients can apply events without
 * re-implementing rules. Applying a patch is idempotent.
 */
export interface EventPatch {
  status?: MatchStatus;
  pausedFrom?: MatchStatus | null;
  liveStartClock?: number | null;
  phase?: Phase;
  phaseEndsAt?: number | null;
  roundIndex?: number;
  round?: RoundState | null;
  regions?: RegionPaint[];
  teams?: TeamState[];
  result?: SeasonResult | null;
}

interface EventBase<T extends string, D> {
  matchId: string;
  seq: number;
  /** Match clock (ms) when the event happened. */
  t: number;
  gameMs: number;
  type: T;
  data: D;
  patch: EventPatch;
}

export type GameEvent =
  | EventBase<'MATCH_STATUS_CHANGED', { from: MatchStatus; to: MatchStatus; reason: string | null }>
  | EventBase<'ROUND_STARTED', { round: RoundState }>
  | EventBase<
      'ZAP',
      {
        participantId: string;
        nickname: string;
        teamId: TeamId;
        code: ZapOkCode;
        damage: number;
        special: boolean;
        pinch: boolean;
        hp: Record<TeamId, number>;
      }
    >
  | EventBase<'ROUND_ENDED', { summary: RoundSummary; finisher: Finisher | null }>
  | EventBase<'SEASON_ENDED', { result: SeasonResult }>;

export type GameEventType = GameEvent['type'];
