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

/**
 * Which regions border each other (land or a short strait). Aliens spread
 * from a captured region into a neighbour, so this shapes the defence.
 */
export const REGION_NEIGHBORS: Record<RegionId, readonly RegionId[]> = {
  hokkaido: ['tohoku'],
  tohoku: ['hokkaido', 'kanto', 'chubu'],
  kanto: ['tohoku', 'chubu'],
  chubu: ['tohoku', 'kanto', 'kinki'],
  kinki: ['chubu', 'chugoku', 'shikoku'],
  chugoku: ['kinki', 'shikoku', 'kyushu'],
  shikoku: ['kinki', 'chugoku', 'kyushu'],
  kyushu: ['chugoku', 'shikoku'],
};
