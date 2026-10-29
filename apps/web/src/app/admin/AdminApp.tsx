'use client';
import { useCallback, useEffect, useState } from 'react';
import type { GameConfig, PublicRaidSnapshot } from '@sats-wars/shared';
import { PHASE_LABELS, ROLES, ROLE_LABELS, STATUS_LABELS } from '@sats-wars/shared';
import { JapanMapMini, fmtClock, raidView } from '@sats-wars/ui';
import { Logo } from '@/components/Logo';
import { ApiError, api } from '@/lib/api';

interface Overview {
  snapshot: PublicRaidSnapshot;
  settings: {
    paymentMode: string;
    paymentsEnabled: boolean;
    paymentIntegration: boolean;
    joinStopped: boolean;
    namesHidden: boolean;
    autoLoop: boolean;
    passMode: 'FREE' | 'PAID';
    demoMode: boolean;
    authMode: string;
    timeScale: number;
    demoBots: number;
    demoBotSkill: number;
    eventId: string;
    event: { eventId: string; venueName: string; arenaLocale: 'ja' | 'en' };
  };
  crew: { total: number; bots: number; roles: Record<string, number> };
  entitlements: Record<string, number>;
  invoices: Record<string, { count: number; sats: number }>;
  sponsored: Record<string, number>;
  realtime: {
    connections: number;
    byRole: Record<string, number>;
    arenas: Array<{
      socketId: string;
      fps: number;
      frameMs: number;
      renderer: string;
      quality: string;
      autoQuality?: boolean;
    }>;
  };
  server: {
    uptimeSec: number;
    memoryMb: number;
    eventLoopLagMs: number | null;
    tickLagMs: number | null;
  };
  nextConfig: GameConfig;
  broadcastTemplates: Record<string, { ja: string; en: string }>;
}

interface PilotRow {
  id: string;
  code: string;
  callsign: string;
  hidden: boolean;
  showName: boolean;
  authType: string;
  sorties: number;
  victories: number;
  passCredits: number;
  aboard: boolean;
  role: string | null;
  lastSeenAt: number;
}
interface InvoiceRow {
  id: string;
  pilotId: string;
  raidId: string;
  amountSats: number;
  status: string;
  createdAt: number;
  expiresAt: number;
  latePolicy: string | null;
  checkFailures: number;
  paymentHashPrefix: string;
}
interface SponsoredRow {
  idPrefix: string;
  label: string;
  raidId: string | null;
  status: string;
  issuedAt: number;
  expiresAt: number;
  redeemedAt: number | null;
}
interface AuditRow {
  id: number;
  actor: string;
  action: string;
  target_id: string | null;
  timestamp: number;
}

const TOKEN_KEY = 'sw.admin.token';

export function AdminApp() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    try {
      setToken(sessionStorage.getItem(TOKEN_KEY));
    } catch {
      setToken(null);
    }
  }, []);
  // Stable: the dashboard's polling effect depends on it.
  const logout = useCallback(() => {
    void api('/api/admin/logout', { body: {}, token }).catch(() => undefined);
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
    setToken(null);
  }, [token]);
  if (!token) {
    return (
      <Login
        onToken={(t) => {
          try {
            sessionStorage.setItem(TOKEN_KEY, t);
          } catch {
            // ignore
          }
          setToken(t);
        }}
      />
    );
  }
  return <Dashboard token={token} onLogout={logout} />;
}

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ token: string }>('/api/admin/login', { body: { password } });
      onToken(r.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="sw-panel w-full max-w-sm p-6">
        <Logo size="sm" />
        <h1 className="mt-4 text-xl font-black">運営ログイン / Admin login</h1>
        <input
          type="password"
          className="sw-focus mt-4 w-full rounded-lg border border-line bg-black/40 px-3 py-3"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="ADMIN_PASSWORD"
          autoComplete="current-password"
          data-testid="admin-password"
        />
        <button
          className="sw-btn mt-4 w-full bg-amber text-navy"
          type="submit"
          data-testid="admin-login"
        >
          ログイン / Login
        </button>
        {error && <p className="mt-3 text-sm font-bold text-danger">{error}</p>}
      </form>
    </div>
  );
}

type Tab = 'raid' | 'pilots' | 'passes' | 'monitor' | 'audit';

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [tab, setTab] = useState<Tab>('raid');
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setOv(await api<Overview>('/api/admin/overview', { token }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout();
    }
  }, [token, onLogout]);
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 2000);
    return () => clearInterval(id);
  }, [load]);
  const cmd = async (body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setMsg(null);
    try {
      await api('/api/admin/command', { body, token });
      setMsg(`OK: ${String(body.command)}`);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    }
  };
  if (!ov) return <p className="p-6">読み込み中… / Loading…</p>;
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4" data-testid="admin">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <Logo size="sm" />
        <nav className="flex flex-wrap gap-1">
          {(
            [
              ['raid', '作戦'],
              ['pilots', 'パイロット'],
              ['passes', 'パス・決済'],
              ['monitor', '監視'],
              ['audit', '監査ログ'],
            ] as Array<[Tab, string]>
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`sw-btn px-3 ${tab === k ? 'bg-teal text-navy' : 'bg-navy-3'}`}
              onClick={() => setTab(k)}
              data-testid={`tab-${k}`}
            >
              {label}
            </button>
          ))}
          <button type="button" className="sw-btn bg-navy-3 px-3" onClick={onLogout}>
            ログアウト
          </button>
        </nav>
      </header>
      <EmergencyBar ov={ov} cmd={cmd} />
      {msg && (
        <p className="rounded bg-navy-3 px-3 py-2 text-sm" role="status" data-testid="admin-msg">
          {msg}
        </p>
      )}
      {tab === 'raid' && <RaidTab ov={ov} cmd={cmd} token={token} onSaved={load} />}
      {tab === 'pilots' && <PilotsTab token={token} />}
      {tab === 'passes' && <PassesTab token={token} ov={ov} />}
      {tab === 'monitor' && <MonitorTab ov={ov} />}
      {tab === 'audit' && <AuditTab token={token} />}
    </main>
  );
}

type Cmd = (body: Record<string, unknown>, confirmText?: string) => Promise<void>;

/** Separate kill switches, always visible. Each is independent and audit-logged. */
function EmergencyBar({ ov, cmd }: { ov: Overview; cmd: Cmd }) {
  const s = ov.settings;
  return (
    <section className="sw-panel flex flex-wrap items-center gap-2 p-3" data-testid="kill-switches">
      <button
        type="button"
        className="sw-btn bg-danger px-4 text-navy"
        onClick={() =>
          void cmd(
            { command: 'EMERGENCY_STOP' },
            '緊急停止：作戦一時停止・搭乗停止・決済停止・自動ループ停止。よろしいですか？',
          )
        }
        data-testid="cmd-emergency"
      >
        🛑 緊急停止
      </button>
      <Toggle
        label="新規決済"
        on={s.paymentsEnabled}
        onChange={(v) => void cmd({ command: 'SET_PAYMENTS_ENABLED', enabled: v })}
        testId="sw-payments"
      />
      <Toggle
        label="決済連携"
        on={s.paymentIntegration}
        onChange={(v) => void cmd({ command: 'SET_PAYMENT_INTEGRATION', enabled: v })}
        testId="sw-integration"
      />
      <Toggle
        label="搭乗受付"
        on={!s.joinStopped}
        onChange={(v) => void cmd({ command: 'SET_JOIN_STOPPED', stopped: !v })}
        testId="sw-join"
      />
      <Toggle
        label="名前表示"
        on={!s.namesHidden}
        onChange={(v) => void cmd({ command: 'SET_NAMES_HIDDEN', hidden: !v })}
        testId="sw-names"
      />
      <Toggle
        label="自動ループ"
        on={s.autoLoop}
        onChange={(v) => void cmd({ command: 'SET_AUTO_LOOP', enabled: v })}
        testId="sw-autoloop"
      />
      <span className="ml-auto text-xs text-muted">
        PAYMENT_MODE={s.paymentMode} · AUTH={s.authMode} · {s.demoMode ? 'DEMO_MODE' : 'EVENT'} ·{' '}
        {s.eventId}
      </span>
    </section>
  );
}

function Toggle({
  label,
  on,
  onChange,
  testId,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={`sw-btn px-3 text-sm ${on ? 'bg-ok/80 text-navy' : 'bg-danger/40'}`}
      onClick={() => onChange(!on)}
      aria-pressed={on}
      data-testid={testId}
    >
      {label}：{on ? 'ON' : 'OFF'}
    </button>
  );
}

function RaidTab({
  ov,
  cmd,
  token,
  onSaved,
}: {
  ov: Overview;
  cmd: Cmd;
  token: string;
  onSaved: () => Promise<void>;
}) {
  const snap = ov.snapshot;
  const s = ov.settings;
  const view = raidView(snap, snap.gameMs);
  const [bots, setBots] = useState(String(s.demoBots));
  const [skill, setSkill] = useState(String(s.demoBotSkill));
  const [tpl, setTpl] = useState(Object.keys(ov.broadcastTemplates)[0] ?? 'CUSTOM');
  const [ja, setJa] = useState('');
  const [en, setEn] = useState('');
  const phase =
    snap.status === 'LIVE' ? PHASE_LABELS[snap.phase].ja : STATUS_LABELS[snap.status].ja;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="sw-panel flex flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-3xl font-black" data-testid="admin-status">
            {phase}
          </span>
          <span className="font-mono text-xl">{fmtClock(view.timeLeftMs)}</span>
        </div>
        <p className="text-sm text-muted">
          {snap.raidId} · {snap.configVersion} #{snap.configHash} · 搭乗 {ov.crew.total}（BOT{' '}
          {ov.crew.bots}）
        </p>
        <p className="text-sm">
          {ROLES.map((r) => (
            <span key={r} className="mr-3">
              {ROLE_LABELS[r].icon} {ov.crew.roles[r] ?? 0}
            </span>
          ))}
          SYNC {snap.sync} · 都市 {view.citiesStanding}/8 · NULL CORE{' '}
          {view.boss ? `${view.boss.hp}/${view.boss.hpMax}` : '-'}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <button
            className="sw-btn bg-navy-3"
            onClick={() => void cmd({ command: 'OPEN_LOBBY' })}
            data-testid="cmd-open-lobby"
          >
            受付開始
          </button>
          <button
            className="sw-btn bg-amber text-navy"
            onClick={() => void cmd({ command: 'START' })}
            data-testid="cmd-start"
          >
            出撃開始
          </button>
          <button
            className="sw-btn bg-navy-3"
            onClick={() => void cmd({ command: snap.status === 'PAUSED' ? 'RESUME' : 'PAUSE' })}
            data-testid="cmd-pause"
          >
            {snap.status === 'PAUSED' ? '再開' : '一時停止'}
          </button>
          <button
            className="sw-btn bg-navy-3"
            onClick={() =>
              void cmd({ command: 'END' }, '作戦を終了して結果を確定します。よろしいですか？')
            }
            data-testid="cmd-end"
          >
            終了
          </button>
          <button
            className="sw-btn bg-navy-3"
            onClick={() =>
              void cmd(
                { command: 'CANCEL' },
                '作戦を中止します（記録なし・支払い済みはパス残高へ）。よろしいですか？',
              )
            }
            data-testid="cmd-cancel"
          >
            中止
          </button>
          <button
            className="sw-btn bg-navy-3"
            onClick={() => void cmd({ command: 'NEXT_RAID' })}
            data-testid="cmd-next"
          >
            次の作戦
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          出撃パス：
          <Toggle
            label={s.passMode === 'FREE' ? '無料イベント' : `有料 ${snap.ticketPriceSats} sats`}
            on={s.passMode === 'FREE'}
            onChange={(v) => void cmd({ command: 'SET_PASS_MODE', mode: v ? 'FREE' : 'PAID' })}
            testId="sw-passmode"
          />
        </div>
        {s.demoMode && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            デモBOT
            <input
              className="w-16 rounded border border-line bg-navy px-2 py-1"
              value={bots}
              onChange={(e) => setBots(e.target.value)}
              data-testid="bots-input"
            />
            腕前
            <input
              className="w-16 rounded border border-line bg-navy px-2 py-1"
              value={skill}
              onChange={(e) => setSkill(e.target.value)}
            />
            <button
              className="sw-btn bg-navy-3 px-3"
              onClick={() =>
                void cmd({
                  command: 'SET_DEMO_BOTS',
                  count: Number(bots) || 0,
                  skill: Math.min(1, Math.max(0, Number(skill) || 0)),
                })
              }
              data-testid="bots-apply"
            >
              適用
            </button>
            速度 ×{s.timeScale}
            {[1, 2, 4].map((x) => (
              <button
                key={x}
                className="sw-btn bg-navy-3 px-2"
                onClick={() => void cmd({ command: 'SET_TIME_SCALE', speed: x })}
              >
                ×{x}
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="sw-panel p-4">
        <JapanMapMini view={view} locale="ja" maxHp={snap.config.cityMaxHp} />
      </section>
      <NextRaidPanel ov={ov} token={token} onSaved={onSaved} />
      <ArenaDisplayPanel ov={ov} cmd={cmd} />
      {s.demoMode && <RehearsalPanel cmd={cmd} />}
      <section
        className="sw-panel flex flex-col gap-2 p-4 md:col-span-2"
        data-testid="broadcast-panel"
      >
        <h2 className="font-black">会場アナウンス（定型文優先）</h2>
        <div className="flex flex-wrap gap-2">
          <select
            className="rounded border border-line bg-navy px-2 py-2"
            value={tpl}
            onChange={(e) => setTpl(e.target.value)}
          >
            {Object.entries(ov.broadcastTemplates).map(([k, v]) => (
              <option key={k} value={k}>
                {v.ja}
              </option>
            ))}
            <option value="CUSTOM">自由入力（80文字まで）</option>
          </select>
          {tpl === 'CUSTOM' && (
            <>
              <input
                className="flex-1 rounded border border-line bg-navy px-2"
                placeholder="日本語"
                value={ja}
                maxLength={80}
                onChange={(e) => setJa(e.target.value)}
              />
              <input
                className="flex-1 rounded border border-line bg-navy px-2"
                placeholder="English"
                value={en}
                maxLength={80}
                onChange={(e) => setEn(e.target.value)}
              />
            </>
          )}
          <button
            className="sw-btn bg-teal px-3 text-navy"
            onClick={() =>
              void cmd({
                command: 'BROADCAST',
                template: tpl,
                ...(tpl === 'CUSTOM' ? { ja, en } : {}),
                seconds: 30,
              })
            }
            data-testid="broadcast-send"
          >
            表示（30秒）
          </button>
          <button
            className="sw-btn bg-navy-3 px-3"
            onClick={() => void cmd({ command: 'BROADCAST_CLEAR' })}
          >
            消す
          </button>
        </div>
        {snap.broadcast && <p className="text-sm">表示中：{snap.broadcast.messageJa}</p>}
      </section>
    </div>
  );
}

/** Spec E4 作戦作成: what the next raid will be (the running raid never changes). */
function NextRaidPanel({
  ov,
  token,
  onSaved,
}: {
  ov: Overview;
  token: string;
  onSaved: () => Promise<void>;
}) {
  const c = ov.nextConfig;
  const ev = ov.settings.event;
  const [preset, setPreset] = useState<'' | 'EASY' | 'NORMAL' | 'HARD'>('');
  const [price, setPrice] = useState(String(c.ticketPriceSats));
  const [max, setMax] = useState(String(c.maxPilots));
  const [eventId, setEventId] = useState(ev.eventId);
  const [venue, setVenue] = useState(ev.venueName);
  const [lang, setLang] = useState<'ja' | 'en'>(ev.arenaLocale);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setMsg(null);
    try {
      await api('/api/admin/next-raid', {
        method: 'PUT',
        token,
        body: {
          ...(preset ? { preset } : {}),
          ticketPriceSats: Number(price),
          maxPilots: Number(max),
          eventId,
          venueName: venue,
          arenaLocale: lang,
        },
      });
      setMsg('保存しました（次の作戦から反映）');
      await onSaved();
    } catch (e) {
      setMsg(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    }
  };
  const field = 'rounded border border-line bg-navy px-2 py-1';
  return (
    <section className="sw-panel flex flex-col gap-2 p-4 text-sm" data-testid="next-raid-panel">
      <h2 className="font-black">次の作戦の設定</h2>
      <p className="text-muted">
        現在：{c.version} · 難度 {c.difficultyPreset} · {c.matchSeconds / 60}分 · 出撃パス{' '}
        {c.ticketPriceSats} sats · 定員 {c.maxPilots} · イベント {ev.eventId}
      </p>
      <label className="flex items-center gap-2">
        難度
        <select
          className={field}
          value={preset}
          onChange={(e) => setPreset(e.target.value as typeof preset)}
          data-testid="next-preset"
        >
          <option value="">変更しない</option>
          <option value="EASY">EASY（敵HP・攻撃 −20%、予告 +2秒）</option>
          <option value="NORMAL">NORMAL（既定値）</option>
          <option value="HARD">HARD（敵HP・攻撃 +20%、予告 −1秒・最短6秒）</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2">
          出撃パス（sats）
          <input
            className={`${field} w-20`}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2">
          定員
          <input className={`${field} w-20`} value={max} onChange={(e) => setMax(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2">
          イベントID
          <input
            className={`${field} w-44`}
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            placeholder="btc-tokyo-2026"
            data-testid="next-event-id"
          />
        </label>
        <label className="flex items-center gap-2">
          会場名
          <input
            className={`${field} w-44`}
            value={venue}
            maxLength={40}
            onChange={(e) => setVenue(e.target.value)}
            data-testid="next-venue"
          />
        </label>
        <label className="flex items-center gap-2">
          会場画面の言語
          <select
            className={field}
            value={lang}
            onChange={(e) => setLang(e.target.value as 'ja' | 'en')}
          >
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-muted">
        イベントIDは英小文字・数字・ハイフン（ランキングと会場限定装飾に使用）。難度を変えると設定ハッシュが変わり、
        ランキングは別枠になります。
        {ov.settings.demoMode ? 'いまは DEMO_MODE（モック決済・モックログイン）。' : '本番モード。'}
      </p>
      <div className="flex items-center gap-2">
        <button
          className="sw-btn bg-amber px-3 text-navy"
          onClick={() => void save()}
          data-testid="next-save"
        >
          次の作戦に保存
        </button>
        {msg && <span role="status">{msg}</span>}
      </div>
    </section>
  );
}

/** Venue screens follow these when pushed (each PC can still adjust locally with S). */
function ArenaDisplayPanel({ ov, cmd }: { ov: Overview; cmd: Cmd }) {
  const d = ov.snapshot.arenaDisplay;
  const [renderer, setRenderer] = useState(d.renderer);
  const [quality, setQuality] = useState(d.quality);
  const [volume, setVolume] = useState(d.volume);
  const [showQr, setShowQr] = useState(d.showQr);
  const field = 'rounded border border-line bg-navy px-2 py-1';
  return (
    <section className="sw-panel flex flex-col gap-2 p-4 text-sm" data-testid="arena-display-panel">
      <h2 className="font-black">会場画面の表示</h2>
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2">
          表示
          <select
            className={field}
            value={renderer}
            onChange={(e) => setRenderer(e.target.value as typeof renderer)}
          >
            <option value="auto">自動</option>
            <option value="3d">3D</option>
            <option value="2d">2D</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          品質
          <select
            className={field}
            value={quality}
            onChange={(e) => setQuality(e.target.value as typeof quality)}
          >
            <option value="auto">自動（低FPSで下げる）</option>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          音量 {Math.round(volume * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showQr} onChange={(e) => setShowQr(e.target.checked)} />
          参加QRを表示（通常はON）
        </label>
      </div>
      <button
        className="sw-btn self-start bg-teal px-3 text-navy"
        onClick={() =>
          void cmd({ command: 'SET_ARENA_DISPLAY', renderer, quality, volume, showQr })
        }
        data-testid="arena-display-apply"
      >
        全ての会場画面に適用
      </button>
    </section>
  );
}

/** DEMO only: rehearse enemies and the finale without waiting for the raid to get there. */
function RehearsalPanel({ cmd }: { cmd: Cmd }) {
  return (
    <section
      className="sw-panel flex flex-col gap-2 p-4 text-sm md:col-span-2"
      data-testid="rehearsal-panel"
    >
      <h2 className="font-black">リハーサル（DEMOのみ）</h2>
      <p className="text-xs text-muted">
        敵の出現はゲームに実際に作用します（このレイドはランキング対象外になります）。演出テストは会場画面で再生するだけで、ゲームには作用しません。
      </p>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['SCOUT', '偵察機を出す'],
            ['SIEGE', '砲撃機を出す'],
            ['SABOTEUR', '妨害機を出す'],
            ['BOSS', 'NULL COREを出す'],
          ] as const
        ).map(([kind, label]) => (
          <button
            key={kind}
            className="sw-btn bg-navy-3 px-3"
            onClick={() => void cmd({ command: 'DEMO_SPAWN', kind })}
            data-testid={`demo-spawn-${kind}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['RAID_START', '開幕'],
            ['BOSS_ENTRANCE', 'ボス登場'],
            ['SPECIAL_ACTIVATED', '神雷風陣・成功'],
            ['SPECIAL_FALLBACK', '神雷風陣・不完全'],
            ['SPECIAL_FAILED', '神雷風陣・失敗'],
            ['VICTORY', '勝利'],
            ['DEFEAT', '敗北'],
          ] as const
        ).map(([cue, label]) => (
          <button
            key={cue}
            className="sw-btn bg-navy-3 px-3"
            onClick={() => void cmd({ command: 'DEMO_ARENA_CUE', cue })}
            data-testid={`demo-cue-${cue}`}
          >
            演出：{label}
          </button>
        ))}
      </div>
    </section>
  );
}

function PilotsTab({ token }: { token: string }) {
  const [rows, setRows] = useState<PilotRow[]>([]);
  const load = useCallback(
    async () => setRows((await api<{ pilots: PilotRow[] }>('/api/admin/pilots', { token })).pilots),
    [token],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const hide = async (id: string, hidden: boolean) => {
    await api(`/api/admin/pilots/${id}/name-visibility`, { body: { hidden }, token });
    await load();
  };
  const credit = async (id: string) => {
    const note = window.prompt('パスを1枚付与する理由（必須・監査ログに残ります）');
    if (!note || note.trim().length < 3) return;
    await api(`/api/admin/pilots/${id}/pass-credit`, { body: { delta: 1, note }, token });
    await load();
  };
  return (
    <section className="sw-panel overflow-x-auto p-4" data-testid="pilots-tab">
      <table className="w-full text-sm">
        <thead className="text-left text-muted">
          <tr>
            <th>コード</th>
            <th>コールサイン</th>
            <th>認証</th>
            <th>搭乗</th>
            <th>出撃/勝利</th>
            <th>パス残</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-t border-line">
              <td className="font-mono">{p.code}</td>
              <td className={p.hidden ? 'line-through opacity-60' : ''}>
                {p.callsign}{' '}
                {p.showName ? '' : <span className="text-xs text-muted">(非公開)</span>}
              </td>
              <td>{p.authType}</td>
              <td>{p.aboard ? (p.role ?? '○') : ''}</td>
              <td>
                {p.sorties}/{p.victories}
              </td>
              <td>{p.passCredits}</td>
              <td className="flex gap-1 py-1">
                <button
                  className="sw-btn bg-navy-3 px-2 text-xs"
                  onClick={() => void hide(p.id, !p.hidden)}
                >
                  {p.hidden ? '名前を戻す' : '名前を隠す'}
                </button>
                <button className="sw-btn bg-navy-3 px-2 text-xs" onClick={() => void credit(p.id)}>
                  パス+1
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PassesTab({ token, ov }: { token: string; ov: Overview }) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [passes, setPasses] = useState<SponsoredRow[]>([]);
  const [codes, setCodes] = useState<string[]>([]);
  const [count, setCount] = useState('10');
  const [label, setLabel] = useState('sponsored');
  const load = useCallback(async () => {
    setInvoices((await api<{ invoices: InvoiceRow[] }>('/api/admin/invoices', { token })).invoices);
    setPasses(
      (await api<{ passes: SponsoredRow[] }>('/api/admin/sponsored-passes', { token })).passes,
    );
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);
  const issue = async () => {
    const r = await api<{ codes: string[] }>('/api/admin/sponsored-passes', {
      body: { count: Math.max(1, Math.min(500, Number(count) || 1)), label },
      token,
    });
    setCodes(r.codes);
    await load();
  };
  return (
    <div className="flex flex-col gap-4">
      <section className="sw-panel p-4 text-sm">
        <h2 className="font-black">この作戦の出撃パス</h2>
        <p>
          {Object.entries(ov.entitlements)
            .map(([k, v]) => `${k}: ${v}`)
            .join(' · ') || 'なし'}
        </p>
        <p className="mt-1">
          請求書：
          {Object.entries(ov.invoices)
            .map(([k, v]) => `${k} ${v.count}件/${v.sats} sats`)
            .join(' · ') || 'なし'}
        </p>
        <p className="mt-1">
          スポンサーパス：
          {Object.entries(ov.sponsored)
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ') || 'なし'}
        </p>
      </section>
      <section className="sw-panel flex flex-col gap-2 p-4">
        <h2 className="font-black">スポンサーパス発行（コードは1回だけ表示）</h2>
        <div className="flex flex-wrap gap-2">
          <input
            className="w-20 rounded border border-line bg-navy px-2"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            aria-label="枚数"
          />
          <input
            className="rounded border border-line bg-navy px-2"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label="ラベル"
          />
          <button
            className="sw-btn bg-amber px-3 text-navy"
            onClick={() => void issue()}
            data-testid="issue-passes"
          >
            発行
          </button>
        </div>
        {codes.length > 0 && (
          <pre
            className="max-h-48 overflow-auto rounded bg-black/40 p-2 font-mono text-sm"
            data-testid="pass-codes"
          >
            {codes.join('\n')}
          </pre>
        )}
        <ul className="max-h-48 overflow-auto text-xs">
          {passes.map((p) => (
            <li key={p.idPrefix} className="flex gap-2">
              <span className="font-mono">{p.idPrefix}</span> {p.label} {p.status}
              {p.status === 'ACTIVE' && (
                <button
                  className="underline"
                  onClick={() =>
                    void api(`/api/admin/sponsored-passes/${p.idPrefix}/revoke`, {
                      body: {},
                      token,
                    }).then(load)
                  }
                >
                  無効化
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="sw-panel overflow-x-auto p-4">
        <h2 className="font-black">請求書（決済照合用・ハッシュ先頭のみ）</h2>
        <table className="w-full text-xs">
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="font-mono">{i.paymentHashPrefix}</td>
                <td>{i.amountSats} sats</td>
                <td>{i.status}</td>
                <td>{i.latePolicy ?? ''}</td>
                <td>{new Date(i.createdAt).toLocaleTimeString()}</td>
                <td>
                  {i.status === 'PENDING' && (
                    <button
                      className="underline"
                      onClick={() =>
                        void api(`/api/admin/invoices/${i.id}/recheck`, { body: {}, token }).then(
                          load,
                        )
                      }
                    >
                      再照会
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function MonitorTab({ ov }: { ov: Overview }) {
  return (
    <section className="sw-panel grid gap-2 p-4 text-sm md:grid-cols-2" data-testid="monitor-tab">
      <div>
        <h2 className="font-black">接続</h2>
        <p>
          合計 {ov.realtime.connections} ·{' '}
          {Object.entries(ov.realtime.byRole)
            .map(([k, v]) => `${k}:${v}`)
            .join(' ')}
        </p>
        <ul>
          {ov.realtime.arenas.map((a) => (
            <li key={a.socketId}>
              大画面 {a.renderer}/{a.quality}
              {a.autoQuality ? '（自動で品質低下中）' : ''} {a.fps.toFixed(0)}fps{' '}
              {a.frameMs.toFixed(1)}ms
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="font-black">サーバー</h2>
        <p>
          稼働 {Math.round(ov.server.uptimeSec / 60)}分 · メモリ {ov.server.memoryMb}MB ·
          イベントループ遅延 {ov.server.eventLoopLagMs ?? '-'}ms · tick遅延{' '}
          {ov.server.tickLagMs ?? '-'}ms
        </p>
        <p className="mt-1 text-muted">
          次の作戦の設定：{ov.nextConfig.version}（進行中の作戦には反映しません）
        </p>
      </div>
      <div>
        <h2 className="font-black">役割の偏り</h2>
        <RoleBalance roles={ov.crew.roles} total={ov.crew.total} />
        <p className="mt-1 text-muted">
          イベント seq {ov.snapshot.lastSeq} · SYNC {ov.snapshot.sync} · 予備電源{' '}
          {ov.snapshot.reserveEnergy}
        </p>
      </div>
    </section>
  );
}

/** Seat spread: one seat over half the crew means the others are missing (warn). */
function RoleBalance({ roles, total }: { roles: Record<string, number>; total: number }) {
  return (
    <ul data-testid="role-balance">
      {ROLES.map((r) => {
        const n = roles[r] ?? 0;
        const share = total ? n / total : 0;
        return (
          <li key={r} className={share > 0.5 ? 'font-bold text-danger' : ''}>
            {ROLE_LABELS[r].icon} {ROLE_LABELS[r].ja} {n}（{Math.round(share * 100)}%）
            {share > 0.5 ? ' ⚠ 偏り' : n === 0 && total > 0 ? ' ・空席' : ''}
          </li>
        );
      })}
    </ul>
  );
}

function AuditTab({ token }: { token: string }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  useEffect(() => {
    void api<{ entries: AuditRow[] }>('/api/admin/audit', { token }).then((r) =>
      setRows(r.entries),
    );
  }, [token]);
  return (
    <section className="sw-panel overflow-x-auto p-4" data-testid="audit-tab">
      <table className="w-full text-xs">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td>{new Date(r.timestamp).toLocaleString()}</td>
              <td>{r.actor}</td>
              <td className="font-bold">{r.action}</td>
              <td className="font-mono">{r.target_id ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
