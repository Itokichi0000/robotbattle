import { ACTION_KINDS } from '@swed/shared';
import type { ActionKind, PublicMatchState } from '@swed/shared';
import { phoneJob } from './hints';

/**
 * Demo bots and balance-sim players: they play the screen their phone would show (their
 * team's job, D-035), like a person, with some noise (`skill` 1 = always the right job).
 */
export function botChoose(
  s: PublicMatchState,
  roll: number,
  skill: number,
  jobs: readonly ActionKind[] = ACTION_KINDS,
): ActionKind {
  const best = phoneJob(s, s.t, jobs);
  if (roll < skill) return best;
  const allowed = ACTION_KINDS.filter((k) => k !== best && (k === 'ATTACK' || jobs.includes(k)));
  if (allowed.length === 0) return best;
  return allowed[Math.floor(((roll - skill) / Math.max(1e-9, 1 - skill)) * allowed.length)] ?? best;
}
