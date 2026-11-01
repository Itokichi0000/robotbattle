import type { ActionKind } from './config';
import type { SquadId } from './space';
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
      /** HP dealt, shield added, or armour restored (summed over `count` free actions). */
      value: number;
      /** Free actions are sent to screens in batches. */
      count: number;
      /** Made during THUNDER MODE (worth ×feverMultiplier). */
      fever: boolean;
    }
  | { type: 'launch_push'; launched: number; players: number }
  | {
      type: 'lightning';
      boltId: string;
      /** Sandbox / demo: no real money moved. */
      virtual: boolean;
      /** Demo bot (labelled on screen). */
      bot: boolean;
      /** Invoice issued → confirmed by the server (ms). Null for VIRTUAL and bots. */
      settleMs: number | null;
      feverUntil: number;
    }
  | { type: 'bolt_thrown'; boltId: string; hit: boolean; damage: number; auto: boolean }
  | {
      type: 'threat_warning';
      threatId: string;
      sourceId: string;
      target: 'SQUAD' | 'MECH';
      squadId: SquadId | null;
      dir: Direction;
      impactAt: number;
      /** SQUAD: shield needed. MECH: armour damage. */
      amount: number;
    }
  | { type: 'strike_blocked'; threatId: string; squadId: SquadId; dir: Direction; need: number }
  | { type: 'strike_hit'; threatId: string; squadId: SquadId; dir: Direction }
  | { type: 'mech_hit'; threatId: string; damage: number; hp: number }
  | { type: 'boss_destroyed'; enemyId: string }
  | { type: 'match_result'; outcome: MatchOutcome; result: MatchResult };

export type MatchEventType = MatchEventBody['type'];

export type MatchEvent = MatchEventBody & { seq: number; t: number };
