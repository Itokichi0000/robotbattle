'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JoinResponse, MeResponse } from '@sats-wars/shared';
import { ConnectionPill } from '@/components/ConnectionPill';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Logo } from '@/components/Logo';
import { ApiError, api, storage } from '@/lib/api';
import { useConnectionState, useMatchConnection, useSnapshot } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Controller } from './Controller';
import { type PlaySession, clearSession, deviceId, loadSession, saveSession } from './session';

/**
 * Phone flow, deliberately one screen: everyone is on the same side, so the
 * player is created silently on first load and lands straight on the
 * controller (big おすすめ button, map for those who want to choose).
 */
export function PlayApp() {
  const { L } = useI18n();
  const [session, setSession] = useState<PlaySession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [largeText, setLargeText] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const conn = useMatchConnection('player', session?.token ?? null);
  const snap = useSnapshot(conn);
  const connState = useConnectionState(conn);

  useEffect(() => {
    setSession(loadSession());
    setLargeText(storage.get('sw.largeText') === '1');
    setLoaded(true);
  }, []);
  useEffect(() => {
    document.body.classList.toggle('sw-large-text', largeText);
    storage.set('sw.largeText', largeText ? '1' : '0');
  }, [largeText]);

  const refreshMe = useCallback(async () => {
    if (!session) return;
    try {
      setMe(await api<MeResponse>('/api/me', { token: session.token }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // Token replaced or unknown: joining again with the device id restores
        // the same player (and credit).
        clearSession();
        setSession(null);
        setMe(null);
      }
    }
  }, [session]);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);
  // Balance pushes (top-up credited, move charged, code redeemed).
  useEffect(() => {
    if (!conn) return;
    return conn.onCredit((c) => setMe((m) => (m ? { ...m, creditSats: c.creditSats } : m)));
  }, [conn]);
  // A new season resets "this season" counters; a phone that slept catches up.
  useEffect(() => {
    if (connState === 'connected') void refreshMe();
  }, [connState, refreshMe, snap?.matchId]);

  const onSession = useCallback((s: PlaySession) => {
    saveSession(s);
    setSession(s);
  }, []);

  // No team to pick: join (free) as soon as the page is open.
  const joining = useRef(false);
  const join = useCallback(async () => {
    if (joining.current) return;
    joining.current = true;
    setJoinError(null);
    try {
      const r = await api<JoinResponse>('/api/players', { body: { deviceId: deviceId() } });
      onSession({ token: r.token, playerId: r.playerId, nickname: r.nickname });
    } catch (e) {
      setJoinError(e instanceof ApiError ? e.message : String(e));
    } finally {
      joining.current = false;
    }
  }, [onSession]);
  useEffect(() => {
    if (loaded && !session && snap) void join();
  }, [loaded, session, snap, join]);

  let body: React.ReactNode;
  if (!loaded || !snap) {
    body = <Centered>{connState === 'offline' ? <Offline /> : L('読み込み中…', 'Loading…')}</Centered>;
  } else if (!session) {
    body = (
      <Centered>
        {joinError ? (
          <div>
            <p className="font-bold text-danger">{joinError}</p>
            <button type="button" className="sw-btn mt-3 bg-amber px-4 text-navy" onClick={() => void join()}>
              {L('もう一度', 'Retry')}
            </button>
          </div>
        ) : (
          L('隊員登録中…', 'Joining the defence force…')
        )}
      </Centered>
    );
  } else {
    body = (
      <Controller
        snap={snap}
        conn={conn!}
        session={session}
        me={me}
        onMe={setMe}
        onSession={onSession}
        refreshMe={refreshMe}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-3 pb-6 pt-3">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Logo size="sm" />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ConnectionPill state={connState} />
          <button
            type="button"
            className="sw-focus rounded-full border border-line px-2 py-1.5 text-sm font-bold"
            onClick={() => setLargeText((v) => !v)}
            aria-pressed={largeText}
            aria-label={L('文字サイズ', 'Text size')}
          >
            {largeText ? 'A−' : 'A+'}
          </button>
          <LanguageToggle />
        </div>
      </header>
      <main className="flex flex-1 flex-col">{body}</main>
      <footer className="mt-6 text-center text-[11px] text-off/50">
        <a className="underline" href="/#terms">
          {L('利用条件・個人情報の扱い', 'Terms & privacy')}
        </a>
        {' · '}
        {L('賞金・換金・払い戻しはありません', 'No prizes, no cash-out')}
        {' · '}
        {L('支払い情報は会場画面に表示されません', 'Payment data never appears on the venue screen')}
      </footer>
    </div>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="sw-panel flex flex-1 flex-col items-center justify-center p-6 text-center">{children}</div>
  );
}

function Offline() {
  const { L } = useI18n();
  return (
    <div>
      <p className="text-lg font-bold text-danger">{L('ゲームサーバーに接続できません', 'Cannot reach the game server')}</p>
      <p className="mt-2 text-sm text-off/80">
        {L('会場Wi-Fiに接続しているか確認してください。自動で再接続します。', 'Check the venue Wi-Fi. We will retry automatically.')}
      </p>
    </div>
  );
}
