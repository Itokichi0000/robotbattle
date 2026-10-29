import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { TaskInput, TaskParams } from '@sats-wars/shared';
import { reticleAt } from '@sats-wars/game-engine';
import { Icon } from '../hud/icons';
import { Key } from '../hud/primitives';
import { type MinigameProps, now, useElapsed, useKeys, useOnce } from './common';

type P = Extract<TaskParams, { role: 'GUNNER' }>;
type I = Extract<TaskInput, { role: 'GUNNER' }>;

/**
 * Raijin's mechanical sight: an outer bezel with range ticks, an inner ring
 * and the scope across its middle. The same frame is shown idle (READY,
 * cooling down, waiting for the verdict) and live (tracking, LOCK), so the
 * trigger never moves.
 */
export function SightFrame({
  state,
  status,
  caption,
  children,
}: {
  state: 'idle' | 'tracking' | 'locked' | 'fired' | 'cooldown' | 'result-hit' | 'result-miss';
  status: ReactNode;
  caption?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`hud-sight is-${state}`}>
      <svg className="hud-sight-ring" viewBox="0 0 240 240" aria-hidden="true">
        <circle cx="120" cy="120" r="112" className="hud-sight-bezel" />
        <circle cx="120" cy="120" r="74" className="hud-sight-inner" />
        {Array.from({ length: 48 }, (_, i) => {
          const a = (i / 48) * Math.PI * 2;
          const major = i % 6 === 0;
          const r0 = major ? 96 : 104;
          return (
            <line
              key={i}
              x1={120 + Math.cos(a) * r0}
              y1={120 + Math.sin(a) * r0}
              x2={120 + Math.cos(a) * 112}
              y2={120 + Math.sin(a) * 112}
              className={major ? 'is-major' : undefined}
            />
          );
        })}
        {/* Converging brackets: they close in on LOCK */}
        <g className="hud-sight-brackets">
          <path d="M70,96 V70 H96" />
          <path d="M144,70 H170 V96" />
          <path d="M170,144 V170 H144" />
          <path d="M96,170 H70 V144" />
        </g>
        <path d="M120,40 V58 M120,182 V200 M40,120 H58 M182,120 H200" className="hud-sight-cross" />
      </svg>
      {caption && <div className="hud-sight-caption">{caption}</div>}
      <div className="hud-scope">{children}</div>
      <div className="hud-sight-status" role="status">
        {status}
      </div>
    </div>
  );
}

/**
 * Raijin's fire control: the reticle sweeps across the scope; inside the lock
 * window the brackets close (LOCK). Fire with the trigger, Space or Enter.
 * Only the stop time is sent; the server scores it.
 */
export function GunnerGame({
  params,
  locale,
  onSubmit,
  disabled,
  offsetMs,
  caption,
  onAim,
}: MinigameProps<P, I> & {
  caption?: ReactNode;
  /** Sight state changes (for the 3D designator); called on change only. */
  onAim?: (state: 'track' | 'lock' | 'fired') => void;
}) {
  const L = (ja: string, en: string) => (locale === 'ja' ? ja : en);
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const once = useOnce();
  const { elapsed, startRef } = useElapsed(stoppedAt === null, offsetMs);
  const x = reticleAt(params, stoppedAt ?? elapsed);
  const fire = () => {
    if (disabled || !once()) return;
    const t = now(startRef);
    setStoppedAt(t);
    onSubmit({ role: 'GUNNER', stopAtMs: t });
  };
  useKeys((e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      fire();
    }
  }, stoppedAt === null);
  const lo = params.ringCenter - params.ringWidth / 2;
  const locked = Math.abs(x - params.ringCenter) <= params.ringWidth / 2;
  const fired = stoppedAt !== null;
  const aim = fired ? 'fired' : locked ? 'lock' : 'track';
  useEffect(() => onAim?.(aim), [aim, onAim]);
  return (
    <div className="hud-game hud-gunner">
      <SightFrame
        state={fired ? 'fired' : locked ? 'locked' : 'tracking'}
        caption={caption}
        status={
          fired ? (
            <span className="hud-sight-word">{L('判定待ち', 'AWAITING')}</span>
          ) : locked ? (
            <span className="hud-sight-word is-lock">LOCK</span>
          ) : (
            <span className="hud-sight-word">{L('追尾中', 'TRACKING')}</span>
          )
        }
      >
        <div
          className="hud-scope-window"
          style={{ left: `${lo * 100}%`, width: `${params.ringWidth * 100}%` }}
        />
        <div
          className="hud-scope-reticle"
          style={{ left: `${x * 100}%` }}
          data-testid="gunner-reticle"
          data-locked={locked ? '1' : '0'}
        >
          <i />
        </div>
      </SightFrame>
      <p className="hud-game-help">
        {L('照準がロック枠に入った瞬間に撃て', 'Fire while the reticle is inside the lock window')}
      </p>
      <button
        type="button"
        className={`hud-trigger${locked && !fired ? ' is-hot' : ''}`}
        onPointerDown={fire}
        onClick={fire}
        disabled={fired || disabled}
        data-testid="gunner-fire"
      >
        <Icon name="energy" size={22} />
        <span className="hud-trigger-word">{L('発射', 'FIRE')}</span>
        <Key k="Space" />
      </button>
    </div>
  );
}
