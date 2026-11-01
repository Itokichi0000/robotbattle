import type { ActionKind } from './config';

/**
 * What a phone may send: which of the three actions it pressed. The server decides whether
 * it counts and how big it is.
 */
export interface PilotActionInput {
  kind: ActionKind;
}

/** The payer's throw: where they tapped on the square aiming field, and when (match time). */
export interface BoltThrowInput {
  boltId: string;
  x: number;
  y: number;
  at: number;
}

export const REASON_CODES = [
  'INVALID',
  'STALE_MATCH',
  'NOT_JOINED',
  'NOT_IN_COMBAT',
  'PAUSED',
  'COOLDOWN',
  'WRONG_TEAM',
  'NOT_LAUNCHING',
  'NO_BOLT',
  'RATE_LIMITED',
  'DUPLICATE',
  'NETWORK',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export const REASON_TEXT: Record<ReasonCode, { ja: string; en: string }> = {
  INVALID: { ja: 'その操作はできません', en: 'Not allowed' },
  STALE_MATCH: { ja: 'この作戦は終了しました', en: 'That round is over' },
  NOT_JOINED: { ja: '参加しなおしてください', en: 'Join again' },
  NOT_IN_COMBAT: { ja: '戦闘中だけ押せます', en: 'Only during the battle' },
  PAUSED: { ja: '一時停止中です', en: 'Paused' },
  COOLDOWN: { ja: '少し待って', en: 'Wait a moment' },
  WRONG_TEAM: { ja: 'それは別の班の仕事です', en: "That is another team's job" },
  NOT_LAUNCHING: { ja: '発進のときだけスワイプできます', en: 'Only during the launch' },
  NO_BOLT: { ja: '投げられる雷がありません', en: 'No bolt to throw' },
  RATE_LIMITED: { ja: '押しすぎです。少し待って', en: 'Too fast. Wait a moment' },
  DUPLICATE: { ja: '受付済み', en: 'Already received' },
  NETWORK: { ja: '通信待ち。もう一度押してください', en: 'No answer. Tap again' },
};

export interface ActionResult {
  clientActionId: string;
  accepted: boolean;
  reasonCode?: ReasonCode;
  /** Free action: match time the next one is accepted. */
  readyAt?: number;
}
