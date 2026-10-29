/** Match state machine (spec §6.5). PAUSE is a flag on the state, not a phase. */
export const PHASES = [
  'ATTRACT',
  'LOBBY',
  'COUNTDOWN',
  'DEPLOYMENT',
  'WAVE_1',
  'WAVE_2',
  'BOSS',
  'VICTORY',
  'DEFEAT',
  'RESULTS',
] as const;
export type Phase = (typeof PHASES)[number];

export const COMBAT_PHASES: readonly Phase[] = ['WAVE_1', 'WAVE_2', 'BOSS'];
export const PREMATCH_PHASES: readonly Phase[] = ['ATTRACT', 'LOBBY'];

export function isCombatPhase(p: Phase): boolean {
  return COMBAT_PHASES.includes(p);
}

export const PHASE_LABEL: Record<Phase, { ja: string; en: string }> = {
  ATTRACT: { ja: 'パイロット募集中', en: 'PILOTS WANTED' },
  LOBBY: { ja: '搭乗受付', en: 'BOARDING' },
  COUNTDOWN: { ja: '出撃準備', en: 'LAUNCH SEQUENCE' },
  DEPLOYMENT: { ja: '出撃', en: 'DEPLOYMENT' },
  WAVE_1: { ja: '第1波', en: 'WAVE 01' },
  WAVE_2: { ja: '第2波', en: 'WAVE 02' },
  BOSS: { ja: 'NULL CORE 迎撃', en: 'WAVE 03 / BOSS' },
  VICTORY: { ja: '撃退成功', en: 'VICTORY' },
  DEFEAT: { ja: '防衛失敗', en: 'DEFEAT' },
  RESULTS: { ja: '作戦記録', en: 'DEBRIEF' },
};
