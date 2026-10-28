'use client';
import { useCallback, useEffect, useState } from 'react';
import type { MeResponse, PublicMatchSnapshot } from '@sats-wars/shared';
import { STATUS_LABELS } from '@sats-wars/shared';
import { ConnectionPill } from '@/components/ConnectionPill';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Logo } from '@/components/Logo';
import { ApiError, api, storage } from '@/lib/api';
import { useConnectionState, useMatchConnection, useSnapshot } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Controller } from './Controller';
import { Finished } from './Finished';
import { Intro } from './Intro';
import { Payment } from './Payment';
import { type PlaySession, clearSession, loadSession, saveSession } from './session';
import { Spectate } from './Spectate';

export type Me = MeResponse & { lateCarryoverCode: string | null };

export function PlayApp() {
  const { L, locale } = useI18n();
  const [session, setSession] = useState<PlaySession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [spectating, setSpectating] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
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
      setMe(await api<Me>('/api/me', { token: session.token }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        clearSession();
        setSession(null);
        setMe(null);
      }
    }
  }, [session]);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);
  useEffect(() => {
    if (!conn) return;
    const offs = [conn.onPayment(() => void refreshMe()), conn.onAck(() => void refreshMe())];
    return () => offs.forEach((o) => o());
  }, [conn, refreshMe]);
  // Re-fetch on reconnect so a phone that slept catches up.
  useEffect(() => {
    if (connState === 'connected') void refreshMe();
  }, [connState, refreshMe]);

  const startSession = (s: PlaySession) => {
    saveSession(s);
    setSession(s);
    setMe(null);
  };
  const leave = () => {
    clearSession();
    setSession(null);
    setMe(null);
  };

  // A session for an older match is only kept while it needs attention (late payment).
  const stale = !!(session && snap && session.matchId !== snap.matchId);
  const carryover = me?.lateCarryoverCode ?? null;

  let body: React.ReactNode;
  if (!loaded || !snap) {
    body = (
      <Centered>{connState === 'offline' ? <Offline /> : L('読み込み中…', 'Loading…')}</Centered>
    );
  } else if (spectating) {
    body = <Spectate snap={snap} conn={conn!} onBack={() => setSpectating(false)} />;
  } else if (!session || (stale && me?.invoiceStatus !== 'LATE_PAID')) {
    body = (
      <Intro
        snap={snap}
        onJoined={startSession}
        onSpectate={() => setSpectating(true)}
        serverNow={() => conn?.serverNow() ?? Date.now()}
      />
    );
  } else if (!me) {
    body = <Centered>{L('参加情報を確認中…', 'Checking your entry…')}</Centered>;
  } else if (me.invoiceStatus === 'LATE_PAID') {
    body = <LatePayment me={me} carryover={carryover} onDone={leave} />;
  } else if (me.status === 'EXPIRED' || me.status === 'CANCELLED') {
    body = (
      <Centered>
        <p className="text-lg font-bold">
          {L('参加枠の予約期限が切れました。', 'Your reservation expired.')}
        </p>
        <p className="mt-2 text-off/80">
          {L(
            '料金は発生していません。もう一度参加できます。',
            'You were not charged. You can join again.',
          )}
        </p>
        <button className="sw-btn mt-6 w-full bg-amber text-navy" onClick={leave}>
          {L('もう一度参加する', 'Join again')}
        </button>
      </Centered>
    );
  } else if (me.status !== 'ACTIVE') {
    body = (
      <Payment
        snap={snap}
        session={session}
        me={me}
        onChanged={refreshMe}
        onCancel={leave}
        serverNow={() => conn?.serverNow() ?? Date.now()}
      />
    );
  } else if (
    snap.status === 'FINALIZING' ||
    snap.status === 'FINISHED' ||
    snap.status === 'CANCELLED' ||
    stale
  ) {
    body = <Finished snap={snap} me={me} session={session} onNext={leave} stale={stale} />;
  } else {
    body = (
      <Controller
        snap={snap}
        conn={conn!}
        session={session}
        me={me}
        onMe={setMe}
        refreshMe={refreshMe}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-3 pb-6 pt-3">
      <header className="mb-3 flex items-center justify-between gap-2">
        <Logo size="sm" />
        <div className="flex items-center gap-2">
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
      <div className="mb-2 flex items-center justify-between text-xs text-off/80">
        <ConnectionPill state={connState} />
        {snap && <span className="font-bold">{STATUS_LABELS[snap.status][locale]}</span>}
      </div>
      <main className="flex flex-1 flex-col">{body}</main>
      <footer className="mt-6 text-center text-[11px] text-off/50">
        <a className="underline" href="/#terms">
          {L('利用条件・個人情報の扱い', 'Terms & privacy')}
        </a>
        {' · '}
        {L(
          '支払い情報やIPアドレスは会場画面に表示されません',
          'Payment data is never shown on the venue screen',
        )}
      </footer>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="sw-panel flex flex-1 flex-col items-center justify-center p-6 text-center">
      {children}
    </div>
  );
}

function Offline() {
  const { L } = useI18n();
  return (
    <div>
      <p className="text-lg font-bold text-danger">
        {L('ゲームサーバーに接続できません', 'Cannot reach the game server')}
      </p>
      <p className="mt-2 text-sm text-off/80">
        {L(
          '会場Wi-Fiに接続しているか確認してください。自動で再接続します。',
          'Check the venue Wi-Fi. We will retry automatically.',
        )}
      </p>
    </div>
  );
}

function LatePayment({
  me,
  carryover,
  onDone,
}: {
  me: Me;
  carryover: string | null;
  onDone: () => void;
}) {
  const { L } = useI18n();
  return (
    <Centered>
      <p className="text-lg font-bold">
        {L(
          '入金を確認しましたが、試合の参加受付が終了していました。',
          'Payment confirmed, but the match no longer accepted players.',
        )}
      </p>
      <p className="mt-2 text-sm text-off/80">
        {L(
          '料金を没収することはありません。運営スタッフが確認し、次の試合への繰越などで対応します。この画面をスタッフに見せてください。',
          'Your payment is not forfeited. Staff will review it (e.g. carry over to the next match). Please show this screen to staff.',
        )}
      </p>
      <p className="mt-3 rounded bg-black/40 px-3 py-2 font-mono text-sm">
        ID: {me.participantId.slice(-8)}
      </p>
      {carryover ? (
        <div className="mt-4 w-full rounded-xl border-2 border-ok p-4">
          <p className="font-bold text-ok">
            {L('次の試合で使える参加コード', 'Entry code for the next match')}
          </p>
          <p className="mt-2 select-all font-mono text-2xl font-black tracking-widest">
            {carryover}
          </p>
          <p className="mt-1 text-xs text-off/70">
            {L(
              '参加時に「スポンサーパス」に入力してください',
              'Enter it as a sponsored pass when joining',
            )}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-yellow-300">
          {L('運営の確認待ち', 'Waiting for staff review')}
        </p>
      )}
      <button className="sw-btn mt-6 w-full bg-white/15" onClick={onDone}>
        {L('トップへ戻る', 'Back')}
      </button>
    </Centered>
  );
}

export type { PublicMatchSnapshot };
