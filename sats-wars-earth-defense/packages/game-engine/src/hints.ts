import { bearingToDirection, SQUADS } from '@swed/shared';
import type { ActionKind, PublicEnemy, PublicMatchState, ThreatState } from '@swed/shared';
import { enemyBearingAt } from './orbit';

/**
 * Display-side hints shared by the phones, the big screen and the demo bots. They
 * recommend; the engine decides.
 */

type HintState = Pick<PublicMatchState, 'threats' | 'shield' | 'mechHp' | 'mechMax' | 't'> & {
  hints: Pick<PublicMatchState['hints'], 'shieldDecayPerSec'>;
};

/** Shield the strike will still find at impact, with the decay until then. */
export function shieldShort(s: HintState, strike: ThreatState, mt = s.t): boolean {
  const secs = Math.max(0, (strike.impactAt - mt) / 1000);
  return s.shield - s.hints.shieldDecayPerSec * secs < strike.damage + 2;
}

/** The announced squad strike, if any (one at a time). */
export function squadStrike(s: Pick<PublicMatchState, 'threats'>): ThreatState | null {
  return s.threats.find((th) => th.target.type === 'SQUAD') ?? null;
}

/** The next claw at RAIJIN, if announced. */
export function mechClaw(s: Pick<PublicMatchState, 'threats'>): ThreatState | null {
  return s.threats.find((th) => th.target.type === 'MECH') ?? null;
}

/**
 * The one button that helps most right now:
 *   a squad strike is coming and the shield is short → 守る
 *   RAIJIN is at half armour or a claw would bring it close to zero → 直す
 *   otherwise → 撃つ
 */
export function recommendAction(s: HintState, mt = s.t): ActionKind {
  const strike = squadStrike(s);
  if (strike && shieldShort(s, strike, mt)) return 'DEFEND';
  const claw = mechClaw(s);
  if (s.mechHp <= s.mechMax * 0.5) return 'REPAIR';
  if (claw && s.mechHp - claw.damage <= s.mechMax * 0.25) return 'REPAIR';
  return 'ATTACK';
}

export interface NowLine {
  action: ActionKind;
  /** Short reason, Japanese first. */
  ja: string;
  en: string;
}

/** What the hall should do this second, in words a passer-by understands. */
export function nowLine(s: HintState, mt: number): NowLine {
  const action = recommendAction(s, mt);
  const strike = squadStrike(s);
  if (action === 'DEFEND' && strike && strike.target.type === 'SQUAD') {
    const squad = SQUADS[strike.target.squadId];
    const secs = Math.max(0, (strike.impactAt - mt) / 1000).toFixed(0);
    return {
      action,
      ja: `${squad.nameJa}に攻撃まで ${secs}秒 → 「守る」でシールドを ${strike.damage} まで`,
      en: `${squad.nameEn} hit in ${secs}s → DEFEND: shield to ${strike.damage}`,
    };
  }
  if (action === 'REPAIR') {
    return {
      action,
      ja: '雷神の装甲が危ない → 「直す」',
      en: 'RAIJIN armour low → REPAIR',
    };
  }
  return {
    action,
    ja: '母艦を「撃つ」！ 地球に着く前に倒せ',
    en: 'ATTACK the mothership before it reaches Earth',
  };
}

/** Sector an enemy is in right now (for radar). */
export function enemySector(e: Pick<PublicEnemy, 'orbit' | 'spawnedAt'>, t: number) {
  return bearingToDirection(enemyBearingAt(e.orbit, e.spawnedAt, t));
}

/** Estimated match clock on a client: snapshot time plus local elapsed, frozen while paused. */
export function estimateMatchTime(
  snap: Pick<PublicMatchState, 't' | 'paused'>,
  receivedAtMs: number,
  nowMs: number,
): number {
  return snap.paused ? snap.t : snap.t + Math.max(0, nowMs - receivedAtMs);
}

export function percent(v: number, max: number): number {
  return max <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((v / max) * 100)));
}
