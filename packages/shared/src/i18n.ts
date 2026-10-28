import type { MatchStatus, Phase, RoundEndReason, ZapErrorCode, ZapOkCode } from './state';

export type Locale = 'ja' | 'en';
export const LOCALES: Locale[] = ['ja', 'en'];

export const STATUS_LABELS: Record<MatchStatus, { ja: string; en: string }> = {
  CREATED: { ja: '準備中', en: 'Preparing' },
  LIVE: { ja: '対戦中', en: 'Live' },
  FINISHED: { ja: 'シーズン終了', en: 'Season over' },
  PAUSED: { ja: '一時停止中', en: 'Paused' },
  CANCELLED: { ja: '中止', en: 'Cancelled' },
};

export const PHASE_LABELS: Record<Phase, { ja: string; en: string }> = {
  OPENING: { ja: '開幕', en: 'Opening' },
  ROUND: { ja: 'バトル中', en: 'Fight' },
  ROUND_END: { ja: 'ラウンド終了', en: 'Round over' },
  SEASON_END: { ja: '全国制覇決定', en: 'Champion decided' },
};

export const ZAP_CODE_LABELS: Record<ZapOkCode | ZapErrorCode, { ja: string; en: string }> = {
  HIT: { ja: 'パンチ命中！', en: 'Hit!' },
  SPECIAL: { ja: '必殺技が出た！', en: 'Special move!' },
  KO: { ja: 'とどめの一撃！KO！', en: 'Knockout blow!' },
  NOT_LIVE: { ja: 'まだ試合が始まっていません', en: 'The battle has not started' },
  PAUSED: { ja: '一時停止中です', en: 'Paused' },
  ROUND_NOT_ACTIVE: {
    ja: 'ラウンドの合間です。次のラウンドまで待ってね（satsは使われていません）',
    en: 'Between rounds — wait for the next one (no sats used)',
  },
};

export const ROUND_END_LABELS: Record<RoundEndReason, { ja: string; en: string }> = {
  KO: { ja: 'KO勝ち', en: 'Knockout' },
  TIME: { ja: '時間切れ・残りHP判定', en: 'Time up — more HP wins' },
  DRAW: { ja: '引き分け', en: 'Draw' },
};

/** The whole game in one line, used everywhere a newcomer might look. */
export const ONE_LINE_RULES = {
  ja: '応援するロボットを選んで、satsを送るとパンチ！ 先にHPを0にしたチームがその地方をゲット',
  en: 'Pick a robot and send sats to punch! Knock out the rival to win the region',
};

export const SATS_EXPLAINER = {
  ja: 'sats（サッツ）はビットコインの小さな単位。1ビットコイン＝1億sats',
  en: 'A sat is the smallest unit of bitcoin. 1 BTC = 100,000,000 sats',
};

/** Common UI strings. Keep keys flat so both apps can share them. */
export const UI_STRINGS = {
  ja: {
    appTitle: 'SATS WARS',
    subtitle: '雷神 VS 風神',
    zap: 'パンチ！',
    cheer: '応援',
    topup: 'チャージ',
    credit: '残高',
    connected: '接続中',
    reconnecting: '再接続中…',
    disconnected: '切断',
  },
  en: {
    appTitle: 'SATS WARS',
    subtitle: 'RAIJIN VS FUJIN',
    zap: 'Punch!',
    cheer: 'Cheer',
    topup: 'Top up',
    credit: 'Balance',
    connected: 'Connected',
    reconnecting: 'Reconnecting…',
    disconnected: 'Disconnected',
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type UiStringKey = keyof (typeof UI_STRINGS)['ja'];
