import type {
  Direction,
  GunnerSeatId,
  PilotActionInput,
  PublicMatchState,
  SeatId,
  ShieldSeatId,
} from '@swed/shared';
import { isCombatPhase, roleOf } from '@swed/shared';
import { recommendTarget, threatsForShield } from './hints';

/**
 * A competent-but-human pilot policy. Used by demo bots, balance tests and load tests; it
 * only reads public state and sends the same raw intents a phone would.
 */
export function botDecide(
  pub: PublicMatchState,
  seat: SeatId,
  t: number,
  skill = 1,
): PilotActionInput | null {
  if (!isCombatPhase(pub.phase) || pub.paused) return null;
  const role = roleOf(seat);
  if (role === 'GUNNER') return gunner(pub, seat as GunnerSeatId, t);
  if (role === 'DEFENSE') return defense(pub, seat as ShieldSeatId, t, skill);
  return null;
}

function gunner(pub: PublicMatchState, seat: GunnerSeatId, t: number): PilotActionInput | null {
  const g = pub.gunners[seat];
  const best = recommendTarget(pub.enemies, pub.threats, t);
  const current = g.targetId ? pub.enemies.find((e) => e.id === g.targetId) : undefined;
  if (!current) return best ? { actionType: 'LOCK', payload: { targetId: best.id } } : null;
  // The railgun keeps the weak point lit on whatever matters most right now.
  if (seat === 'GUNNER_R' && best && best.id !== current.id && t >= g.readyAt) {
    return { actionType: 'LOCK', payload: { targetId: best.id } };
  }
  if (t >= g.readyAt && pub.energy.weapon >= pub.hints.weaponCost) {
    return { actionType: 'FIRE', payload: {} };
  }
  return null;
}

function defense(
  pub: PublicMatchState,
  seat: ShieldSeatId,
  t: number,
  skill: number,
): PilotActionInput | null {
  const sh = pub.shields[seat];
  if (t < sh.cooldownUntil || pub.energy.shield < pub.hints.shieldCost) return null;
  const next = threatsForShield(pub.threats, seat)[0];
  if (!next) return null;
  const lead = next.impactAt - t;
  // Humans press somewhere in the last second or two; a lower skill presses earlier.
  const want = 700 + (1 - skill) * 1_200;
  if (lead > 0 && lead <= want)
    return { actionType: 'DEPLOY_SHIELD', payload: { dir: next.dir as Direction } };
  return null;
}
