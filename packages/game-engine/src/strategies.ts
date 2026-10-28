import type { ActionType, MatchState, RegionId, TeamId } from '@sats-wars/shared';
import { otherTeam } from '@sats-wars/shared';

/** Small deterministic PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export interface PlannedAction {
  actionType: ActionType;
  regionId: RegionId | null;
}

export const STRATEGY_NAMES = ['random', 'balanced', 'aggressive', 'defensive', 'charger'] as const;
export type StrategyName = (typeof STRATEGY_NAMES)[number];

function pick<T>(rng: Rng, items: T[]): T | undefined {
  return items.length ? items[Math.floor(rng() * items.length)] : undefined;
}

/** Actions that the engine would accept right now for this team. */
export function legalActions(state: MatchState, teamId: TeamId): PlannedAction[] {
  const out: PlannedAction[] = [];
  const enemy = otherTeam(teamId);
  for (const id of state.regionOrder) {
    const r = state.regions[id];
    if (r.ownerTeamId === null || r.ownerTeamId === enemy) out.push({ actionType: 'ATTACK', regionId: id });
    if (r.ownerTeamId === teamId && r.contestedByTeamId === enemy)
      out.push({ actionType: 'ATTACK', regionId: id });
    if (r.ownerTeamId === teamId && (r.contestedByTeamId !== null || r.shieldCharges < state.config.shieldMax))
      out.push({ actionType: 'DEFEND', regionId: id });
  }
  if (state.teams[teamId].energy < state.config.energyMax) out.push({ actionType: 'CHARGE', regionId: null });
  return out;
}

/**
 * Choose an action for a participant of `teamId`. Strategies are heuristics
 * used by demo bots and the balance simulator; they only read public state.
 */
export function chooseAction(
  state: MatchState,
  teamId: TeamId,
  strategy: StrategyName,
  rng: Rng,
): PlannedAction | null {
  const legal = legalActions(state, teamId);
  if (legal.length === 0) return null;
  if (strategy === 'random') return pick(rng, legal) ?? null;

  const enemy = otherTeam(teamId);
  const regions = state.regionOrder.map((id) => state.regions[id]);
  const ownContested = regions.filter((r) => r.ownerTeamId === teamId && r.contestedByTeamId === enemy);
  const finishCapture = regions.filter((r) => r.ownerTeamId === enemy && r.contestedByTeamId === teamId);
  const neutral = regions.filter((r) => r.ownerTeamId === null);
  const enemyOwned = regions.filter((r) => r.ownerTeamId === enemy && r.contestedByTeamId === null);
  const ownUnshielded = regions.filter(
    (r) => r.ownerTeamId === teamId && r.contestedByTeamId === null && r.shieldCharges === 0,
  );
  const energy = state.teams[teamId].energy;
  const canCharge = energy < state.config.energyMax;

  const attack = (rs: typeof regions): PlannedAction | null => {
    const r = pick(rng, rs);
    return r ? { actionType: 'ATTACK', regionId: r.regionId } : null;
  };
  const defend = (rs: typeof regions): PlannedAction | null => {
    const r = pick(rng, rs);
    return r ? { actionType: 'DEFEND', regionId: r.regionId } : null;
  };
  const charge = (): PlannedAction | null => (canCharge ? { actionType: 'CHARGE', regionId: null } : null);

  const roll = rng();
  switch (strategy) {
    case 'aggressive':
      return (
        attack(finishCapture) ??
        attack(neutral) ??
        attack(enemyOwned) ??
        attack(ownContested) ??
        charge() ??
        pick(rng, legal) ??
        null
      );
    case 'defensive':
      return (
        defend(ownContested) ??
        attack(neutral) ??
        (roll < 0.7 ? defend(ownUnshielded) : null) ??
        attack(finishCapture) ??
        charge() ??
        pick(rng, legal) ??
        null
      );
    case 'charger':
      return (
        (roll < 0.75 ? charge() : null) ??
        attack(finishCapture) ??
        attack(neutral) ??
        pick(rng, legal) ??
        null
      );
    case 'balanced':
    default: {
      // Urgent responses first, then a weighted mix.
      if (ownContested.length && roll < 0.8) return defend(ownContested) ?? attack(ownContested);
      if (finishCapture.length && roll < 0.9) return attack(finishCapture);
      const r2 = rng();
      if (neutral.length && r2 < 0.5) return attack(neutral);
      if (r2 < 0.65) return charge() ?? attack(enemyOwned) ?? pick(rng, legal) ?? null;
      if (r2 < 0.8) return defend(ownUnshielded) ?? attack(enemyOwned) ?? pick(rng, legal) ?? null;
      return attack(enemyOwned) ?? attack(neutral) ?? pick(rng, legal) ?? null;
    }
  }
}
