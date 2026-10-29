import { useState } from 'react';
import type { Direction, TaskInput, TaskParams } from '@sats-wars/shared';
import { DIRECTIONS } from '@sats-wars/shared';
import { gaugeAt } from '@sats-wars/game-engine';
import { DIRECTION_LABELS } from '../board';
import { Icon } from '../hud/icons';
import { Key } from '../hud/primitives';
import { type MinigameProps, now, useElapsed, useKeys, useOnce } from './common';

type P = Extract<TaskParams, { role: 'GUARDIAN' }>;
type I = Extract<TaskInput, { role: 'GUARDIAN' }>;

const ICON = { LEFT: 'left', UP: 'up', RIGHT: 'right' } as const;
/** Sector centre angles on the radar (degrees from straight up). */
const SECTOR: Record<Direction, number> = { LEFT: -60, UP: 0, RIGHT: 60 };

function sectorPath(center: number): string {
  const r = 86;
  const a0 = ((center - 26 - 90) * Math.PI) / 180;
  const a1 = ((center + 26 - 90) * Math.PI) / 180;
  const p = (a: number, rr: number) =>
    `${(100 + Math.cos(a) * rr).toFixed(1)},${(100 + Math.sin(a) * rr).toFixed(1)}`;
  return `M${p(a0, 28)} L${p(a0, r)} A${r},${r} 0 0 1 ${p(a1, r)} L${p(a1, 28)} A28,28 0 0 0 ${p(a0, 28)} Z`;
}

/**
 * Fujin's shield control: the radar shows where the blow comes from; brace
 * that side while the charge is inside the brace window. Arrow keys or the
 * three shield buttons. Only the direction and the release time are sent.
 */
export function GuardianGame({
  params,
  locale,
  onSubmit,
  disabled,
  offsetMs,
}: MinigameProps<P, I>) {
  const L = (ja: string, en: string) => (locale === 'ja' ? ja : en);
  const [released, setReleased] = useState<{ at: number; dir: Direction } | null>(null);
  const once = useOnce();
  const { elapsed, startRef } = useElapsed(released === null, offsetMs);
  const g = gaugeAt(params, released?.at ?? elapsed);
  const inWindow = g >= params.greenFrom && g <= params.greenTo;
  const release = (dir: Direction) => {
    if (disabled || !once()) return;
    const at = now(startRef);
    setReleased({ at, dir });
    onSubmit({ role: 'GUARDIAN', direction: dir, releaseAtMs: at });
  };
  useKeys((e) => {
    const d = DIRECTIONS.find((x) => DIRECTION_LABELS[x].key === e.key);
    if (d) {
      e.preventDefault();
      release(d);
    }
  }, released === null);
  const threat = DIRECTION_LABELS[params.direction];
  return (
    <div
      className={`hud-game hud-guardian${inWindow ? ' is-window' : ''}${released ? ' is-braced' : ''}`}
    >
      <p className="hud-game-help">
        {L(
          `攻撃方向「${threat.ja}」— ゲージが防御窓に入ったら${threat.ja}の盾`,
          `Incoming from the ${threat.en.toLowerCase()} — brace ${threat.en} inside the window`,
        )}
      </p>
      <svg className="hud-radar" viewBox="0 30 200 110" aria-hidden="true">
        <path d="M14,100 A86,86 0 0 1 186,100" className="hud-radar-arc" />
        <path d="M56,100 A44,44 0 0 1 144,100" className="hud-radar-arc is-inner" />
        {DIRECTIONS.map((d) => (
          <path
            key={d}
            d={sectorPath(SECTOR[d])}
            className={`hud-radar-sector${d === params.direction ? ' is-threat' : ''}${released?.dir === d ? ' is-braced' : ''}`}
          />
        ))}
        <path d="M92,100 L100,84 L108,100 Z" className="hud-radar-own" />
      </svg>
      <div
        className="hud-brace"
        aria-hidden="true"
        data-testid="guardian-gauge"
        data-window={inWindow ? '1' : '0'}
      >
        <span className="hud-label">{L('防御チャージ', 'BRACE CHARGE')}</span>
        <div className="hud-brace-track">
          <div
            className="hud-brace-window"
            style={{
              left: `${params.greenFrom * 100}%`,
              width: `${(params.greenTo - params.greenFrom) * 100}%`,
            }}
          />
          <div className="hud-brace-fill" style={{ width: `${g * 100}%` }} />
        </div>
      </div>
      <div className="hud-shield-row">
        {DIRECTIONS.map((d) => (
          <button
            key={d}
            type="button"
            className={`hud-btn hud-btn-shield${d === params.direction ? ' is-threat' : ''}`}
            onPointerDown={() => release(d)}
            onClick={() => release(d)}
            disabled={!!released || disabled}
            aria-label={L(`${DIRECTION_LABELS[d].ja}の盾`, `${DIRECTION_LABELS[d].en} shield`)}
            data-testid={`guardian-${d}`}
            data-threat={d === params.direction ? '1' : '0'}
          >
            <Icon name={ICON[d]} size={26} strokeWidth={2.2} />
            <span>{L(DIRECTION_LABELS[d].ja, DIRECTION_LABELS[d].en)}</span>
            <Key k={d === 'LEFT' ? '←' : d === 'UP' ? '↑' : '→'} />
          </button>
        ))}
      </div>
    </div>
  );
}
