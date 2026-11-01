/**
 * Every balance number lives here so the operator can pick a preset and the server can
 * freeze it per match (configHash). Engine code never hard-codes a number that belongs to
 * balance.
 *
 * D-033/D-035: three actions, one per team. Every phone belongs to a team and plays that
 * team's screen; each hit on the phone sends one free action.
 *   撃つ ATTACK  砲撃班 → damages NULL CORE (everyone may also shoot when their own job is done)
 *   守る DEFEND  防衛班 → fills RAIJIN's shield, which blocks the telegraphed strike on a squad
 *   直す REPAIR  整備班 → restores RAIJIN's armour after the mothership hits it
 * Lightning (a fixed 21 sats, capped per person) calls down the thunder: every phone in the
 * hall gets THUNDER MODE (free actions ×N for a few seconds) and the payer throws one bolt at
 * the mothership's weak point. Money never changes how big one action is.
 */

export const ENEMY_KINDS = ['DRONE', 'STRIKER', 'NULL_CORE'] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

export const PRESET_IDS = ['STANDARD', 'SHORT', 'TEST'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const ACTION_KINDS = ['ATTACK', 'DEFEND', 'REPAIR'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_LABEL: Record<ActionKind, { ja: string; en: string; verbJa: string }> = {
  ATTACK: { ja: '撃つ', en: 'ATTACK', verbJa: '母艦を撃つ' },
  DEFEND: { ja: '守る', en: 'DEFEND', verbJa: '部隊を守る' },
  REPAIR: { ja: '直す', en: 'REPAIR', verbJa: '雷神を直す' },
};

/** The team that owns each action (D-035). A phone's team decides its screen. */
export const TEAM_LABEL: Record<
  ActionKind,
  { ja: string; en: string; jobJa: string; jobEn: string }
> = {
  ATTACK: {
    ja: '砲撃班',
    en: 'GUNNERS',
    jobJa: '飛んでくる敵機をタップで撃ち落とす',
    jobEn: 'Tap the alien drones to shoot them down',
  },
  DEFEND: {
    ja: '防衛班',
    en: 'GUARDS',
    jobJa: '部隊を狙うミサイルをタップで弾く',
    jobEn: 'Tap the missiles to knock them away',
  },
  REPAIR: {
    ja: '整備班',
    en: 'ENGINEERS',
    jobJa: '雷神の火花をタップして直す',
    jobEn: 'Tap the sparks to fix RAIJIN',
  },
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
    /** A squad strike is announced `warnMs` before impact; the first at `firstAtMs`. */
    firstAtMs: number;
    everyMs: number;
    warnMs: number;
    /** Shield needed to block = base + perPlayer × (players − 1), capped at `needMax`. */
    needBase: number;
    needPerPlayer: number;
    needMax: number;
    /** Losing this many squads ends the match. */
    lostForDefeat: number;
  };
  shield: { max: number; decayPerSec: number };
  free: { cooldownMs: number; effect: ActionEffects };
  /** The group launch (D-035): the share of players who swiped up becomes starting shield. */
  launch: { shieldAtFull: number };
  paid: {
    amountSats: number;
    /** THUNDER MODE: every free action is worth `feverMultiplier` × for `feverMs`. */
    feverMs: number;
    feverMultiplier: number;
    /** The payer's bolt: max(boltMin, boltBossShare × boss max HP), × boltHitMultiplier on the weak point. */
    boltMin: number;
    boltBossShare: number;
    boltHitMultiplier: number;
    /** The payer has this long to throw; then it is thrown for them (a plain hit). */
    boltWindowMs: number;
    /** Weak point radius on the phone's square aiming field (0..1 units). */
    boltRadius: number;
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
  // D-035: a base so one person alone needs help (a friend or one Lightning), while a crowd
  // of demo bots still wins most rounds.
  boss: { hpBase: 200, hpPerPlayer: 300, hpExponent: 0.95 },
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
    needBase: 22,
    needPerPlayer: 7,
    needMax: 80,
    lostForDefeat: 3,
  },
  shield: { max: 100, decayPerSec: 1.5 },
  // About a third of the crowd guards and a third repairs (D-035), so their taps count for more.
  free: { cooldownMs: 700, effect: { ATTACK: 6, DEFEND: 8, REPAIR: 4 } },
  launch: { shieldAtFull: 30 },
  paid: {
    amountSats: 21,
    // One Lightning payment is a moment the whole hall plays: 10 s of THUNDER MODE for
    // everyone, and the payer's own bolt (2.5 % of the boss, 5 % on the weak point). THUNDER
    // MODE only multiplies what people do, and the bolts are capped so that even every bolt
    // of a round hitting the weak point stays under the boss's HP: money alone never wins.
    feverMs: 10_000,
    feverMultiplier: 3,
    boltMin: 30,
    boltBossShare: 0.025,
    boltHitMultiplier: 2,
    boltWindowMs: 8_000,
    boltRadius: 0.14,
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

/** Size of one Lightning bolt against a boss of `bossMaxHp` (before the weak-point bonus). */
export function boltDamageFor(c: GameConfig, bossMaxHp: number): number {
  return Math.max(c.paid.boltMin, Math.round(bossMaxHp * c.paid.boltBossShare));
}

/**
 * Where the mothership's weak point is on the payer's aiming field, `ms` after the bolt was
 * granted. A pure function of the bolt id and time, so the phone draws it and the server
 * judges the throw with the same numbers (raw input in, result decided by the server).
 * Coordinates are 0..1 on a square field, y down.
 */
export function boltTargetAt(boltId: string, ms: number): { x: number; y: number } {
  let h = 0x811c9dc5;
  for (let i = 0; i < boltId.length; i++) {
    h ^= boltId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const a = ((h & 0xff) / 255) * Math.PI * 2;
  const b = (((h >>> 8) & 0xff) / 255) * Math.PI * 2;
  const sx = 0.0011 + ((h >>> 16) & 0x3f) / 0x3f / 2500;
  const sy = 0.0017 + ((h >>> 22) & 0x3f) / 0x3f / 2200;
  return {
    x: 0.5 + 0.32 * Math.sin(a + ms * sx),
    y: 0.42 + 0.2 * Math.sin(b + ms * sy),
  };
}
