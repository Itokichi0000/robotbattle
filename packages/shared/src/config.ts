import { z } from 'zod';
import { ENEMY_KINDS } from './state';

/**
 * Every rule number of SATS WARS: EARTH DEFENSE (8-minute co-op raid).
 * Defaults follow the spec's initial hypotheses (§C6) and are tuned with the
 * simulator (docs/BALANCE_REPORT.md); none of them is final until playtested.
 * A raid freezes a copy at creation (configVersion + configHash), so edits
 * only affect the next raid.
 */
const range = z.tuple([z.number().int().min(0), z.number().int().min(0)]);

const enemySchema = z.object({
  hp: z.number().int().min(1),
  /** City damage per resolved attack (before shields). */
  damage: z.number().int().min(0),
  telegraphMs: range,
  recoveryMs: range,
});

export const gameConfigSchema = z
  .object({
    version: z.string().min(1).max(40),

    // ---- raid timeline (seconds of game time) ----
    matchSeconds: z.number().int().min(60).max(3600),
    lobbySeconds: z.number().int().min(0).max(600),
    cutoffForPaidJoinAtSeconds: z.number().int().min(0).max(3600),
    resultsSeconds: z.number().int().min(5).max(600),
    /** Phase starts: INTRO_TRAINING at 0, then WAVE_1, WAVE_2, WAVE_3, FINAL_WAVE. */
    phaseStartsSeconds: z.object({
      WAVE_1: z.number().int().min(1),
      WAVE_2: z.number().int().min(1),
      WAVE_3: z.number().int().min(1),
      FINAL_WAVE: z.number().int().min(1),
    }),
    maxPilots: z.number().int().min(1).max(1000),
    serverTickMs: z.number().int().min(20).max(1000),

    // ---- cities ----
    cityCount: z.literal(8),
    cityMaxHp: z.number().int().min(1),
    /** The raid is lost as soon as fewer cities than this are standing. */
    minimumSurvivingCities: z.number().int().min(1).max(8),
    cityShieldMax: z.number().int().min(0),
    /** An ENGINEER can bring a destroyed city back to this HP (once per cooldown). */
    cityRebuildHp: z.number().int().min(0),
    cityRebuildCooldownSeconds: z.number().int().min(0),

    // ---- boss & enemies ----
    bossBaseHp: z.number().int().min(1),
    scout: enemySchema,
    siege: enemySchema,
    saboteur: enemySchema.extend({
      energyDrain: z.number().int().min(0),
      jamSeconds: z.number().int().min(0),
    }),
    boss: enemySchema.omit({ hp: true }).extend({
      /** Below this HP share the boss alternates its beam with a sweep over 3 cities. */
      sweepBelowHpRatio: z.number().min(0).max(1),
      sweepDamage: z.number().int().min(0),
      /**
       * In FINAL_WAVE the core hardens: gunner damage to the boss is multiplied
       * by this until 神雷風陣 lands. Cooperation, not raw clicking, finishes it.
       */
      finalArmorFactor: z.number().min(0).max(1),
    }),
    /** When each enemy enters (game seconds). The boss is the BOSS entry. */
    spawns: z
      .array(z.object({ atSeconds: z.number().int().min(0), kind: z.enum(ENEMY_KINDS) }))
      .min(1),
    /** INTRO_TRAINING attacks deal this share of their damage (no fatal blows while learning). */
    trainingDamageRatio: z.number().min(0).max(1),

    // ---- pilots, seats and minigames ----
    roleChangeCooldownSeconds: z.number().int().min(0),
    miniGameDurationSeconds: z.number().int().min(3).max(60),
    inputGraceSeconds: z.number().int().min(0).max(10),
    normalActionCooldownSeconds: z.number().int().min(0).max(120),
    /** Window used for "active pilots" (difficulty) and per-role crowd normalisation. */
    activeWindowSeconds: z.number().int().min(5),
    /**
     * Per-seat crowd normalisation: a seat works at full strength with up to
     * this share of the active crew (at least one pilot); beyond that each
     * action is scaled down. A crowd piling onto one seat cannot one-shot the
     * boss, and spreading over the four seats is always stronger.
     */
    roleFairShare: z.number().min(0.05).max(1),
    gunner: z.object({
      damage: z.object({ CORE: z.number().int(), ARM: z.number().int(), LEG: z.number().int() }),
      /** ARM hit: next attacks of that enemy deal this much less (stacks to max). */
      armWeaken: z.number().min(0).max(1),
      armWeakenMax: z.number().min(0).max(1),
      /** LEG hit: the current telegraph resolves this much later (once per telegraph). */
      legDelaySeconds: z.number().int().min(0),
      energyPerHit: z.number().int().min(0),
    }),
    guardian: z.object({ shield: z.number().int().min(0), standbyRatio: z.number().min(0).max(1) }),
    router: z.object({ energy: z.number().int().min(0) }),
    engineer: z.object({
      repairCity: z.number().int().min(0),
      repairRobot: z.number().int().min(0),
    }),
    /** Robot energy boosts its seat's effect by up to this share. */
    energyBoostMax: z.number().min(0).max(2),
    /** Damaged component (Raijin drum / Fujin ring) multiplies its effect by this. */
    damagedComponentFactor: z.number().min(0).max(1),

    // ---- SYNC RATE ----
    sync: z.object({
      windowSeconds: z.number().int().min(5),
      gainTwoRoles: z.number().int().min(0),
      gainThreeRoles: z.number().int().min(0),
      gainFourRoles: z.number().int().min(0),
      decayEverySeconds: z.number().int().min(1),
      decayAmount: z.number().int().min(0),
      max: z.number().int().min(1),
    }),

    // ---- 神雷風陣 SHINRAI FUJIN ----
    special: z.object({
      availableAfterSeconds: z.number().int().min(0),
      activationWindowSeconds: z.number().int().min(1),
      requiredDistinctPilots: z.number().int().min(1).max(4),
      syncMinimum: z.number().int().min(0),
      energyMinimum: z.number().int().min(0),
      damage: z.number().int().min(0),
      /** Fallback 雷風連撃 when the window closes with partial cooperation. */
      fallbackDamage: z.number().int().min(0),
      fallbackSyncMinimum: z.number().int().min(0),
      /** Nobody cooperated: the boss fires NULL BEAM on every city. */
      failBeamDamage: z.number().int().min(0),
    }),

    // ---- difficulty & assist ----
    /** Enemy HP scales with active pilots / this (clamped to [min,max]). */
    difficultyReferencePilots: z.number().int().min(1),
    /** Below the reference crew, enemy HP shrinks faster than linearly: small crews also cover fewer seats. */
    difficultySmallCrewExponent: z.number().min(1).max(3),
    difficultyMinScale: z.number().min(0.05).max(1),
    difficultyMaxScale: z.number().min(1).max(10),
    /** Below this many active pilots an assist AI fills empty seats (recorded in results). */
    assistBelowPilots: z.number().int().min(0),
    assistIntervalSeconds: z.number().int().min(1),
    assistSuccess: z.number().min(0).max(1),

    // ---- pass & payments ----
    ticketPriceSats: z.number().int().min(0).max(100_000),
    invoiceTtlMs: z.number().int().min(10_000).max(3_600_000),
    cheerCooldownMs: z.number().int().min(0),
  })
  .refine(
    (c) =>
      c.phaseStartsSeconds.WAVE_1 < c.phaseStartsSeconds.WAVE_2 &&
      c.phaseStartsSeconds.WAVE_2 < c.phaseStartsSeconds.WAVE_3 &&
      c.phaseStartsSeconds.WAVE_3 < c.phaseStartsSeconds.FINAL_WAVE &&
      c.phaseStartsSeconds.FINAL_WAVE < c.matchSeconds &&
      c.spawns.filter((x) => x.kind === 'BOSS').length === 1,
    { message: 'phases must start in order before matchSeconds, with exactly one BOSS spawn' },
  );

export type GameConfig = z.infer<typeof gameConfigSchema>;
export type EnemyConfig = z.infer<typeof enemySchema>;

export const DEFAULT_GAME_CONFIG: GameConfig = {
  version: 'raid-1',
  matchSeconds: 480,
  lobbySeconds: 60,
  cutoffForPaidJoinAtSeconds: 240,
  resultsSeconds: 30,
  phaseStartsSeconds: { WAVE_1: 60, WAVE_2: 150, WAVE_3: 270, FINAL_WAVE: 390 },
  maxPilots: 100,
  serverTickMs: 100,

  cityCount: 8,
  cityMaxHp: 100,
  minimumSurvivingCities: 4,
  cityShieldMax: 100,
  cityRebuildHp: 25,
  cityRebuildCooldownSeconds: 30,

  bossBaseHp: 900,
  scout: { hp: 60, damage: 18, telegraphMs: [8000, 12000], recoveryMs: [4000, 7000] },
  siege: { hp: 140, damage: 36, telegraphMs: [12000, 18000], recoveryMs: [6000, 9000] },
  saboteur: {
    hp: 90,
    damage: 6,
    telegraphMs: [10000, 12000],
    recoveryMs: [6000, 9000],
    energyDrain: 25,
    jamSeconds: 15,
  },
  boss: {
    damage: 32,
    telegraphMs: [12000, 15000],
    recoveryMs: [3000, 5000],
    sweepBelowHpRatio: 0.6,
    sweepDamage: 14,
    finalArmorFactor: 0.6,
  },
  spawns: [
    { atSeconds: 5, kind: 'SCOUT' },
    { atSeconds: 60, kind: 'SCOUT' },
    { atSeconds: 75, kind: 'SCOUT' },
    { atSeconds: 100, kind: 'SCOUT' },
    { atSeconds: 150, kind: 'SIEGE' },
    { atSeconds: 165, kind: 'SABOTEUR' },
    { atSeconds: 185, kind: 'SCOUT' },
    { atSeconds: 215, kind: 'SIEGE' },
    { atSeconds: 240, kind: 'SCOUT' },
    { atSeconds: 270, kind: 'BOSS' },
    { atSeconds: 300, kind: 'SCOUT' },
    { atSeconds: 330, kind: 'SABOTEUR' },
    { atSeconds: 360, kind: 'SIEGE' },
    { atSeconds: 400, kind: 'SCOUT' },
    { atSeconds: 430, kind: 'SIEGE' },
  ],
  trainingDamageRatio: 0.25,

  roleChangeCooldownSeconds: 20,
  miniGameDurationSeconds: 12,
  inputGraceSeconds: 1,
  normalActionCooldownSeconds: 10,
  activeWindowSeconds: 30,
  roleFairShare: 0.3,
  gunner: {
    damage: { CORE: 36, ARM: 18, LEG: 18 },
    armWeaken: 0.1,
    armWeakenMax: 0.3,
    legDelaySeconds: 3,
    energyPerHit: 8,
  },
  guardian: { shield: 45, standbyRatio: 0.5 },
  router: { energy: 18 },
  engineer: { repairCity: 15, repairRobot: 25 },
  energyBoostMax: 0.5,
  damagedComponentFactor: 0.6,

  sync: {
    windowSeconds: 20,
    gainTwoRoles: 8,
    gainThreeRoles: 7,
    gainFourRoles: 10,
    decayEverySeconds: 10,
    decayAmount: 3,
    max: 100,
  },

  special: {
    availableAfterSeconds: 390,
    activationWindowSeconds: 30,
    requiredDistinctPilots: 3,
    syncMinimum: 75,
    energyMinimum: 80,
    damage: 250,
    fallbackDamage: 90,
    fallbackSyncMinimum: 50,
    failBeamDamage: 25,
  },

  difficultyReferencePilots: 9,
  difficultySmallCrewExponent: 1.4,
  difficultyMinScale: 0.25,
  difficultyMaxScale: 6,
  assistBelowPilots: 5,
  assistIntervalSeconds: 12,
  assistSuccess: 0.6,

  ticketPriceSats: 21,
  invoiceTtlMs: 10 * 60_000,
  cheerCooldownMs: 1000,
};

export function parseGameConfig(input: unknown): GameConfig {
  return gameConfigSchema.parse(input);
}

/** Deep-merge partial overrides onto the defaults and validate. */
export function makeGameConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return gameConfigSchema.parse({
    ...structuredClone(DEFAULT_GAME_CONFIG),
    ...structuredClone(overrides),
  });
}

/**
 * Stable short hash of a config (FNV-1a over canonical JSON). Results and
 * leaderboards only compare raids with the same hash.
 */
export function configHash(c: GameConfig): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
          )
        : v;
  const text = JSON.stringify(canon(c));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
