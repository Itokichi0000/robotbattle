'use client';
import { useCallback, useEffect, useState } from 'react';
import type { MeResponse } from '@sats-wars/shared';
import { ConnectionPill } from '@/components/ConnectionPill';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Logo } from '@/components/Logo';
import { ApiError, api, storage } from '@/lib/api';
import { useConnectionState, useMatchConnection, useSnapshot } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Controller } from './Controller';
import { type PlaySession, clearSession, loadSession, saveSession } from './session';
import { TeamPick } from './TeamPick';

/**
 * Phone flow, deliberately two screens only:
 *   1. pick a robot (free, instant)  2. tap to punch (top up when needed).
 * Everything else (rules, sats explanation, top-up) lives on those screens.
 */
export function PlayApp() {
  const { L } = useI18n();
  const [session, setSession] = useState<PlaySession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [largeText, setLargeText] = useState(false);
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
        // Token replaced or unknown: picking a team again restores the same
        // player (and credit) for this device.
        clearSession();
        setSession(null);
        setMe(null);
      }
    }
  }, [session]);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);
  // Balance pushes (top-up credited, punch charged, code redeemed).
  useEffect(() => {
    if (!conn) return;
    return conn.onCredit((c) => setMe((m) => (m ? { ...m, creditSats: c.creditSats } : m)));
  }, [conn]);
  // A new season resets "this season" counters; a phone that slept catches up.
  useEffect(() => {
    if (connState === 'connected') void refreshMe();
  }, [connState, refreshMe, snap?.matchId]);

  const onSession = (s: PlaySession) => {
    saveSession(s);
    setSession(s);
  };

  let body: React.ReactNode;
  if (!loaded || !snap) {
    body = <Centered>{connState === 'offline' ? <Offline /> : L('読み込み中…', 'Loading…')}</Centered>;
  } else if (!session) {
    body = <TeamPick snap={snap} onJoined={onSession} />;
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
