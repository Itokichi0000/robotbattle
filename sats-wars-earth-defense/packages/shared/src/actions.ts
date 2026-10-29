import type { Direction, SeatId } from './seats';

/**
 * Pilot intents. Clients send raw intent only; the engine decides success and effect.
 * Phase 1 ships the gunner and shield actions; power and engineer actions arrive in Phase 2.
 */
export type PilotActionInput =
  | { actionType: 'LOCK'; payload: { targetId?: string } }
  | { actionType: 'FIRE'; payload: Record<string, never> }
  | { actionType: 'DEPLOY_SHIELD'; payload: { dir: Direction } };

export type PilotActionType = PilotActionInput['actionType'];

export const REASON_CODES = [
  'NOT_AUTHENTICATED',
  'INVALID',
  'RATE_LIMITED',
  'STALE_MATCH',
  'UNKNOWN_SEAT',
  'SEAT_TAKEN',
  'SEAT_NOT_OPEN',
  'ALREADY_SEATED',
  'SEAT_LOCKED',
  'NOT_YOUR_SEAT',
  'WRONG_ROLE',
  'NOT_IN_COMBAT',
  'PAUSED',
  'NO_TARGET',
  'TARGET_LOST',
  'TARGET_ARRIVING',
  'CHARGING',
  'COOLDOWN',
  'NO_ENERGY',
  'WEAPON_BROKEN',
  'BAD_DIRECTION',
  'ROUND_CLOSED',
  /** Client-side only: no answer from the server in time. */
  'NETWORK',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** Human wording for every refusal (spec §9.2). Japanese first, English second. */
export const REASON_TEXT: Record<ReasonCode, { ja: string; en: string }> = {
  NOT_AUTHENTICATED: { ja: 'パイロット認証が必要です', en: 'Pilot sign-in required' },
  INVALID: { ja: '操作を読み取れませんでした', en: 'Could not read that input' },
  RATE_LIMITED: { ja: '操作が速すぎます。少し待って', en: 'Too fast. Wait a moment' },
  STALE_MATCH: { ja: 'この作戦は終了しました', en: 'That round is over' },
  UNKNOWN_SEAT: { ja: 'その席はありません', en: 'No such seat' },
  SEAT_TAKEN: { ja: 'その席は他のパイロットが搭乗中', en: 'Another pilot has that seat' },
  SEAT_NOT_OPEN: { ja: 'この席はAUTO SUPPORTが担当中', en: 'AUTO SUPPORT flies this seat' },
  ALREADY_SEATED: { ja: '既に別の席に搭乗しています', en: 'You already have a seat' },
  SEAT_LOCKED: { ja: '戦闘中は席替えできません', en: 'No seat changes during combat' },
  NOT_YOUR_SEAT: { ja: 'あなたの席ではありません', en: 'Not your seat' },
  WRONG_ROLE: { ja: 'この席ではできない操作です', en: 'This seat cannot do that' },
  NOT_IN_COMBAT: { ja: '今は戦闘中ではありません', en: 'Not in combat' },
  PAUSED: { ja: '作戦一時停止中', en: 'Operation paused' },
  NO_TARGET: { ja: '狙える敵がいません', en: 'No target' },
  TARGET_LOST: { ja: '目標を見失いました。再ロック', en: 'Target lost. Lock again' },
  TARGET_ARRIVING: { ja: '敵が接近中。まだ狙えません', en: 'Target still inbound' },
  CHARGING: { ja: 'チャージ中', en: 'Charging' },
  COOLDOWN: { ja: '冷却中', en: 'Cooling down' },
  NO_ENERGY: { ja: 'エネルギー不足', en: 'Not enough energy' },
  WEAPON_BROKEN: { ja: '主砲が故障。整備を待て', en: 'Gun is down. Needs repair' },
  BAD_DIRECTION: { ja: 'その方向はあなたの担当外', en: 'Not your sector' },
  ROUND_CLOSED: { ja: '作戦は終了しています', en: 'The round has ended' },
  NETWORK: { ja: '通信待ち。もう一度押してください', en: 'No answer. Tap again' },
};

export interface ActionResult {
  clientActionId: string;
  accepted: boolean;
  reasonCode?: ReasonCode;
  resultingStateVersion?: number;
}

export type SeatRequestResult =
  { ok: true; seatId: SeatId | null } | { ok: false; reasonCode: ReasonCode };
