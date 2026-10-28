'use client';
import { useCallback, useEffect, useState } from 'react';
import type { GameConfig, PublicMatchSnapshot } from '@sats-wars/shared';
import { REGION_INFO, STATUS_LABELS } from '@sats-wars/shared';
import { Logo } from '@/components/Logo';
import { ApiError, api } from '@/lib/api';

interface Overview {
  snapshot: PublicMatchSnapshot;
  paymentMode: string;
  paymentsEnabled: boolean;
  autoLoop: boolean;
  demoBots: number;
  actions: { actions: number; players: number };
  credit: { outstanding: number; toppedUp: number; passes: number; spent: number; adjusted: number };
  invoices: Record<string, { count: number; sats: number }>;
  passes: Record<string, { count: number; sats: number }>;
  realtime: {
    connections: number;
    byRole: Record<string, number>;
    arenas: Array<{
      socketId: string;
      fps: number;
      frameMs: number;
      renderer: string;
      quality: string;
    }>;
  };
  server: {
    uptimeSec: number;
    memoryMb: number;
    eventLoopLagMs: number | null;
    tickLagMs: number | null;
  };
  nextConfig: GameConfig;
}

interface InvoiceRow {
  id: string;
  playerId: string;
  amountSats: number;
  status: string;
  createdAt: number;
  expiresAt: number;
  checkFailures: number;
  paymentHashPrefix: string;
}
interface PlayerRow {
  id: string;
  nickname: string;
  nicknameHidden: boolean;
  creditSats: number;
  actionsTotal: number;
  kills: number;
  lastSeenAt: number;
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
  const logout = () => {
    void api('/api/admin/logout', { body: {}, token }).catch(() => undefined);
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
    setToken(null);
  };
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

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

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

  const command = async (body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      await api('/api/admin/command', { token, body });
      setMsg({ ok: true, text: `OK: ${String(body.command)}` });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!ov) return <div className="p-6">Loading…</div>;
  const s = ov.snapshot;

  return (
    <div className="mx-auto max-w-6xl p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Logo size="sm" />
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`rounded-full px-3 py-1 font-bold ${ov.paymentMode === 'mock' ? 'bg-yellow-400/20 text-yellow-200' : 'bg-danger/20 text-danger'}`}
          >
            PAYMENT_MODE={ov.paymentMode}
          </span>
          <a
            className="rounded border border-line px-3 py-1"
            href="/arena"
            target="_blank"
            rel="noreferrer"
          >
            /arena
          </a>
          <button className="rounded border border-line px-3 py-1" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      {msg && (
        <p
          className={`mb-3 rounded px-3 py-2 text-sm font-bold ${msg.ok ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger'}`}
        >
          {msg.text}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <section className="sw-panel p-4 md:col-span-2">
          <h2 className="font-black">防衛戦 / Campaign</h2>
          <p className="mt-1 font-mono text-xs text-off/70">
            {s.matchId} · config {s.configVersion}
          </p>
          <div className="mt-2 flex flex-wrap items-baseline gap-4">
            <span className="text-3xl font-black" data-testid="admin-status">
              {STATUS_LABELS[s.status].ja} / {s.status}
            </span>
            <span className="text-xl" data-testid="admin-wave">
              ウェーブ {s.wave} · 敵ターンまで {s.config.actionsPerTurn - s.actionsThisTurn}手 · 合体 {s.combo}/{s.config.comboGaugeMax}
            </span>
          </div>
          {s.pauseReason && <p className="text-sm text-yellow-300">pause reason: {s.pauseReason}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn onClick={() => command({ command: 'START' })} disabled={busy || s.status !== 'CREATED'} testId="cmd-start">
              スタート / Start
            </Btn>
            <Btn onClick={() => command({ command: 'PAUSE' })} disabled={busy || s.status !== 'LIVE'} testId="cmd-pause">
              一時停止 / Pause
            </Btn>
            <Btn onClick={() => command({ command: 'RESUME' })} disabled={busy || s.status !== 'PAUSED'} testId="cmd-resume">
              再開 / Resume
            </Btn>
            <Btn
              onClick={() => command({ command: 'CANCEL' }, '防衛戦を中止します（残高は保持）。よろしいですか？ / Cancel this campaign?')}
              disabled={busy || s.status === 'FINISHED' || s.status === 'CANCELLED'}
              cls="bg-danger/80"
            >
              中止 / Cancel
            </Btn>
            <Btn
              onClick={() => command({ command: 'NEXT_MATCH' })}
              disabled={busy || !['FINISHED', 'CANCELLED', 'CREATED'].includes(s.status)}
              testId="cmd-next"
            >
              次の防衛戦 / Next campaign
            </Btn>
          </div>
          <label className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-black/30 p-3 text-sm">
            <span>
              自動ループ（無人運転）/ Auto-loop
              <br />
              <b className={ov.autoLoop ? 'text-ok' : 'text-yellow-300'}>{ov.autoLoop ? 'ON' : 'OFF'}</b>
              <span className="ml-2 text-xs text-off/60">日本陥落後に自動で次を開始・再起動後10秒で自動再開</span>
            </span>
            <Btn onClick={() => command({ command: 'SET_AUTO_LOOP', enabled: !ov.autoLoop })} disabled={busy} testId="cmd-autoloop">
              {ov.autoLoop ? '停止 / Off' : '有効 / On'}
            </Btn>
          </label>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" data-testid="admin-regions">
            {s.regions.map((r) => (
              <div key={r.regionId} className={`rounded-lg p-2 ${r.fallen ? 'bg-fuchsia-900/50' : 'bg-black/30'}`}>
                <b>{REGION_INFO[r.regionId].labelJa}</b>
                <div>
                  {r.fallen ? '👾 とられた' : `🏙 ${r.cityHp}/${s.config.cityHpMax}`}
                  {r.shield > 0 && ` 🛡${r.shield}`}
                </div>
                <div className="text-xs text-off/70">🛸 {s.enemies.filter((e) => e.regionId === r.regionId).length}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="sw-panel flex flex-col gap-3 p-4">
          <h2 className="font-black text-danger">緊急 / Emergency</h2>
          <button
            className="sw-btn bg-danger py-4 text-lg text-white"
            onClick={() =>
              command(
                { command: 'EMERGENCY_STOP' },
                '緊急停止：防衛戦を一時停止し、チャージ受付と自動ループを止めます / Emergency stop?',
              )
            }
            data-testid="cmd-emergency"
          >
            ⛔ 緊急停止 / EMERGENCY STOP
          </button>
          <label className="flex items-center justify-between gap-2 rounded-lg bg-black/30 p-3">
            <span>
              決済受付 / Payments
              <br />
              <b className={ov.paymentsEnabled ? 'text-ok' : 'text-danger'}>
                {ov.paymentsEnabled ? 'ON' : 'OFF'}
              </b>
            </span>
            <Btn
              onClick={() =>
                command({ command: 'SET_PAYMENTS_ENABLED', enabled: !ov.paymentsEnabled })
              }
              disabled={busy}
            >
              {ov.paymentsEnabled ? '停止 / Stop' : '再開 / Enable'}
            </Btn>
          </label>
          <BotsControl
            current={ov.demoBots}
            onApply={(n) => command({ command: 'SET_DEMO_BOTS', count: n })}
          />
          <p className="text-xs text-off/60">
            復帰手順: docs/EVENT_OPERATIONS.md ・ 再起動後はPAUSEDで復元（自動ループONなら10秒後に自動再開）/ After a
            restart the campaign is restored as PAUSED (auto-resumes after 10s when auto-loop is on).
          </p>
        </section>

        <section className="sw-panel p-4">
          <h2 className="font-black">残高・チャージ / Credit</h2>
          <Table
            rows={[
              ['未使用残高 outstanding', `${ov.credit.outstanding} sats`],
              ['チャージ topped up', `${ov.credit.toppedUp} sats`],
              ['コード passes', `${ov.credit.passes} sats`],
              ['出撃消費 spent', `${ov.credit.spent} sats`],
              ['手動調整 adjusted', `${ov.credit.adjusted} sats`],
            ]}
            head={['credit', 'sats']}
          />
          <Table rows={Object.entries(ov.invoices).map(([k, v]) => [k, v.count, `${v.sats} sats`])} head={['invoices', 'count', 'sum']} />
          <Table rows={Object.entries(ov.passes).map(([k, v]) => [k, v.count, `${v.sats} sats`])} head={['codes', 'count', 'sum']} />
        </section>

        <section className="sw-panel p-4">
          <h2 className="font-black">この防衛戦 / This campaign</h2>
          <Table
            rows={[
              ['moves (paid)', ov.actions.actions],
              ['players who moved', ov.actions.players],
              ['kills', s.stats.kills],
              ['alien turns', s.stats.alienTurns],
              ['captured / liberated', `${s.stats.regionsLost} / ${s.stats.regionsLiberated}`],
              ['best wave (all time)', s.bestWave],
            ]}
            head={['metric', 'value']}
          />
        </section>

        <section className="sw-panel p-4">
          <h2 className="font-black">接続・性能 / Health</h2>
          <Table
            rows={[
              ['sockets', ov.realtime.connections],
              ...Object.entries(ov.realtime.byRole).map(
                ([k, v]) => [`  ${k}`, v] as [string, number],
              ),
              ['event loop lag', `${ov.server.eventLoopLagMs ?? '-'} ms`],
              ['tick lag', `${ov.server.tickLagMs ?? '-'} ms`],
              ['memory', `${ov.server.memoryMb} MB`],
              ['uptime', `${ov.server.uptimeSec}s`],
            ]}
            head={['metric', 'value']}
          />
          <h3 className="mt-3 text-sm font-bold">Arena screens</h3>
          {ov.realtime.arenas.length === 0 ? (
            <p className="text-sm text-yellow-300">
              会場画面が接続されていません / No arena connected
            </p>
          ) : (
            <Table
              rows={ov.realtime.arenas.map((a) => [
                a.renderer,
                a.quality,
                `${a.fps} fps`,
                `${a.frameMs} ms`,
              ])}
              head={['renderer', 'quality', 'fps', 'frame']}
            />
          )}
        </section>

        <PassesPanel token={token} />
        <InvoicesPanel token={token} />
        <PlayersPanel token={token} />
        <ConfigPanel token={token} config={ov.nextConfig} />
        <AuditPanel token={token} />
      </div>
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  cls = 'bg-white/15',
  testId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  cls?: string;
  testId?: string;
}) {
  return (
    <button
      className={`sw-btn px-3 py-2 text-sm ${cls}`}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

function Table({ rows, head }: { rows: Array<Array<string | number>>; head: string[] }) {
  return (
    <table className="mt-2 w-full text-left text-sm">
      <thead>
        <tr className="text-off/60">
          {head.map((h) => (
            <th key={h} className="font-normal">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className="text-off/50">—</td>
          </tr>
        ) : (
          rows.map((r, i) => (
            <tr key={i} className="border-t border-white/5">
              {r.map((c, j) => (
                <td key={j} className="py-0.5 tabular-nums">
                  {c}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function BotsControl({ current, onApply }: { current: number; onApply: (n: number) => void }) {
  const [n, setN] = useState(current);
  useEffect(() => setN(current), [current]);
  return (
    <div className="rounded-lg bg-black/30 p-3">
      <div>
        デモBOT / Demo bots: <b>{current}</b>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="number"
          min={0}
          max={50}
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
          className="w-20 rounded bg-black/40 px-2"
          data-testid="bots-input"
        />
        <Btn onClick={() => onApply(n)} testId="bots-apply">
          適用 / Apply
        </Btn>
      </div>
      <p className="mt-1 text-xs text-off/60">BOTは名前に「BOT」と付き、satsを使いません。BOTはおすすめの一手でゲームを進めてしまうため、通常は0（無人デモ・リハーサル用）。</p>
    </div>
  );
}

function PassesPanel({ token }: { token: string }) {
  const [count, setCount] = useState(10);
  const [amount, setAmount] = useState(105);
  const [minutes, setMinutes] = useState(720);
  const [label, setLabel] = useState('venue');
  const [codes, setCodes] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const issue = async () => {
    setErr(null);
    try {
      const r = await api<{ codes: string[] }>('/api/admin/passes', {
        token,
        body: { count, amountSats: amount, expiresInMinutes: minutes, label },
      });
      setCodes(r.codes);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };
  return (
    <section className="sw-panel p-4">
      <h2 className="font-black">配布コード / Credit codes</h2>
      <p className="text-xs text-off/60">会場で配るsatsの代わりに使えるコード。1枚＝指定satsの残高。</p>
      <div className="mt-2 grid grid-cols-4 gap-2 text-sm">
        <label>
          sats/枚
          <input
            type="number"
            min={21}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full rounded bg-black/40 px-2 py-1"
          />
        </label>
        <label>
          枚数
          <input
            type="number"
            min={1}
            max={200}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-full rounded bg-black/40 px-2 py-1"
          />
        </label>
        <label>
          有効(分)
          <input
            type="number"
            min={5}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="w-full rounded bg-black/40 px-2 py-1"
          />
        </label>
        <label>
          ラベル
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full rounded bg-black/40 px-2 py-1"
          />
        </label>
      </div>
      <Btn onClick={issue} testId="issue-passes">
        発行 / Issue
      </Btn>
      {err && <p className="text-sm text-danger">{err}</p>}
      {codes.length > 0 && (
        <div className="mt-2 rounded bg-black/40 p-2">
          <p className="text-xs text-yellow-200">
            コードはこの画面でのみ表示されます。印刷・配布してください。/ Shown once — print now.
          </p>
          <pre className="mt-1 max-h-48 overflow-auto font-mono text-sm" data-testid="pass-codes">
            {codes.join('\n')}
          </pre>
        </div>
      )}
    </section>
  );
}

function InvoicesPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const load = useCallback(async () => {
    try {
      setRows((await api<{ invoices: InvoiceRow[] }>('/api/admin/invoices', { token })).invoices);
    } catch {
      // ignore
    }
  }, [token]);
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);
  const recheck = async (id: string) => {
    await api(`/api/admin/invoices/${id}/recheck`, { token, body: {} }).catch((e) => alert(String(e)));
    await load();
  };
  const attention = rows.filter((r) => r.checkFailures > 0 || r.status === 'PENDING');
  return (
    <section className="sw-panel p-4 md:col-span-2">
      <h2 className="font-black">確認中の請求書 / Pending invoices</h2>
      {attention.length === 0 ? (
        <p className="text-sm text-off/60">なし / none</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-off/60">
              <th>id</th>
              <th>player</th>
              <th>status</th>
              <th>sats</th>
              <th>hash</th>
              <th>check fails</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {attention.map((r) => (
              <tr key={r.id} className="border-t border-white/5">
                <td className="font-mono text-xs">{r.id.slice(-10)}</td>
                <td className="font-mono text-xs">{r.playerId.slice(-8)}</td>
                <td>{r.status}</td>
                <td>{r.amountSats}</td>
                <td className="font-mono text-xs">{r.paymentHashPrefix}…</td>
                <td>{r.checkFailures}</td>
                <td className="py-1">{r.status === 'PENDING' && <Btn onClick={() => recheck(r.id)}>再照会</Btn>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-xs text-off/60">
        遅れて届いた入金も没収せず自動で残高に加算されます。LNbits側で入金済みなのに反映されない場合は「再照会」、それでも駄目なら
        プレイヤー一覧から手動で残高調整（監査ログに残ります）。運営画面から送金は行いません。
      </p>
    </section>
  );
}

function PlayersPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const load = useCallback(async () => {
    try {
      setRows((await api<{ players: PlayerRow[] }>('/api/admin/players', { token })).players);
    } catch {
      // ignore
    }
  }, [token]);
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);
  const toggle = async (p: PlayerRow) => {
    await api(`/api/admin/players/${p.id}/nickname-visibility`, { token, body: { hidden: !p.nicknameHidden } });
    await load();
  };
  const adjust = async (p: PlayerRow) => {
    const raw = window.prompt(`${p.nickname} の残高を増減（sats、例: 105 / -21）`);
    if (!raw) return;
    const deltaSats = Number(raw);
    if (!Number.isInteger(deltaSats) || deltaSats === 0) return alert('整数を入力してください');
    const note = window.prompt('理由（必須・監査ログに残ります）') ?? '';
    if (!note.trim()) return;
    await api(`/api/admin/players/${p.id}/credit`, { token, body: { deltaSats, note } }).catch((e) => alert(String(e)));
    await load();
  };
  return (
    <section className="sw-panel p-4">
      <h2 className="font-black">プレイヤー / Players ({rows.length})</h2>
      <div className="mt-2 max-h-72 overflow-auto">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-white/5">
                <td className={p.nicknameHidden ? 'line-through opacity-50' : ''}>{p.nickname}</td>
                <td className="text-xs tabular-nums">{p.creditSats} sats</td>
                <td className="text-xs tabular-nums">
                  {p.actionsTotal}回 · 撃破{p.kills}
                </td>
                <td className="whitespace-nowrap">
                  <button className="text-xs underline" onClick={() => toggle(p)}>
                    {p.nicknameHidden ? '表示' : '非表示'}
                  </button>{' '}
                  <button className="text-xs underline" onClick={() => adjust(p)}>
                    残高調整
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ConfigPanel({ token, config }: { token: string; config: GameConfig }) {
  const [text, setText] = useState(() => JSON.stringify(config, null, 2));
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    try {
      const parsed = JSON.parse(text) as unknown;
      await api('/api/admin/next-config', { method: 'PUT', token, body: { config: parsed } });
      setMsg('保存しました（次の防衛戦から適用）/ Saved for the next campaign');
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    }
  };
  return (
    <section className="sw-panel p-4 md:col-span-2">
      <h2 className="font-black">次の防衛戦の設定 / Next campaign config</h2>
      <p className="text-xs text-off/60">
        進行中の防衛戦には反映されません。actionCostSats=1回の値段、actionsPerTurn=敵ターンまでの手数、topupOptionsSats=チャージ額の選択肢。/ Never applied to the running campaign.
      </p>
      <textarea
        className="mt-2 h-64 w-full rounded bg-black/40 p-2 font-mono text-xs"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      <div className="flex items-center gap-2">
        <Btn onClick={save}>保存 / Save</Btn>
        <Btn onClick={() => setText(JSON.stringify(config, null, 2))}>リセット / Reset</Btn>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
    </section>
  );
}

function AuditPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  useEffect(() => {
    const load = async () => {
      try {
        setRows((await api<{ entries: AuditRow[] }>('/api/admin/audit', { token })).entries);
      } catch {
        // ignore
      }
    };
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [token]);
  return (
    <section className="sw-panel p-4">
      <h2 className="font-black">監査ログ / Audit log</h2>
      <ul className="mt-2 max-h-72 overflow-auto text-xs">
        {rows.map((r) => (
          <li key={r.id} className="border-t border-white/5 py-0.5">
            <span className="text-off/60">{new Date(r.timestamp).toLocaleTimeString()}</span>{' '}
            <b>{r.action}</b> by {r.actor} {r.target_id ? `→ ${r.target_id.slice(-10)}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}
