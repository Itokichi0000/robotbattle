export const REGION_IDS = [
  'hokkaido',
  'tohoku',
  'kanto',
  'chubu',
  'kinki',
  'chugoku',
  'shikoku',
  'kyushu',
] as const;
export type RegionId = (typeof REGION_IDS)[number];

export const REGION_KINDS = ['ATTACK', 'DEFENSE', 'ENERGY'] as const;
export type RegionKind = (typeof REGION_KINDS)[number];

export function isRegionId(value: unknown): value is RegionId {
  return typeof value === 'string' && (REGION_IDS as readonly string[]).includes(value);
}

export interface RegionInfo {
  regionId: RegionId;
  labelJa: string;
  labelEn: string;
  /** Short label for small screens / map badges. */
  shortJa: string;
}

export const REGION_INFO: Record<RegionId, RegionInfo> = {
  hokkaido: { regionId: 'hokkaido', labelJa: '北海道', labelEn: 'Hokkaido', shortJa: '北海道' },
  tohoku: { regionId: 'tohoku', labelJa: '東北', labelEn: 'Tohoku', shortJa: '東北' },
  kanto: { regionId: 'kanto', labelJa: '関東', labelEn: 'Kanto', shortJa: '関東' },
  chubu: { regionId: 'chubu', labelJa: '中部', labelEn: 'Chubu', shortJa: '中部' },
  kinki: { regionId: 'kinki', labelJa: '近畿', labelEn: 'Kinki', shortJa: '近畿' },
  chugoku: { regionId: 'chugoku', labelJa: '中国', labelEn: 'Chugoku', shortJa: '中国' },
  shikoku: { regionId: 'shikoku', labelJa: '四国', labelEn: 'Shikoku', shortJa: '四国' },
  kyushu: {
    regionId: 'kyushu',
    labelJa: '九州・沖縄',
    labelEn: 'Kyushu & Okinawa',
    shortJa: '九州',
  },
};

export const REGION_KIND_META: Record<
  RegionKind,
  { labelJa: string; labelEn: string; icon: string; descJa: string; descEn: string }
> = {
  ATTACK: {
    labelJa: '攻撃拠点',
    labelEn: 'Attack base',
    icon: '⚔',
    descJa: '1つにつき激突時の与ダメージ+3',
    descEn: '+3 clash damage each',
  },
  DEFENSE: {
    labelJa: '防御拠点',
    labelEn: 'Defense base',
    icon: '🛡',
    descJa: '1つにつき激突時の被ダメージ-2',
    descEn: '-2 damage taken each',
  },
  ENERGY: {
    labelJa: 'エネルギー拠点',
    labelEn: 'Energy base',
    icon: '◆',
    descJa: '1つにつき激突後エネルギー+5',
    descEn: '+5 energy after each clash',
  },
};

/** Default layout: 3 ATTACK, 3 DEFENSE, 2 ENERGY spread across the archipelago. */
export const DEFAULT_REGION_LAYOUT: ReadonlyArray<{ regionId: RegionId; kind: RegionKind }> = [
  { regionId: 'hokkaido', kind: 'DEFENSE' },
  { regionId: 'tohoku', kind: 'ATTACK' },
  { regionId: 'kanto', kind: 'ENERGY' },
  { regionId: 'chubu', kind: 'DEFENSE' },
  { regionId: 'kinki', kind: 'ATTACK' },
  { regionId: 'chugoku', kind: 'ENERGY' },
  { regionId: 'shikoku', kind: 'DEFENSE' },
  { regionId: 'kyushu', kind: 'ATTACK' },
];
