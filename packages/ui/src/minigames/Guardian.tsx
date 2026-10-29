import { useState } from 'react';
import type { Direction, TaskInput, TaskParams } from '@sats-wars/shared';
import { DIRECTIONS } from '@sats-wars/shared';
import { gaugeAt } from '@sats-wars/game-engine';
import { DIRECTION_LABELS } from '../board';
import { type MinigameProps, now, useElapsed, useKeys, useOnce } from './common';

type P = Extract<TaskParams, { role: 'GUARDIAN' }>;
type I = Extract<TaskInput, { role: 'GUARDIAN' }>;

/** 🛡 Raise the shield toward the attack, while the gauge is in the green band. */
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
  const inGreen = g >= params.greenFrom && g <= params.greenTo;
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
    <div className="swc-game swc-guardian">
      <p className="swc-game-help">
        <span className="swc-threat-arrow" aria-hidden="true">
          {threat.icon}
        </span>{' '}
        {L(
          `攻撃は「${threat.ja}」から！ ゲージが緑のときに${threat.ja}の盾を押す`,
          `Attack from the ${threat.en.toLowerCase()}! Press ${threat.en} while the gauge is green`,
        )}
      </p>
      <div className="swc-gauge" aria-hidden="true">
        <div
          className="swc-gauge-green"
          style={{
            left: `${params.greenFrom * 100}%`,
            width: `${(params.greenTo - params.greenFrom) * 100}%`,
          }}
        />
        <div
          className={`swc-gauge-fill${inGreen ? ' is-green' : ''}`}
          style={{ width: `${g * 100}%` }}
        />
      </div>
      <div className="swc-dir-row">
        {DIRECTIONS.map((d) => (
          <button
            key={d}
            type="button"
            className={`swc-big-btn swc-dir${d === params.direction ? ' is-threat' : ''}`}
            onPointerDown={() => release(d)}
            onClick={() => release(d)}
            disabled={!!released || disabled}
            aria-label={L(`${DIRECTION_LABELS[d].ja}の盾`, `${DIRECTION_LABELS[d].en} shield`)}
            data-testid={`guardian-${d}`}
          >
            {DIRECTION_LABELS[d].icon}
            <small>{L(DIRECTION_LABELS[d].ja, DIRECTION_LABELS[d].en)}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
