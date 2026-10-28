import { useState } from 'react';
import type { TaskInput, TaskParams } from '@sats-wars/shared';
import { type MinigameProps, useKeys } from './common';

type P = Extract<TaskParams, { role: 'ENGINEER' }>;
type I = Extract<TaskInput, { role: 'ENGINEER' }>;

const NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** 🔧 Press the repair switches in the order shown (tap or letter keys). */
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
  return (
    <div className="swc-game swc-engineer">
      <p className="swc-game-help">{L('光った順番にスイッチを押そう', 'Press the switches in this order')}</p>
      <ol className="swc-order" aria-label={L('押す順番', 'Order')}>
        {params.order.map((s, k) => {
          const state = k < seq.length ? (seq[k] === s ? 'is-ok' : 'is-bad') : k === seq.length ? 'is-now' : '';
          return (
            <li key={k} className={state}>
              {NAMES[s]}
            </li>
          );
        })}
      </ol>
      <div className="swc-switches">
        {Array.from({ length: params.switchCount }, (_, i) => (
          <button key={i} type="button" className="swc-big-btn swc-switch" onClick={() => press(i)} disabled={done || disabled} data-testid={`engineer-switch-${i}`}>
            {NAMES[i]}
          </button>
        ))}
      </div>
    </div>
  );
}
