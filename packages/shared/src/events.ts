import type { RegionId } from './regions';
import type {
  ActionOkCode,
  ActionType,
  ClashRecord,
  MatchResult,
  MatchStatus,
  RegionState,
  TeamState,
} from './state';
import type { TeamId } from './teams';

/**
 * Post-state included with every event so clients can apply events without
 * re-implementing rules. Applying a patch is idempotent.
 */
export interface EventPatch {
  regions?: RegionState[];
  teams?: TeamState[];
  status?: MatchStatus;
  pausedFrom?: MatchStatus | null;
  liveStartClock?: number | null;
  result?: MatchResult | null;
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
  | EventBase<
      'PARTICIPANT_JOINED',
      { participantId: string; teamId: TeamId; nickname: string; isBot: boolean }
    >
  | EventBase<
      'ACTION_APPLIED',
      {
        participantId: string;
        nickname: string;
        teamId: TeamId;
        actionType: ActionType;
        regionId: RegionId | null;
        code: ActionOkCode;
      }
    >
  | EventBase<'CONTEST_EXPIRED', { regionId: RegionId; ownerTeamId: TeamId | null }>
  | EventBase<'SHIELD_EXPIRED', { regionId: RegionId }>
  | EventBase<'CLASH_RESOLVED', { clash: ClashRecord }>
  | EventBase<'MATCH_RESULT', { result: MatchResult }>;

export type GameEventType = GameEvent['type'];
