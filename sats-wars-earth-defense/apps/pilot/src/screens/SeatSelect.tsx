import { ROLE_IDS, ROLES, SEATS } from '@swed/shared';
import type { PublicMatchState, SeatId } from '@swed/shared';
import { ROLE_VAR } from '@swed/ui-tokens';
import { useState } from 'react';
import { haptic, joinSeat, signOut, type PilotSessionState } from '../net';
import { reasonText, useL } from '../ui';
import { MechMap } from './MechMap';

/** Choose a station on the one mech. Seats not open yet are shown as AUTO SUPPORT, not as buttons. */
export function SeatSelect({
  s,
  session,
}: {
  s: PublicMatchState | undefined;
  session: PilotSessionState;
}) {
  const { L } = useL();
  const [busy, setBusy] = useState<SeatId | null>(null);
  const [msg, setMsg] = useState('');
  const closed = s && (s.phase === 'VICTORY' || s.phase === 'DEFEAT' || s.phase === 'RESULTS');
  return (
    <main className="screen seats">
      <div className="join-top">
        <span className="ph-brand">SATS WARS / PILOT</span>
        <span className="who">
          {session.pilot?.publicName}
          {session.pilot?.kind === 'DEMO_GUEST' ? <em>DEMO GUEST</em> : null}
        </span>
      </div>
      <h2 className="title">
        {L('搭乗する席を選ぶ', 'Choose your seat')}
        <small>ONE MECH · 8 SEATS</small>
      </h2>
      <MechMap s={s} />
      {closed ? (
        <p className="note">
          {L('作戦終了。次の作戦の受付を待っています…', 'Round over. Waiting for the next sortie…')}
        </p>
      ) : null}
      {msg ? (
        <p className="err" role="alert">
          {msg}
        </p>
      ) : null}
      {ROLE_IDS.map((role) => (
        <section key={role} className="seat-group" style={{ ['--acc' as string]: ROLE_VAR[role] }}>
          <h3>
            <span className="sw-num">{String(ROLES[role].no).padStart(2, '0')}</span>{' '}
            {L(ROLES[role].labelJa, ROLES[role].labelEn)}
          </h3>
          {ROLES[role].seats.map((id) => {
            const seat = s?.seats[id];
            const def = SEATS[id];
            const taken = !!seat?.occupied;
            if (!seat?.open) {
              return (
                <div key={id} className="seat-row closed">
                  <span className="no sw-num">{String(def.no).padStart(2, '0')}</span>
                  <span className="body">
                    <b>{L(def.labelJa, def.labelEn)}</b>{' '}
                    <span className="part">{L(def.partJa, def.partEn)}</span>
                    <span className="duty">
                      {L(
                        'AUTO SUPPORT が担当中 — Phase 2 で搭乗可能',
                        'Flown by AUTO SUPPORT — opens in Phase 2',
                      )}
                    </span>
                  </span>
                </div>
              );
            }
            return (
              <button
                key={id}
                className={`seat-row${taken ? ' taken' : ''}`}
                disabled={taken || !!busy || !!closed}
                onClick={async () => {
                  haptic();
                  setBusy(id);
                  setMsg('');
                  const r = await joinSeat(id);
                  setBusy(null);
                  if (!r.ok) setMsg(reasonText(r.reasonCode, L));
                }}
              >
                <span className="no sw-num">{String(def.no).padStart(2, '0')}</span>
                <span className="body">
                  <b>{L(def.labelJa, def.labelEn)}</b>{' '}
                  <span className="part">{L(def.partJa, def.partEn)}</span>
                  <span className="duty">{L(def.dutyJa, def.dutyEn)}</span>
                </span>
                <span className="st">
                  {busy === id ? '…' : taken ? seat.displayName : L('空席', 'OPEN')}
                </span>
              </button>
            );
          })}
        </section>
      ))}
      <button className="link" onClick={() => void signOut()}>
        {L('ログアウト', 'Sign out')}
      </button>
    </main>
  );
}
