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
 * Defence nodes: one city per region with an abstract facility (fictional
 * game setting, not a claim about real infrastructure). While a city stands,
 * its facility helps the whole raid; a destroyed city loses it.
 */
export const FACILITIES = ['RADAR', 'DOCK', 'COMMAND', 'HUB', 'BASTION', 'JAMMER', 'SENSOR', 'RESERVE_PLANT'] as const;
export type Facility = (typeof FACILITIES)[number];

export interface CityInfo {
  cityId: RegionId;
  cityJa: string;
  cityEn: string;
  facility: Facility;
  facilityJa: string;
  facilityEn: string;
  effectJa: string;
  effectEn: string;
}

export const CITY_INFO: Record<RegionId, CityInfo> = {
  hokkaido: { cityId: 'hokkaido', cityJa: '札幌', cityEn: 'Sapporo', facility: 'RADAR', facilityJa: '監視レーダー', facilityEn: 'Radar', effectJa: '敵の予兆が1秒早く出る', effectEn: 'Threats show 1 s earlier' },
  tohoku: { cityId: 'tohoku', cityJa: '仙台', cityEn: 'Sendai', facility: 'DOCK', facilityJa: '修復ドック', facilityEn: 'Repair dock', effectJa: '整備の回復量+25%', effectEn: 'Repairs +25%' },
  kanto: { cityId: 'kanto', cityJa: '東京', cityEn: 'Tokyo', facility: 'COMMAND', facilityJa: '中央指令所', facilityEn: 'Command HQ', effectJa: 'シンクロ率が減りにくい', effectEn: 'SYNC decays slower' },
  chubu: { cityId: 'chubu', cityJa: '名古屋', cityEn: 'Nagoya', facility: 'HUB', facilityJa: '供給ハブ', facilityEn: 'Supply hub', effectJa: '電力接続のエネルギー+20%', effectEn: 'Routed energy +20%' },
  kinki: { cityId: 'kinki', cityJa: '大阪', cityEn: 'Osaka', facility: 'BASTION', facilityJa: '防衛中枢', facilityEn: 'Defence core', effectJa: 'シールド+20%', effectEn: 'Shields +20%' },
  chugoku: { cityId: 'chugoku', cityJa: '広島', cityEn: 'Hiroshima', facility: 'JAMMER', facilityJa: '妨害装置', facilityEn: 'Jammer', effectJa: '敵の予兆が1秒長くなる', effectEn: 'Threats last 1 s longer' },
  shikoku: { cityId: 'shikoku', cityJa: '高松', cityEn: 'Takamatsu', facility: 'SENSOR', facilityJa: 'センサー網', facilityEn: 'Sensor net', effectJa: '砲撃の照準リングが広い', effectEn: 'Wider aiming ring' },
  kyushu: { cityId: 'kyushu', cityJa: '福岡', cityEn: 'Fukuoka', facility: 'RESERVE_PLANT', facilityJa: '予備電源', facilityEn: 'Reserve plant', effectJa: '最終決戦エネルギー+20%', effectEn: 'Reserve energy +20%' },
};

