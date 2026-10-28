import { useMemo } from 'react';
import type { RegionId } from '@sats-wars/shared';
import { CITY_INFO, ENEMY_LABELS, PHASE_LABELS, REGION_CENTROIDS, REGION_IDS, REGION_OUTLINES, ROLE_LABELS, SPECIAL_LABELS, STATUS_LABELS, mapBounds } from '@sats-wars/shared';
import { cityName } from './board';
import { type RaidLike, type RaidView } from './view';

type Lx = (ja: string, en: string) => string;

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Meter({ value, max = 100, tone, label, testId }: { value: number; max?: number; tone: string; label: string; testId?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`swc-meter swc-tone-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)} aria-label={label} data-testid={testId}>
      <span className="swc-meter-label">{label}</span>
      <span className="swc-meter-bar">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="swc-meter-num">{Math.round(value)}</span>
    </div>
  );
}

/** Top bar: phase, time left, boss, cities, SYNC, special. Same on phone and venue. */
export function RaidHeader({ raid, view, locale, compact }: { raid: RaidLike; view: RaidView; locale: 'ja' | 'en'; compact?: boolean }) {
  const L: Lx = (ja, en) => (locale === 'ja' ? ja : en);
  const phase = raid.status === 'LIVE' || raid.status === 'ENDED' ? PHASE_LABELS[raid.phase] : STATUS_LABELS[raid.status];
  const danger = view.citiesStanding <= view.minCities;
  return (
    <div className={`swc-header${compact ? ' is-compact' : ''}`} data-testid="raid-header">
      <div className="swc-header-row">
        <span className="swc-phase">{L(phase.ja, phase.en)}</span>
        <span className="swc-clock" aria-label={L('残り時間', 'Time left')} data-testid="raid-clock">
          ⏱ {fmtClock(view.timeLeftMs)}
        </span>
        <span className={`swc-cities${danger ? ' is-danger' : ''}`} title={L(`${view.minCities}都市を下回ると日本陥落`, `Japan falls below ${view.minCities} cities`)}>
          🏙 {view.citiesStanding}/8
        </span>
      </div>
      {view.boss && (
        <Meter value={view.boss.hp} max={view.boss.hpMax} tone="red" label={`${ENEMY_LABELS.BOSS.icon} ${L('NULL CORE', 'NULL CORE')}`} testId="boss-hp" />
      )}
      <div className="swc-header-row">
        <Meter value={raid.sync} tone="teal" label="SYNC" testId="sync" />
        {!compact && <Meter value={raid.reserveEnergy} tone="amber" label={L('予備電源', 'Reserve')} />}
      </div>
      {raid.special.status !== 'LOCKED' && (
        <p className={`swc-special is-${raid.special.status.toLowerCase()}`} role="status">
          ⚡🌀 {L(SPECIAL_LABELS[raid.special.status].ja, SPECIAL_LABELS[raid.special.status].en)}
          {view.specialOpen && view.specialSecondsLeft !== null && (
            <>
              {' '}
              <b>{Math.ceil(view.specialSecondsLeft)}s</b>{' '}
              {(['GUNNER', 'GUARDIAN', 'ROUTER'] as const).map((r) => (
                <span key={r} className={raid.special.contributors[r] ? 'is-done' : ''}>
                  {ROLE_LABELS[r].icon}
                </span>
              ))}
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** The most urgent threat in one line: 「東京に砲撃まで 8秒」. */
export function ThreatLine({ view, locale }: { view: RaidView; locale: 'ja' | 'en' }) {
  const L: Lx = (ja, en) => (locale === 'ja' ? ja : en);
  const u = view.urgent;
  if (!u) return <p className="swc-threat is-calm">{L('いまは静か。準備しよう', 'All quiet. Get ready')}</p>;
  const name = u.enemy ? L(ENEMY_LABELS[u.enemy.kind].ja, ENEMY_LABELS[u.enemy.kind].en) : '';
  const lethal = view.threats[u.cityId]?.lethal;
  return (
    <p className={`swc-threat${lethal ? ' is-lethal' : ''}`} role="status" data-testid="threat-line">
      ⚠ {L(`${name}が${cityName(u.cityId, L)}を攻撃まで ${Math.ceil(u.seconds)}秒`, `${name} hits ${cityName(u.cityId, L)} in ${Math.ceil(u.seconds)}s`)}
      {lethal ? L('（このままだと陥落！）', ' (city will fall!)') : ''}
    </p>
  );
}

/** Small Japan map: 8 cities with HP, shields, incoming attacks and losses. */
export function JapanMapMini({ view, locale, maxHp, labels = true }: { view: RaidView; locale: 'ja' | 'en'; maxHp: number; labels?: boolean }) {
  const L: Lx = (ja, en) => (locale === 'ja' ? ja : en);
  const geo = useMemo(() => {
    const b = mapBounds();
    const pad = 0.6;
    const w = b.maxX - b.minX + pad * 2;
    const h = b.maxY - b.minY + pad * 2;
    const tx = (x: number) => x - b.minX + pad;
    const ty = (y: number) => b.maxY - y + pad;
    const paths = Object.fromEntries(
      REGION_IDS.map((id) => [id, REGION_OUTLINES[id].map((poly) => 'M' + poly.map((p) => `${tx(p.x).toFixed(2)},${ty(p.y).toFixed(2)}`).join('L') + 'Z').join(' ')]),
    ) as Record<RegionId, string>;
    const dots = Object.fromEntries(REGION_IDS.map((id) => [id, { x: tx(REGION_CENTROIDS[id].x), y: ty(REGION_CENTROIDS[id].y) }])) as Record<RegionId, { x: number; y: number }>;
    return { w, h, paths, dots };
  }, []);
  return (
    <svg className="swc-map" viewBox={`0 0 ${geo.w} ${geo.h}`} role="img" aria-label={L('日本の8都市の状態', 'Status of the 8 cities')}>
      {REGION_IDS.map((id) => {
        const c = view.cities[id];
        const t = view.threats[id];
        const cls = c.destroyed ? 'is-down' : t?.lethal ? 'is-danger' : t ? 'is-threat' : c.hp < maxHp * 0.5 ? 'is-hurt' : 'is-ok';
        return <path key={id} d={geo.paths[id]} className={`swc-map-region ${cls}`} />;
      })}
      {REGION_IDS.map((id) => {
        const c = view.cities[id];
        const t = view.threats[id];
        const p = geo.dots[id];
        return (
          <g key={id} className="swc-map-city" transform={`translate(${p.x.toFixed(2)},${p.y.toFixed(2)})`}>
            {c.shield > 0 && !c.destroyed && <circle r={0.75} className="swc-map-shield" />}
            <circle r={0.42} className={c.destroyed ? 'swc-map-dot is-down' : 'swc-map-dot'} />
            {labels && (
              <text y={-0.7} textAnchor="middle" className="swc-map-label">
                {c.destroyed ? '✕ ' : ''}
                {L(CITY_INFO[id].cityJa, CITY_INFO[id].cityEn)} {c.destroyed ? '' : Math.round(c.hp)}
              </text>
            )}
            {t && !c.destroyed && (
              <text y={1.35} textAnchor="middle" className={`swc-map-threat${t.lethal ? ' is-lethal' : ''}`}>
                ⚠{Math.ceil(t.seconds)}s
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Both robots: hull, energy and damaged parts. */
export function RobotBars({ raid, locale }: { raid: RaidLike; locale: 'ja' | 'en' }) {
  const L: Lx = (ja, en) => (locale === 'ja' ? ja : en);
  return (
    <div className="swc-robots">
      {raid.robots.map((r) => (
        <div key={r.robotId} className={`swc-robot swc-robot-${r.robotId.toLowerCase()}`}>
          <b>{r.robotId === 'RAIJIN' ? L('⚡ 雷神', '⚡ RAIJIN') : L('🌀 風神', '🌀 FUJIN')}</b>
          <Meter value={r.health} tone={r.robotId === 'RAIJIN' ? 'amber' : 'teal'} label={L('機体', 'Hull')} />
          <Meter value={r.energy} tone="white" label={L('電力', 'Energy')} />
          {r.componentDamaged && <span className="swc-tag swc-tag-warn">{r.robotId === 'RAIJIN' ? L('雷太鼓 損傷', 'Drum damaged') : L('風輪 損傷', 'Ring damaged')}</span>}
        </div>
      ))}
    </div>
  );
}
