import type { Enemy, PublicMatchSnapshot, RegionId, RegionState } from '@sats-wars/shared';
import { ACTION_LABELS, ENEMY_LABELS, REGION_IDS, REGION_INFO } from '@sats-wars/shared';
import { type Board, type PlannedAction, type RegionThreat, recommendAction, threats } from '@sats-wars/game-engine';

/**
 * Display-only view of the defence for HUDs (phone + venue). Every number comes
 * from the server snapshot; the engine helpers only translate it into the
 * promises the screens show ("東北 falls next alien turn", "おすすめ").
 * The server stays authoritative: AUTO is resolved again on the server.
 */
export interface BoardView {
  board: Board;
  regions: Record<RegionId, RegionState>;
  threats: Record<RegionId, RegionThreat>;
  /** Danger map for the 3D/2D maps. */
  danger: Partial<Record<RegionId, { damageNext: number; willFall: boolean }>>;
  recommend: PlannedAction | null;
  /** Paid actions until the aliens move. */
  turnLeft: number;
  fallenCount: number;
  comboReady: boolean;
  /** Regions that fall at the next alien turn unless someone acts. */
  doomed: RegionId[];
}

export function boardView(snap: PublicMatchSnapshot): BoardView {
  const regions = Object.fromEntries(snap.regions.map((r) => [r.regionId, r])) as Record<RegionId, RegionState>;
  const board: Board = {
    config: snap.config,
    regions,
    enemies: snap.enemies,
    incoming: snap.incoming,
    combo: snap.combo,
    actionsThisTurn: snap.actionsThisTurn,
  };
  const th = threats(board);
  const danger: BoardView['danger'] = {};
  for (const id of REGION_IDS) {
    if (th[id].damageNext > 0) danger[id] = { damageNext: th[id].damageNext, willFall: th[id].willFall };
  }
  return {
    board,
    regions,
    threats: th,
    danger,
    recommend: snap.status === 'LIVE' ? recommendAction(board) : null,
    turnLeft: Math.max(0, snap.config.actionsPerTurn - snap.actionsThisTurn),
    fallenCount: snap.regions.filter((r) => r.fallen).length,
    comboReady: snap.combo >= snap.config.comboGaugeMax,
    doomed: REGION_IDS.filter((id) => th[id].willFall),
  };
}

export const regionName = (id: RegionId, locale: 'ja' | 'en') =>
  locale === 'ja' ? REGION_INFO[id].labelJa : REGION_INFO[id].labelEn;

export const enemyName = (e: Pick<Enemy, 'kind'>, locale: 'ja' | 'en') =>
  `${ENEMY_LABELS[e.kind].icon} ${locale === 'ja' ? ENEMY_LABELS[e.kind].ja : ENEMY_LABELS[e.kind].en}`;

/** "⚡ 東北の侵略メカに雷撃" — what the おすすめ button will do. */
export function describePlan(plan: PlannedAction, enemies: Enemy[], locale: 'ja' | 'en'): string {
  const a = ACTION_LABELS[plan.action];
  const where = regionName(plan.regionId, locale);
  const target = plan.enemyId !== undefined ? enemies.find((e) => e.id === plan.enemyId) : undefined;
  if (locale === 'ja') {
    switch (plan.action) {
      case 'RAIJIN':
        return `${a.icon} ${where}の${target ? ENEMY_LABELS[target.kind].ja : '敵'}に雷撃`;
      case 'FUJIN':
        return `${a.icon} ${where}に竜巻（全員にダメージ）`;
      case 'SHIELD':
        return `${a.icon} ${where}に結界`;
      case 'COMBO':
        return `${a.icon} ${where}に合体技！`;
    }
  }
  switch (plan.action) {
    case 'RAIJIN':
      return `${a.icon} Strike the ${target ? ENEMY_LABELS[target.kind].en : 'alien'} in ${where}`;
    case 'FUJIN':
      return `${a.icon} Tornado on ${where}`;
    case 'SHIELD':
      return `${a.icon} Barrier on ${where}`;
    case 'COMBO':
      return `${a.icon} Combo on ${where}!`;
  }
}
