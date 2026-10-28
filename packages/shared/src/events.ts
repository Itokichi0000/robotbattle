import type {
  CampaignResult,
  CampaignStats,
  Enemy,
  Landing,
  MatchStatus,
  RegionState,
  ResolvedAction,
} from './state';
import type { RegionId } from './regions';

/**
 * Post-state included with events so clients never re-implement rules.
 * Board-changing events carry the whole (small) board; applying is idempotent.
 */
export interface EventPatch {
  status?: MatchStatus;
  pausedFrom?: MatchStatus | null;
  liveStartClock?: number | null;
  wave?: number;
  waveRemaining?: number;
  actionsThisTurn?: number;
  combo?: number;
  regions?: RegionState[];
  enemies?: Enemy[];
  incoming?: Landing[];
  stats?: CampaignStats;
  result?: CampaignResult | null;
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

export interface AlienAttack {
  regionId: RegionId;
  damage: number;
  /** Part of the damage stopped by a barrier. */
  absorbed: number;
  cityHpAfter: number;
  fell: boolean;
}

export type GameEvent =
  | EventBase<'MATCH_STATUS_CHANGED', { from: MatchStatus; to: MatchStatus; reason: string | null }>
  | EventBase<
      'PLAYER_ACTION',
      {
        participantId: string;
        nickname: string;
        action: ResolvedAction;
        /** Chosen by the "おすすめ" button. */
        auto: boolean;
        regionId: RegionId;
        targetIds: number[];
        damage: number;
        kills: number;
        liberated: boolean;
      }
    >
  | EventBase<'ALIEN_TURN', { turn: number; attacks: AlienAttack[]; landed: Enemy[]; fell: RegionId[] }>
  | EventBase<'WAVE_STARTED', { wave: number; aliens: number; boss: boolean }>
  /** Landing outside an alien turn: the map was empty, so the next aliens arrive at once. */
  | EventBase<'ALIENS_LANDED', { landed: Enemy[] }>
  | EventBase<'WAVE_CLEARED', { wave: number }>
  | EventBase<'JAPAN_FALLEN', { result: CampaignResult }>;

export type GameEventType = GameEvent['type'];
