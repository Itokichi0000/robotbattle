'use client';
import type { Enemy, RegionId, RegionState } from '@sats-wars/shared';
import { REGION_CENTROIDS, REGION_INFO, REGION_OUTLINES, mapBounds } from '@sats-wars/shared';

const B = mapBounds();
const PAD = 0.6;
const VB = {
  x: B.minX - PAD,
  y: -B.maxY - PAD,
  w: B.maxX - B.minX + PAD * 2,
  h: B.maxY - B.minY + PAD * 2,
};

function pathFor(id: RegionId): string {
  return REGION_OUTLINES[id]
    .map((poly) => `M${poly.map((p) => `${p.x.toFixed(3)},${(-p.y).toFixed(3)}`).join('L')}Z`)
    .join(' ');
}
const PATHS = Object.fromEntries(
  Object.keys(REGION_OUTLINES).map((id) => [id, pathFor(id as RegionId)]),
) as Record<RegionId, string>;

export interface JapanMap2DProps {
  regions: RegionState[];
  enemies: Enemy[];
  cityHpMax: number;
  locale: 'ja' | 'en';
  /** Regions hit at the next alien turn (⚠ marks, red outline when it would fall). */
  danger?: Partial<Record<RegionId, { damageNext: number; willFall: boolean }>>;
  selected?: RegionId | null;
  onSelect?: (id: RegionId) => void;
  className?: string;
  labelScale?: number;
}

/** City health → colour. Captured regions are violet and hatched (colour-blind safe: also 👾 text). */
export function regionFill(r: RegionState, cityHpMax: number): string {
  if (r.fallen) return '#5B2A86';
  const k = r.cityHp / cityHpMax;
  return k > 0.6 ? '#2F7FD8' : k > 0.3 ? '#E0A030' : '#D8483A';
}

/**
 * 2D map used on phones, the landing page and the arena's no-WebGL fallback.
 * States are shown with colour AND pattern/icon/text (colour-blind safe).
 */
export function JapanMap2D({
  regions,
  enemies,
  cityHpMax,
  locale,
  danger = {},
  selected = null,
  onSelect,
  className = '',
  labelScale = 1,
}: JapanMap2DProps) {
  const fs = 0.55 * labelScale;
  const count = (id: RegionId) => enemies.filter((e) => e.regionId === id).length;
  return (
    <svg
      viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
      className={className}
      role="group"
      aria-label={locale === 'ja' ? '日本地図' : 'Map of Japan'}
    >
      <defs>
        <pattern id="hatch-captured" width="0.5" height="0.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="0.5" height="0.5" fill="transparent" />
          <line x1="0" y1="0" x2="0" y2="0.5" stroke="#C98BFF" strokeWidth="0.14" />
        </pattern>
      </defs>
      {regions.map((r) => {
        const id = r.regionId;
        const sel = selected === id;
        const d = danger[id];
        const name = REGION_INFO[id].labelJa;
        return (
          <g
            key={id}
            data-testid={`map-region-${id}`}
            data-state={r.fallen ? 'captured' : d?.willFall ? 'danger' : 'ok'}
            onClick={onSelect ? () => onSelect(id) : undefined}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={onSelect ? `${name}${r.fallen ? ' (とられた)' : ''}` : name}
            aria-pressed={onSelect ? sel : undefined}
            onKeyDown={
              onSelect
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(id);
                    }
                  }
                : undefined
            }
            style={onSelect ? { cursor: 'pointer' } : undefined}
          >
            <path
              d={PATHS[id]}
              fill={regionFill(r, cityHpMax)}
              fillOpacity={0.88}
              stroke={sel ? '#FFFFFF' : d?.willFall ? '#FF5A4A' : '#0B1222'}
              strokeWidth={sel ? 0.24 : d?.willFall ? 0.18 : 0.06}
              className={d?.willFall && !sel ? 'sw-pulse' : undefined}
            />
            {r.fallen && <path d={PATHS[id]} fill="url(#hatch-captured)" stroke="none" pointerEvents="none" />}
          </g>
        );
      })}
      {regions.map((r) => {
        const c = REGION_CENTROIDS[r.regionId];
        const n = count(r.regionId);
        const d = danger[r.regionId];
        const sel = selected === r.regionId;
        const line2 = r.fallen ? `👾${n}` : `🏙${r.cityHp}${r.shield > 0 ? ' 🛡' : ''}${n > 0 ? ` 🛸${n}` : ''}`;
        return (
          <g key={`l-${r.regionId}`} transform={`translate(${c.x},${-c.y})`} pointerEvents="none">
            <text
              textAnchor="middle"
              fontSize={fs}
              fontWeight={800}
              fill={sel ? '#FFE27A' : '#FFFFFF'}
              stroke="#070D1A"
              strokeWidth={fs * 0.18}
              paintOrder="stroke"
            >
              {d?.willFall ? '⚠ ' : ''}
              {locale === 'ja' ? REGION_INFO[r.regionId].shortJa : REGION_INFO[r.regionId].labelEn.split(' ')[0]}
            </text>
            <text
              y={fs * 1.1}
              textAnchor="middle"
              fontSize={fs * 0.8}
              fontWeight={800}
              fill="#FFFFFF"
              stroke="#070D1A"
              strokeWidth={fs * 0.15}
              paintOrder="stroke"
            >
              {line2}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
