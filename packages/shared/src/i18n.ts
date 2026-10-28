import type {
  AttackKind,
  EnemyKind,
  EnergySink,
  RaidPhase,
  RaidStatus,
  Role,
  SpecialStatus,
  TaskErrorCode,
  Weakpoint,
} from './state';

export type Locale = 'ja' | 'en';
export const LOCALES: Locale[] = ['ja', 'en'];

type L = { ja: string; en: string };

export const STATUS_LABELS: Record<RaidStatus, L> = {
  CREATED: { ja: '準備中', en: 'Preparing' },
  LOBBY_OPEN: { ja: '搭乗受付中', en: 'Boarding open' },
  LIVE: { ja: '作戦中', en: 'In battle' },
  PAUSED: { ja: '一時停止中', en: 'Paused' },
  ENDED: { ja: '作戦終了', en: 'Mission over' },
  CANCELLED: { ja: '中止', en: 'Cancelled' },
};

export const PHASE_LABELS: Record<RaidPhase, L> = {
  LOBBY: { ja: '出撃準備', en: 'Briefing' },
  INTRO_TRAINING: { ja: '訓練・出撃', en: 'Launch & training' },
  WAVE_1: { ja: '第1波', en: 'Wave 1' },
  WAVE_2: { ja: '第2波', en: 'Wave 2' },
  WAVE_3: { ja: '第3波：ボス出現', en: 'Wave 3: boss' },
  FINAL_WAVE: { ja: '最終決戦', en: 'Final wave' },
  SUCCEEDED: { ja: '地球防衛成功', en: 'Earth defended' },
  FAILED: { ja: '防衛失敗', en: 'Defence failed' },
};

export const ROLE_LABELS: Record<
  Role,
  L & { icon: string; robotJa: string; doJa: string; doEn: string }
> = {
  GUNNER: {
    ja: '砲撃席',
    en: 'Gunner',
    icon: '🎯',
    robotJa: '雷神',
    doJa: '敵の弱点を撃つ',
    doEn: "Hit the enemy's weak points",
  },
  GUARDIAN: {
    ja: '防衛席',
    en: 'Guardian',
    icon: '🛡',
    robotJa: '風神',
    doJa: '街をシールドで守る',
    doEn: 'Shield the cities',
  },
  ROUTER: {
    ja: '電力接続席',
    en: 'Router',
    icon: '🔌',
    robotJa: '両機',
    doJa: 'エネルギーの経路をつなぐ',
    doEn: 'Route energy',
  },
  ENGINEER: {
    ja: '整備席',
    en: 'Engineer',
    icon: '🔧',
    robotJa: '両機',
    doJa: '機体と街を修理する',
    doEn: 'Repair robots and cities',
  },
};

export const ENEMY_LABELS: Record<EnemyKind, L & { icon: string }> = {
  SCOUT: { ja: '侵蝕偵察機', en: 'Corruptor scout', icon: '🛸' },
  SIEGE: { ja: '侵蝕砲撃機', en: 'Corruptor siege', icon: '💣' },
  SABOTEUR: { ja: '侵蝕妨害機', en: 'Corruptor saboteur', icon: '📡' },
  BOSS: { ja: '虚蝕巨核 NULL CORE', en: 'NULL CORE', icon: '🌑' },
};

export const ATTACK_LABELS: Record<AttackKind, L> = {
  BEAM: { ja: 'ビーム', en: 'Beam' },
  BOMBARD: { ja: '砲撃', en: 'Bombardment' },
  JAM: { ja: '電力妨害', en: 'Power jam' },
  CORE_BEAM: { ja: 'コアビーム', en: 'Core beam' },
  SWEEP: { ja: '薙ぎ払い', en: 'Sweep' },
  NULL_BEAM: { ja: 'ヌルビーム', en: 'Null beam' },
};

export const WEAKPOINT_LABELS: Record<Weakpoint, L & { hintJa: string; hintEn: string }> = {
  CORE: { ja: 'コア', en: 'Core', hintJa: '大ダメージ', hintEn: 'Big damage' },
  ARM: { ja: '腕', en: 'Arm', hintJa: '敵の攻撃を弱める', hintEn: 'Weakens its attacks' },
  LEG: {
    ja: '脚',
    en: 'Leg',
    hintJa: '次の攻撃を3秒遅らせる',
    hintEn: 'Delays its next attack by 3 s',
  },
};

export const SINK_LABELS: Record<EnergySink, L & { hintJa: string; hintEn: string }> = {
  RAIJIN: { ja: '雷神', en: 'Raijin', hintJa: '砲撃が強くなる', hintEn: 'Stronger shots' },
  FUJIN: { ja: '風神', en: 'Fujin', hintJa: 'シールドが強くなる', hintEn: 'Stronger shields' },
  RESERVE: {
    ja: '予備電源',
    en: 'Reserve',
    hintJa: '最終技「神雷風陣」に必要',
    hintEn: 'Needed for the final special',
  },
};

export const SPECIAL_LABELS: Record<SpecialStatus, L> = {
  LOCKED: { ja: '最終決戦で解放', en: 'Unlocks in the final wave' },
  OPEN: { ja: '発動チャンス！', en: 'Chance to activate!' },
  ACTIVATED: { ja: '神雷風陣 発動！', en: 'SHINRAI FUJIN!' },
  FALLBACK: { ja: '雷風連撃（不完全）', en: 'Partial combo' },
  FAILED: { ja: '発動失敗', en: 'Missed' },
};

export const TASK_ERROR_LABELS: Record<TaskErrorCode, L> = {
  NOT_LIVE: { ja: '作戦が始まっていません', en: 'The raid has not started' },
  PAUSED: { ja: '一時停止中です', en: 'Paused' },
  NOT_BOARDED: { ja: 'まだ搭乗していません', en: 'Not aboard yet' },
  COOLDOWN: { ja: '次の指令まで待機中', en: 'Cooling down' },
  ROLE_COOLDOWN: { ja: '席の変更は少し待ってから', en: 'Seat change cooling down' },
  TASK_OPEN: { ja: '進行中の任務があります', en: 'A mission is already open' },
  NO_TASK: { ja: '任務がありません', en: 'No mission' },
  TASK_MISMATCH: { ja: '別の任務です', en: 'Different mission' },
  EXPIRED: { ja: '期限切れ（間に合いませんでした）', en: 'Expired (too late)' },
  INVALID_INPUT: { ja: '入力を受け付けられませんでした', en: 'Input not accepted' },
  NO_TARGET: { ja: '今は対象がいません', en: 'No target right now' },
};

export const RANKS: Array<L & { minPoints: number }> = [
  { ja: '新兵', en: 'Recruit', minPoints: 0 },
  { ja: '防衛隊員', en: 'Defender', minPoints: 3 },
  { ja: '精鋭隊員', en: 'Elite', minPoints: 8 },
  { ja: '指揮官', en: 'Commander', minPoints: 16 },
  { ja: '伝説のパイロット', en: 'Legendary pilot', minPoints: 30 },
];

/** The whole game in one line, used everywhere a newcomer might look. */
export const ONE_LINE_RULES = {
  ja: '君も地球防衛軍のパイロットになろう。仲間と巨大機神を操縦して地球を守れ！',
  en: 'Join the pilots. Co-pilot the giant robots with everyone and save the Earth!',
};

export const SATS_EXPLAINER = {
  ja: 'sats（サッツ）はビットコインの小さな単位。Lightning＝ビットコインの少額決済技術',
  en: 'A sat is the smallest unit of bitcoin. Lightning = fast small bitcoin payments',
};

/** Common UI strings. Keep keys flat so both apps can share them. */
export const UI_STRINGS = {
  ja: {
    appTitle: 'SATS WARS',
    subtitle: '地球防衛作戦',
    slogan: '君も、パイロットになろう。',
    cheer: '応援',
    connected: '接続中',
    reconnecting: '再接続中…',
    disconnected: '切断',
  },
  en: {
    appTitle: 'SATS WARS',
    subtitle: 'EARTH DEFENSE',
    slogan: 'JOIN THE PILOTS. SAVE THE EARTH.',
    cheer: 'Cheer',
    connected: 'Connected',
    reconnecting: 'Reconnecting…',
    disconnected: 'Disconnected',
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type UiStringKey = keyof (typeof UI_STRINGS)['ja'];

/** Titles earned in raids (cosmetic only: never affect gameplay). */
export const TITLE_LABELS: Record<string, L> = {
  FIRST_SORTIE: { ja: '初出撃', en: 'First sortie' },
  EARTH_DEFENDER: { ja: '地球防衛者', en: 'Earth defender' },
  SHINRAI_FUJIN: { ja: '神雷風陣の担い手', en: 'Shinrai Fujin pilot' },
  MVP_GUNNER: { ja: '最優秀砲撃手', en: 'Top gunner' },
  MVP_GUARDIAN: { ja: '最優秀守護者', en: 'Top guardian' },
  MVP_ROUTER: { ja: '最優秀接続手', en: 'Top router' },
  MVP_ENGINEER: { ja: '最優秀整備士', en: 'Top engineer' },
  MVP_SYNC: { ja: '連携の要', en: 'Heart of the team' },
  ALL_ROUNDER: { ja: '万能パイロット', en: 'All-rounder' },
  VETERAN: { ja: '歴戦の勇士', en: 'Veteran' },
};

export function rankFor(points: number): {
  index: number;
  ja: string;
  en: string;
  nextAt: number | null;
} {
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) if (points >= RANKS[i]!.minPoints) index = i;
  const r = RANKS[index]!;
  return { index, ja: r.ja, en: r.en, nextAt: RANKS[index + 1]?.minPoints ?? null };
}
