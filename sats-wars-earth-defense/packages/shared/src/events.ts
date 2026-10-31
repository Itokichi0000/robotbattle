import type { ActionKind } from './config';
import type { CityId } from './japan';
import type { Phase } from './phases';
import type { Direction } from './seats';
import type { MatchOutcome, MatchResult } from './state';

/**
 * Confirmed match events. The big screen keys its VFX and sound off these; they are facts
 * the server already applied, never requests.
 */
export type MatchEventBody =
  | { type: 'phase_changed'; from: Phase; to: Phase; endsAt: number | null }
  | { type: 'match_paused' }
  | { type: 'match_resumed' }
  | { type: 'player_joined'; players: number; bot: boolean }
  | { type: 'player_left'; players: number }
  | { type: 'boss_spawned'; enemyId: string; hp: number }
  | {
      type: 'action';
      kind: ActionKind;
      /** Lightning (21 sats) action: the big version. */
      paid: boolean;
      /** Sandbox / demo: no real money moved. */
      virtual: boolean;
      /** Demo bot (labelled on screen). */
      bot: boolean;
      /** HP dealt, shield added, or armour restored (summed over `count` free taps). */
      value: number;
      /** Free taps are sent to screens in batches; a Lightning action is always 1. */
      count: number;
      /** Invoice issued → confirmed by the server (ms). Null for free and VIRTUAL actions. */
      settleMs: number | null;
    }
  | {
      type: 'threat_warning';
      threatId: string;
      sourceId: string;
      target: 'CITY' | 'MECH';
      cityId: CityId | null;
      dir: Direction;
      impactAt: number;
      /** CITY: shield needed. MECH: armour damage. */
      amount: number;
    }
  | { type: 'strike_blocked'; threatId: string; cityId: CityId; dir: Direction; need: number }
  | { type: 'strike_hit'; threatId: string; cityId: CityId; dir: Direction }
  | { type: 'mech_hit'; threatId: string; damage: number; hp: number }
  | { type: 'boss_destroyed'; enemyId: string }
  | { type: 'match_result'; outcome: MatchOutcome; result: MatchResult };

export type MatchEventType = MatchEventBody['type'];

export type MatchEvent = MatchEventBody & { seq: number; t: number };
