/**
 * Match state machine (D-033). PAUSE is a flag on the state, not a phase.
 *   LOBBY → COUNTDOWN → DEPLOYMENT → BATTLE → VICTORY | DEFEAT → RESULTS → (next match) LOBBY
 */
export const PHASES = [
  'LOBBY',
  'COUNTDOWN',
  'DEPLOYMENT',
  'BATTLE',
  'VICTORY',
  'DEFEAT',
  'RESULTS',
] as const;
export type Phase = (typeof PHASES)[number];

export function isCombatPhase(p: Phase): boolean {
  return p === 'BATTLE';
}

export const PHASE_LABEL: Record<Phase, { ja: string; en: string }> = {
  LOBBY: { ja: '参加受付中', en: 'JOIN NOW' },
  COUNTDOWN: { ja: '出撃準備', en: 'LAUNCH SEQUENCE' },
  DEPLOYMENT: { ja: '出撃', en: 'DEPLOYMENT' },
  BATTLE: { ja: 'NULL CORE 迎撃', en: 'DEFEND JAPAN' },
  VICTORY: { ja: '撃退成功', en: 'VICTORY' },
  DEFEAT: { ja: '防衛失敗', en: 'DEFEAT' },
  RESULTS: { ja: '作戦記録', en: 'DEBRIEF' },
};
