import { z } from './validation';
import { ENEMY_KINDS } from './state';
import { REGION_IDS } from './regions';

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
    /** Escorts (not the boss, not training) need at least this many gunner CORE hits: big crews must not erase them before they telegraph. 0 = off. */
    escortMinHits: z.number().min(0).max(10),
    /**
     * Crowd pressure by numbers, not only HP (D-053): every escort spawn
     * becomes a wing of 1 + floor(active / extraEveryPilots) enemies (up to
     * `max`) that split the scaled HP and aim at different cities, so a big
     * crew has several countdowns to race at once. extraEveryPilots 0 = off.
     */
    escortWing: z.object({
      extraEveryPilots: z.number().int().min(0),
      max: z.number().int().min(1).max(4),
    }),
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
       * by this until 神雷風陣 resolves (any outcome). Cooperation, not raw
       * clicking, decides the finale; the last seconds stay winnable.
       */
      finalArmorFactor: z.number().min(0).max(1),
      /**
       * Before FINAL_WAVE the boss cannot fall below this share of its HP
       * (its core barrier): gunners still weaken arms and slow legs, and the
       * finale with 神雷風陣 always happens, even with 100 pilots. 0 = off.
       */
      barrierFloorRatio: z.number().min(0).max(0.9),
    }),
    /** When each enemy enters (game seconds). The boss is the BOSS entry. */
    spawns: z
      .array(z.object({ atSeconds: z.number().int().min(0), kind: z.enum(ENEMY_KINDS) }))
      .min(1),
    /**
     * Scripted demos only (the `earth-defense-opening` demo seed): the first
     * non-training attack aimed at or after `atSeconds` targets these cities
     * (if standing), one entry per attack, in order. Absent in normal raids,
     * so it never changes their config hash.
     */
    scriptedTargets: z
      .array(
        z.object({
          atSeconds: z.number().int().min(0),
          targets: z.array(z.enum(REGION_IDS)).min(1).max(3),
        }),
      )
      .max(50)
      .optional(),
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
      /**
       * With no enemy on the field the gunner seat charges Raijin's thunder
       * drums instead of idling (energy to Raijin, then to the reserve).
       * 0 = off (the seat reports NO_TARGET as before).
       */
      chargeEnergy: z.number().int().min(0),
    }),
    guardian: z.object({
      shield: z.number().int().min(0),
      standbyRatio: z.number().min(0).max(1),
      /**
       * Wind barriers fade: every SYNC decay tick each city loses this much
       * shield. A big crew cannot blanket Japan once and stop reacting (D-053).
       */
      shieldFade: z.number().int().min(0),
    }),
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
    /** Label of the preset these numbers came from (`applyDifficultyPreset`). Part of the config hash. */
    difficultyPreset: z.enum(['EASY', 'NORMAL', 'HARD']),
    /**
     * Gentle adjustment of new enemies' HP from the crew's recent minigame
     * success (spec C5): 1 + clamp((mean success − target) × gain, ±maxAdjust).
     * Deterministic (state only). maxAdjust 0 = off.
     */
    adaptive: z.object({
      windowSeconds: z.number().int().min(10),
      targetSuccess: z.number().min(0).max(1),
      gain: z.number().min(0).max(2),
      maxAdjust: z.number().min(0).max(0.5),
    }),
    /** Enemy HP scales with active pilots / this (clamped to [min,max]). */
    difficultyReferencePilots: z.number().int().min(1),
    /** Below the reference crew, enemy HP shrinks faster than linearly: small crews also cover fewer seats. */
    difficultySmallCrewExponent: z.number().min(1).max(3),
    /**
     * Above the reference crew, enemy attack damage also grows with the
     * crowd: × scale^this (shields scale with the crowd too). 0 = off (D-053).
     */
    difficultyDamageExponent: z.number().min(0).max(1),
    difficultyMinScale: z.number().min(0.05).max(1),
    difficultyMaxScale: z.number().min(1).max(20),
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
  version: 'raid-2',
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

  bossBaseHp: 750,
  escortMinHits: 0,
  escortWing: { extraEveryPilots: 12, max: 3 },
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
    barrierFloorRatio: 0.15,
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
    chargeEnergy: 12,
  },
  guardian: { shield: 45, standbyRatio: 0.5, shieldFade: 8 },
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

  difficultyPreset: 'NORMAL',
  adaptive: { windowSeconds: 60, targetSuccess: 0.65, gain: 0.5, maxAdjust: 0.15 },
  difficultyReferencePilots: 9,
  difficultySmallCrewExponent: 1.4,
  difficultyDamageExponent: 0.6,
  difficultyMinScale: 0.25,
  difficultyMaxScale: 12,
  assistBelowPilots: 5,
  assistIntervalSeconds: 12,
  assistSuccess: 0.6,

  ticketPriceSats: 21,
  invoiceTtlMs: 10 * 60_000,
  cheerCooldownMs: 1000,
};

export const DIFFICULTY_PRESETS = ['EASY', 'NORMAL', 'HARD'] as const;
export type DifficultyPreset = (typeof DIFFICULTY_PRESETS)[number];

/**
 * Operator-facing difficulty versions (spec C6 `difficultyPreset`). A preset
 * rewrites the numbers of a base config; the label travels in the config so
 * results and leaderboards (compared by config hash) never mix versions.
 * HARD never shortens a telegraph below 6 s: no unreactable attacks.
 */
export function applyDifficultyPreset(base: GameConfig, preset: DifficultyPreset): GameConfig {
  const c = structuredClone(base);
  c.difficultyPreset = preset;
  if (preset === 'NORMAL') return gameConfigSchema.parse(c);
  const hp = preset === 'EASY' ? 0.8 : 1.2;
  const dmg = preset === 'EASY' ? 0.8 : 1.2;
  const tele = preset === 'EASY' ? 2000 : -1000;
  const shift = ([a, b]: [number, number]): [number, number] => [
    Math.max(6000, a + tele),
    Math.max(6000, b + tele),
  ];
  for (const k of ['scout', 'siege', 'saboteur'] as const) {
    c[k].hp = Math.max(1, Math.round(c[k].hp * hp));
    c[k].damage = Math.round(c[k].damage * dmg);
    c[k].telegraphMs = shift(c[k].telegraphMs as [number, number]);
  }
  c.bossBaseHp = Math.max(1, Math.round(c.bossBaseHp * hp));
  c.boss.damage = Math.round(c.boss.damage * dmg);
  c.boss.sweepDamage = Math.round(c.boss.sweepDamage * dmg);
  c.boss.telegraphMs = shift(c.boss.telegraphMs as [number, number]);
  return gameConfigSchema.parse(c);
}

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
