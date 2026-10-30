import type {
  Direction,
  EngineerSeatId,
  GunnerSeatId,
  PilotActionInput,
  PowerDistribution,
  PublicMatchState,
  SeatId,
  ShieldSeatId,
} from '@swed/shared';
import { ENGINEER_COVERAGE, isCombatPhase, POWER_LANES, roleOf } from '@swed/shared';
import { recommendTarget, threatsForShield } from './hints';
import { solvePuzzle } from './router';

/**
 * A competent-but-human pilot policy. Used by demo bots, balance tests and load tests; it
 * only reads public state and sends the same raw intents a phone would. Reaction delays
 * keep it from playing better than an attentive person.
 */
/** Per-seat memory the caller keeps between decisions (bots do not share state). */
export interface BotMemory {
  lastPlanAt?: number;
}

export function botDecide(
  pub: PublicMatchState,
  seat: SeatId,
  t: number,
  skill = 1,
  mem: BotMemory = {},
): PilotActionInput | null {
  if (!isCombatPhase(pub.phase) || pub.paused) return null;
  const role = roleOf(seat);
  const od = pub.overdrive;
  if ((od.status === 'READY' || od.status === 'CHARGING') && !od.confirmed.includes(role)) {
    // Humans need a moment to notice the call; the window is 5 s.
    const since = od.status === 'READY' ? t - od.readyAt : t - od.windowStartedAt;
    if (since > 700 + (1 - skill) * 1_500) return { actionType: 'SYNC_NOW', payload: {} };
  }
  if (role === 'GUNNER') return gunner(pub, seat as GunnerSeatId, t);
  if (role === 'DEFENSE') return defense(pub, seat as ShieldSeatId, t, skill);
  if (seat === 'POWER_ROUTER') return router(pub, t);
  if (seat === 'POWER_CORE') return power(pub, t, mem);
  if (role === 'ENGINEER') return engineer(pub, seat as EngineerSeatId, t);
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
  if (lead > 0 && lead <= want) {
    return { actionType: 'DEPLOY_SHIELD', payload: { dir: next.dir as Direction } };
  }
  return null;
}

function router(pub: PublicMatchState, t: number): PilotActionInput | null {
  // A blackout comes first: the whole mech is dark until the core circuit is re-routed.
  if (pub.crisis && t - pub.crisis.startedAt > 4_500) {
    const rotations = solvePuzzle(pub.crisis.puzzle);
    if (rotations) return { actionType: 'BLACKOUT_ROUTE', payload: { rotations } };
  }
  for (const lane of POWER_LANES) {
    const c = pub.circuits[lane];
    // A person needs a few seconds to read and turn the tiles.
    if (c.broken && c.puzzle && t - c.brokenAt > 3_500) {
      const rotations = solvePuzzle(c.puzzle);
      if (rotations) return { actionType: 'ROUTE_SUBMIT', payload: { lane, rotations } };
    }
  }
  return null;
}

function power(pub: PublicMatchState, t: number, mem: BotMemory): PilotActionInput | null {
  if (mem.lastPlanAt !== undefined && t - mem.lastPlanAt < 7_000 && t >= mem.lastPlanAt)
    return null;
  const want = plan(pub);
  const d = pub.distribution;
  const moved =
    (Math.abs(want.weapon - d.weapon) +
      Math.abs(want.shield - d.shield) +
      Math.abs(want.mobility - d.mobility) +
      Math.abs(want.repair - d.repair)) /
    2;
  if (moved < 10) return null;
  mem.lastPlanAt = t;
  return {
    actionType: 'SET_POWER',
    payload: { distribution: want, baseVersion: pub.distributionVersion },
  };
}

/** What an attentive POWER A would do: guns for the boss, shields under fire, repair when hurt. */
function plan(pub: PublicMatchState): PowerDistribution {
  const worst = Math.min(...Object.values(pub.parts));
  const pressure = pub.threats.length;
  if (worst < 50) return { weapon: 30, shield: 30, mobility: 10, repair: 30 };
  if (pub.boss)
    return pressure >= 2
      ? { weapon: 45, shield: 35, mobility: 5, repair: 15 }
      : { weapon: 55, shield: 25, mobility: 5, repair: 15 };
  if (pressure >= 3) return { weapon: 35, shield: 40, mobility: 10, repair: 15 };
  return { weapon: 45, shield: 30, mobility: 10, repair: 15 };
}

function engineer(pub: PublicMatchState, seat: EngineerSeatId, t: number): PilotActionInput | null {
  const eng = pub.engineers[seat];
  if (eng.job) {
    // Reading three numbered bolts and tapping them takes a person a second or two.
    if (t - eng.job.startedAt > 1_600) {
      return {
        actionType: 'REPAIR_FINISH',
        payload: { part: eng.job.part, order: [...eng.job.bolts] },
      };
    }
    return null;
  }
  if (t < eng.cooldownUntil || pub.energy.repair < pub.hints.repairCost) return null;
  const parts = ENGINEER_COVERAGE[seat].filter((p) => pub.parts[p] < 88);
  if (parts.length === 0) return null;
  const worst = parts.reduce((a, b) => (pub.parts[b] < pub.parts[a] ? b : a));
  return { actionType: 'REPAIR_START', payload: { part: worst } };
}
