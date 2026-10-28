import { z } from 'zod';

/**
 * ZAP BATTLE rules (v3). Every balance/timing number is injected through
 * GameConfig; a season stores a frozen copy, edits apply to the next season.
 * Durations are milliseconds of game time (pause-corrected).
 */
export const gameConfigSchema = z
  .object({
    version: z.string().min(1).max(64),
    /** Season opening show before round 1. */
    openingMs: z.number().int().min(0).max(120_000),
    roundsPerSeason: z.number().int().min(1).max(8),
    /** A round ends by KO or when this time runs out. */
    roundMaxMs: z.number().int().min(10_000).max(10 * 60_000),
    /** KO / time-up celebration and "next region" announcement. */
    roundEndMs: z.number().int().min(1_000).max(120_000),
    seasonEndMs: z.number().int().min(1_000).max(10 * 60_000),
    /** Price of one punch, deducted from the player's prepaid credit. */
    zapCostSats: z.number().int().min(1).max(100_000),
    /** Top-up amounts offered to players (sats). */
    topupOptionsSats: z.array(z.number().int().min(1).max(1_000_000)).min(1).max(6),
    zapDamage: z.number().int().min(1).max(10_000),
    /** At or below this HP ratio a robot is "in a pinch" and hits harder. */
    pinchHpRatio: z.number().min(0).max(1),
    pinchMultiplier: z.number().min(1).max(5),
    /** Every Nth punch of a team in a round is a special move. */
    specialEvery: z.number().int().min(2).max(1000),
    specialDamage: z.number().int().min(1).max(100_000),
    /** HP of each robot in round 1; later rounds adapt to the crowd. */
    hpInitial: z.number().int().min(10),
    hpMin: z.number().int().min(10),
    hpCap: z.number().int().min(10),
    /** Adaptive HP aims for a round of about this many seconds. */
    targetRoundSec: z.number().min(5).max(300),
    /** Max factor by which HP may grow/shrink from one round to the next. */
    hpMaxChangeFactor: z.number().min(1).max(10),
    /** Minimum gap between two punches of the same player (server-enforced). */
    zapCooldownMs: z.number().int().min(0).max(10_000),
    cheerCooldownMs: z.number().int().min(0).max(60_000),
    /** Pause between seasons before the next one starts automatically. */
    nextSeasonDelayMs: z.number().int().min(0).max(10 * 60_000),
    invoiceTtlMs: z
      .number()
      .int()
      .min(30_000)
      .max(60 * 60_000),
  })
  .refine((c) => c.hpMin <= c.hpCap && c.hpInitial >= c.hpMin && c.hpInitial <= c.hpCap, {
    message: 'hpMin <= hpInitial <= hpCap required',
  });

export type GameConfig = z.infer<typeof gameConfigSchema>;

export const DEFAULT_GAME_CONFIG: GameConfig = {
  version: 'zap-2',
  openingMs: 6_000,
  roundsPerSeason: 8,
  roundMaxMs: 60_000,
  roundEndMs: 8_000,
  seasonEndMs: 20_000,
  zapCostSats: 21,
  topupOptionsSats: [105, 210, 525],
  zapDamage: 10,
  pinchHpRatio: 0.3,
  pinchMultiplier: 1.5,
  specialEvery: 10,
  specialDamage: 60,
  hpInitial: 200,
  hpMin: 150,
  // Large enough that 100+ people tapping still get ~half-minute rounds (BALANCE_REPORT).
  hpCap: 100_000,
  targetRoundSec: 35,
  hpMaxChangeFactor: 3,
  zapCooldownMs: 250,
  cheerCooldownMs: 1_000,
  nextSeasonDelayMs: 6_000,
  invoiceTtlMs: 10 * 60_000,
};

export function parseGameConfig(input: unknown): GameConfig {
  return gameConfigSchema.parse(input);
}

/** Build a config by overriding defaults, validating the result. */
export function makeGameConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return gameConfigSchema.parse({ ...DEFAULT_GAME_CONFIG, ...overrides });
}

/** Punches a credit balance can buy. */
export function zapsFor(creditSats: number, config: Pick<GameConfig, 'zapCostSats'>): number {
  return Math.floor(creditSats / config.zapCostSats);
}
