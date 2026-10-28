import type {
  Enemy,
  EnemyKind,
  EnemyStats,
  GameConfig,
  MatchState,
  RegionId,
  RegionState,
  ResolvedAction,
} from '@sats-wars/shared';
import { REGION_IDS } from '@sats-wars/shared';

/** Alien stats for a wave: HP and attack grow a little every wave. */
export function enemyStats(c: GameConfig, kind: EnemyKind, wave: number): EnemyStats {
  const base: EnemyStats = kind === 'SCOUT' ? c.scout : kind === 'WALKER' ? c.walker : c.mothership;
  const w = Math.max(0, wave - 1);
  return {
    hp: Math.round(base.hp * (1 + c.hpGrowthPerWave * w)),
    attack: Math.round(base.attack * (1 + c.attackGrowthPerWave * w)),
  };
}

export function waveSize(c: GameConfig, wave: number): number {
  return c.waveBase + c.waveGrowth * wave;
}

export function isBossWave(c: GameConfig, wave: number): boolean {
  return wave % c.bossEvery === 0;
}

/** Wave landings per alien turn (spreading from captured regions comes on top). */
export function landingsPerTurn(c: GameConfig, wave: number): number {
  return 1 + Math.floor((wave - 1) / c.landingsStepWaves);
}

export interface RegionThreat {
  regionId: RegionId;
  /** City damage at the next alien turn, after the barrier. */
  damageNext: number;
  willFall: boolean;
  enemies: number;
  enemyHp: number;
  /** Aliens announced to land here next turn. */
  landing: number;
}

/**
 * What the next alien turn will do, region by region. This is exactly what
 * the engine will apply (no randomness in attacks), so screens can show it as
 * a promise: "Tohoku falls next turn unless you act".
 */
export function threats(s: Pick<MatchState, 'regions' | 'enemies' | 'incoming'>): Record<RegionId, RegionThreat> {
  const out = {} as Record<RegionId, RegionThreat>;
  for (const id of REGION_IDS) {
    const r = s.regions[id];
    const here = s.enemies.filter((e) => e.regionId === id);
    const raw = r.fallen ? 0 : here.reduce((a, e) => a + e.attack, 0);
    const damageNext = Math.max(0, raw - r.shield);
    out[id] = {
      regionId: id,
      damageNext,
      willFall: !r.fallen && damageNext > 0 && damageNext >= r.cityHp,
      enemies: here.length,
      enemyHp: here.reduce((a, e) => a + e.hp, 0),
      landing: s.incoming.filter((l) => l.regionId === id).length,
    };
  }
  return out;
}

export interface PlannedAction {
  action: ResolvedAction;
  regionId: RegionId;
  enemyId?: number;
}

/**
 * The "おすすめ" button: a sensible move for someone who just wants to help.
 * 1. Fire the combo when it is ready and worth it.
 * 2. Save the region in the most danger: kill what can be killed, sweep a
 *    crowd with FUJIN, or raise a barrier if it cannot be saved in time.
 * 3. Otherwise liberate the easiest captured region, then thin out aliens.
 * Deterministic for a given state (ties broken by region order / enemy id).
 */
export function recommendAction(s: MatchState): PlannedAction | null {
  const c = s.config;
  const th = threats(s);
  const enemiesIn = (id: RegionId) => s.enemies.filter((e) => e.regionId === id);
  const standing = REGION_IDS.filter((id) => !s.regions[id].fallen);
  const danger = (id: RegionId) => th[id].damageNext / Math.max(1, s.regions[id].cityHp);
  const hot = standing.filter((id) => enemiesIn(id).length > 0).sort((a, b) => danger(b) - danger(a));
  const actionsLeft = Math.max(1, c.actionsPerTurn - s.actionsThisTurn);

  if (s.combo >= c.comboGaugeMax) {
    const best = [...REGION_IDS]
      .filter((id) => enemiesIn(id).length > 0)
      .sort((a, b) => th[b].enemyHp - th[a].enemyHp)[0];
    if (best && (enemiesIn(best).length >= 2 || enemiesIn(best).some((e) => e.kind === 'MOTHERSHIP'))) {
      return { action: 'COMBO', regionId: best };
    }
  }

  const strike = (id: RegionId): PlannedAction => {
    const here = enemiesIn(id);
    if (here.length >= 3 && c.fujinDamage * here.length > c.raijinDamage) return { action: 'FUJIN', regionId: id };
    // Prefer an alien this hit finishes (removes its attack now), else the hardest hitter.
    const killable = here.filter((e) => e.hp <= c.raijinDamage).sort((a, b) => b.attack - a.attack || a.id - b.id)[0];
    const target = killable ?? [...here].sort((a, b) => b.attack - a.attack || a.hp - b.hp || a.id - b.id)[0]!;
    return { action: 'RAIJIN', regionId: id, enemyId: target.id };
  };

  const top = hot[0];
  if (top && danger(top) > 0) {
    const region = s.regions[top];
    const canKillInTime = th[top].enemyHp <= c.raijinDamage * actionsLeft;
    if (th[top].willFall && !canKillInTime && region.shield === 0) return { action: 'SHIELD', regionId: top };
    return strike(top);
  }

  const captured = REGION_IDS.filter((id) => s.regions[id].fallen && enemiesIn(id).length > 0).sort(
    (a, b) => th[a].enemyHp - th[b].enemyHp,
  );
  if (captured[0]) return strike(captured[0]);

  const any = [...REGION_IDS].filter((id) => enemiesIn(id).length > 0).sort((a, b) => th[b].enemyHp - th[a].enemyHp)[0];
  if (any) return strike(any);

  // Nothing to hit: protect where the next landing comes down.
  const landing = standing.filter((id) => th[id].landing > 0 && s.regions[id].shield === 0)[0];
  if (landing) return { action: 'SHIELD', regionId: landing };
  return null;
}

/** Regions still standing. */
export function standingRegions(regions: Record<RegionId, RegionState>): RegionId[] {
  return REGION_IDS.filter((id) => !regions[id].fallen);
}

export function totalEnemyHp(enemies: Enemy[]): number {
  return enemies.reduce((a, e) => a + e.hp, 0);
}
