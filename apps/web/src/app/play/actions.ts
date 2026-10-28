import type { ActionType, RegionState, TeamId } from '@sats-wars/shared';
import { otherTeam } from '@sats-wars/shared';

export interface ActionHint {
  enabled: boolean;
  /** Why it is disabled, or what will happen. */
  ja: string;
  en: string;
}

/**
 * Client-side hints only, so buttons can be greyed out with an explanation.
 * The server re-validates everything and is the only authority.
 */
export function actionHint(
  type: Exclude<ActionType, 'CHARGE'>,
  r: RegionState,
  myTeam: TeamId,
): ActionHint {
  const enemy = otherTeam(myTeam);
  if (type === 'ATTACK') {
    if (r.ownerTeamId === null)
      return { enabled: true, ja: '中立地域：1回で占領', en: 'Neutral: capture in one attack' };
    if (r.ownerTeamId === enemy) {
      if (r.contestedByTeamId === myTeam)
        return {
          enabled: true,
          ja: '争奪中：攻撃で占領完了',
          en: 'Contested by us: attack to capture',
        };
      if (r.shieldCharges > 0)
        return { enabled: true, ja: 'シールドを1枚破壊', en: 'Breaks one shield' };
      return {
        enabled: true,
        ja: '争奪開始（25秒以内に味方がもう1回攻撃で占領）',
        en: 'Starts a 25s contest',
      };
    }
    if (r.contestedByTeamId === enemy)
      return { enabled: true, ja: '敵の争奪を阻止', en: 'Break the enemy contest' };
    return {
      enabled: false,
      ja: '味方の地域（争奪中のときだけ攻撃で阻止）',
      en: 'Ours (attack only to break a contest)',
    };
  }
  if (r.ownerTeamId !== myTeam)
    return {
      enabled: false,
      ja: '味方の地域だけ防御できます',
      en: 'Only our regions can be defended',
    };
  if (r.contestedByTeamId)
    return {
      enabled: true,
      ja: '争奪を解除（シールドは付きません）',
      en: 'Break contest (no shield)',
    };
  if (r.shieldCharges > 0)
    return { enabled: false, ja: 'シールド設置済み', en: 'Shield already active' };
  return { enabled: true, ja: 'シールド1枚（30秒）', en: 'Shield for 30s' };
}
