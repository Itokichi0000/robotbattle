'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MeResponse, Role, SessionResponse, TeamId } from '@sats-wars/shared';
import { ONE_LINE_RULES, ROLES, ROLE_LABELS } from '@sats-wars/shared';
import {
  ArenaDirector,
  type Banner,
  type FrameStats,
  type GovernorLevel,
  QualityGovernor,
  cueFromEvent,
} from '@sats-wars/three-game';
import {
  type CommsItem,
  type ConsoleCallout,
  Icon,
  type LinkState,
  PilotConsole,
  ROLE_ICON,
  type SeatState,
  type TargetDesignation,
  effectSentence,
  raidView,
} from '@sats-wars/ui';
import { ApiError, api } from '@/lib/api';
import type { RaidConnection } from '@/lib/connection';
import { useConnectionState, useRaid, useRaidConnection, useTicker } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { httpRaidClient } from '@/lib/raidClient';
import { PassGate } from './PassGate';
import { deviceId } from './session';

const ArenaScene = dynamic(() => import('@sats-wars/three-game').then((m) => m.ArenaScene), {
  ssr: false,
  loading: () => null,
});

type Snapshot = NonNullable<ReturnType<typeof useRaid>>;

/** The robot a station flies (the hangar camera looks at it). */
const ROBOT_OF: Record<Role, TeamId | 'BOTH'> = {
  GUNNER: 'RAIJIN',
  GUARDIAN: 'FUJIN',
  ROUTER: 'BOTH',
  ENGINEER: 'BOTH',
};

/**
 * The pilot's screen: pilot authentication (guest or Lightning), then the
 * pilot console — hangar, battle, debrief — over the 3D battlefield on a
 * computer or the tactical map on a phone. The session is an HttpOnly
 * cookie; nothing secret is kept in the page.
 */
export function PlayApp() {
  const { L } = useI18n();
  const conn = useRaidConnection('pilot');
  const snap = useRaid(conn);
  const connState = useConnectionState(conn);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const client = useMemo(() => (conn ? httpRaidClient(conn) : null), [conn]);

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api<MeResponse>('/api/me'));
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

  if (!authChecked)
    return <AuthShell connState={connState}>{L('読み込み中…', 'Loading…')}</AuthShell>;
  if (!me)
    return (
      <AuthShell connState={connState}>
        <Onboarding onLogin={onLogin} />
      </AuthShell>
    );
  if (!snap || !client || !conn)
    return <AuthShell connState={connState}>{L('サーバーに接続中…', 'Connecting…')}</AuthShell>;
  return (
    <PlayConsole
      snap={snap}
      me={me}
      conn={conn}
      client={client}
      connState={connState}
      refreshMe={refreshMe}
    />
  );
}

function linkOf(s: ReturnType<typeof useConnectionState>): LinkState {
  return s === 'connected' ? 'connected' : s === 'offline' ? 'offline' : 'connecting';
}

/** The 3D battlefield behind the console: computers with WebGL, unless turned off. */
function want3d(): boolean {
  try {
    const saved = localStorage.getItem('sw-play-3d');
    if (saved) return saved === '1';
  } catch {
    // storage blocked: fall through to the device check
  }
  try {
    if (!window.matchMedia('(min-width: 900px) and (pointer: fine)').matches) return false;
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

function PlayConsole({
  snap,
  me,
  conn,
  client,
  connState,
  refreshMe,
}: {
  snap: Snapshot;
  me: MeResponse;
  conn: RaidConnection;
  client: ReturnType<typeof httpRaidClient>;
  connState: ReturnType<typeof useConnectionState>;
  refreshMe: () => Promise<void>;
}) {
  const { L, locale } = useI18n();
  useTicker(250);
  const [seatPatch, setSeatPatch] = useState<Partial<SeatState>>({});
  // A fresh /api/me is the server's seat: drop local patches.
  useEffect(() => setSeatPatch({}), [me]);
  const director = useMemo(() => new ArenaDirector(), []);
  const designation = useRef<TargetDesignation | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [comms, setComms] = useState<CommsItem[]>([]);
  const [use3d, setUse3d] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [level, setLevel] = useState<GovernorLevel>('medium');
  const governor = useMemo(() => new QualityGovernor({ ceiling: 'medium' }), []);
  const reducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  );
  useEffect(() => setUse3d(want3d()), []);
  const show3d = use3d && !contextLost && level !== '2d';

  useEffect(() => {
    director.settings = { reducedMotion, shakeScale: 0.5, shortSpecials: true };
  }, [director, reducedMotion]);

  // Server events: director cues (camera, robots, banners) and the comms line.
  // My own results and the big moments always; the crowd's at most every 2 s.
  const myId = me.pilot.pilotId;
  useEffect(() => {
    let lastAlly = 0;
    let n = 0;
    const say = (item: Omit<CommsItem, 'id'>, priority: boolean) => {
      const now = performance.now();
      if (!priority) {
        if (now - lastAlly < 2000) return;
        lastAlly = now;
      }
      setComms((xs) => [...xs.slice(-29), { ...item, id: `${Date.now()}-${++n}` }]);
    };
    const offs = [
      director.onBanner(setBanner),
      conn.store.onEvent((e) => {
        cueFromEvent(director, e);
        if (e.type === 'TASK_RESOLVED') {
          const d = e.data;
          const mine = d.pilotId === myId;
          const who = mine ? L('あなた', 'You') : d.assist ? L('補佐AI', 'Assist AI') : d.callsign;
          say(
            {
              text: `${who}: ${d.success > 0 ? effectSentence(d.effect, L) : L('ミス', 'miss')}`,
              role: d.role,
              tone: mine ? 'mine' : d.success > 0 ? 'ally' : 'miss',
            },
            mine,
          );
        }
        if (e.type === 'ENEMY_DEFEATED' && e.data.callsign)
          say(
            {
              text: L(`${e.data.callsign} が敵を撃破`, `${e.data.callsign} destroyed an enemy`),
              tone: 'big',
            },
            true,
          );
        if (e.type === 'CITY_REBUILT')
          say(
            {
              text: L(`${e.data.callsign} が都市を再建`, `${e.data.callsign} rebuilt a city`),
              tone: 'big',
            },
            true,
          );
      }),
      conn.onCheer(() => director.play({ kind: 'cheer' })),
    ];
    return () => offs.forEach((o) => o());
  }, [conn, director, myId, L]);

  // A different raid: calm stance, empty comms.
  const lastRaid = useRef<string | null>(null);
  useEffect(() => {
    if (lastRaid.current === snap.raidId) return;
    lastRaid.current = snap.raidId;
    director.reset();
    setComms([]);
  }, [snap.raidId, director]);

  // Without the 3D canvas nothing ticks the director (banners, cinematics).
  useEffect(() => {
    if (show3d) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      director.update(Math.min(0.25, (now - last) / 1000));
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [show3d, director]);

  const seat: SeatState = { ...me.seat, ...seatPatch };
  const lobby = snap.status === 'LOBBY_OPEN' || snap.status === 'CREATED';
  const [browsing, setBrowsing] = useState<Role | null>(null);
  const focus = browsing ?? seat.role;
  useEffect(() => {
    if (lobby) director.hangarView(focus ? ROBOT_OF[focus] : 'BOTH');
    else setBrowsing(null);
  }, [lobby, focus, director]);

  // The server decides (DEMO_MODE defaults to FREE; a PAID rehearsal still needs a pass).
  const needsPass =
    !seat.boarded && !me.seat.entitled && snap.passMode === 'PAID' && me.passCredits === 0;
  const gate =
    !snap.joinOpen && !seat.boarded ? (
      <div className="hud-gate" data-testid="join-closed">
        <b>{L('今回の出撃受付は終了しました', 'Boarding has closed for this raid')}</b>
        <span className="hud-hint">
          {L(
            '応援して次の作戦を待とう。次はすぐ始まります',
            'Cheer now and join the next raid soon',
          )}
        </span>
      </div>
    ) : needsPass ? (
      <PassGate snap={snap} conn={conn} pending={me.pendingInvoice} onGranted={refreshMe} />
    ) : undefined;

  const view = raidView(snap, conn.gameNow());
  const threats = Object.fromEntries(
    Object.entries(view.threats).map(([k, t]) => [k, { seconds: t!.seconds, lethal: t!.lethal }]),
  );
  const callout: ConsoleCallout | null = banner
    ? {
        title: L(banner.textJa, banner.textEn),
        sub: L(banner.subJa ?? '', banner.subEn ?? '') || undefined,
        tone: banner.tone === 'enemy' ? 'enemy' : banner.tone === 'neutral' ? 'neutral' : 'ally',
      }
    : null;

  const toggle3d = () => {
    const next = !use3d;
    setUse3d(next);
    setContextLost(false);
    try {
      localStorage.setItem('sw-play-3d', next ? '1' : '0');
    } catch {
      // per-device convenience only
    }
  };

  return (
    <PilotConsole
      client={client}
      raid={snap}
      seat={seat}
      onSeat={(p) => setSeatPatch((s) => ({ ...s, ...p }))}
      locale={locale}
      easy={me.pilot.assistMode}
      pilot={{
        callsign: me.pilot.callsign,
        detail: (
          <span className="hud-pilot-detail">
            <span className="hud-hint">
              {me.pilot.lightningLinked
                ? L('Lightning 鍵で認証済み', 'Lightning key verified')
                : L('ゲスト', 'Guest')}
              {me.seat.stats && me.seat.stats.tasks > 0
                ? L(
                    ` · 出撃 ${me.seat.stats.tasks}回・成功 ${me.seat.stats.successes}回`,
                    ` · ${me.seat.stats.tasks} sorties, ${me.seat.stats.successes} hits`,
                  )
                : ''}
            </span>
            <Link className="hud-link" href="/passport">
              {L('パイロット手帳', 'Passport')}
            </Link>
          </span>
        ),
      }}
      backdrop={
        show3d ? (
          <ArenaScene
            director={director}
            cities={snap.cities}
            enemies={snap.enemies}
            telegraphs={snap.telegraphs}
            threats={threats}
            cityMaxHp={snap.config.cityMaxHp}
            glow={{
              RAIJIN: 0.15 + 0.85 * (snap.robots[0]!.energy / 100),
              FUJIN: 0.15 + 0.85 * (snap.robots[1]!.energy / 100),
            }}
            health={{ RAIJIN: snap.robots[0]!.health, FUJIN: snap.robots[1]!.health }}
            reserve={snap.reserveEnergy / 100}
            quality={level}
            reducedMotion={reducedMotion}
            locale={locale}
            bossBarrier={view.bossBarrier}
            crew={snap.crew}
            designation={designation}
            focusStation={lobby ? focus : null}
            onStats={(s: FrameStats) => {
              const next = governor.sample(s.fps, performance.now() / 1000);
              if (next) setLevel(next);
            }}
            onContextLost={() => setContextLost(true)}
          />
        ) : undefined
      }
      designation={designation}
      lobbyEndsAt={snap.lobbyEndsAt}
      boardGate={gate}
      link={linkOf(connState)}
      callout={callout}
      comms={comms}
      broadcast={snap.broadcast ? L(snap.broadcast.messageJa, snap.broadcast.messageEn) : null}
      onCheer={(emoji) => void api('/api/cheer', { body: { emoji } }).catch(() => undefined)}
      onFocusStation={setBrowsing}
      bestScore={snap.bestScore}
      reducedMotion={reducedMotion}
      menu={<PilotMenu me={me} onChanged={refreshMe} use3d={use3d} onToggle3d={toggle3d} />}
      debriefActions={
        <>
          <span className="hud-hint">
            {L('まもなく次の作戦が始まります', 'The next raid starts soon')}
          </span>
          <Link className="hud-btn" href="/passport">
            <Icon name="pilot" size={16} />
            {L('パイロット手帳を見る', 'Open my passport')}
          </Link>
        </>
      }
    />
  );
}

/** Pilot menu (inside the console's SYSTEM panel): settings and links. */
function PilotMenu({
  me,
  onChanged,
  use3d,
  onToggle3d,
}: {
  me: MeResponse;
  onChanged: () => Promise<void>;
  use3d: boolean;
  onToggle3d: () => void;
}) {
  const { L, locale, setLocale } = useI18n();
  // Optimistic: the box flips at once; the server copy replaces it after the save.
  const [local, setLocal] = useState({
    assistMode: me.pilot.assistMode,
    showNameOnArena: me.pilot.showNameOnArena,
  });
  useEffect(
    () => setLocal({ assistMode: me.pilot.assistMode, showNameOnArena: me.pilot.showNameOnArena }),
    [me.pilot.assistMode, me.pilot.showNameOnArena],
  );
  const patch = async (body: Partial<typeof local>) => {
    setLocal((l) => ({ ...l, ...body }));
    try {
      await api('/api/me', { method: 'PATCH', body });
    } finally {
      await onChanged();
    }
  };
  return (
    <>
      <section data-testid="pilot-settings">
        <span className="hud-label">{L('設定', 'SETTINGS')}</span>
        <label className="hud-check">
          <input
            type="checkbox"
            checked={local.assistMode}
            onChange={(e) => void patch({ assistMode: e.target.checked })}
          />
          {L('かんたん操作（的が大きい・ゆっくり）', 'Easy controls (bigger, slower targets)')}
        </label>
        <label className="hud-check">
          <input
            type="checkbox"
            checked={local.showNameOnArena}
            onChange={(e) => void patch({ showNameOnArena: e.target.checked })}
            data-testid="show-name"
          />
          {L('大画面にコールサインを表示する', 'Show my callsign on the big screen')}
        </label>
        <label className="hud-check">
          <input type="checkbox" checked={use3d} onChange={onToggle3d} data-testid="play-3d" />
          {L(
            '3D の戦場を表示（重い端末ではオフ）',
            'Show the 3D battlefield (off on slow devices)',
          )}
        </label>
        <button
          type="button"
          className="hud-btn"
          onClick={() => setLocale(locale === 'ja' ? 'en' : 'ja')}
          aria-label={locale === 'ja' ? 'Switch to English' : '日本語に切り替え'}
        >
          {locale === 'ja' ? 'English' : '日本語'}
        </button>
      </section>
      <section>
        <span className="hud-label">{L('パイロット', 'PILOT')}</span>
        <Link className="hud-btn" href="/passport">
          <Icon name="pilot" size={16} />
          {L('パイロット手帳', 'Passport')}
        </Link>
        {!me.pilot.lightningLinked && (
          <Link className="hud-btn" href="/auth/lightning?next=/play">
            <Icon name="energy" size={16} />
            {L('ウォレットで記録を保存', 'Save records with a wallet')}
          </Link>
        )}
      </section>
    </>
  );
}

/** Before the console: the pilot authentication frame (no raid data needed). */
function AuthShell({
  children,
  connState,
}: {
  children: React.ReactNode;
  connState: ReturnType<typeof useConnectionState>;
}) {
  const { L, locale, setLocale } = useI18n();
  const link = linkOf(connState);
  return (
    <main className="hud-root hud-auth">
      <header className="hud-topbar">
        <Link href="/" className="hud-brand">
          SATS WARS <span>· EARTH DEFENSE</span>
        </Link>
        <span className="hud-topbar-sys">
          <span
            className={`hud-lamp hud-tone-${link === 'connected' ? 'ok' : link === 'connecting' ? 'act' : 'danger'}`}
          >
            <i aria-hidden="true" />
            <span data-testid="conn-pill" data-state={connState}>
              {link === 'connected'
                ? 'NETWORK OK'
                : link === 'connecting'
                  ? L('接続中', 'LINKING')
                  : L('切断', 'OFFLINE')}
            </span>
          </span>
          <button
            type="button"
            className="hud-btn"
            onClick={() => setLocale(locale === 'ja' ? 'en' : 'ja')}
            aria-label={locale === 'ja' ? 'Switch to English' : '日本語に切り替え'}
          >
            {locale === 'ja' ? 'EN' : '日本語'}
          </button>
        </span>
      </header>
      <div className="hud-auth-body">{children}</div>
    </main>
  );
}

function Onboarding({ onLogin }: { onLogin: () => Promise<void> }) {
  const { L, locale } = useI18n();
  const [callsign, setCallsign] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modes, setModes] = useState<{
    mock: boolean;
    lightning: boolean;
    demo: boolean;
    guest?: boolean;
  } | null>(null);
  useEffect(() => {
    api<{ mock: boolean; lightning: boolean; demo: boolean; guest?: boolean }>('/api/auth/modes')
      .then(setModes)
      .catch(() => setModes(null));
  }, []);
  const guest = async () => {
    setBusy(true);
    setError(null);
    try {
      await api<SessionResponse>('/api/auth/guest', {
        body: { callsign: callsign.trim(), deviceId: deviceId() },
      });
      await onLogin();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="hud-auth-grid" data-testid="onboarding">
      <div className="hud-auth-brief">
        <span className="hud-label">PILOT AUTHENTICATION</span>
        <h1>{L('君も、パイロットになろう。', 'Become a pilot.')}</h1>
        <p className="hud-auth-rules">{locale === 'ja' ? ONE_LINE_RULES.ja : ONE_LINE_RULES.en}</p>
        <ul className="hud-auth-roles">
          {ROLES.map((r) => (
            <li key={r}>
              <Icon name={ROLE_ICON[r]} size={18} />
              <b>{L(ROLE_LABELS[r].ja, ROLE_LABELS[r].en)}</b>
              <span>{L(ROLE_LABELS[r].doJa, ROLE_LABELS[r].doEn)}</span>
            </li>
          ))}
        </ul>
      </div>
      <form
        className="hud-frame hud-auth-form"
        onSubmit={(e) => {
          e.preventDefault();
          void guest();
        }}
      >
        <span className="hud-frame-label">PILOT ID</span>
        <label className="hud-label" htmlFor="callsign">
          {L(
            'コールサイン（大画面に出る名前・省略可）',
            'Callsign (optional, may appear on the big screen)',
          )}
        </label>
        <input
          id="callsign"
          className="hud-input"
          value={callsign}
          onChange={(e) => setCallsign(e.target.value)}
          maxLength={20}
          placeholder={L('例：サトシ', 'e.g. Satoshi')}
          autoComplete="nickname"
          data-testid="callsign-input"
        />
        <p className="hud-hint">
          {L(
            '本名や連絡先は入れないでね。名前は「大画面に表示」を選んだときだけ出ます。',
            'No real names or contacts. Your name shows on screen only if you allow it.',
          )}
        </p>
        {(modes?.guest ?? true) && (
          <button
            type="submit"
            className="hud-trigger is-board"
            disabled={busy}
            data-testid="guest-login"
          >
            <Icon name="launch" size={20} />
            <span className="hud-trigger-word">{L('ゲストで搭乗', 'Board as guest')}</span>
          </button>
        )}
        {modes?.lightning && (
          <Link className="hud-btn" href="/auth/lightning?next=/play" data-testid="lightning-login">
            <Icon name="energy" size={16} />
            {L(
              'Lightningウォレットでログイン（記録を残す）',
              'Log in with a Lightning wallet (keep records)',
            )}
          </Link>
        )}
        <p className="hud-hint">
          {L(
            'Lightning ログインは鍵の所持証明です。秘密鍵やシードを入力することはありません。',
            'Lightning login proves you hold a key. You never enter a private key or seed.',
          )}
        </p>
        {error && (
          <p className="hud-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
