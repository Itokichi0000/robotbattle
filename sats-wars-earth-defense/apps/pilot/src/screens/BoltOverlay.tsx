import { useStore, useTicker } from '@swed/client';
import { boltTargetAt } from '@swed/shared';
import type { PublicMatchState } from '@swed/shared';
import { IconBolt } from '@swed/ui-tokens';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { haptic, paymentsStore, store, throwBolt } from '../net';
import { useL } from '../ui';

/**
 * The payer's moment (D-035): the mothership's weak point drifts across the field; tap it to
 * throw the bolt. The phone sends only where and when you tapped; the server checks the weak
 * point's position at that moment (the same formula draws it here). Not thrown in time, it is
 * thrown for you — the payment always does something.
 */
export function BoltOverlay({ s }: { s: PublicMatchState }) {
  const { L } = useL();
  const pay = useSyncExternalStore(paymentsStore.subscribe, paymentsStore.get, paymentsStore.get);
  useStore(store);
  const now = useTicker(33);
  const field = useRef<HTMLDivElement>(null);
  const [thrown, setThrown] = useState<string | null>(null);
  const [result, setResult] = useState<{
    id: string;
    hit: boolean;
    damage: number;
    until: number;
  } | null>(null);
  const bolt = s.bolts.find((b) => pay.mine.includes(b.id) && b.id !== thrown) ?? null;

  useEffect(
    () =>
      store.onEvent(({ payload: e }) => {
        if (e.type === 'bolt_thrown' && pay.mine.includes(e.boltId))
          setResult({
            id: e.boltId,
            hit: e.hit,
            damage: e.damage,
            until: performance.now() + 2_200,
          });
      }),
    [pay.mine],
  );

  if (result && now < result.until) {
    return (
      <div className={`bolt-overlay result${result.hit ? ' hit' : ''}`} role="status">
        <IconBolt size={56} />
        <b>{result.hit ? L('弱点に直撃！', 'Weak point hit!') : L('雷撃命中', 'Bolt landed')}</b>
        <span className="sw-num">
          {L(`母艦に ${result.damage} ダメージ`, `${result.damage} damage to the mothership`)}
        </span>
        <small>{L('大画面を見て！', 'Look at the big screen!')}</small>
      </div>
    );
  }
  if (!bolt) return null;
  const mt = store.matchTime(now);
  const p = boltTargetAt(bolt.id, mt - bolt.startedAt);
  const left = Math.max(0, (bolt.expiresAt - mt) / 1000);
  const r = s.hints.boltRadius;

  const send = (x: number, y: number) => {
    if (thrown === bolt.id) return;
    haptic(40);
    setThrown(bolt.id);
    void throwBolt(bolt.id, x, y, store.matchTime(performance.now()));
  };
  const tap = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = field.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    send((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height);
  };

  return (
    <div className="bolt-overlay" role="dialog" aria-label={L('雷を落とせ', 'Throw the bolt')}>
      <b className="bolt-title">
        <IconBolt size={26} /> {L('雷を落とせ！', 'THROW THE BOLT!')}
      </b>
      <span className="bolt-sub">
        {L(
          `赤い弱点をタップ — 当たれば ${s.hints.boltHitMultiplier}倍`,
          `Tap the red weak point — ×${s.hints.boltHitMultiplier} on a hit`,
        )}
      </span>
      <div ref={field} className="bolt-field" onPointerDown={tap}>
        <svg viewBox="0 0 100 100" className="bolt-ship" aria-hidden>
          <path d="M10 40 L30 22 L50 30 L70 22 L90 40 L74 58 L50 66 L26 58 Z" />
          <path d="M30 58 L26 86 M42 63 L40 92 M58 63 L60 92 M70 58 L74 86" />
        </svg>
        <button
          className="bolt-core"
          aria-label={L('弱点', 'Weak point')}
          style={{
            left: `${p.x * 100}%`,
            top: `${p.y * 100}%`,
            width: `${r * 200}%`,
            height: `${r * 200}%`,
          }}
          tabIndex={0}
          onKeyDown={(e) => {
            // Keyboard: Enter throws at the weak point as it is drawn now.
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              send(p.x, p.y);
            }
          }}
        />
      </div>
      <span className="bolt-left sw-num">
        {L(`あと ${left.toFixed(1)} 秒`, `${left.toFixed(1)}s left`)}
      </span>
    </div>
  );
}
