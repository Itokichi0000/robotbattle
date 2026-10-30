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
  const how = me
    ? L(
        'あなたの回路修復で炉心が戻ります（下のパネル）',
        'Re-route the core below to restore power',
      )
    : crisis.autoAt !== null
      ? L(
          `AUTO SUPPORT が ${Math.max(0, Math.ceil((crisis.autoAt - mt) / 1000))} 秒後に復旧`,
          `AUTO SUPPORT restores it in ${Math.max(0, Math.ceil((crisis.autoAt - mt) / 1000))} s`,
        )
      : L('電力B が回路を修復中', 'POWER B is re-routing the core');
  return (
    <div className={`crisis${me ? ' compact' : ''}`} role="alert">
      <div className="crisis-head">
        <IconWarning size={20} />
        <b>REACTOR BLACKOUT</b>
        <span className="sw-num">{(left / 1000).toFixed(1)}s</span>
      </div>
      <p className="crisis-how">
        {L(
          '炉心停止 — 予備電源のみ（回復 30%）。',
          'Reactor down — reserve power only (30% regen). ',
        )}
        {how}
      </p>
      {/* POWER B's job is the re-route below; the pulse button would cover the puzzle. */}
      {me ? null : (
        <button className="btn grid-pulse" onClick={() => pulseUi.set(true)}>
          <IconBolt size={20} />
          <span>
            {L('GRID PULSE で即時復旧', 'GRID PULSE: restore now')}
            <small>
              {virtual
                ? L('VIRTUAL（テスト・無料）・任意', 'VIRTUAL (free test) · optional')
                : L(
                    `${s.hints.pulseAmountSats} sats・任意 — 払わなくても復旧できます`,
                    `${s.hints.pulseAmountSats} sats · optional — the crew can fix it too`,
                  )}
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
                  `LIGHTNING PULSE 着金、炉心復旧${speed}`,
                  `LIGHTNING PULSE landed, reactor back${speed}`,
                )
              : L(
                  `LIGHTNING PULSE 着金 — OVERCHARGE${speed}`,
                  `LIGHTNING PULSE — OVERCHARGE${speed}`,
                ),
            tone: 'bolt',
            until,
          });
        }
        if (e.type === 'crisis_resolved' && e.by === 'ROUTE')
          setFlash({
            text: L('電力B が炉心を復旧 — OVERCHARGE', 'POWER B restored the core — OVERCHARGE'),
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
