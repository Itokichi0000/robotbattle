import type { TeamId } from '@sats-wars/shared';
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

/**
 * One robot's panel for the venue screen: HP, how many punches its fans still
 * need for a KO, and the special-move countdown. `hp` is the director's value
 * (always a number the server sent).
 */
export function RobotGauge({
  teamId,
  hp,
  hpMax,
  toKo,
  toSpecial,
  pinch,
  supporters,
  regionsWon,
  fighting,
  locale,
  size = 'md',
  align = 'left',
}: {
  teamId: TeamId;
  hp: number;
  hpMax: number;
  /** Punches this team needs to KO the other robot. */
  toKo: number;
  toSpecial: number;
  pinch: boolean;
  supporters: number;
  regionsWon: number;
  fighting: boolean;
  locale: 'ja' | 'en';
  size?: 'md' | 'xl';
  align?: 'left' | 'right';
}) {
  const m = TEAM_META[teamId];
  const foe = TEAM_META[teamId === 'RAIJIN' ? 'FUJIN' : 'RAIJIN'];
  const pct = Math.max(0, Math.min(100, (hp / hpMax) * 100));
  const hpH = size === 'xl' ? 'h-10' : 'h-5';
  const nameCls = size === 'xl' ? 'text-5xl' : 'text-xl';
  const numCls = size === 'xl' ? 'text-5xl' : 'text-2xl';
  const dir = align === 'right' ? 'flex-row-reverse text-right' : '';
  const ja = locale === 'ja';
  return (
    <div className="w-full" data-testid={`gauge-${teamId}`}>
      <div className={`flex items-end justify-between gap-2 ${dir}`}>
        <div className={`sw-display font-black ${nameCls}`} style={{ color: m.color }}>
          <span aria-hidden>{m.symbol} </span>
          {ja ? m.nameJa : m.nameEn}
          <span className="ml-2 text-[0.42em] font-bold text-off/70">{ja ? m.nameEn : m.nameJa}</span>
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
          className="absolute inset-y-0 transition-[width] duration-200 ease-out"
          style={{
            width: `${pct}%`,
            [align === 'right' ? 'right' : 'left']: 0,
            background: `linear-gradient(90deg, ${m.colorDark}, ${m.color}, ${m.colorLight})`,
          }}
        />
        {pinch && (
          <div className="absolute inset-0 flex items-center justify-center text-[0.9em] font-black text-white drop-shadow">
            {ja ? 'ピンチ！ パンチ1.5倍' : 'PINCH! ×1.5'}
          </div>
        )}
      </div>
      <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.95em] font-bold ${dir}`}>
        {fighting && (
          <span className="rounded bg-black/40 px-2" data-testid={`to-ko-${teamId}`}>
            {ja ? `${foe.nameJa}KOまで あと` : `KO ${foe.nameEn} in `}
            <span className="sw-display text-[1.5em] text-white">{toKo}</span>
            {ja ? '発' : ''}
          </span>
        )}
        {fighting && (
          <span className="text-yellow-300">
            {ja ? `必殺技まで${toSpecial}発` : `Special in ${toSpecial}`}
          </span>
        )}
        <span className="text-off/80">
          {ja ? `応援${supporters}人 ・ ${regionsWon}地方` : `${supporters} fans ・ ${regionsWon} regions`}
        </span>
      </div>
    </div>
  );
}
