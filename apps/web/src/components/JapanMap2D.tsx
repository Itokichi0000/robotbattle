'use client';
import type { RegionId, RegionState, TeamId } from '@sats-wars/shared';
import { REGION_CENTROIDS, REGION_INFO, REGION_KIND_META, REGION_OUTLINES, TEAM_META, mapBounds } from '@sats-wars/shared';
import { teamColor } from './TeamBits';

const B = mapBounds();
const PAD = 0.6;
const VB = { x: B.minX - PAD, y: -B.maxY - PAD, w: B.maxX - B.minX + PAD * 2, h: B.maxY - B.minY + PAD * 2 };

function pathFor(id: RegionId): string {
  return REGION_OUTLINES[id]
    .map((poly) => `M${poly.map((p) => `${p.x.toFixed(3)},${(-p.y).toFixed(3)}`).join('L')}Z`)
    .join(' ');
}
const PATHS = Object.fromEntries(Object.keys(REGION_OUTLINES).map((id) => [id, pathFor(id as RegionId)])) as Record<RegionId, string>;

export interface JapanMap2DProps {
  regions: RegionState[];
  locale: 'ja' | 'en';
  /** Viewer's team, to mark ally/enemy for players. */
  myTeam?: TeamId | null;
  selected?: RegionId | null;
  onSelect?: (id: RegionId) => void;
  gameMs?: number;
  className?: string;
  labelScale?: number;
}

/**
 * 2D map used on phones, the landing page and the arena's no-WebGL fallback.
 * States are shown with colour AND pattern/icon/text (colour-blind safe).
 */
export function JapanMap2D({ regions, locale, myTeam, selected, onSelect, gameMs = 0, className = '', labelScale = 1 }: JapanMap2DProps) {
  const fs = 0.55 * labelScale;
  return (
    <svg viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} className={className} role="group" aria-label={locale === 'ja' ? '日本地図' : 'Map of Japan'}>
      <defs>
        {(['RAIJIN', 'FUJIN'] as const).map((t) => (
          <pattern key={t} id={`hatch-${t}`} width="0.5" height="0.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="0.5" height="0.5" fill="transparent" />
            <line x1="0" y1="0" x2="0" y2="0.5" stroke={TEAM_META[t].color} strokeWidth="0.22" />
          </pattern>
        ))}
      </defs>
      {regions.map((r) => {
        const id = r.regionId;
        const fill = teamColor(r.ownerTeamId);
        const isSel = selected === id;
        const interactive = !!onSelect;
        return (
          <g
            key={id}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-pressed={interactive ? isSel : undefined}
            aria-label={`${REGION_INFO[id].labelJa}`}
            onClick={interactive ? () => onSelect(id) : undefined}
            onKeyDown={interactive ? (e) => (e.key === 'Enter' || e.key === ' ') && onSelect(id) : undefined}
            className={interactive ? 'cursor-pointer outline-none' : undefined}
            data-testid={`map-region-${id}`}
          >
            <path d={PATHS[id]} fill={fill} fillOpacity={r.ownerTeamId ? 0.85 : 0.55} stroke={isSel ? '#FFFFFF' : '#0B1222'} strokeWidth={isSel ? 0.18 : 0.06} />
            {r.contestedByTeamId && <path d={PATHS[id]} fill={`url(#hatch-${r.contestedByTeamId})`} stroke={TEAM_META[r.contestedByTeamId].color} strokeWidth={0.12} strokeDasharray="0.3 0.2" />}
          </g>
        );
      })}
      {regions.map((r) => {
        const c = REGION_CENTROIDS[r.regionId];
        const kind = REGION_KIND_META[r.kind];
        const rel = !r.ownerTeamId ? '' : myTeam ? (r.ownerTeamId === myTeam ? (locale === 'ja' ? '味方' : 'ALLY') : locale === 'ja' ? '敵' : 'ENEMY') : TEAM_META[r.ownerTeamId].symbol;
        const left = r.contestedUntil !== null ? Math.max(0, Math.ceil((r.contestedUntil - gameMs) / 1000)) : null;
        return (
          <g key={`l-${r.regionId}`} transform={`translate(${c.x},${-c.y})`} pointerEvents="none">
            <text textAnchor="middle" fontSize={fs} fontWeight={800} fill="#FFFFFF" stroke="#070D1A" strokeWidth={fs * 0.18} paintOrder="stroke">
              {kind.icon} {locale === 'ja' ? REGION_INFO[r.regionId].shortJa : REGION_INFO[r.regionId].labelEn.split(' ')[0]}
            </text>
            {(rel || r.shieldCharges > 0) && (
              <text y={fs * 1.1} textAnchor="middle" fontSize={fs * 0.8} fontWeight={800} fill="#FFFFFF" stroke="#070D1A" strokeWidth={fs * 0.15} paintOrder="stroke">
                {rel}
                {r.shieldCharges > 0 ? ' 🛡' : ''}
              </text>
            )}
            {r.contestedByTeamId && left !== null && (
              <text y={fs * 2.1} textAnchor="middle" fontSize={fs * 0.8} fontWeight={800} fill="#FFE08A" stroke="#070D1A" strokeWidth={fs * 0.15} paintOrder="stroke">
                {locale === 'ja' ? `争奪 ${left}s` : `contest ${left}s`}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
