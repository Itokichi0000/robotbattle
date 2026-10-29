import { bearingToDirection, SHIELD_COVERAGE } from '@swed/shared';
import type {
  EnemyState,
  PublicEnemy,
  PublicMatchState,
  ShieldSeatId,
  ThreatState,
} from '@swed/shared';
import { enemyBearingAt } from './orbit';

/**
 * Display-side hints shared by the server (AUTO SUPPORT), the phones and the big screen.
 * They recommend; the engine decides.
 */

type TargetLike = Pick<EnemyState, 'id' | 'kind' | 'hp' | 'arrivesAt'>;

/**
 * Best target now: the attacker whose telegraphed strike lands soonest (killing it cancels
 * the strike), then the boss, then the weakest arrived enemy.
 */
export function recommendTarget<E extends TargetLike>(
  enemies: readonly E[],
  threats: readonly Pick<ThreatState, 'sourceId' | 'impactAt'>[],
  t: number,
): E | null {
  const arrived = enemies.filter((e) => e.arrivesAt <= t);
  if (arrived.length === 0) return null;
  let best: E | null = null;
  let bestImpact = Infinity;
  for (const th of threats) {
    const src = arrived.find((e) => e.id === th.sourceId);
    if (src && src.kind !== 'NULL_CORE' && th.impactAt < bestImpact) {
      best = src;
      bestImpact = th.impactAt;
    }
  }
  if (best) return best;
  const boss = arrived.find((e) => e.kind === 'NULL_CORE');
  if (boss) return boss;
  return arrived.reduce((a, b) => (b.hp < a.hp ? b : a));
}

/** Threats a shield seat is responsible for, soonest first. */
export function threatsForShield(
  threats: readonly ThreatState[],
  seat: ShieldSeatId,
): ThreatState[] {
  return threats
    .filter((th) => SHIELD_COVERAGE[seat].includes(th.dir))
    .sort((a, b) => a.impactAt - b.impactAt);
}

/** Sector an enemy is in right now (for radar and pilot scopes). */
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
