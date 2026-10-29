import type { CityId } from './japan';
import type { Direction, SeatId } from './seats';
import { SEAT_IDS } from './seats';

/**
 * Every balance number lives here (spec §6.4) so the operator can pick a preset and the
 * server can freeze it per match (configHash). Engine code never hard-codes a number that
 * belongs to balance.
 */

export const ENEMY_KINDS = ['DRONE', 'STRIKER', 'NULL_CORE'] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

export const PRESET_IDS = ['STANDARD', 'SHORT', 'TEST'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export interface EnemyDef {
  hp: number;
  /** Damage of one unblocked attack. */
  damage: number;
  attackMinMs: number;
  attackMaxMs: number;
  /** Visual placement: how far and how high the enemy hangs around RAIJIN (scene units). */
  distance: [number, number];
  altitude: [number, number];
  /** Seconds the enemy takes to arrive; untargetable until then. */
  arriveMs: number;
}

export interface SpawnSpec {
  kind: EnemyKind;
  bearing: number;
  /** Scripted first attack (tutorial). Omitted = random within the enemy's cadence. */
  firstAttackAtMs?: number;
  /** Scripted tutorial targets so the first threats always read clearly. */
  firstTargetCity?: CityId;
}

export interface WaveScript {
  /** Spawns at fixed offsets from the wave start. */
  scripted: Array<SpawnSpec & { atMs: number }>;
  spawnEveryMs: number;
  maxAlive: number;
  pool: Array<{ kind: EnemyKind; weight: number }>;
  /** Bearing ranges (deg) random spawns are drawn from. */
  bearings: Array<[number, number]>;
  /** Share of attacks that strike the mech itself instead of a city. */
  mechTargetShare: number;
}

export interface PowerDistribution {
  weapon: number;
  shield: number;
  mobility: number;
  repair: number;
}

export interface GameConfig {
  presetId: PresetId;
  /** Seats a human may board. Others are flown by AUTO SUPPORT (or idle). */
  openSeats: SeatId[];
  timings: {
    countdownMs: number;
    deploymentMs: number;
    wave1Ms: number;
    wave2Ms: number;
    bossMs: number;
    victoryMs: number;
    defeatMs: number;
    resultsMs: number;
    /** Telegraph length: every enemy attack is announced this long before impact (§3.6). */
    threatWarnMs: number;
    /** Seat kept for a disconnected pilot before it is released (§5.7). */
    seatHoldMs: number;
  };
  core: { max: number };
  cities: { hp: number; lostForDefeat: number; coreShareOfCityHit: number };
  enemies: Record<EnemyKind, EnemyDef>;
  /**
   * Crew-size compensation (humans aboard at launch, at least 1):
   * enemy HP × min(1, hpBase + hpPerPilot·crew); attack intervals × (1 + slowPerMissing·(8 − crew)).
   */
  difficulty: { hpBase: number; hpPerPilot: number; slowPerMissing: number };
  weapons: {
    seats: Record<'GUNNER_L' | 'GUNNER_R', { damage: number; chargeMs: number }>;
    cooldownMs: number;
    energyCost: number;
    weakMultiplier: number;
    weakPointMs: number;
  };
  shields: {
    energyCost: number;
    activeMs: number;
    /** Deploying within this many ms before impact counts as a PERFECT guard. */
    perfectMs: number;
    cooldownMs: number;
  };
  energy: { regenPerSec: number; start: number; laneMax: number };
  power: { defaultDistribution: PowerDistribution };
  mech: {
    /** Mech-targeted hits are softened by this ratio when the mobility lane can pay. */
    evadeRatio: number;
    evadeCost: number;
    /** Share of a mech hit that also chips CORE integrity. */
    coreShareOfMechHit: number;
  };
  repair: { energyCost: number; amount: number; cooldownMs: number };
  sync: {
    windowMs: number;
    gainByRoles: Record<2 | 3 | 4, number>;
    perAction: number;
    decayPerSec: number;
    decayAfterMs: number;
  };
  capacitor: {
    perHit: number;
    perBlock: number;
    perPerfect: number;
    perCombo: number;
    max: number;
  };
  overdrive: { syncMin: number; capacitorMin: number; damage: number; windowMs: number };
  auto: {
    gunnerEveryMs: number;
    gunnerDamageRatio: number;
    shieldBlockRatio: number;
    shieldCooldownMs: number;
    engineerEveryMs: number;
    engineerAmount: number;
  };
  waves: Record<'WAVE_1' | 'WAVE_2' | 'BOSS', WaveScript>;
}

const ENEMIES: Record<EnemyKind, EnemyDef> = {
  DRONE: {
    hp: 80,
    damage: 45,
    attackMinMs: 9_000,
    attackMaxMs: 13_000,
    distance: [55, 80],
    altitude: [14, 30],
    arriveMs: 1_800,
  },
  STRIKER: {
    hp: 220,
    damage: 80,
    attackMinMs: 8_000,
    attackMaxMs: 11_000,
    distance: [60, 90],
    altitude: [18, 36],
    arriveMs: 2_400,
  },
  NULL_CORE: {
    hp: 1_800,
    // Below a city's HP: one missed lance hurts, it never erases a city outright.
    damage: 90,
    attackMinMs: 6_500,
    attackMaxMs: 8_000,
    distance: [120, 120],
    altitude: [52, 52],
    arriveMs: 4_000,
  },
};

const STANDARD: GameConfig = {
  presetId: 'STANDARD',
  // Phase 1 vertical slice: gunners and shields are boardable; power and engineer seats are
  // flown by the clearly labelled AUTO SUPPORT until their consoles land in Phase 2.
  openSeats: ['GUNNER_L', 'GUNNER_R', 'SHIELD_L', 'SHIELD_R'],
  timings: {
    countdownMs: 3_000,
    deploymentMs: 8_000,
    wave1Ms: 55_000,
    wave2Ms: 65_000,
    bossMs: 90_000,
    victoryMs: 6_000,
    defeatMs: 6_000,
    resultsMs: 14_000,
    threatWarnMs: 4_500,
    seatHoldMs: 60_000,
  },
  core: { max: 1_000 },
  cities: { hp: 120, lostForDefeat: 3, coreShareOfCityHit: 0.5 },
  enemies: ENEMIES,
  difficulty: { hpBase: 0.45, hpPerPilot: 0.07, slowPerMissing: 0.08 },
  weapons: {
    seats: {
      GUNNER_L: { damage: 42, chargeMs: 1_400 },
      GUNNER_R: { damage: 26, chargeMs: 900 },
    },
    cooldownMs: 3_000,
    energyCost: 15,
    weakMultiplier: 1.5,
    weakPointMs: 6_000,
  },
  shields: { energyCost: 18, activeMs: 2_500, perfectMs: 1_200, cooldownMs: 8_000 },
  energy: { regenPerSec: 24, start: 60, laneMax: 100 },
  power: { defaultDistribution: { weapon: 35, shield: 30, mobility: 15, repair: 20 } },
  mech: { evadeRatio: 0.6, evadeCost: 20, coreShareOfMechHit: 0.6 },
  repair: { energyCost: 10, amount: 25, cooldownMs: 8_000 },
  sync: {
    windowMs: 10_000,
    gainByRoles: { 2: 6, 3: 10, 4: 15 },
    perAction: 1,
    decayPerSec: 0.4,
    decayAfterMs: 8_000,
  },
  capacitor: { perHit: 2, perBlock: 3, perPerfect: 5, perCombo: 4, max: 100 },
  overdrive: { syncMin: 80, capacitorMin: 100, damage: 300, windowMs: 5_000 },
  auto: {
    gunnerEveryMs: 4_500,
    gunnerDamageRatio: 0.4,
    shieldBlockRatio: 0.5,
    shieldCooldownMs: 10_000,
    engineerEveryMs: 6_000,
    engineerAmount: 8,
  },
  waves: {
    WAVE_1: {
      // Tutorial: the first two attacks are scripted so both shield seats see one early.
      scripted: [
        {
          atMs: 600,
          kind: 'DRONE',
          bearing: -12,
          firstAttackAtMs: 6_000,
          firstTargetCity: 'TOKYO',
        },
        {
          atMs: 900,
          kind: 'DRONE',
          bearing: 78,
          firstAttackAtMs: 14_000,
          firstTargetCity: 'OSAKA',
        },
        { atMs: 8_000, kind: 'DRONE', bearing: -70 },
      ],
      spawnEveryMs: 7_000,
      maxAlive: 5,
      pool: [{ kind: 'DRONE', weight: 1 }],
      bearings: [
        [-110, -50],
        [-40, 40],
        [50, 110],
      ],
      mechTargetShare: 0.2,
    },
    WAVE_2: {
      scripted: [
        { atMs: 500, kind: 'STRIKER', bearing: 150 },
        { atMs: 1_500, kind: 'STRIKER', bearing: -95 },
      ],
      spawnEveryMs: 6_000,
      maxAlive: 6,
      pool: [
        { kind: 'DRONE', weight: 2 },
        { kind: 'STRIKER', weight: 1 },
      ],
      bearings: [
        [-170, -110],
        [-100, -50],
        [-40, 40],
        [50, 100],
        [110, 170],
      ],
      mechTargetShare: 0.35,
    },
    BOSS: {
      scripted: [{ atMs: 1_000, kind: 'NULL_CORE', bearing: 6, firstAttackAtMs: 9_000 }],
      spawnEveryMs: 11_000,
      maxAlive: 5,
      pool: [
        { kind: 'DRONE', weight: 3 },
        { kind: 'STRIKER', weight: 1 },
      ],
      bearings: [
        [-170, -100],
        [-80, -50],
        [50, 80],
        [100, 170],
      ],
      mechTargetShare: 0.35,
    },
  },
};

function derive(base: GameConfig, patch: (c: GameConfig) => void): GameConfig {
  const c = structuredClone(base);
  patch(c);
  return c;
}

export const PRESETS: Record<PresetId, GameConfig> = {
  STANDARD,
  // ~150 s of combat for busy exhibition hours (§6.1).
  SHORT: derive(STANDARD, (c) => {
    c.presetId = 'SHORT';
    c.timings.deploymentMs = 6_000;
    c.timings.wave1Ms = 40_000;
    c.timings.wave2Ms = 45_000;
    c.timings.bossMs = 65_000;
    c.timings.resultsMs = 12_000;
    c.enemies.NULL_CORE.hp = 1_400;
  }),
  // Fast lead-in for automated tests only; the server refuses it in production.
  TEST: derive(STANDARD, (c) => {
    c.presetId = 'TEST';
    c.timings.countdownMs = 500;
    c.timings.deploymentMs = 1_000;
  }),
};

export const DEFAULT_PRESET: PresetId = 'STANDARD';

export function combatDurationMs(c: GameConfig): number {
  return c.timings.wave1Ms + c.timings.wave2Ms + c.timings.bossMs;
}

export function isSeatOpen(c: GameConfig, seat: SeatId): boolean {
  return c.openSeats.includes(seat);
}

/** Stable JSON (sorted keys) so equal configs hash equally. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/** FNV-1a (32-bit) of the stable JSON. Identifies a balance set; not a security hash. */
export function configHash(c: GameConfig): string {
  const s = stableStringify(c);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const ALL_SEATS_OPEN: SeatId[] = [...SEAT_IDS];

export type { Direction };
