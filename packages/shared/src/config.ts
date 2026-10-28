import { z } from 'zod';
import { DEFAULT_REGION_LAYOUT, REGION_IDS, REGION_KINDS } from './regions';

export const regionLayoutSchema = z
  .array(z.object({ regionId: z.enum(REGION_IDS), kind: z.enum(REGION_KINDS) }))
  .length(REGION_IDS.length)
  .refine((layout) => new Set(layout.map((r) => r.regionId)).size === layout.length, {
    message: 'regionId must be unique',
  });

/**
 * Every balance/timing number is injected through GameConfig. A match stores a
 * frozen copy (with `version`) when it is created; edits apply to the next match only.
 * All durations are milliseconds of *game time* (pause-corrected).
 */
export const gameConfigSchema = z
  .object({
    version: z.string().min(1).max(64),
    lobbyMs: z.number().int().min(0).max(30 * 60_000),
    /** Start LIVE automatically when the lobby countdown ends. */
    autoStartAfterLobby: z.boolean(),
    /** Main game length (LIVE + FINALIZING). */
    matchMs: z.number().int().min(10_000).max(60 * 60_000),
    actionCloseMs: z.number().int().min(5_000),
    clashTimesMs: z.array(z.number().int().positive()).min(1).max(50),
    joinCloseMs: z.number().int().min(0),
    contestWindowMs: z.number().int().min(1_000),
    shieldDurationMs: z.number().int().min(1_000),
    shieldMax: z.number().int().min(1).max(5),
    hpMax: z.number().int().min(1).max(10_000),
    energyMax: z.number().int().min(1).max(1_000),
    chargeAmount: z.number().int().min(1),
    baseDamage: z.number().int().min(0),
    attackRegionBonus: z.number().int().min(0),
    defenseRegionReduction: z.number().int().min(0),
    energyRegionGain: z.number().int().min(0),
    specialThreshold: z.number().int().min(1),
    specialBonus: z.number().int().min(0),
    specialCost: z.number().int().min(0),
    energyBonusPer10: z.number().int().min(0),
    energyBonusMax: z.number().int().min(0),
    damageMin: z.number().int().min(0),
    damageMax: z.number().int().min(1),
    apPerParticipant: z.number().int().min(1).max(20),
    entryFeeSats: z.number().int().min(1).max(100_000),
    invoiceTtlMs: z.number().int().min(30_000).max(60 * 60_000),
    reservationTtlMs: z.number().int().min(30_000).max(60 * 60_000),
    maxParticipantsPerTeam: z.number().int().min(1).max(10_000),
    regions: regionLayoutSchema,
  })
  .refine((c) => c.actionCloseMs <= c.matchMs, { message: 'actionCloseMs must be <= matchMs' })
  .refine((c) => c.joinCloseMs <= c.actionCloseMs, {
    message: 'joinCloseMs must be <= actionCloseMs',
  })
  .refine((c) => c.clashTimesMs.every((t) => t <= c.actionCloseMs), {
    message: 'clashes must happen before or at actionCloseMs',
  })
  .refine((c) => c.clashTimesMs.every((t, i, a) => i === 0 || t > a[i - 1]!), {
    message: 'clashTimesMs must be strictly increasing',
  })
  .refine((c) => c.damageMin <= c.damageMax, { message: 'damageMin must be <= damageMax' });

export type GameConfig = z.infer<typeof gameConfigSchema>;

export const DEFAULT_GAME_CONFIG: GameConfig = {
  version: 'mvp-1',
  lobbyMs: 30_000,
  autoStartAfterLobby: true,
  matchMs: 300_000,
  actionCloseMs: 270_000,
  clashTimesMs: [45_000, 90_000, 135_000, 180_000, 225_000, 270_000],
  joinCloseMs: 180_000,
  contestWindowMs: 25_000,
  shieldDurationMs: 30_000,
  shieldMax: 1,
  hpMax: 100,
  energyMax: 60,
  chargeAmount: 10,
  baseDamage: 10,
  attackRegionBonus: 3,
  defenseRegionReduction: 2,
  energyRegionGain: 5,
  specialThreshold: 30,
  specialBonus: 10,
  specialCost: 30,
  energyBonusPer10: 2,
  energyBonusMax: 4,
  damageMin: 2,
  damageMax: 28,
  apPerParticipant: 3,
  entryFeeSats: 21,
  invoiceTtlMs: 120_000,
  reservationTtlMs: 180_000,
  maxParticipantsPerTeam: 100,
  regions: DEFAULT_REGION_LAYOUT.map((r) => ({ ...r })),
};

export function parseGameConfig(input: unknown): GameConfig {
  return gameConfigSchema.parse(input);
}

/** Build a config by overriding defaults, validating the result. */
export function makeGameConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return gameConfigSchema.parse({ ...DEFAULT_GAME_CONFIG, ...overrides });
}
