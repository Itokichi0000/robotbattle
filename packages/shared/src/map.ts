import type { RegionId } from './regions';

/**
 * Simplified, hand-drawn outlines of Japan's 8 regions.
 *
 * These are ORIGINAL low-poly drawings made for this project from approximate
 * longitude/latitude anchor points. They are NOT administrative boundary data
 * and must not be used as such. See docs/DECISION_LOG.md (D-010).
 * Coordinates are [longitude, latitude].
 */
export const REGION_OUTLINES_LONLAT: Record<RegionId, Array<Array<[number, number]>>> = {
  hokkaido: [
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
  ],
  tohoku: [
    [
      [140.0, 41.3],
      [140.9, 41.5],
      [141.5, 41.3],
      [141.6, 40.4],
      [142.0, 39.6],
      [141.6, 38.7],
      [141.0, 38.3],
      [140.9, 37.0],
      [139.7, 37.0],
      [139.5, 38.2],
      [139.9, 39.2],
      [140.0, 40.2],
    ],
  ],
  kanto: [
    [
      [139.7, 37.0],
      [140.9, 37.0],
      [140.6, 36.3],
      [140.9, 35.7],
      [140.4, 35.1],
      [139.8, 34.9],
      [139.6, 35.3],
      [139.1, 35.3],
      [138.7, 35.8],
      [138.6, 36.4],
      [139.1, 36.8],
    ],
  ],
  chubu: [
    [
      [139.5, 38.2],
      [139.7, 37.0],
      [139.1, 36.8],
      [138.6, 36.4],
      [138.7, 35.8],
      [139.1, 35.3],
      [138.8, 34.6],
      [137.8, 34.6],
      [136.9, 34.9],
      [136.6, 35.3],
      [136.1, 35.6],
      [136.2, 36.2],
      [136.7, 36.8],
      [136.9, 37.4],
      [137.3, 37.5],
      [137.4, 36.9],
      [138.2, 37.2],
      [138.7, 37.8],
    ],
  ],
  kinki: [
    [
      [136.1, 35.6],
      [136.6, 35.3],
      [136.9, 34.9],
      [136.9, 34.3],
      [136.3, 33.8],
      [135.8, 33.4],
      [135.1, 33.9],
      [135.2, 34.6],
      [134.4, 34.7],
      [134.3, 35.3],
      [134.6, 35.6],
      [135.3, 35.5],
      [135.8, 35.7],
    ],
  ],
  chugoku: [
    [
      [134.6, 35.6],
      [134.3, 35.3],
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
    ],
  ],
  shikoku: [
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
  ],
  kyushu: [
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
  ],
};

export interface MapPoint {
  x: number;
  y: number;
}

/** Center of projection; chosen to center the archipelago. */
const LON0 = 137.5;
const LAT0 = 37.5;
const COS_LAT = Math.cos((36 * Math.PI) / 180);

/**
 * Equirectangular projection to a local plane. x grows east, y grows north.
 * 1 unit ≈ 1 degree of latitude.
 */
export function projectLonLat(lon: number, lat: number): MapPoint {
  return { x: (lon - LON0) * COS_LAT, y: lat - LAT0 };
}

export const REGION_OUTLINES: Record<RegionId, MapPoint[][]> = Object.fromEntries(
  Object.entries(REGION_OUTLINES_LONLAT).map(([id, polys]) => [
    id,
    polys.map((poly) => poly.map(([lon, lat]) => projectLonLat(lon, lat))),
  ]),
) as Record<RegionId, MapPoint[][]>;

/** Area-weighted centroid of the first (main) polygon, used for labels and effects. */
export function polygonCentroid(points: MapPoint[]): MapPoint {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-9) return points[0] ?? { x: 0, y: 0 };
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

export const REGION_CENTROIDS: Record<RegionId, MapPoint> = Object.fromEntries(
  Object.entries(REGION_OUTLINES).map(([id, polys]) => [id, polygonCentroid(polys[0]!)]),
) as Record<RegionId, MapPoint>;

export function mapBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const polys of Object.values(REGION_OUTLINES)) {
    for (const poly of polys) {
      for (const p of poly) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

export const MAP_CREDIT_JA = '地図: 本プロジェクト独自の簡略作図（実際の行政境界ではありません）';
export const MAP_CREDIT_EN =
  'Map: simplified original drawing for this project (not official boundaries)';
