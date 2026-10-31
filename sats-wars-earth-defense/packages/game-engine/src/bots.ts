import { ACTION_KINDS } from '@swed/shared';
import type { ActionKind, PublicMatchState } from '@swed/shared';
import { recommendAction } from './hints';

/**
 * Demo bots and balance-sim players: they press what the screen recommends, like a person
 * watching the big screen, with some noise (`skill` 1 = always the recommended button).
 */
export function botChoose(s: PublicMatchState, roll: number, skill: number): ActionKind {
  const best = recommendAction(s);
  if (roll < skill) return best;
  const others = ACTION_KINDS.filter((k) => k !== best);
  return others[Math.floor(((roll - skill) / Math.max(1e-9, 1 - skill)) * others.length)] ?? best;
}
