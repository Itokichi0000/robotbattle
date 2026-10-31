import { useStore, useTicker } from '@swed/client';
import { ROLE_IDS, ROLES, roleOf } from '@swed/shared';
import type { PublicMatchState, RoleId, SeatId } from '@swed/shared';
import { IconBolt } from '@swed/ui-tokens';
import { useEffect, useState } from 'react';
import { haptic, store, syncNow } from '../net';
import { reasonText, useL } from '../ui';

/**
 * RAIJIN OVERDRIVE (spec §6.7, D-032): when the RAIJIN gauge is full in the boss fight,
 * every phone shows SYNC NOW. One pilot from each of the four systems must confirm within
 * 5 s; roles with nobody aboard are confirmed by the labelled AUTO SUPPORT.
 */
export function OverdriveCall({ seat }: { seat: SeatId }) {
  const { L } = useL();
  const st = useStore(store);
  const now = useTicker(100);
  const s = st.snap?.state as PublicMatchState | undefined;
  const [pending, setPending] = useState(false);
  const [flash, setFlash] = useState<{ text: string; ok: boolean; until: number } | null>(null);
  const [err, setErr] = useState('');

  useEffect(
    () =>
      store.onEvent(({ payload: e }) => {
        if (e.type === 'overdrive_ready') haptic(80);
        if (e.type === 'overdrive_fired') {
          haptic(200);
          setFlash({
            text: L(`RAIJIN OVERDRIVE 発射！ −${e.damage}`, `RAIJIN OVERDRIVE! −${e.damage}`),
            ok: true,
            until: performance.now() + 3_000,
          });
        }
        if (e.type === 'overdrive_failed') {
          const missing = e.missing.map((r) => L(ROLES[r].labelJa, ROLES[r].labelEn)).join(' ');
          setFlash({
            text: L(`同期失敗：${missing} が未同期`, `Sync failed: ${missing} missing`),
            ok: false,
            until: performance.now() + 3_000,
          });
        }
      }),
    [L],
  );

  if (flash && now < flash.until) {
    return (
      <div className={`od-flash${flash.ok ? '' : ' fail'}`} role="status">
        {flash.text}
      </div>
    );
  }
  if (!s || s.overdrive.status === 'IDLE') return null;
  const od = s.overdrive;
  const mt = store.matchTime(now);
  const role = roleOf(seat);
  const mine = od.confirmed.includes(role);
  const left = od.status === 'CHARGING' ? Math.max(0, od.windowEndsAt - mt) : null;

  const press = async () => {
    if (pending || mine) return;
    haptic(50);
    setPending(true);
    const r = await syncNow();
    setPending(false);
    setErr(r.accepted ? '' : reasonText(r.reasonCode, L));
  };

  return (
    <div
      // While a blackout banner holds the top, the READY strip stays in the thumb zone.
      className={`od-call${od.status === 'READY' && !s.crisis ? ' ready' : ''}`}
      role="dialog"
      aria-label="RAIJIN OVERDRIVE"
    >
      <div className="od-head">
        <IconBolt size={22} />
        <b>RAIJIN OVERDRIVE</b>
        {left !== null ? (
          <span className="sw-num">{(left / 1000).toFixed(1)}s</span>
        ) : (
          <span>READY</span>
        )}
      </div>
      {/* Role chips only during the 5 s window. While READY the strip is compact and sits at
          the top (see pilot.css) so the console's own controls stay usable. */}
      {od.status === 'CHARGING' ? (
        <div className="od-roles">
          {ROLE_IDS.map((r: RoleId) => {
            const done = od.confirmed.includes(r);
            const auto = od.autoRoles.includes(r);
            return (
              <span key={r} className={`od-role${done ? ' done' : ''}${r === role ? ' me' : ''}`}>
                {L(ROLES[r].labelJa, ROLES[r].labelEn)}
                <small>{done ? (auto ? 'AUTO' : 'SYNC') : auto ? 'AUTO' : '…'}</small>
              </span>
            );
          })}
        </div>
      ) : null}
      <button className="btn od" disabled={mine || pending} onClick={() => void press()}>
        <span className="lbl">{mine ? L('同期完了', 'SYNCED') : 'SYNC NOW'}</span>
        <small>
          {mine
            ? L('他の系統を待っています', 'Waiting for the other systems')
            : L('4系統そろえて一斉発射', 'All four systems fire together')}
        </small>
      </button>
      {err ? <p className="err">{err}</p> : null}
    </div>
  );
}
