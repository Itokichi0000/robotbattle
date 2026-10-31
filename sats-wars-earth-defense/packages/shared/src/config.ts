/**
 * Every balance number lives here so the operator can pick a preset and the server can
 * freeze it per match (configHash). Engine code never hard-codes a number that belongs to
 * balance.
 *
 * D-033: the whole game is three actions anyone can do from a phone.
 *   撃つ ATTACK  → damages NULL CORE
 *   守る DEFEND  → fills RAIJIN's shield, which blocks the telegraphed strike on a city
 *   直す REPAIR  → restores RAIJIN's armour after the boss hits it
 * Each action is free (a small effect, once per `free.cooldownMs`) or costs a fixed
 * 21 sats (a big effect, capped per person). Money never changes how big one action is.
 */

export const ENEMY_KINDS = ['DRONE', 'STRIKER', 'NULL_CORE'] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

export const PRESET_IDS = ['STANDARD', 'SHORT', 'TEST'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const ACTION_KINDS = ['ATTACK', 'DEFEND', 'REPAIR'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_LABEL: Record<ActionKind, { ja: string; en: string; verbJa: string }> = {
  ATTACK: { ja: '撃つ', en: 'ATTACK', verbJa: 'ボスを撃つ' },
  DEFEND: { ja: '守る', en: 'DEFEND', verbJa: '都市を守る' },
  REPAIR: { ja: '直す', en: 'REPAIR', verbJa: '雷神を直す' },
};

export type ActionEffects = Record<ActionKind, number>;

export interface GameConfig {
  presetId: PresetId;
  timings: {
    countdownMs: number;
    deploymentMs: number;
    battleMs: number;
    victoryMs: number;
    defeatMs: number;
    resultsMs: number;
    /** Lobby starts the sortie by itself this long after the first player joins (0 = off). */
    lobbyAutoStartMs: number;
    /** A player who drops is still counted this long (phones sleep, Wi-Fi blips). */
    playerHoldMs: number;
  };
  boss: {
    /** NULL CORE HP = base + perPlayer × players^exponent (players at launch, at least 1). */
    hpBase: number;
    hpPerPlayer: number;
    hpExponent: number;
  };
  mech: {
    max: number;
    /** NULL CORE claws RAIJIN this often; announced `warnMs` ahead. Cannot be blocked. */
    hitEveryMs: number;
    hitWarnMs: number;
    hitFirstAtMs: number;
    /** Damage = base × (1 + perPlayer × (players − 1)), capped at base × maxScale. */
    hitDamage: number;
    hitPerPlayer: number;
    hitMaxScale: number;
  };
  strikes: {
    /** A city strike is announced `warnMs` before impact; the first at `firstAtMs`. */
    firstAtMs: number;
    everyMs: number;
    warnMs: number;
    /** Shield needed to block = base + perPlayer × (players − 1), capped at `needMax`. */
    needBase: number;
    needPerPlayer: number;
    needMax: number;
    /** Losing this many cities ends the match. */
    lostForDefeat: number;
  };
  shield: { max: number; decayPerSec: number };
  free: { cooldownMs: number; effect: ActionEffects };
  paid: {
    amountSats: number;
    /** ATTACK here is the floor; the real hit is max(floor, attackBossShare × boss max HP). */
    effect: ActionEffects;
    /** A Lightning attack takes this share of NULL CORE's max HP, so it reads in any crowd. */
    attackBossShare: number;
    perPilotPerMatch: number;
    cooldownMs: number;
    maxPerMatch: number;
  };
  /** Demo bots: tap rate and how often one sends a VIRTUAL paid action (labelled DEMO). */
  bots: { count: number; tapMinMs: number; tapMaxMs: number; paidChancePerSec: number };
}

const STANDARD: GameConfig = {
  presetId: 'STANDARD',
  timings: {
    countdownMs: 5_000,
    deploymentMs: 8_000,
    battleMs: 120_000,
    victoryMs: 6_000,
    defeatMs: 6_000,
    resultsMs: 14_000,
    lobbyAutoStartMs: 30_000,
    playerHoldMs: 45_000,
  },
  boss: { hpBase: 0, hpPerPlayer: 300, hpExponent: 0.95 },
  mech: {
    max: 100,
    hitEveryMs: 11_000,
    hitWarnMs: 3_000,
    hitFirstAtMs: 16_000,
    hitDamage: 10,
    hitPerPlayer: 0.1,
    hitMaxScale: 2.5,
  },
  strikes: {
    firstAtMs: 6_000,
    everyMs: 15_000,
    warnMs: 8_000,
    needBase: 16,
    needPerPlayer: 6,
    needMax: 70,
    lostForDefeat: 3,
  },
  shield: { max: 100, decayPerSec: 1.5 },
  free: { cooldownMs: 700, effect: { ATTACK: 6, DEFEND: 4, REPAIR: 3 } },
  paid: {
    amountSats: 21,
    // One Lightning action is a moment the whole hall sees: 5 % of the boss, most of a
    // strike's shield, half of RAIJIN's armour. Capped so money alone can never win.
    effect: { ATTACK: 60, DEFEND: 60, REPAIR: 50 },
    attackBossShare: 0.05,
    perPilotPerMatch: 3,
    cooldownMs: 15_000,
    maxPerMatch: 15,
  },
  bots: { count: 6, tapMinMs: 900, tapMaxMs: 1_800, paidChancePerSec: 0.012 },
};

function derive(base: GameConfig, patch: (c: GameConfig) => void): GameConfig {
  const c = structuredClone(base);
  patch(c);
  return c;
}

export const PRESETS: Record<PresetId, GameConfig> = {
  STANDARD,
  // Busy hours: 90 s fights.
  SHORT: derive(STANDARD, (c) => {
    c.presetId = 'SHORT';
    c.timings.deploymentMs = 6_000;
    c.timings.battleMs = 90_000;
    c.timings.resultsMs = 12_000;
    c.timings.lobbyAutoStartMs = 20_000;
    c.boss.hpPerPlayer = 240;
  }),
  // Fast lead-in for automated tests only; the server refuses it in production.
  TEST: derive(STANDARD, (c) => {
    c.presetId = 'TEST';
    c.timings.countdownMs = 500;
    c.timings.deploymentMs = 1_000;
    c.timings.lobbyAutoStartMs = 0;
  }),
};

export const DEFAULT_PRESET: PresetId = 'STANDARD';

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

/** NULL CORE HP for a crowd of `players` (at least 1). */
export function bossHpFor(c: GameConfig, players: number): number {
  const n = Math.max(1, players);
  return Math.round(c.boss.hpBase + c.boss.hpPerPlayer * Math.pow(n, c.boss.hpExponent));
}

export function strikeNeedFor(c: GameConfig, players: number): number {
  const n = Math.max(1, players);
  return Math.min(
    c.strikes.needMax,
    Math.round(c.strikes.needBase + c.strikes.needPerPlayer * (n - 1)),
  );
}

export function mechHitFor(c: GameConfig, players: number): number {
  const n = Math.max(1, players);
  const scale = Math.min(c.mech.hitMaxScale, 1 + c.mech.hitPerPlayer * (n - 1));
  return Math.round(c.mech.hitDamage * scale);
}

/** Size of one Lightning attack against a boss of `bossMaxHp`. */
export function paidAttackFor(c: GameConfig, bossMaxHp: number): number {
  return Math.max(c.paid.effect.ATTACK, Math.round(bossMaxHp * c.paid.attackBossShare));
}
