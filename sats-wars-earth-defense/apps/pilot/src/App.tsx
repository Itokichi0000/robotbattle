import { useLang, useStore, useTicker } from '@swed/client';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { CAPTURE } from './capture';
import { loadSession, paymentsStore, sessionStore, store } from './net';
import { Battle } from './screens/Battle';
import { Debrief } from './screens/Debrief';
import { Join } from './screens/Join';
import { Lobby } from './screens/Lobby';
import { PaySheet } from './screens/PaySheet';
import { LangCtx, PilotHeader, useL } from './ui';

/**
 * Phone flow (D-033): scan → sign in (free) → you are in the crowd → three buttons → result.
 * No seats to pick. Every screen is derived from server state.
 */
function Router() {
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
  const pay = useSyncExternalStore(paymentsStore.subscribe, paymentsStore.get, paymentsStore.get);
  const st = useStore(store);
  const now = useTicker(250);
  const { L } = useL();
  const s = st.snap?.state;
  const mt = store.matchTime(now);

  if (!session.loaded) return <div className="center-note">{L('接続中…', 'Connecting…')}</div>;
  if (!session.authenticated) return <Join session={session} />;
  const header = <PilotHeader s={s} mt={mt} connected={st.connected} />;
  if (!s) {
    return (
      <>
        {header}
        <div className="center-note">
          {st.reconnecting
            ? L('再接続中…', 'Reconnecting…')
            : L('ゲームサーバーに接続中…', 'Connecting to the game server…')}
        </div>
      </>
    );
  }
  const name = session.status?.pilot?.publicName ?? session.pilot?.publicName ?? 'PILOT';
  let body;
  if (s.phase === 'VICTORY' || s.phase === 'DEFEAT' || s.phase === 'RESULTS') {
    body = <Debrief s={s} />;
  } else if (s.phase === 'BATTLE' || s.phase === 'DEPLOYMENT') {
    body = <Battle s={s} mt={mt} />;
  } else {
    body = <Lobby s={s} mt={mt} name={name} />;
  }
  return (
    <>
      {header}
      {body}
      {pay.action ? <PaySheet s={s} /> : null}
      {s.paused && !CAPTURE ? (
        <div className="overlay">
          {L('作戦一時停止中 — 運営の再開を待っています', 'Paused — waiting for the operator')}
        </div>
      ) : null}
      {!st.connected ? <div className="overlay">{L('再接続中…', 'Reconnecting…')}</div> : null}
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
