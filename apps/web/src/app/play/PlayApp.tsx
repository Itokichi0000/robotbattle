'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MeResponse, SessionResponse } from '@sats-wars/shared';
import { CHEER_EMOJIS, ONE_LINE_RULES } from '@sats-wars/shared';
import { Cockpit, JapanMapMini, RaidHeader, ResultCard, type SeatState, ThreatLine, TrainingPanel, raidView } from '@sats-wars/ui';
import { ConnectionPill } from '@/components/ConnectionPill';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Logo } from '@/components/Logo';
import { ApiError, api } from '@/lib/api';
import { useConnectionState, useRaid, useRaidConnection, useTicker } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { httpRaidClient } from '@/lib/raidClient';
import { PassGate } from './PassGate';
import { deviceId } from './session';

/**
 * Phone: become a pilot (guest or Lightning), take a seat, fly missions.
 * The session is an HttpOnly cookie; nothing secret is kept in the page.
 */
export function PlayApp() {
  const { L, locale } = useI18n();
  const conn = useRaidConnection('pilot');
  const snap = useRaid(conn);
  const connState = useConnectionState(conn);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [seatPatch, setSeatPatch] = useState<Partial<SeatState>>({});
  const client = useMemo(() => (conn ? httpRaidClient(conn) : null), [conn]);

  const refreshMe = useCallback(async () => {
    try {
      const m = await api<MeResponse>('/api/me');
      setMe(m);
      setSeatPatch({});
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
    } finally {
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);
  // A new raid (or a raid that just opened) resets the seat.
  useEffect(() => {
    if (snap && me && snap.raidId !== me.seat.raidId) void refreshMe();
  }, [snap?.raidId, me, refreshMe]); // eslint-disable-line react-hooks/exhaustive-deps

  const onLogin = useCallback(async () => {
    await refreshMe();
    conn?.resubscribe();
  }, [refreshMe, conn]);

  if (!authChecked) return <Shell connState={connState}>{L('読み込み中…', 'Loading…')}</Shell>;
  if (!me) return <Shell connState={connState}><Onboarding onLogin={onLogin} /></Shell>;
  if (!snap || !client) return <Shell connState={connState}>{L('サーバーに接続中…', 'Connecting…')}</Shell>;

  const seat: SeatState = { ...me.seat, ...seatPatch };
  const needsPass = !seat.boarded && !me.seat.entitled && snap.passMode === 'PAID' && !snap.demoMode && me.passCredits === 0;
  const lobby = snap.status === 'LOBBY_OPEN' || snap.status === 'CREATED';
  const gate = !snap.joinOpen && !seat.boarded ? (
    <div className="sw-panel p-4 text-center" data-testid="join-closed">
      <p className="font-bold">{L('今回の出撃受付は終了しました', 'Boarding has closed for this raid')}</p>
      <p className="text-sm text-muted">{L('応援して次の作戦を待とう！ 次はすぐ始まります', 'Cheer now and join the next raid soon!')}</p>
    </div>
  ) : needsPass ? (
    <PassGate snap={snap} conn={conn!} pending={me.pendingInvoice} onGranted={refreshMe} />
  ) : undefined;

  return (
    <Shell connState={connState} callsign={me.pilot.callsign}>
      <PlayBody snap={snap} me={me} />
      {snap.status === 'ENDED' && snap.result ? (
        <>
          <ResultCard result={snap.result} locale={locale} bestScore={snap.bestScore} />
          <p className="text-center text-sm text-muted">{L('まもなく次の作戦が始まります', 'The next raid starts soon')}</p>
          <Link className="sw-btn sw-focus bg-navy-3 px-4 py-3 text-center" href="/passport">
            🪪 {L('パイロット手帳を見る', 'Open my passport')}
          </Link>
        </>
      ) : (
        <Cockpit
          client={client}
          raid={snap}
          seat={seat}
          onSeat={(p) => setSeatPatch((s) => ({ ...s, ...p }))}
          locale={locale}
          easy={me.pilot.assistMode}
          boardGate={gate}
        />
      )}
      {!lobby && <PlayMap snap={snap} />}
      {(lobby || !seat.boarded) && snap.status !== 'ENDED' && <TrainingPanel locale={locale} initialRole={seat.role ?? 'GUNNER'} />}
      <CheerRow />
      <Settings me={me} onChanged={refreshMe} />
    </Shell>
  );
}

function PlayBody({ snap, me }: { snap: NonNullable<ReturnType<typeof useRaid>>; me: MeResponse }) {
  const { L, locale } = useI18n();
  useTicker(500);
  const view = raidView(snap, snapNow(snap));
  const lobbyLeft = snap.lobbyEndsAt ? Math.max(0, Math.ceil((snap.lobbyEndsAt - Date.now()) / 1000)) : null;
  return (
    <>
      {snap.broadcast && (
        <p className="rounded-lg bg-teal/20 px-3 py-2 text-sm font-bold" role="status">
          📢 {L(snap.broadcast.messageJa, snap.broadcast.messageEn)}
        </p>
      )}
      <RaidHeader raid={snap} view={view} locale={locale} compact />
      {snap.status === 'LIVE' && <ThreatLine view={view} locale={locale} />}
      {snap.status === 'LOBBY_OPEN' && (
        <p className="sw-panel p-3 text-center font-bold" data-testid="lobby-countdown">
          {lobbyLeft !== null ? L(`出撃まで ${lobbyLeft}秒`, `Launch in ${lobbyLeft}s`) : L('パイロット募集中', 'Pilots wanted')}
          <span className="block text-xs font-normal text-muted">{L(`${snap.crew.length}人が搭乗中`, `${snap.crew.length} aboard`)}</span>
        </p>
      )}
      {snap.status === 'PAUSED' && (
        <p className="rounded-lg bg-amber/20 px-3 py-2 text-center font-bold" role="status">
          ⏸ {L('一時停止中', 'Paused')}
        </p>
      )}
      {me.seat.stats && me.seat.stats.tasks > 0 && (
        <p className="text-center text-xs text-muted">
          {L(`あなたの出撃 ${me.seat.stats.tasks}回・成功 ${me.seat.stats.successes}回`, `Your sorties ${me.seat.stats.tasks} · hits ${me.seat.stats.successes}`)}
        </p>
      )}
    </>
  );
}

/** Map below the cockpit: the phone's job is the mission, the big screen shows the map. */
function PlayMap({ snap }: { snap: NonNullable<ReturnType<typeof useRaid>> }) {
  const { L, locale } = useI18n();
  const view = raidView(snap, snapNow(snap));
  return (
    <details className="sw-panel p-3">
      <summary className="min-h-11 cursor-pointer content-center text-sm font-bold">🗾 {L('日本の地図を見る', 'Show the map of Japan')}</summary>
      <div className="mx-auto max-w-sm">
        <JapanMapMini view={view} locale={locale} maxHp={snap.config.cityMaxHp} />
      </div>
    </details>
  );
}

/** Rough game time from the snapshot anchor (the cockpit uses the synced clock). */
function snapNow(s: NonNullable<ReturnType<typeof useRaid>>): number {
  return s.running ? s.gameMs + Math.max(0, Date.now() - s.serverTime) : s.gameMs;
}

function Shell({ children, connState, callsign }: { children: React.ReactNode; connState: ReturnType<typeof useConnectionState>; callsign?: string }) {
  return (
    <main className="swc-root mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-3 px-4 pt-3 pb-10">
      <header className="flex items-center justify-between gap-2">
        <Link href="/" className="sw-focus shrink-0 rounded">
          <Logo size="sm" />
        </Link>
        <div className="flex min-w-0 items-center gap-1.5">
          {callsign && (
            <Link href="/passport" className="sw-focus max-w-[7rem] min-w-[4.5rem] truncate rounded-full sm:max-w-[11rem] border border-line px-2 py-1 text-xs font-bold" data-testid="callsign">
              🪪 {callsign}
            </Link>
          )}
          <ConnectionPill state={connState} />
          <LanguageToggle />
        </div>
      </header>
      {children}
    </main>
  );
}

function Onboarding({ onLogin }: { onLogin: () => Promise<void> }) {
  const { L, locale } = useI18n();
  const [callsign, setCallsign] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modes, setModes] = useState<{ mock: boolean; lightning: boolean; demo: boolean } | null>(null);
  useEffect(() => {
    api<{ mock: boolean; lightning: boolean; demo: boolean }>('/api/auth/modes')
      .then(setModes)
      .catch(() => setModes(null));
  }, []);
  const guest = async () => {
    setBusy(true);
    setError(null);
    try {
      await api<SessionResponse>('/api/auth/guest', { body: { callsign: callsign.trim(), deviceId: deviceId() } });
      await onLogin();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="flex flex-col gap-4" data-testid="onboarding">
      <div className="sw-panel p-4">
        <h1 className="sw-display text-2xl">{L('君も、パイロットになろう。', 'Become a pilot.')}</h1>
        <p className="mt-2 text-sm">{locale === 'ja' ? ONE_LINE_RULES.ja : ONE_LINE_RULES.en}</p>
        <ul className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <li>🎯 {L('砲撃：敵の弱点を撃つ', 'Gunner: hit weak points')}</li>
          <li>🛡 {L('防衛：街を守る', 'Guardian: shield cities')}</li>
          <li>🔌 {L('電力：エネルギーをつなぐ', 'Router: route energy')}</li>
          <li>🔧 {L('整備：修理する', 'Engineer: repair')}</li>
        </ul>
      </div>
      <form
        className="sw-panel flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void guest();
        }}
      >
        <label className="text-sm font-bold" htmlFor="callsign">
          {L('コールサイン（大画面に出る名前・省略可）', 'Callsign (optional, may appear on the big screen)')}
        </label>
        <input
          id="callsign"
          className="sw-focus min-h-12 rounded-lg border border-line bg-navy px-3 text-lg"
          value={callsign}
          onChange={(e) => setCallsign(e.target.value)}
          maxLength={20}
          placeholder={L('例：サトシ', 'e.g. Satoshi')}
          autoComplete="nickname"
          data-testid="callsign-input"
        />
        <p className="text-xs text-muted">{L('本名や連絡先は入れないでね。名前は「大画面に表示」を選んだときだけ出ます。', 'No real names or contacts. Your name shows on screen only if you allow it.')}</p>
        {(modes?.mock ?? true) && (
          <button type="submit" className="sw-btn bg-amber px-4 text-lg text-navy" disabled={busy} data-testid="guest-login">
            🚀 {L('ゲストで搭乗', 'Board as guest')}
          </button>
        )}
        {modes?.lightning && (
          <Link className="sw-btn sw-focus flex items-center justify-center bg-navy-3 px-4" href="/auth/lightning?next=/play" data-testid="lightning-login">
            ⚡ {L('Lightningウォレットでログイン（記録を残す）', 'Log in with a Lightning wallet (keep records)')}
          </Link>
        )}
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

function CheerRow() {
  const { L } = useI18n();
  const [sent, setSent] = useState<string | null>(null);
  const cheer = async (emoji: string) => {
    try {
      await api('/api/cheer', { body: { emoji } });
      setSent(emoji);
      setTimeout(() => setSent(null), 1200);
    } catch {
      // cheering is best-effort
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted">{L('応援（無料・大画面に出る）', 'Cheer (free, shown on the big screen)')}</p>
      <div className="grid grid-cols-6 gap-1">
        {CHEER_EMOJIS.map((e) => (
          <button key={e} type="button" className={`sw-btn sw-focus bg-navy-3 text-xl ${sent === e ? 'ring-2 ring-teal' : ''}`} onClick={() => void cheer(e)} aria-label={L(`応援 ${e}`, `Cheer ${e}`)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

function Settings({ me, onChanged }: { me: MeResponse; onChanged: () => Promise<void> }) {
  const { L } = useI18n();
  // Optimistic: the box flips at once; the server copy replaces it after the save.
  const [local, setLocal] = useState({ assistMode: me.pilot.assistMode, showNameOnArena: me.pilot.showNameOnArena });
  useEffect(() => setLocal({ assistMode: me.pilot.assistMode, showNameOnArena: me.pilot.showNameOnArena }), [me.pilot.assistMode, me.pilot.showNameOnArena]);
  const patch = async (body: Partial<typeof local>) => {
    setLocal((l) => ({ ...l, ...body }));
    try {
      await api('/api/me', { method: 'PATCH', body });
    } finally {
      await onChanged();
    }
  };
  return (
    <details className="sw-panel p-3 text-sm">
      <summary className="cursor-pointer font-bold">⚙ {L('設定', 'Settings')}</summary>
      <div className="mt-2 flex flex-col gap-2">
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={local.assistMode} onChange={(e) => void patch({ assistMode: e.target.checked })} />
          {L('かんたん操作（的が大きい・ゆっくり）', 'Easy controls (bigger, slower targets)')}
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={local.showNameOnArena} onChange={(e) => void patch({ showNameOnArena: e.target.checked })} data-testid="show-name" />
          {L('大画面にコールサインを表示する', 'Show my callsign on the big screen')}
        </label>
        <div className="flex flex-wrap gap-2">
          <Link className="sw-btn sw-focus bg-navy-3 px-3 py-2" href="/passport">
            🪪 {L('パイロット手帳', 'Passport')}
          </Link>
          {!me.pilot.lightningLinked && (
            <Link className="sw-btn sw-focus bg-navy-3 px-3 py-2" href="/auth/lightning?next=/play">
              ⚡ {L('ウォレットで記録を保存', 'Save records with a wallet')}
            </Link>
          )}
        </div>
      </div>
    </details>
  );
}
