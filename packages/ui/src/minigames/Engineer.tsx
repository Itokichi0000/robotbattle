import { useState } from 'react';
import type { TaskInput, TaskParams } from '@sats-wars/shared';
import { Key } from '../hud/primitives';
import { type MinigameProps, useKeys } from './common';

type P = Extract<TaskParams, { role: 'ENGINEER' }>;
type I = Extract<TaskInput, { role: 'ENGINEER' }>;

const NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * The maintenance panel: run the repair procedure by throwing the breakers
 * in the listed order (tap or letter keys). The sequence is sent when the
 * procedure is complete; the server scores it.
 */
export function EngineerGame({ params, locale, onSubmit, disabled }: MinigameProps<P, I>) {
  const L = (ja: string, en: string) => (locale === 'ja' ? ja : en);
  const [seq, setSeq] = useState<number[]>([]);
  const done = seq.length >= params.order.length;
  const press = (i: number) => {
    if (done || disabled) return;
    const next = [...seq, i];
    setSeq(next);
    if (next.length >= params.order.length) onSubmit({ role: 'ENGINEER', sequence: next });
  };
  useKeys((e) => {
    const i = NAMES.indexOf(e.key.toUpperCase());
    if (i >= 0 && i < params.switchCount) press(i);
  }, !done);
  const thrown = new Set(seq);
  return (
    <div className={`hud-game hud-engineer${done ? ' is-done' : ''}`}>
      <p className="hud-game-help">
        {L('手順どおりにブレーカーを入れろ', 'Throw the breakers in procedure order')}
      </p>
      <ol
        className="hud-procedure"
        aria-label={L('修理手順', 'Repair procedure')}
        data-testid="engineer-order"
      >
        {params.order.map((s, k) => {
          const state =
            k < seq.length ? (seq[k] === s ? 'is-ok' : 'is-bad') : k === seq.length ? 'is-now' : '';
          return (
            <li key={k} className={state}>
              <span className="hud-procedure-step hud-num">{String(k + 1).padStart(2, '0')}</span>
              <span className="hud-procedure-sw">{NAMES[s]}</span>
            </li>
          );
        })}
      </ol>
      <div className="hud-breakers">
        {Array.from({ length: params.switchCount }, (_, i) => (
          <button
            key={i}
            type="button"
            className={`hud-breaker${thrown.has(i) ? ' is-thrown' : ''}`}
            onClick={() => press(i)}
            disabled={done || disabled}
            data-testid={`engineer-switch-${i}`}
            aria-label={L(`ブレーカー ${NAMES[i]}`, `Breaker ${NAMES[i]}`)}
          >
            <i className="hud-breaker-lamp" aria-hidden="true" />
            <span className="hud-breaker-lever" aria-hidden="true" />
            <span className="hud-breaker-name">{NAMES[i]}</span>
            <Key k={NAMES[i]!} />
          </button>
        ))}
      </div>
    </div>
  );
}
