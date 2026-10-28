import type { ActionErrorCode, ActionOkCode, MatchStatus, ResultReason } from './state';

export type Locale = 'ja' | 'en';
export const LOCALES: Locale[] = ['ja', 'en'];

export const STATUS_LABELS: Record<MatchStatus, { ja: string; en: string }> = {
  CREATED: { ja: '準備中', en: 'Preparing' },
  LOBBY: { ja: '参加受付中', en: 'Lobby' },
  LIVE: { ja: '対戦中', en: 'Live' },
  FINALIZING: { ja: '最終決戦', en: 'Final' },
  FINISHED: { ja: '試合終了', en: 'Finished' },
  PAUSED: { ja: '一時停止中', en: 'Paused' },
  CANCELLED: { ja: '中止', en: 'Cancelled' },
};

export const ACTION_CODE_LABELS: Record<
  ActionOkCode | ActionErrorCode,
  { ja: string; en: string }
> = {
  CAPTURED: { ja: '占領成功！', en: 'Captured!' },
  SHIELD_BROKEN: { ja: '敵のシールドを破壊！', en: 'Enemy shield broken!' },
  CONTEST_STARTED: {
    ja: '争奪開始！25秒以内に味方がもう一度攻撃すれば占領',
    en: 'Contest started! One more team attack within 25s captures it',
  },
  CONTEST_BROKEN: { ja: '争奪を阻止！', en: 'Contest broken!' },
  SHIELD_PLACED: { ja: 'シールド設置！', en: 'Shield placed!' },
  CHARGED: { ja: 'エネルギー充電！', en: 'Energy charged!' },
  MATCH_NOT_LIVE: { ja: '試合中ではありません', en: 'The match is not live' },
  MATCH_PAUSED: { ja: '一時停止中です', en: 'The match is paused' },
  ACTIONS_CLOSED: { ja: 'アクション受付は終了しました', en: 'Actions are closed' },
  UNKNOWN_PARTICIPANT: { ja: '参加情報が見つかりません', en: 'Participant not found' },
  NO_AP: { ja: 'APが残っていません', en: 'No AP left' },
  INVALID_REGION: { ja: '地域が正しくありません', en: 'Invalid region' },
  REGION_REQUIRED: { ja: '地域を選んでください', en: 'Choose a region' },
  OWN_REGION_NOT_CONTESTED: {
    ja: '味方の地域です（争奪中のときだけ攻撃で阻止できます）',
    en: 'Your own region (attack only to break an enemy contest)',
  },
  NOT_OWN_REGION: { ja: '味方の地域にだけ防御できます', en: 'You can only defend your own region' },
  SHIELD_ALREADY_ACTIVE: { ja: 'シールドはすでに設置済みです', en: 'Shield already active' },
  ENERGY_FULL: { ja: 'エネルギーは満タンです', en: 'Energy is already full' },
};

export const RESULT_REASON_LABELS: Record<ResultReason, { ja: string; en: string }> = {
  KO: { ja: 'KO勝利', en: 'Win by KO' },
  DOUBLE_KO: { ja: '相打ち（地域数で判定）', en: 'Double KO (decided by regions)' },
  TIME_HP: { ja: '時間切れ・残HP判定', en: 'Time up — decided by HP' },
  TIME_REGIONS: { ja: '時間切れ・占領地域数判定', en: 'Time up — decided by regions' },
  DRAW: { ja: '引き分け', en: 'Draw' },
  CANCELLED: { ja: '中止', en: 'Cancelled' },
};

/** Common UI strings. Keep keys flat so both apps can share them. */
export const UI_STRINGS = {
  ja: {
    appTitle: 'SATS WARS',
    subtitle: '雷神 VS 風神',
    play: '参加する',
    spectate: '観戦のみ',
    arena: '会場スクリーン',
    admin: '運営',
    attack: '攻撃',
    defend: '防御',
    charge: '充電',
    neutral: '中立',
    ally: '味方',
    enemy: '敵',
    contested: '争奪中',
    shield: 'シールド',
    nextClash: '次の激突まで',
    timeLeft: '残り時間',
    hp: 'HP',
    energy: 'エネルギー',
    ap: 'AP',
    participants: '参加者',
    winner: '勝者',
    draw: '引き分け',
    mvp: 'MVP',
    language: 'English',
    reconnecting: '再接続中…',
    connected: '接続中',
    disconnected: '切断',
  },
  en: {
    appTitle: 'SATS WARS',
    subtitle: 'RAIJIN VS FUJIN',
    play: 'Join',
    spectate: 'Watch only',
    arena: 'Arena screen',
    admin: 'Admin',
    attack: 'Attack',
    defend: 'Defend',
    charge: 'Charge',
    neutral: 'Neutral',
    ally: 'Ally',
    enemy: 'Enemy',
    contested: 'Contested',
    shield: 'Shield',
    nextClash: 'Next clash in',
    timeLeft: 'Time left',
    hp: 'HP',
    energy: 'Energy',
    ap: 'AP',
    participants: 'Players',
    winner: 'Winner',
    draw: 'Draw',
    mvp: 'MVP',
    language: '日本語',
    reconnecting: 'Reconnecting…',
    connected: 'Connected',
    disconnected: 'Disconnected',
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type UiStringKey = keyof (typeof UI_STRINGS)['ja'];
