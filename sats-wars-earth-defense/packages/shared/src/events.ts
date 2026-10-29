import type { EnemyKind } from './config';
import type { CityId } from './japan';
import type { Phase } from './phases';
import type { Direction, MechPartId, RoleId, SeatId } from './seats';
import type { MatchOutcome, MatchResult, ThreatKind, ThreatTarget } from './state';

/**
 * Confirmed match events. The big screen keys its VFX and sound off these (spec §12.3);
 * they are facts the server already applied, never requests.
 */
export type MatchEventBody =
  | { type: 'phase_changed'; from: Phase; to: Phase; endsAt: number | null }
  | { type: 'match_paused' }
  | { type: 'match_resumed' }
  | { type: 'auto_support_changed'; enabled: boolean }
  | { type: 'seat_assigned'; seatId: SeatId; displayName: string }
  | { type: 'seat_released'; seatId: SeatId; reason: 'LEFT' | 'TIMEOUT' | 'KICKED' | 'ROUND_OVER' }
  | { type: 'seat_ready'; seatId: SeatId }
  | { type: 'seat_connection'; seatId: SeatId; connected: boolean }
  | { type: 'enemy_spawned'; enemyId: string; kind: EnemyKind }
  | { type: 'target_locked'; seatId: SeatId; enemyId: string; weakPoint: boolean }
  | { type: 'weapon_charged'; seatId: SeatId; enemyId: string }
  | {
      type: 'weapon_fired';
      seatId: SeatId;
      enemyId: string;
      damage: number;
      weak: boolean;
      auto: boolean;
      killed: boolean;
    }
  | { type: 'enemy_destroyed'; enemyId: string; kind: EnemyKind; bySeat: SeatId | null }
  | {
      type: 'threat_warning';
      threatId: string;
      sourceId: string;
      kind: ThreatKind;
      dir: Direction;
      target: ThreatTarget;
      impactAt: number;
    }
  | { type: 'shield_deployed'; seatId: SeatId; dir: Direction; until: number; auto: boolean }
  | {
      type: 'threat_blocked';
      threatId: string;
      seatId: SeatId;
      dir: Direction;
      perfect: boolean;
      ratio: number;
      auto: boolean;
    }
  | { type: 'threat_intercepted'; threatId: string; enemyId: string }
  | {
      type: 'incoming_hit';
      threatId: string;
      dir: Direction;
      target: ThreatTarget;
      damage: number;
    }
  | { type: 'city_damaged'; cityId: CityId; hp: number }
  | { type: 'city_lost'; cityId: CityId }
  | { type: 'part_damaged'; part: MechPartId; hp: number }
  | { type: 'part_repaired'; part: MechPartId; hp: number; seatId: SeatId; auto: boolean }
  | { type: 'team_combo'; roles: RoleId[]; gain: number; sync: number }
  | { type: 'match_result'; outcome: MatchOutcome; result: MatchResult };

export type MatchEventType = MatchEventBody['type'];

export type MatchEvent = MatchEventBody & { seq: number; t: number };
