import type { RegionId } from './regions';
import type {
  AttackKind,
  CityState,
  Enemy,
  EnemyKind,
  RaidPhase,
  RaidResult,
  RaidStats,
  RaidStatus,
  RobotId,
  RobotState,
  Role,
  SpecialState,
  TaskEffect,
  Telegraph,
} from './state';

/** Public crew summary (callsigns are moderated by the server before sending). */
export interface CrewMember {
  pilotId: string;
  callsign: string;
  role: Role;
  robot: RobotId;
  isBot: boolean;
}

/**
 * The whole public board after the event. It is small (8 cities, 2 robots,
 * a handful of enemies/telegraphs), so every event carries it and clients
 * never compute rules: they just take the server's post-state.
 */
export interface BoardPatch {
  status: RaidStatus;
  phase: RaidPhase;
  pausedFrom: RaidStatus | null;
  liveStartClock: number | null;
  cities: CityState[];
  robots: RobotState[];
  reserveEnergy: number;
  jammedUntil: number;
  enemies: Enemy[];
  telegraphs: Telegraph[];
  bossId: number | null;
  sync: number;
  special: SpecialState;
  stats: RaidStats;
  result: RaidResult | null;
  /** Only on crew changes (boarding, seat changes). */
  crew?: CrewMember[];
}

export interface CityHit {
  cityId: RegionId;
  damage: number;
  absorbed: number;
  hpAfter: number;
  destroyed: boolean;
}

interface Base<T extends string, D> {
  raidId: string;
  /** Raid-scoped, strictly increasing by 1. */
  seq: number;
  /** Server clock (pause-corrected) at which it happened. */
  t: number;
  gameMs: number;
  type: T;
  data: D;
  patch: BoardPatch;
}

export type GameEvent =
  | Base<'RAID_STATUS_CHANGED', { from: RaidStatus; to: RaidStatus; reason: string | null }>
  | Base<'PHASE_CHANGED', { from: RaidPhase; to: RaidPhase }>
  | Base<'PILOT_BOARDED', CrewMember>
  | Base<'PILOT_ROLE_CHANGED', CrewMember & { from: Role }>
  | Base<'ENEMY_SPAWNED', { enemy: Enemy }>
  | Base<'ENEMY_TELEGRAPH', { telegraph: Telegraph; enemyKind: EnemyKind }>
  | Base<
      'ATTACK_RESOLVED',
      {
        telegraphId: number;
        enemyId: number;
        enemyKind: EnemyKind;
        kind: AttackKind;
        hits: CityHit[];
        jammedUntil: number | null;
        energyDrained: number;
        robotHit: RobotId | null;
      }
    >
  | Base<
      'ENEMY_DEFEATED',
      { enemyId: number; kind: EnemyKind; pilotId: string | null; callsign: string | null }
    >
  | Base<
      'TASK_RESOLVED',
      {
        pilotId: string;
        callsign: string;
        role: Role;
        robot: RobotId;
        success: number;
        effect: TaskEffect | null;
        syncGain: number;
        /** Done by the assist AI (low player count), not a person. */
        assist: boolean;
      }
    >
  | Base<'SYNC_CHANGED', { sync: number; delta: number; reason: 'COOP' | 'DECAY' | 'SPECIAL' }>
  | Base<'CITY_DESTROYED', { cityId: RegionId }>
  | Base<'CITY_REBUILT', { cityId: RegionId; pilotId: string; callsign: string }>
  | Base<'SPECIAL_WINDOW_OPENED', { closesAt: number }>
  | Base<'SPECIAL_PROGRESS', { role: Role; pilotId: string; callsign: string }>
  | Base<
      'SPECIAL_RESOLVED',
      {
        outcome: 'ACTIVATED' | 'FALLBACK' | 'FAILED';
        damage: number;
        cityHits: CityHit[];
        contributors: string[];
      }
    >
  | Base<'RAID_ENDED', { result: RaidResult }>;

export type GameEventType = GameEvent['type'];
