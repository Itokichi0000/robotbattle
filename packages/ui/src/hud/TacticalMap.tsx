import { useMemo } from 'react';
import type { Enemy, RegionId } from '@sats-wars/shared';
import {
  CITY_INFO,
  ENEMY_LABELS,
  REGION_CENTROIDS,
  REGION_IDS,
  REGION_OUTLINES,
  mapBounds,
} from '@sats-wars/shared';
import type { RaidView } from '../view';
import { fmtSecs } from './primitives';

type Lx = (ja: string, en: string) => string;

/** Label placement per city (map units ≈ degrees) so neighbours never overlap. */
const LABEL_AT: Record<RegionId, { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }> = {
  hokkaido: { dx: 0, dy: -0.95, anchor: 'middle' },
  tohoku: { dx: 0.8, dy: 0.2, anchor: 'start' },
  kanto: { dx: 0.8, dy: 0.5, anchor: 'start' },
  chubu: { dx: -0.1, dy: -0.9, anchor: 'middle' },
  kinki: { dx: 0.35, dy: 1.35, anchor: 'middle' },
  chugoku: { dx: -0.2, dy: -0.9, anchor: 'end' },
  shikoku: { dx: 0.7, dy: 1.1, anchor: 'start' },
  kyushu: { dx: -0.8, dy: 0.25, anchor: 'end' },
};

function useGeo() {
  return useMemo(() => {
    const b = mapBounds();
    const pad = 0.8;
    const padLeft = 2.6;
    const w = b.maxX - b.minX + pad + padLeft;
    const h = b.maxY - b.minY + pad * 2;
    const tx = (x: number) => x - b.minX + padLeft;
    const ty = (y: number) => b.maxY - y + pad;
    const paths = Object.fromEntries(
      REGION_IDS.map((id) => [
        id,
        REGION_OUTLINES[id]
          .map(
            (poly) =>
              'M' + poly.map((p) => `${tx(p.x).toFixed(2)},${ty(p.y).toFixed(2)}`).join('L') + 'Z',
          )
          .join(' '),
      ]),
    ) as Record<RegionId, string>;
    const dots = Object.fromEntries(
      REGION_IDS.map((id) => [
        id,
        { x: tx(REGION_CENTROIDS[id].x), y: ty(REGION_CENTROIDS[id].y) },
      ]),
    ) as Record<RegionId, { x: number; y: number }>;
    return { w, h, paths, dots };
  }, []);
}

/**
 * Japan as a tactical layer: friendly installations (squares) with their HP
 * and shield brackets, hostile attack warnings (diamonds) with countdowns over
 * the cities they target, fallen cities crossed out. `selectable` cities are
 * buttons (the guardian and the engineer pick their target on the map).
 */
export function TacticalMap({
  view,
  locale,
  maxHp,
  labels = true,
  selectable,
  selected,
  onSelect,
  className,
}: {
  view: RaidView;
  locale: 'ja' | 'en';
  maxHp: number;
  labels?: boolean;
  selectable?: ReadonlySet<RegionId>;
  selected?: RegionId | null;
  onSelect?: (id: RegionId) => void;
  className?: string;
}) {
  const L: Lx = (ja, en) => (locale === 'ja' ? ja : en);
  const geo = useGeo();
  const threatEnemy = (id: RegionId): Enemy | null => {
    const u = view.urgent;
    if (u && u.cityId === id) return u.enemy;
    return null;
  };
  return (
    <svg
      className={`hud-map${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${geo.w.toFixed(2)} ${geo.h.toFixed(2)}`}
      role="img"
      aria-label={L('戦術マップ：日本の8都市', 'Tactical map: the 8 cities')}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern
          id="hud-hatch"
          width="0.5"
          height="0.5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="0.5" className="hud-map-hatch" />
        </pattern>
      </defs>
      {/* Coordinate grid */}
      <g className="hud-map-grid" aria-hidden="true">
        {Array.from({ length: Math.ceil(geo.w / 2) }, (_, i) => (
          <line key={`v${i}`} x1={i * 2} y1={0} x2={i * 2} y2={geo.h} />
        ))}
        {Array.from({ length: Math.ceil(geo.h / 2) }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={i * 2} x2={geo.w} y2={i * 2} />
        ))}
      </g>
      {REGION_IDS.map((id) => {
        const c = view.cities[id];
        const t = view.threats[id];
        const cls = c.destroyed ? 'is-down' : t?.lethal ? 'is-lethal' : t ? 'is-threat' : 'is-ok';
        return (
          <path
            key={id}
            d={geo.paths[id]}
            className={`hud-map-region ${cls}`}
            fill={c.destroyed ? 'url(#hud-hatch)' : undefined}
          />
        );
      })}
      {REGION_IDS.map((id) => {
        const c = view.cities[id];
        const t = view.threats[id];
        const p = geo.dots[id];
        const hpRatio = Math.max(0, Math.min(1, c.hp / maxHp));
        const canPick = !!onSelect && !!selectable?.has(id);
        const name = L(CITY_INFO[id].cityJa, CITY_INFO[id].cityEn);
        const enemy = t ? threatEnemy(id) : null;
        return (
          <g
            key={id}
            className={`hud-map-city${c.destroyed ? ' is-down' : ''}${selected === id ? ' is-selected' : ''}${canPick ? ' is-pickable' : ''}`}
            transform={`translate(${p.x.toFixed(2)},${p.y.toFixed(2)})`}
            {...(canPick
              ? {
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': L(`${name}を目標にする`, `Target ${name}`),
                  'aria-pressed': selected === id,
                  onClick: () => onSelect!(id),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect!(id);
                    }
                  },
                  'data-testid': `map-city-${id}`,
                }
              : {})}
          >
            {canPick && <rect x={-1.1} y={-1.1} width={2.2} height={2.2} className="hud-map-hit" />}
            {/* Shield brackets: the city has a barrier banked */}
            {c.shield > 0 && !c.destroyed && (
              <path
                d="M-0.95,-0.55 V-0.95 H-0.55 M0.55,-0.95 H0.95 V-0.55 M0.95,0.55 V0.95 H0.55 M-0.55,0.95 H-0.95 V0.55"
                className="hud-map-shield"
              />
            )}
            <rect x={-0.42} y={-0.42} width={0.84} height={0.84} className="hud-map-sq" />
            {c.destroyed ? (
              <path d="M-0.42,-0.42 L0.42,0.42 M0.42,-0.42 L-0.42,0.42" className="hud-map-x" />
            ) : (
              <rect
                x={-0.42}
                y={0.62}
                width={0.84 * hpRatio}
                height={0.16}
                className={`hud-map-hp${hpRatio < 0.5 ? ' is-low' : ''}`}
              />
            )}
            {t && !c.destroyed && (
              <g
                className={`hud-map-threat${t.lethal ? ' is-lethal' : ''}`}
                transform="translate(0.95,-1.05)"
              >
                <path d="M0,-0.55 L0.55,0 L0,0.55 L-0.55,0 Z" />
                <text x={0.85} y={0.22} className="hud-map-count">
                  {fmtSecs(t.seconds)}
                </text>
                {enemy && (
                  <title>
                    {L(ENEMY_LABELS[enemy.kind].ja, ENEMY_LABELS[enemy.kind].en)} → {name}
                  </title>
                )}
              </g>
            )}
            {labels && (
              <text
                x={LABEL_AT[id].dx}
                y={LABEL_AT[id].dy}
                textAnchor={LABEL_AT[id].anchor}
                className="hud-map-label"
              >
                {name}
                {!c.destroyed && <tspan className="hud-map-num"> {Math.round(c.hp)}</tspan>}
                {c.shield > 0 && !c.destroyed && (
                  <tspan className="hud-map-shnum"> +{Math.round(c.shield)}</tspan>
                )}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
