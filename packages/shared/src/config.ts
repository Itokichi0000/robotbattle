import { z } from 'zod';

/**
 * EARTH DEFENSE rules (co-op). Every balance number is injected through
 * GameConfig; a campaign stores a frozen copy, edits apply to the next one.
 * There are no round timers: the game advances only when players act
 * (every `actionsPerTurn` paid actions the aliens take a turn).
 */
const enemyStatsSchema = z.object({
  hp: z.number().int().min(1).max(100_000),
  attack: z.number().int().min(0).max(10_000),
});

export const gameConfigSchema = z
  .object({
    version: z.string().min(1).max(64),
    /** Price of one action, deducted from the player's prepaid credit. */
    actionCostSats: z.number().int().min(1).max(100_000),
    /** Top-up amounts offered on the phone (each should be a multiple of actionCostSats). */
    topupOptionsSats: z.array(z.number().int().min(1).max(1_000_000)).min(1).max(6),
    /** Player actions between two alien turns. */
    actionsPerTurn: z.number().int().min(1).max(200),
    /** Each region's city strength; a region is captured at 0. */
    cityHpMax: z.number().int().min(1).max(100_000),
    /** RAIJIN: big hit on one alien. */
    raijinDamage: z.number().int().min(1).max(100_000),
    /** FUJIN: smaller hit on every alien in the region. */
    fujinDamage: z.number().int().min(1).max(100_000),
    /** Barrier: absorbs this much alien damage in the region at the next alien turn. */
    shieldAbsorb: z.number().int().min(1).max(100_000),
    /** Combo gauge fills by 1 per action; when full anyone may fire the combo. */
    comboGaugeMax: z.number().int().min(1).max(1_000),
    comboDamage: z.number().int().min(1).max(1_000_000),
    comboHeal: z.number().int().min(0).max(100_000),
    /** Japan falls (campaign over) when this many regions are captured at once. */
    fallLimit: z.number().int().min(1).max(8),
    /** City strength a captured region gets back when liberated. */
    liberateHp: z.number().int().min(1).max(100_000),
    /** Every standing region is repaired by this much when a wave is cleared. */
    waveClearHeal: z.number().int().min(0).max(100_000),
    scout: enemyStatsSchema,
    walker: enemyStatsSchema,
    mothership: enemyStatsSchema,
    /** Enemy HP and attack grow by these fractions per wave after the first. */
    hpGrowthPerWave: z.number().min(0).max(10),
    attackGrowthPerWave: z.number().min(0).max(10),
    /** Aliens in wave w: waveBase + waveGrowth × w. */
    waveBase: z.number().int().min(1).max(1_000),
    waveGrowth: z.number().int().min(0).max(1_000),
    /** Every Nth wave starts with a mothership. */
    bossEvery: z.number().int().min(1).max(1_000),
    /** Landings per alien turn: 1 + floor((wave − 1) / landingsStepWaves). */
    landingsStepWaves: z.number().int().min(1).max(1_000),
    /** From this wave on, some landings are walkers instead of scouts. */
    walkersFromWave: z.number().int().min(1).max(1_000),
    /** After Japan falls, the result stays on screen this long before a new campaign. */
    nextCampaignDelayMs: z.number().int().min(0).max(10 * 60_000),
    /** Minimum gap between two actions of the same player (server-enforced). */
    actionCooldownMs: z.number().int().min(0).max(10_000),
    cheerCooldownMs: z.number().int().min(0).max(60_000),
    /** Lightning invoice expiry for top-ups. */
    invoiceTtlMs: z.number().int().min(60_000).max(24 * 60 * 60_000),
  })
  .refine((c) => c.liberateHp <= c.cityHpMax, { message: 'liberateHp <= cityHpMax required' });

export type GameConfig = z.infer<typeof gameConfigSchema>;
export type EnemyStats = z.infer<typeof enemyStatsSchema>;

export const DEFAULT_GAME_CONFIG: GameConfig = {
  version: 'def-1',
  actionCostSats: 21,
  topupOptionsSats: [105, 210, 525],
  actionsPerTurn: 8,
  cityHpMax: 70,
  raijinDamage: 45,
  fujinDamage: 20,
  shieldAbsorb: 40,
  comboGaugeMax: 12,
  comboDamage: 150,
  comboHeal: 30,
  fallLimit: 5,
  liberateHp: 30,
  waveClearHeal: 15,
  scout: { hp: 30, attack: 10 },
  walker: { hp: 70, attack: 20 },
  mothership: { hp: 260, attack: 32 },
  hpGrowthPerWave: 0.25,
  attackGrowthPerWave: 0.2,
  waveBase: 2,
  waveGrowth: 2,
  bossEvery: 5,
  landingsStepWaves: 1,
  walkersFromWave: 2,
  nextCampaignDelayMs: 15_000,
  actionCooldownMs: 400,
  cheerCooldownMs: 1_000,
  invoiceTtlMs: 10 * 60_000,
};

export function parseGameConfig(input: unknown): GameConfig {
  return gameConfigSchema.parse(input);
}

/** Build a config by overriding defaults, validating the result. */
export function makeGameConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return gameConfigSchema.parse({ ...DEFAULT_GAME_CONFIG, ...overrides });
}

/** Actions a credit balance can buy. */
export function actionsFor(creditSats: number, config: Pick<GameConfig, 'actionCostSats'>): number {
  return Math.floor(creditSats / config.actionCostSats);
}
