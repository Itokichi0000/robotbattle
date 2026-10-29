/**
 * Japan for the tactical hologram and the city list.
 *
 * The outlines are ORIGINAL low-poly drawings made for SATS WARS from approximate
 * longitude/latitude anchor points (first drawn for the earlier prototype in this repo,
 * see ../../docs/01_asset_register.md). They are not administrative boundary data.
 * Coordinates are [longitude, latitude].
 */

export const CITY_IDS = ['SAPPORO', 'SENDAI', 'TOKYO', 'NAGOYA', 'OSAKA', 'FUKUOKA'] as const;
export type CityId = (typeof CITY_IDS)[number];

export interface CityDef {
  id: CityId;
  nameJa: string;
  nameEn: string;
  lon: number;
  lat: number;
}

export const CITIES: Record<CityId, CityDef> = {
  SAPPORO: { id: 'SAPPORO', nameJa: '札幌', nameEn: 'SAPPORO', lon: 141.35, lat: 43.06 },
  SENDAI: { id: 'SENDAI', nameJa: '仙台', nameEn: 'SENDAI', lon: 140.87, lat: 38.27 },
  TOKYO: { id: 'TOKYO', nameJa: '東京', nameEn: 'TOKYO', lon: 139.69, lat: 35.69 },
  NAGOYA: { id: 'NAGOYA', nameJa: '名古屋', nameEn: 'NAGOYA', lon: 136.91, lat: 35.18 },
  OSAKA: { id: 'OSAKA', nameJa: '大阪', nameEn: 'OSAKA', lon: 135.5, lat: 34.69 },
  FUKUOKA: { id: 'FUKUOKA', nameJa: '福岡', nameEn: 'FUKUOKA', lon: 130.4, lat: 33.59 },
};

/** Main islands plus Okinawa (inset). */
export const JAPAN_OUTLINES_LONLAT: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  // Hokkaido
  [
    [139.9, 41.6],
    [140.4, 42.3],
    [141.3, 43.2],
    [141.4, 44.3],
    [141.9, 45.5],
    [142.9, 44.7],
    [144.2, 44.1],
    [145.4, 43.4],
    [144.4, 42.9],
    [143.3, 42.0],
    [142.2, 42.4],
    [141.1, 42.4],
    [140.6, 41.9],
  ],
  // Honshu
  [
    [140.0, 41.3],
    [140.9, 41.5],
    [141.5, 41.3],
    [141.6, 40.4],
    [142.0, 39.6],
    [141.6, 38.7],
    [141.0, 38.3],
    [140.9, 37.0],
    [140.6, 36.3],
    [140.9, 35.7],
    [140.4, 35.1],
    [139.8, 34.9],
    [139.6, 35.3],
    [139.1, 35.3],
    [138.8, 34.6],
    [137.8, 34.6],
    [136.9, 34.9],
    [136.9, 34.3],
    [136.3, 33.8],
    [135.8, 33.4],
    [135.1, 33.9],
    [135.2, 34.6],
    [134.4, 34.7],
    [133.6, 34.5],
    [132.6, 34.3],
    [131.9, 34.0],
    [131.0, 33.95],
    [130.9, 34.3],
    [131.4, 34.6],
    [132.2, 35.1],
    [133.0, 35.5],
    [133.9, 35.6],
    [134.6, 35.6],
    [135.3, 35.5],
    [135.8, 35.7],
    [136.1, 35.6],
    [136.2, 36.2],
    [136.7, 36.8],
    [136.9, 37.4],
    [137.3, 37.5],
    [137.4, 36.9],
    [138.2, 37.2],
    [138.7, 37.8],
    [139.5, 38.2],
    [139.9, 39.2],
    [140.0, 40.2],
  ],
  // Shikoku
  [
    [132.5, 33.9],
    [133.2, 34.2],
    [134.0, 34.4],
    [134.7, 34.2],
    [134.7, 33.8],
    [134.2, 33.3],
    [133.6, 33.5],
    [133.0, 33.0],
    [132.6, 32.8],
    [132.2, 33.2],
  ],
  // Kyushu
  [
    [130.8, 33.95],
    [131.2, 33.6],
    [131.8, 33.4],
    [132.0, 32.8],
    [131.6, 32.1],
    [131.3, 31.4],
    [130.7, 31.0],
    [130.2, 31.3],
    [130.3, 32.1],
    [129.8, 32.7],
    [129.6, 33.3],
    [130.3, 33.6],
  ],
  // Okinawa, drawn as an inset closer to Kyushu than reality for readability.
  [
    [128.4, 29.9],
    [128.9, 30.3],
    [129.2, 30.1],
    [128.7, 29.6],
  ],
];

export interface MapPoint {
  x: number;
  y: number;
}

const LON0 = 137.5;
const LAT0 = 37.5;
const COS_LAT = Math.cos((36 * Math.PI) / 180);

/** Equirectangular projection onto a local plane: x grows east, y grows north, 1 unit ≈ 1° lat. */
export function projectLonLat(lon: number, lat: number): MapPoint {
  return { x: (lon - LON0) * COS_LAT, y: lat - LAT0 };
}

export const JAPAN_OUTLINES: MapPoint[][] = JAPAN_OUTLINES_LONLAT.map((poly) =>
  poly.map(([lon, lat]) => projectLonLat(lon, lat)),
);

export const CITY_POINTS: Record<CityId, MapPoint> = Object.fromEntries(
  CITY_IDS.map((id) => [id, projectLonLat(CITIES[id].lon, CITIES[id].lat)]),
) as Record<CityId, MapPoint>;
