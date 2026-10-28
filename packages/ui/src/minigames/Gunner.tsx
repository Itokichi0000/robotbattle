import { useState } from 'react';
import type { TaskInput, TaskParams } from '@sats-wars/shared';
import { reticleAt } from '@sats-wars/game-engine';
import { type MinigameProps, now, useElapsed, useKeys, useOnce } from './common';

type P = Extract<TaskParams, { role: 'GUNNER' }>;
type I = Extract<TaskInput, { role: 'GUNNER' }>;

/** 🎯 Stop the moving reticle inside the ring (tap, Space or Enter). */
export function GunnerGame({ params, locale, onSubmit, disabled, offsetMs }: MinigameProps<P, I>) {
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
  const inRing = Math.abs(x - params.ringCenter) <= params.ringWidth / 2;
  return (
    <div className="swc-game swc-gunner">
      <p className="swc-game-help">{L('照準が光る輪に重なった瞬間にタップ！', 'Tap when the reticle is inside the ring!')}</p>
      <div className="swc-gunner-track" aria-hidden="true">
        <div className="swc-gunner-ring" style={{ left: `${lo * 100}%`, width: `${params.ringWidth * 100}%` }} />
        <div className={`swc-gunner-reticle${inRing ? ' is-in' : ''}`} style={{ left: `${x * 100}%` }}>
          ⌖
        </div>
      </div>
      <button type="button" className="swc-big-btn swc-fire" onPointerDown={fire} onClick={fire} disabled={stoppedAt !== null || disabled} data-testid="gunner-fire">
        ⚡ {L('撃つ！', 'FIRE!')} <small>Space</small>
      </button>
    </div>
  );
}
