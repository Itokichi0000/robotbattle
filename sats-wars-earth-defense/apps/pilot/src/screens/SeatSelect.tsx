import { ROLE_IDS, ROLES, SEATS } from '@swed/shared';
import type { PublicMatchState, SeatId } from '@swed/shared';
import { ROLE_VAR } from '@swed/ui-tokens';
import { useState } from 'react';
import { haptic, joinSeat, saveCallsign, signOut, type PilotSessionState } from '../net';
import { reasonText, useL } from '../ui';
import { MechMap } from './MechMap';

/** Choose a station on the one mech. Seats staff closed are shown as AUTO SUPPORT, not as buttons. */
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
      <CallsignForm session={session} />
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
            // A DEMO-BOT seat is free for a person: the bot steps aside.
            const taken = !!seat?.occupied && !seat.bot;
            if (!seat?.open) {
              return (
                <div key={id} className="seat-row closed">
                  <span className="no sw-num">{String(def.no).padStart(2, '0')}</span>
                  <span className="body">
                    <b>{L(def.labelJa, def.labelEn)}</b>{' '}
                    <span className="part">{L(def.partJa, def.partEn)}</span>
                    <span className="duty">
                      {L(
                        'AUTO SUPPORT が担当中（運営が閉じた席）',
                        'Flown by AUTO SUPPORT (closed by staff)',
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
                  {busy === id
                    ? '…'
                    : taken
                      ? seat.displayName
                      : seat.bot
                        ? L('DEMO-BOT・交代可', 'DEMO-BOT · take it')
                        : L('空席', 'OPEN')}
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

/** Optional callsign (2–12 letters/digits/kana/kanji, - and _). Shown on the big screen only if opted in. */
function CallsignForm({ session }: { session: PilotSessionState }) {
  const { L } = useL();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(session.pilot?.callsign ?? '');
  const [show, setShow] = useState(session.pilot?.showCallsign ?? false);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'bad'>('idle');
  if (!open) {
    return (
      <button className="link" onClick={() => setOpen(true)}>
        {session.pilot?.callsign
          ? L(
              `コールサイン: ${session.pilot.callsign}（変更）`,
              `Callsign: ${session.pilot.callsign} (edit)`,
            )
          : L('コールサインを設定（任意）', 'Set a callsign (optional)')}
      </button>
    );
  }
  return (
    <form
      className="callsign sw-frame"
      onSubmit={async (e) => {
        e.preventDefault();
        setState('saving');
        const v = value.trim();
        const ok = await saveCallsign(v ? v : null, show);
        setState(ok ? 'saved' : 'bad');
      }}
    >
      <label>
        <span>{L('コールサイン（2〜12文字・任意）', 'Callsign (2–12 chars, optional)')}</span>
        <input
          value={value}
          maxLength={12}
          onChange={(e) => {
            setValue(e.target.value);
            setState('idle');
          }}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={show}
          onChange={(e) => {
            setShow(e.target.checked);
            setState('idle');
          }}
        />
        <span>
          {L(
            '大画面に表示する（しない場合は PILOT-XXXX）',
            'Show it on the big screen (otherwise PILOT-XXXX)',
          )}
        </span>
      </label>
      <button className="btn" type="submit" disabled={state === 'saving'}>
        {state === 'saved'
          ? L('保存しました', 'Saved')
          : state === 'saving'
            ? '…'
            : L('保存', 'Save')}
      </button>
      {state === 'bad' ? (
        <p className="err" role="alert">
          {L(
            '2〜12文字、文字・数字・-・_ のみ使えます',
            '2–12 chars: letters, digits, - and _ only',
          )}
        </p>
      ) : null}
    </form>
  );
}
