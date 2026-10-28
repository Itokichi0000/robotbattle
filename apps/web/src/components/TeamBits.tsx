import type { TeamId, TeamState } from '@sats-wars/shared';
import { TEAM_META } from '@sats-wars/shared';

export function teamColor(t: TeamId | null): string {
  return t ? TEAM_META[t].color : '#41506E';
}

export function TeamBadge({
  teamId,
  locale,
  className = '',
}: {
  teamId: TeamId;
  locale: 'ja' | 'en';
  className?: string;
}) {
  const m = TEAM_META[teamId];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-black ${className}`}
      style={{ background: `${m.color}26`, color: m.color, border: `1.5px solid ${m.color}` }}
    >
      <span aria-hidden>{m.symbol}</span>
      {locale === 'ja' ? m.nameJa : m.nameEn}
    </span>
  );
}

/** HP + energy for one robot. `hp` may lag the server value during cinematics. */
export function RobotGauge({
  team,
  hp,
  hpMax,
  energyMax,
  specialThreshold,
  locale,
  size = 'md',
  align = 'left',
}: {
  team: TeamState;
  hp: number;
  hpMax: number;
  energyMax: number;
  specialThreshold: number;
  locale: 'ja' | 'en';
  size?: 'sm' | 'md' | 'xl';
  align?: 'left' | 'right';
}) {
  const m = TEAM_META[team.teamId];
  const pct = Math.max(0, Math.min(100, (hp / hpMax) * 100));
  const ePct = Math.max(0, Math.min(100, (team.energy / energyMax) * 100));
  const ready = team.energy >= specialThreshold;
  const hpH = size === 'xl' ? 'h-10' : size === 'md' ? 'h-5' : 'h-3';
  const nameCls = size === 'xl' ? 'text-5xl' : size === 'md' ? 'text-xl' : 'text-base';
  const numCls = size === 'xl' ? 'text-6xl' : size === 'md' ? 'text-2xl' : 'text-lg';
  const dir = align === 'right' ? 'flex-row-reverse text-right' : '';
  return (
    <div className="w-full" data-testid={`gauge-${team.teamId}`}>
      <div className={`flex items-end justify-between gap-2 ${dir}`}>
        <div className={`sw-display font-black ${nameCls}`} style={{ color: m.color }}>
          <span aria-hidden>{m.symbol} </span>
          {locale === 'ja' ? m.nameJa : m.nameEn}
          <span className="ml-2 text-[0.45em] font-bold text-off/70">
            {locale === 'ja' ? m.nameEn : m.nameJa}
          </span>
        </div>
        <div className={`sw-display font-black tabular-nums ${numCls}`}>
          {hp}
          <span className="text-[0.45em] text-off/60">/{hpMax}</span>
        </div>
      </div>
      <div
        className={`relative mt-1 w-full overflow-hidden rounded-md bg-black/50 ring-1 ring-white/20 ${hpH}`}
        role="meter"
        aria-label={`${m.nameJa} HP`}
        aria-valuenow={hp}
        aria-valuemin={0}
        aria-valuemax={hpMax}
      >
        <div
          className="absolute inset-y-0 transition-[width] duration-500 ease-out"
          style={{
            width: `${pct}%`,
            [align === 'right' ? 'right' : 'left']: 0,
            background: `linear-gradient(90deg, ${m.colorDark}, ${m.color}, ${m.colorLight})`,
          }}
        />
      </div>
      <div className={`mt-1 flex items-center gap-2 ${dir}`}>
        <div className="relative h-2.5 flex-1 overflow-hidden rounded bg-black/50 ring-1 ring-white/10">
          <div
            className="absolute inset-y-0 left-0 bg-yellow-300/90 transition-[width] duration-500"
            style={{ width: `${ePct}%` }}
          />
          <div
            className="absolute inset-y-0 w-0.5 bg-white/70"
            style={{ left: `${(specialThreshold / energyMax) * 100}%` }}
          />
        </div>
        <span
          className={`text-xs font-bold tabular-nums ${ready ? 'text-yellow-300' : 'text-off/70'}`}
        >
          {locale === 'ja' ? 'EN' : 'EN'} {team.energy}/{energyMax}
          {ready ? (locale === 'ja' ? ' 必殺OK' : ' SPECIAL') : ''}
        </span>
      </div>
    </div>
  );
}
