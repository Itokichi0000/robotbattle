/**
 * ONE MECH. EIGHT PILOTS. RAIJIN-01 is a single machine; the eight seats are physical
 * stations on it (spec §5). Never model them as eight robots.
 */

export const ROLE_IDS = ['GUNNER', 'DEFENSE', 'POWER', 'ENGINEER'] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export const SEAT_IDS = [
  'GUNNER_L',
  'GUNNER_R',
  'SHIELD_L',
  'SHIELD_R',
  'POWER_CORE',
  'POWER_ROUTER',
  'ENGINEER_LEGS',
  'ENGINEER_CORE',
] as const;
export type SeatId = (typeof SEAT_IDS)[number];

export type GunnerSeatId = 'GUNNER_L' | 'GUNNER_R';
export type ShieldSeatId = 'SHIELD_L' | 'SHIELD_R';
export type PowerSeatId = 'POWER_CORE' | 'POWER_ROUTER';
export type EngineerSeatId = 'ENGINEER_LEGS' | 'ENGINEER_CORE';

/** Damageable sections of RAIJIN-01 (gameplay health, 0..100). */
export const MECH_PART_IDS = [
  'ARM_L',
  'ARM_R',
  'SHOULDER_L',
  'SHOULDER_R',
  'CORE',
  'LEG_L',
  'LEG_R',
] as const;
export type MechPartId = (typeof MECH_PART_IDS)[number];

/** Directions are relative to RAIJIN's facing. Bearing 0 = straight ahead, +90 = right. */
export const DIRECTIONS = ['FRONT', 'RIGHT', 'REAR', 'LEFT'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export interface SeatDef {
  id: SeatId;
  /** 1-based station number painted on the hull and shown on phones. */
  no: number;
  role: RoleId;
  /** Physical station on the mech, used to light the right part on the big screen. */
  station: string;
  labelJa: string;
  labelEn: string;
  partJa: string;
  partEn: string;
  /** What this seat is uniquely responsible for (so two seats of a role are not clones). */
  dutyJa: string;
  dutyEn: string;
}

export const SEATS: Record<SeatId, SeatDef> = {
  GUNNER_L: {
    id: 'GUNNER_L',
    no: 1,
    role: 'GUNNER',
    station: 'cannonL',
    labelJa: '砲撃 左',
    labelEn: 'GUNNER L',
    partJa: '左腕主砲',
    partEn: 'Left arm main cannon',
    dutyJa: '重砲で敵を撃ち落とす',
    dutyEn: 'Heavy cannon: knock enemies down',
  },
  GUNNER_R: {
    id: 'GUNNER_R',
    no: 2,
    role: 'GUNNER',
    station: 'cannonR',
    labelJa: '砲撃 右',
    labelEn: 'GUNNER R',
    partJa: '右腕レールガン',
    partEn: 'Right arm railgun',
    dutyJa: '弱点をロックして全砲撃の威力を上げる',
    dutyEn: 'Lock weak points to boost every gun',
  },
  SHIELD_L: {
    id: 'SHIELD_L',
    no: 3,
    role: 'DEFENSE',
    station: 'shoulderL',
    labelJa: '防衛 左',
    labelEn: 'SHIELD L',
    partJa: '左肩防盾',
    partEn: 'Left shoulder shield',
    dutyJa: '前方と左側の攻撃を防ぐ',
    dutyEn: 'Guard FRONT and LEFT',
  },
  SHIELD_R: {
    id: 'SHIELD_R',
    no: 4,
    role: 'DEFENSE',
    station: 'shoulderR',
    labelJa: '防衛 右',
    labelEn: 'SHIELD R',
    partJa: '右肩防盾',
    partEn: 'Right shoulder shield',
    dutyJa: '右側と後方の攻撃を防ぐ',
    dutyEn: 'Guard RIGHT and REAR',
  },
  POWER_CORE: {
    id: 'POWER_CORE',
    no: 5,
    role: 'POWER',
    station: 'core',
    labelJa: '電力 A',
    labelEn: 'POWER A',
    partJa: '胸部炉心',
    partEn: 'Chest reactor',
    dutyJa: '出力を砲撃・防衛・機動・修理へ配分',
    dutyEn: 'Split reactor output across the systems',
  },
  POWER_ROUTER: {
    id: 'POWER_ROUTER',
    no: 6,
    role: 'POWER',
    station: 'backpack',
    labelJa: '電力 B',
    labelEn: 'POWER B',
    partJa: '背部回路',
    partEn: 'Back circuit',
    dutyJa: '送電ルートの切替と過負荷の解除',
    dutyEn: 'Reroute power, clear overloads',
  },
  ENGINEER_LEGS: {
    id: 'ENGINEER_LEGS',
    no: 7,
    role: 'ENGINEER',
    station: 'legs',
    labelJa: '整備 A',
    labelEn: 'ENGINEER A',
    partJa: '脚・関節',
    partEn: 'Legs and joints',
    dutyJa: '脚と肩関節の応急修理',
    dutyEn: 'Field-repair legs and shoulder joints',
  },
  ENGINEER_CORE: {
    id: 'ENGINEER_CORE',
    no: 8,
    role: 'ENGINEER',
    station: 'torso',
    labelJa: '整備 B',
    labelEn: 'ENGINEER B',
    partJa: '胸部・砲塔',
    partEn: 'Core and weapons',
    dutyJa: 'コアと両腕砲の修理',
    dutyEn: 'Repair the core and both arm guns',
  },
};

export interface RoleDef {
  id: RoleId;
  no: number;
  labelJa: string;
  labelEn: string;
  /** CSS token name of the role accent (see @swed/ui-tokens). */
  accent: 'action' | 'ally' | 'power' | 'repair';
  seats: readonly SeatId[];
}

export const ROLES: Record<RoleId, RoleDef> = {
  GUNNER: {
    id: 'GUNNER',
    no: 1,
    labelJa: '砲撃席',
    labelEn: 'GUNNER',
    accent: 'action',
    seats: ['GUNNER_L', 'GUNNER_R'],
  },
  DEFENSE: {
    id: 'DEFENSE',
    no: 2,
    labelJa: '防衛席',
    labelEn: 'DEFENSE',
    accent: 'ally',
    seats: ['SHIELD_L', 'SHIELD_R'],
  },
  POWER: {
    id: 'POWER',
    no: 3,
    labelJa: '電力接続席',
    labelEn: 'POWER',
    accent: 'power',
    seats: ['POWER_CORE', 'POWER_ROUTER'],
  },
  ENGINEER: {
    id: 'ENGINEER',
    no: 4,
    labelJa: '整備席',
    labelEn: 'ENGINEER',
    accent: 'repair',
    seats: ['ENGINEER_LEGS', 'ENGINEER_CORE'],
  },
};

/** Which directions each shield seat covers. They never overlap (spec §5.4). */
export const SHIELD_COVERAGE: Record<ShieldSeatId, readonly Direction[]> = {
  SHIELD_L: ['FRONT', 'LEFT'],
  SHIELD_R: ['RIGHT', 'REAR'],
};

/** Which mech parts each engineer seat may repair (spec §5.6). */
export const ENGINEER_COVERAGE: Record<EngineerSeatId, readonly MechPartId[]> = {
  ENGINEER_LEGS: ['LEG_L', 'LEG_R', 'SHOULDER_L', 'SHOULDER_R'],
  ENGINEER_CORE: ['CORE', 'ARM_L', 'ARM_R'],
};

export const PARTS: Record<MechPartId, { labelJa: string; labelEn: string }> = {
  ARM_L: { labelJa: '左腕', labelEn: 'ARM-L' },
  ARM_R: { labelJa: '右腕', labelEn: 'ARM-R' },
  SHOULDER_L: { labelJa: '左肩', labelEn: 'SHOULDER-L' },
  SHOULDER_R: { labelJa: '右肩', labelEn: 'SHOULDER-R' },
  CORE: { labelJa: 'コア', labelEn: 'CORE' },
  LEG_L: { labelJa: '左脚', labelEn: 'LEG-L' },
  LEG_R: { labelJa: '右脚', labelEn: 'LEG-R' },
};

export const DIRECTION_LABEL: Record<Direction, { ja: string; en: string }> = {
  FRONT: { ja: '前方', en: 'FRONT' },
  RIGHT: { ja: '右側', en: 'RIGHT' },
  REAR: { ja: '後方', en: 'REAR' },
  LEFT: { ja: '左側', en: 'LEFT' },
};

export function roleOf(seat: SeatId): RoleId {
  return SEATS[seat].role;
}

export function isSeatId(v: unknown): v is SeatId {
  return typeof v === 'string' && (SEAT_IDS as readonly string[]).includes(v);
}

/** Bearing in degrees (0 = ahead, +90 = right) to the direction sector it falls in. */
export function bearingToDirection(bearingDeg: number): Direction {
  const b = ((((bearingDeg + 180) % 360) + 360) % 360) - 180;
  if (b >= -45 && b < 45) return 'FRONT';
  if (b >= 45 && b < 135) return 'RIGHT';
  if (b >= -135 && b < -45) return 'LEFT';
  return 'REAR';
}

export function shieldSeatFor(dir: Direction): ShieldSeatId {
  return SHIELD_COVERAGE.SHIELD_L.includes(dir) ? 'SHIELD_L' : 'SHIELD_R';
}
