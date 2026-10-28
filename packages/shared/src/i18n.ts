import type { ActionErrorCode, EnemyKind, MatchStatus, ResolvedAction } from './state';

export type Locale = 'ja' | 'en';
export const LOCALES: Locale[] = ['ja', 'en'];

export const STATUS_LABELS: Record<MatchStatus, { ja: string; en: string }> = {
  CREATED: { ja: '準備中', en: 'Preparing' },
  LIVE: { ja: '防衛中', en: 'Defending' },
  FINISHED: { ja: '日本陥落', en: 'Japan has fallen' },
  PAUSED: { ja: '一時停止中', en: 'Paused' },
  CANCELLED: { ja: '中止', en: 'Cancelled' },
};

export const ACTION_LABELS: Record<ResolvedAction, { ja: string; en: string; icon: string; hintJa: string; hintEn: string }> = {
  RAIJIN: { ja: '雷神の雷撃', en: 'Raijin strike', icon: '⚡', hintJa: '1体に大ダメージ', hintEn: 'Big hit on one alien' },
  FUJIN: { ja: '風神の竜巻', en: 'Fujin tornado', icon: '🌀', hintJa: 'その地方の全員にダメージ', hintEn: 'Hits every alien in the region' },
  SHIELD: { ja: '結界', en: 'Barrier', icon: '🛡', hintJa: '次の攻撃を防ぐ', hintEn: 'Blocks the next attack' },
  COMBO: { ja: '合体技 風神雷神', en: 'Fūjin-Raijin combo', icon: '💥', hintJa: 'ゲージ満タンで一掃', hintEn: 'Wipe out a region when the gauge is full' },
};

export const ACTION_ERROR_LABELS: Record<ActionErrorCode, { ja: string; en: string }> = {
  NOT_LIVE: { ja: 'まだ始まっていません（satsは使われていません）', en: 'Not started yet (no sats used)' },
  PAUSED: { ja: '一時停止中です（satsは使われていません）', en: 'Paused (no sats used)' },
  NO_TARGET: { ja: 'そこには敵がいません（satsは使われていません）', en: 'No aliens there (no sats used)' },
  REGION_FALLEN: { ja: 'とられた地方には結界を張れません。敵を倒して取り返そう', en: 'Captured — defeat the aliens to take it back' },
  ALREADY_SHIELDED: { ja: 'もう結界があります（satsは使われていません）', en: 'Already shielded (no sats used)' },
  COMBO_NOT_READY: { ja: '合体ゲージがまだ溜まっていません', en: 'Combo gauge is not full yet' },
};

export const ENEMY_LABELS: Record<EnemyKind, { ja: string; en: string; icon: string }> = {
  SCOUT: { ja: '偵察UFO', en: 'Scout UFO', icon: '🛸' },
  WALKER: { ja: '侵略メカ', en: 'Invader mech', icon: '👾' },
  MOTHERSHIP: { ja: '母艦', en: 'Mothership', icon: '🪐' },
};

/** The whole game in one line, used everywhere a newcomer might look. */
export const ONE_LINE_RULES = {
  ja: 'エイリアンから日本を守れ！ satsを送ると雷神・風神が攻撃。みんなで協力して8地方を守りぬこう',
  en: 'Defend Japan from the aliens! Send sats and Raijin & Fujin strike. Everyone is on the same team',
};

export const SATS_EXPLAINER = {
  ja: 'sats（サッツ）はビットコインの小さな単位。1ビットコイン＝1億sats',
  en: 'A sat is the smallest unit of bitcoin. 1 BTC = 100,000,000 sats',
};

/** Common UI strings. Keep keys flat so both apps can share them. */
export const UI_STRINGS = {
  ja: {
    appTitle: 'SATS WARS',
    subtitle: '地球防衛軍',
    cheer: '応援',
    topup: 'チャージ',
    credit: '残高',
    connected: '接続中',
    reconnecting: '再接続中…',
    disconnected: '切断',
  },
  en: {
    appTitle: 'SATS WARS',
    subtitle: 'EARTH DEFENSE',
    cheer: 'Cheer',
    topup: 'Top up',
    credit: 'Balance',
    connected: 'Connected',
    reconnecting: 'Reconnecting…',
    disconnected: 'Disconnected',
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type UiStringKey = keyof (typeof UI_STRINGS)['ja'];
