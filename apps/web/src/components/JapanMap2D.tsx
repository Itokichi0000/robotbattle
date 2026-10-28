'use client';
import type { RegionId, RegionPaint, TeamId } from '@sats-wars/shared';
import { REGION_CENTROIDS, REGION_INFO, REGION_OUTLINES, TEAM_META, mapBounds } from '@sats-wars/shared';
import { teamColor } from './TeamBits';

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
  regions: RegionPaint[];
  locale: 'ja' | 'en';
  /** Viewer's team, to mark ally/enemy for players. */
  myTeam?: TeamId | null;
  /** Region being fought over right now. */
  focusRegionId?: RegionId | null;
  className?: string;
  labelScale?: number;
}

/**
 * 2D map used on phones, the landing page and the arena's no-WebGL fallback.
 * States are shown with colour AND pattern/icon/text (colour-blind safe).
 */
export function JapanMap2D({ regions, locale, myTeam, focusRegionId, className = '', labelScale = 1 }: JapanMap2DProps) {
  const fs = 0.55 * labelScale;
  return (
    <svg
      viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
      className={className}
      role="group"
      aria-label={locale === 'ja' ? '日本地図' : 'Map of Japan'}
    >
      <defs>
        <pattern id="hatch-focus" width="0.5" height="0.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="0.5" height="0.5" fill="transparent" />
          <line x1="0" y1="0" x2="0" y2="0.5" stroke="#FFE27A" strokeWidth="0.16" />
        </pattern>
      </defs>
      {regions.map((r) => {
        const id = r.regionId;
        const focus = focusRegionId === id;
        return (
          <g key={id} aria-label={REGION_INFO[id].labelJa} data-testid={`map-region-${id}`} data-owner={r.ownerTeamId ?? 'NEUTRAL'}>
            <path
              d={PATHS[id]}
              fill={teamColor(r.ownerTeamId)}
              fillOpacity={r.ownerTeamId ? 0.85 : 0.5}
              stroke={focus ? '#FFE27A' : '#0B1222'}
              strokeWidth={focus ? 0.2 : 0.06}
            />
            {focus && (
              <path d={PATHS[id]} fill="url(#hatch-focus)" stroke="none" className="sw-pulse" />
            )}
          </g>
        );
      })}
      {regions.map((r) => {
        const c = REGION_CENTROIDS[r.regionId];
        const focus = focusRegionId === r.regionId;
        const rel = !r.ownerTeamId
          ? ''
          : myTeam
            ? r.ownerTeamId === myTeam
              ? locale === 'ja'
                ? '味方'
                : 'ALLY'
              : locale === 'ja'
                ? '相手'
                : 'RIVAL'
            : TEAM_META[r.ownerTeamId].symbol;
        return (
          <g key={`l-${r.regionId}`} transform={`translate(${c.x},${-c.y})`} pointerEvents="none">
            <text
              textAnchor="middle"
              fontSize={fs}
              fontWeight={800}
              fill={focus ? '#FFE27A' : '#FFFFFF'}
              stroke="#070D1A"
              strokeWidth={fs * 0.18}
              paintOrder="stroke"
            >
              {focus ? '⚔ ' : ''}
              {locale === 'ja' ? REGION_INFO[r.regionId].shortJa : REGION_INFO[r.regionId].labelEn.split(' ')[0]}
            </text>
            {rel && (
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
                {rel}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
