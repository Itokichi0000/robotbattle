import { useStore, useTicker } from '@swed/client';
import type { PublicMatchState, SeatId } from '@swed/shared';
import { IconBolt, IconWarning } from '@swed/ui-tokens';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { haptic, loadQuote, paymentsStore, store } from '../net';
import { pulseUi, useL } from '../ui';

/**
 * REACTOR BLACKOUT on the phone (spec §8.1): every pilot sees the countdown and the two ways
 * out — POWER B re-routes the core (or AUTO SUPPORT, said plainly), or anyone sends a GRID
 * PULSE. The pulse is offered, never pushed: it opens the same terms sheet as always.
 */
export function CrisisBanner({ seat }: { seat: SeatId }) {
  const { L } = useL();
  const st = useStore(store);
  const now = useTicker(100);
  const p = useSyncExternalStore(paymentsStore.subscribe, paymentsStore.get, paymentsStore.get);
  const s = st.snap?.state as PublicMatchState | undefined;
  const crisis = s?.crisis ?? null;
  const startedAt = crisis?.startedAt;

  useEffect(() => {
    if (startedAt === undefined) return;
    haptic(120);
    void loadQuote();
  }, [startedAt]);

  if (!s || !crisis) return null;
  const mt = store.matchTime(now);
  const left = Math.max(0, crisis.endsAt - mt);
  const me = seat === 'POWER_ROUTER';
  const virtual = p.quote?.mode !== 'live';
  const gain = s.hints.pulseGain;
  const how = me
    ? L(
        `あなたが下のパネルで回路をつなぐと復旧（雷神ゲージ +${gain}%）`,
        `Re-route the core below to restore it (gauge +${gain}%)`,
      )
    : crisis.autoAt !== null
      ? L(
          `直し方：電力B は空席なので AUTO が ${Math.max(0, Math.ceil((crisis.autoAt - mt) / 1000))} 秒後に復旧。急ぐなら sats で即時復旧（雷神ゲージ +${gain}%）`,
          `AUTO restores it in ${Math.max(0, Math.ceil((crisis.autoAt - mt) / 1000))} s, or send sats to restore now (gauge +${gain}%)`,
        )
      : L(
          `直し方：① 電力B が回路をつなぐ ② 誰かが sats で即時復旧。どちらでも雷神ゲージ +${gain}%`,
          `Fix: POWER B re-routes, or anyone sends sats. Either way gauge +${gain}%`,
        );
  return (
    <div className={`crisis${me ? ' compact' : ''}`} role="alert">
      <div className="crisis-head">
        <IconWarning size={20} />
        <b>{L('炉心停止', 'REACTOR BLACKOUT')}</b>
        <span className="sw-num">{(left / 1000).toFixed(1)}s</span>
      </div>
      <p className="crisis-how">
        {L('エネルギー回復が 30% に低下。', 'Energy regen down to 30%. ')}
        {how}
      </p>
      {/* POWER B's job is the re-route below; the pulse button would cover the puzzle. */}
      {me ? null : (
        <button className="btn grid-pulse" onClick={() => pulseUi.set(true)}>
          <IconBolt size={20} />
          <span>
            {L(
              `${s.hints.pulseAmountSats} sats で即時復旧`,
              `Restore now with ${s.hints.pulseAmountSats} sats`,
            )}
            <small>
              {virtual
                ? L(
                    'VIRTUAL（テスト・お金は動きません）・任意',
                    'VIRTUAL (test, no money) · optional',
                  )
                : L('任意 — 払わなくても仲間が直せます', 'Optional — the crew can fix it too')}
            </small>
          </span>
        </button>
      )}
    </div>
  );
}

/** Short flash when a blackout ends (how), or when a GRID PULSE lands at any time. */
export function CrisisFlash() {
  const { L } = useL();
  const now = useTicker(200);
  const [flash, setFlash] = useState<{
    text: string;
    tone: 'bolt' | 'ok' | 'bad';
    until: number;
  } | null>(null);
  useEffect(
    () =>
      store.onEvent(({ payload: e }) => {
        const until = performance.now() + 3_000;
        if (e.type === 'sats_pulse_settled') {
          haptic(80);
          const speed =
            e.settleMs !== null
              ? L(
                  ` — 請求から着金まで ${(e.settleMs / 1000).toFixed(1)} 秒`,
                  ` — invoice to settled in ${(e.settleMs / 1000).toFixed(1)} s`,
                )
              : ' — VIRTUAL';
          setFlash({
            text: e.crisis
              ? L(
                  `LIGHTNING 着金 — 炉心復旧・雷神ゲージ +${e.gain}%${speed}`,
                  `LIGHTNING landed — reactor back, gauge +${e.gain}%${speed}`,
                )
              : L(
                  `LIGHTNING 着金 — 雷神ゲージ +${e.gain}%${speed}`,
                  `LIGHTNING landed — gauge +${e.gain}%${speed}`,
                ),
            tone: 'bolt',
            until,
          });
        }
        if (e.type === 'crisis_resolved' && e.by === 'ROUTE')
          setFlash({
            text: L(
              `電力B が炉心を復旧 — 雷神ゲージ +${e.gain}%`,
              `POWER B restored the core — gauge +${e.gain}%`,
            ),
            tone: 'ok',
            until,
          });
        if (e.type === 'crisis_resolved' && e.by === 'AUTO')
          setFlash({
            text: L('AUTO SUPPORT が炉心を復旧', 'AUTO SUPPORT restored the core'),
            tone: 'ok',
            until,
          });
        if (e.type === 'crisis_failed') {
          haptic(200);
          setFlash({
            text: L(`ブラックアウト損傷 コア −${e.damage}`, `Blackout damage: core −${e.damage}`),
            tone: 'bad',
            until,
          });
        }
      }),
    [L],
  );
  if (!flash || now > flash.until) return null;
  return (
    <div className={`crisis-flash ${flash.tone}`} role="status">
      {flash.tone === 'bolt' ? <IconBolt size={22} /> : null}
      <span>{flash.text}</span>
    </div>
  );
}
