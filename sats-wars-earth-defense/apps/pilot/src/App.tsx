import { useLang, useStore, useTicker } from '@swed/client';
import { isCombatPhase, SEATS } from '@swed/shared';
import type { GunnerSeatId, ShieldSeatId } from '@swed/shared';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { loadSession, sessionStore, store } from './net';
import { Debrief } from './screens/Debrief';
import { Defense } from './screens/Defense';
import { Gunner } from './screens/Gunner';
import { Join } from './screens/Join';
import { ReadyRoom } from './screens/ReadyRoom';
import { SeatSelect } from './screens/SeatSelect';
import { LangCtx, PilotHeader, useL } from './ui';

/**
 * Pilot flow (spec §4.7): join → sign-in → seat → READY → role console → debrief.
 * Every screen is derived from server state; the phone holds no game state of its own.
 */
function Router() {
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
  const st = useStore(store);
  const now = useTicker(250);
  const { L } = useL();
  const s = st.snap?.state;
  const seat = session.status?.assignedSeat ?? null;
  const mt = store.matchTime(now);

  if (!session.loaded) return <div className="center-note">{L('接続中…', 'Connecting…')}</div>;
  if (!session.authenticated) return <Join session={session} />;
  if (!s) {
    return (
      <main className="screen">
        <PilotHeader s={undefined} mt={0} seat={null} connected={st.connected} />
        <div className="center-note">
          {st.reconnecting
            ? L('再接続中… 席は60秒間確保されます', 'Reconnecting… your seat is held for 60 s')
            : L('ゲームサーバーに接続中…', 'Connecting to the game server…')}
        </div>
      </main>
    );
  }
  if (!seat) return <SeatSelect s={s} session={session} />;
  const role = SEATS[seat].role;
  if (s.phase === 'VICTORY' || s.phase === 'DEFEAT' || s.phase === 'RESULTS')
    return <Debrief s={s} seat={seat} />;
  if (isCombatPhase(s.phase)) {
    const body =
      role === 'GUNNER' ? (
        <Gunner seat={seat as GunnerSeatId} />
      ) : role === 'DEFENSE' ? (
        <Defense seat={seat as ShieldSeatId} />
      ) : null;
    return (
      <>
        {body}
        {s.paused ? (
          <div className="overlay">
            {L('作戦一時停止中 — 運営の再開を待っています', 'Paused — waiting for the operator')}
          </div>
        ) : null}
        {!st.connected ? (
          <div className="overlay">
            {L('再接続中… 席は60秒間確保されます', 'Reconnecting… your seat is held for 60 s')}
          </div>
        ) : null}
      </>
    );
  }
  return (
    <>
      <PilotHeader s={s} mt={mt} seat={null} connected={st.connected} />
      <ReadyRoom s={s} seat={seat} />
    </>
  );
}

export function App() {
  const [lang, setLang, L] = useLang();
  const ctx = useMemo(() => ({ lang, setLang, L }), [lang, setLang, L]);
  useEffect(() => {
    void loadSession();
    // A phone that slept or switched to the wallet app re-checks its session on return.
    const onVisible = () => document.visibilityState === 'visible' && void loadSession();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  return (
    <LangCtx.Provider value={ctx}>
      <Router />
    </LangCtx.Provider>
  );
}
