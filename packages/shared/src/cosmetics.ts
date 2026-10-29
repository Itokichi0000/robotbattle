import { z } from 'zod';
import { TITLE_LABELS } from './i18n';

/**
 * Cosmetics (spec C10): helmets, visors, suits, cockpit effects and license
 * backgrounds. Purely visual — nothing here reaches the engine, so they can
 * never change combat power. Unlocks come from the career (sorties,
 * victories, seats flown, rank, titles, venue events), never from payments.
 */
export const COSMETIC_SLOTS = ['HELMET', 'VISOR', 'SUIT', 'COCKPIT_FX', 'LICENSE_BG'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

export type CosmeticUnlock =
  | { kind: 'DEFAULT' }
  | { kind: 'SORTIES'; n: number }
  | { kind: 'VICTORIES'; n: number }
  /** Distinct seats with at least one success. */
  | { kind: 'ROLES'; n: number }
  | { kind: 'RANK'; index: number }
  | { kind: 'TITLE'; title: string }
  /** Flew a raid at a named venue event (event id other than the default). */
  | { kind: 'EVENT' };

export interface CosmeticDef {
  id: string;
  slot: CosmeticSlot;
  ja: string;
  en: string;
  /** Main colour (hex) used by the avatar, cockpit seat light or card. */
  color: string;
  /** Secondary colour. */
  accent: string;
  rarity: 'BASIC' | 'RARE' | 'EVENT';
  unlock: CosmeticUnlock;
}

export const COSMETICS: CosmeticDef[] = [
  // Helmets
  {
    id: 'helmet-standard',
    slot: 'HELMET',
    ja: '標準ヘルメット',
    en: 'Standard helmet',
    color: '#D7E4E8',
    accent: '#3289DF',
    rarity: 'BASIC',
    unlock: { kind: 'DEFAULT' },
  },
  {
    id: 'helmet-raijin-horn',
    slot: 'HELMET',
    ja: '雷角ヘルメット',
    en: 'Thunder-horn helmet',
    color: '#8C573A',
    accent: '#F7931A',
    rarity: 'BASIC',
    unlock: { kind: 'SORTIES', n: 3 },
  },
  {
    id: 'helmet-fujin-fin',
    slot: 'HELMET',
    ja: '風鰭ヘルメット',
    en: 'Wind-fin helmet',
    color: '#102836',
    accent: '#25C8D7',
    rarity: 'BASIC',
    unlock: { kind: 'ROLES', n: 2 },
  },
  {
    id: 'helmet-oni-crest',
    slot: 'HELMET',
    ja: '鬼神前立て',
    en: 'Guardian-deity crest',
    color: '#161B20',
    accent: '#B88738',
    rarity: 'RARE',
    unlock: { kind: 'VICTORIES', n: 3 },
  },
  {
    id: 'helmet-legend',
    slot: 'HELMET',
    ja: '伝説の冠',
    en: 'Legend crown',
    color: '#B88738',
    accent: '#EFF5FF',
    rarity: 'RARE',
    unlock: { kind: 'RANK', index: 4 },
  },
  // Visors
  {
    id: 'visor-clear',
    slot: 'VISOR',
    ja: 'クリアバイザー',
    en: 'Clear visor',
    color: '#9FB7C9',
    accent: '#EFF5FF',
    rarity: 'BASIC',
    unlock: { kind: 'DEFAULT' },
  },
  {
    id: 'visor-amber',
    slot: 'VISOR',
    ja: '琥珀バイザー',
    en: 'Amber visor',
    color: '#F7931A',
    accent: '#FFD9A0',
    rarity: 'BASIC',
    unlock: { kind: 'VICTORIES', n: 1 },
  },
  {
    id: 'visor-teal',
    slot: 'VISOR',
    ja: '青緑バイザー',
    en: 'Teal visor',
    color: '#25C8D7',
    accent: '#B8F3F8',
    rarity: 'BASIC',
    unlock: { kind: 'ROLES', n: 3 },
  },
  {
    id: 'visor-prism',
    slot: 'VISOR',
    ja: '神雷風陣プリズム',
    en: 'Shinrai Fujin prism',
    color: '#C9A7FF',
    accent: '#F7931A',
    rarity: 'RARE',
    unlock: { kind: 'TITLE', title: 'SHINRAI_FUJIN' },
  },
  // Suits
  {
    id: 'suit-navy',
    slot: 'SUIT',
    ja: '紺の操縦服',
    en: 'Navy flight suit',
    color: '#1B2A44',
    accent: '#3289DF',
    rarity: 'BASIC',
    unlock: { kind: 'DEFAULT' },
  },
  {
    id: 'suit-copper',
    slot: 'SUIT',
    ja: '銅の操縦服',
    en: 'Copper flight suit',
    color: '#8C573A',
    accent: '#F7931A',
    rarity: 'BASIC',
    unlock: { kind: 'SORTIES', n: 5 },
  },
  {
    id: 'suit-silver',
    slot: 'SUIT',
    ja: '銀白の操縦服',
    en: 'Silver flight suit',
    color: '#D7E4E8',
    accent: '#25C8D7',
    rarity: 'RARE',
    unlock: { kind: 'ROLES', n: 4 },
  },
  {
    id: 'suit-veteran',
    slot: 'SUIT',
    ja: '古参の操縦服',
    en: 'Veteran flight suit',
    color: '#161B20',
    accent: '#B88738',
    rarity: 'RARE',
    unlock: { kind: 'TITLE', title: 'VETERAN' },
  },
  // Cockpit seat effects (light at the pilot's seat when a mission succeeds)
  {
    id: 'fx-none',
    slot: 'COCKPIT_FX',
    ja: '標準ランプ',
    en: 'Standard lamp',
    color: '#EFF5FF',
    accent: '#9FB7C9',
    rarity: 'BASIC',
    unlock: { kind: 'DEFAULT' },
  },
  {
    id: 'fx-spark',
    slot: 'COCKPIT_FX',
    ja: '雷花',
    en: 'Thunder sparks',
    color: '#F7931A',
    accent: '#FFD9A0',
    rarity: 'BASIC',
    unlock: { kind: 'SORTIES', n: 2 },
  },
  {
    id: 'fx-breeze',
    slot: 'COCKPIT_FX',
    ja: '旋風',
    en: 'Whirlwind',
    color: '#25C8D7',
    accent: '#B8F3F8',
    rarity: 'BASIC',
    unlock: { kind: 'VICTORIES', n: 2 },
  },
  {
    id: 'fx-aurora',
    slot: 'COCKPIT_FX',
    ja: 'オーロラ',
    en: 'Aurora',
    color: '#7BE0A0',
    accent: '#C9A7FF',
    rarity: 'RARE',
    unlock: { kind: 'RANK', index: 2 },
  },
  // License (passport card) backgrounds
  {
    id: 'bg-standard',
    slot: 'LICENSE_BG',
    ja: '標準ライセンス',
    en: 'Standard license',
    color: '#070D1A',
    accent: '#25C8D7',
    rarity: 'BASIC',
    unlock: { kind: 'DEFAULT' },
  },
  {
    id: 'bg-circuit',
    slot: 'LICENSE_BG',
    ja: '回路の地紋',
    en: 'Circuit pattern',
    color: '#0B1B2B',
    accent: '#25C8D7',
    rarity: 'BASIC',
    unlock: { kind: 'SORTIES', n: 1 },
  },
  {
    id: 'bg-thunder',
    slot: 'LICENSE_BG',
    ja: '雷雲',
    en: 'Thunderclouds',
    color: '#1A1208',
    accent: '#F7931A',
    rarity: 'BASIC',
    unlock: { kind: 'TITLE', title: 'EARTH_DEFENDER' },
  },
  {
    id: 'bg-venue',
    slot: 'LICENSE_BG',
    ja: '会場限定・記念',
    en: 'Venue memorial',
    color: '#1B0E2E',
    accent: '#F7931A',
    rarity: 'EVENT',
    unlock: { kind: 'EVENT' },
  },
  {
    id: 'helmet-venue',
    slot: 'HELMET',
    ja: '会場限定・記念ヘルメット',
    en: 'Venue memorial helmet',
    color: '#EFF5FF',
    accent: '#F7931A',
    rarity: 'EVENT',
    unlock: { kind: 'EVENT' },
  },
];

export const COSMETIC_BY_ID: Record<string, CosmeticDef> = Object.fromEntries(
  COSMETICS.map((c) => [c.id, c]),
);

export const DEFAULT_COSMETICS: Record<CosmeticSlot, string> = {
  HELMET: 'helmet-standard',
  VISOR: 'visor-clear',
  SUIT: 'suit-navy',
  COCKPIT_FX: 'fx-none',
  LICENSE_BG: 'bg-standard',
};

/** Event ids that do not count as a named venue event. */
export const NON_VENUE_EVENT_IDS: ReadonlySet<string> = new Set([
  '',
  'default',
  'dev',
  'demo',
  'local',
]);

export interface CareerFacts {
  sorties: number;
  victories: number;
  /** Distinct seats with a success. */
  rolesDone: number;
  rank: number;
  titles: readonly string[];
  /** Venue event ids the pilot flew at. */
  events: readonly string[];
}

export function cosmeticUnlocked(c: CosmeticDef, f: CareerFacts): boolean {
  const u = c.unlock;
  switch (u.kind) {
    case 'DEFAULT':
      return true;
    case 'SORTIES':
      return f.sorties >= u.n;
    case 'VICTORIES':
      return f.victories >= u.n;
    case 'ROLES':
      return f.rolesDone >= u.n;
    case 'RANK':
      return f.rank >= u.index;
    case 'TITLE':
      return f.titles.includes(u.title);
    case 'EVENT':
      return f.events.some((e) => !NON_VENUE_EVENT_IDS.has(e));
  }
}

export function unlockedCosmeticIds(f: CareerFacts): string[] {
  return COSMETICS.filter((c) => cosmeticUnlocked(c, f)).map((c) => c.id);
}

/** How to earn an item, in one short phrase. */
export function unlockHint(u: CosmeticUnlock, locale: 'ja' | 'en'): string {
  const ja = locale === 'ja';
  switch (u.kind) {
    case 'DEFAULT':
      return ja ? '最初から' : 'From the start';
    case 'SORTIES':
      return ja ? `出撃${u.n}回` : `${u.n} sorties`;
    case 'VICTORIES':
      return ja ? `防衛成功${u.n}回` : `${u.n} victories`;
    case 'ROLES':
      return ja ? `${u.n}種類の席で成功` : `Succeed in ${u.n} seats`;
    case 'RANK':
      return ja ? `階級${u.index + 1}に到達` : `Reach rank ${u.index + 1}`;
    case 'TITLE':
      return ja
        ? `称号「${TITLE_LABELS[u.title]?.ja ?? u.title}」`
        : `Title "${TITLE_LABELS[u.title]?.en ?? u.title}"`;
    case 'EVENT':
      return ja ? '会場イベントで出撃' : 'Fly at a venue event';
  }
}

export const equipPatchSchema = z
  .object({
    HELMET: z.string().max(40),
    VISOR: z.string().max(40),
    SUIT: z.string().max(40),
    COCKPIT_FX: z.string().max(40),
    LICENSE_BG: z.string().max(40),
  })
  .partial();
export type EquipPatch = z.infer<typeof equipPatchSchema>;

/**
 * Equipped items, falling back to the defaults for anything not unlocked
 * (an operator rollback or account merge can never leave a locked item on).
 */
export function normalizeEquipped(
  equipped: Partial<Record<string, string>>,
  unlocked: readonly string[],
): Record<CosmeticSlot, string> {
  const out = { ...DEFAULT_COSMETICS };
  for (const slot of COSMETIC_SLOTS) {
    const id = equipped[slot];
    const def = id ? COSMETIC_BY_ID[id] : undefined;
    if (def && def.slot === slot && unlocked.includes(id!)) out[slot] = id!;
  }
  return out;
}

/** Colours the venue cockpit and the license card draw a pilot with. */
export interface AvatarLook {
  helmet: string;
  helmetAccent: string;
  visor: string;
  suit: string;
  fx: string;
}

export function avatarLook(equipped: Record<CosmeticSlot, string>): AvatarLook {
  const c = (slot: CosmeticSlot) =>
    COSMETIC_BY_ID[equipped[slot]] ?? COSMETIC_BY_ID[DEFAULT_COSMETICS[slot]]!;
  return {
    helmet: c('HELMET').color,
    helmetAccent: c('HELMET').accent,
    visor: c('VISOR').color,
    suit: c('SUIT').color,
    fx: c('COCKPIT_FX').color,
  };
}

export const DEFAULT_LOOK: AvatarLook = avatarLook(DEFAULT_COSMETICS);
