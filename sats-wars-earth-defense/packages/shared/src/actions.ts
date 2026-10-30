import type { PowerDistribution } from './config';
import type { Direction, MechPartId, SeatId } from './seats';
import type { PowerLane } from './state';

/**
 * Pilot intents. Clients send raw intent only; the engine decides success and effect.
 * Phase 1 ships the gunner and shield actions; power and engineer actions arrive in Phase 2.
 */
export type PilotActionInput =
  | { actionType: 'LOCK'; payload: { targetId?: string } }
  | { actionType: 'FIRE'; payload: Record<string, never> }
  | { actionType: 'DEPLOY_SHIELD'; payload: { dir: Direction } }
  /** POWER A: a whole plan (sum 100) against the version it was drawn from. */
  | { actionType: 'SET_POWER'; payload: { distribution: PowerDistribution; baseVersion: number } }
  /** POWER B: the tile rotations the pilot set on a cut circuit. */
  | { actionType: 'ROUTE_SUBMIT'; payload: { lane: PowerLane; rotations: number[] } }
  /** ENGINEER: pick a damaged part (opens a bolt job), then tighten bolts in order. */
  | { actionType: 'REPAIR_START'; payload: { part: MechPartId } }
  | { actionType: 'REPAIR_FINISH'; payload: { part: MechPartId; order: number[] } }
  /** Anyone: confirm RAIJIN OVERDRIVE for your role. */
  | { actionType: 'SYNC_NOW'; payload: Record<string, never> };

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
  'STALE_VERSION',
  'BAD_DISTRIBUTION',
  'CIRCUIT_OK',
  'ROUTE_INCOMPLETE',
  'PART_OK',
  'NOT_YOUR_PART',
  'NO_JOB',
  'JOB_EXPIRED',
  'WRONG_ORDER',
  'OVERDRIVE_NOT_READY',
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
  STALE_VERSION: {
    ja: '配分が更新されました。最新の値で再送信',
    en: 'Plan changed meanwhile. Send again',
  },
  BAD_DISTRIBUTION: {
    ja: '配分の合計は100%（各レーン上限あり）',
    en: 'Shares must total 100 % (per-lane cap)',
  },
  CIRCUIT_OK: { ja: 'その回路は正常です', en: 'That circuit is fine' },
  ROUTE_INCOMPLETE: { ja: '経路がつながっていません', en: 'The route is not connected' },
  PART_OK: { ja: 'その部位は損傷していません', en: 'That part is not damaged' },
  NOT_YOUR_PART: { ja: 'その部位は担当外です', en: 'Not your section' },
  NO_JOB: { ja: '先に修理する部位を選んでください', en: 'Pick a part first' },
  JOB_EXPIRED: { ja: '時間切れ。もう一度選び直し', en: 'Too slow. Pick the part again' },
  WRONG_ORDER: { ja: 'ボルトの順番が違います', en: 'Wrong bolt order' },
  OVERDRIVE_NOT_READY: { ja: 'OVERDRIVE はまだ使えません', en: 'OVERDRIVE is not ready' },
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
