import { useStore, useTicker } from '@swed/client';
import { percent } from '@swed/game-engine';
import { ACTION_LABEL, CITY_IDS, formatClock, PHASE_LABEL } from '@swed/shared';
import type {
  OperatorCommand,
  OperatorPaymentsView,
  PublicMatchState,
  QualityPreset,
} from '@swed/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { checkSession, command, login, logout, socket, statusStore, store } from './net';

/**
 * OPERATOR console (spec §4.8). Staff only: password-protected, every command server-checked
 * and written to the audit log. LIVE payments are never on at start: staff run the checks
 * and type LIVE to turn them on (spec §4.8, §8).
 */

function Login({ onOk }: { onOk: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <main className="login">
      <form
        className="sw-frame"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr('');
          if (await login(pw)) onOk();
          else setErr('パスワードが違います / Wrong password');
        }}
      >
        <h1>
          SATS WARS <span>OPERATOR</span>
        </h1>
        <label>
          運営パスワード / Operator password
          <input
            type="password"
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
          />
        </label>
        {err ? <p className="err">{err}</p> : null}
        <button type="submit" className="b primary">
          ログイン / Sign in
        </button>
      </form>
    </main>
  );
}

/**
 * A checkbox bound to server state. The click shows at once and holds until the server's
 * status agrees (or the command fails), instead of flicking back for a round trip.
 */
function Toggle({
  checked,
  onToggle,
  children,
}: {
  checked: boolean;
  onToggle: (v: boolean) => Promise<boolean>;
  children: React.ReactNode;
}) {
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => {
    if (pending !== null && pending === checked) setPending(null);
  }, [checked, pending]);
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={pending ?? checked}
        onChange={async (e) => {
          const v = e.target.checked;
          setPending(v);
          if (!(await onToggle(v))) setPending(null);
        }}
      />
      {children}
    </label>
  );
}

/** The steps of one round, so staff always see where they are (D-033). */
const FLOW: Array<{ key: string; label: string; phases: string[] }> = [
  { key: 'lobby', label: '参加受付', phases: ['LOBBY'] },
  { key: 'deploy', label: '出撃', phases: ['COUNTDOWN', 'DEPLOYMENT'] },
  { key: 'battle', label: '戦闘（撃つ・守る・直す）', phases: ['BATTLE'] },
  { key: 'done', label: '結果', phases: ['VICTORY', 'DEFEAT', 'RESULTS'] },
];

type Act = {
  label: string;
  note: string;
  cmd: OperatorCommand;
  tone?: 'primary' | 'warn' | 'danger';
  confirm?: string;
};

/** What the round is doing in one sentence, and the actions that make sense right now. */
function plan(s: PublicMatchState, mt: number): { title: string; detail: string; acts: Act[] } {
  const p = s.phase;
  const crowd = s.bots ? `人 ${s.humans}人 ＋ BOT ${s.bots}` : `${s.humans}人`;
  const left = s.phaseEndsAt !== null ? formatClock(s.phaseEndsAt - mt) : '--:--';
  const cities = CITY_IDS.filter((id) => !s.cities[id].lost).length;
  const boss = s.boss ? percent(s.boss.hp, s.boss.maxHp) : 100;
  const fight = `残り ${left} ・ ボス ${boss}% ・ 都市 ${cities}/${CITY_IDS.length} ・ 雷神 ${percent(s.mechHp, s.mechMax)}% ・ 参加 ${crowd}`;
  const end: Act = {
    label: '作戦を中止 END',
    note: 'この回を敗北扱いで終わらせ、結果画面へ',
    cmd: { command: 'END' },
    tone: 'danger',
    confirm: 'この作戦を中止しますか？ / End this match now?',
  };
  if (p === 'LOBBY') {
    const auto =
      s.autoStartAt !== null
        ? `あと ${formatClock(s.autoStartAt - mt)} で自動出撃します。`
        : s.players > 0
          ? '自動出撃はオフです。'
          : '最初の1人が参加すると、自動出撃のカウントが始まります。';
    return {
      title: `参加受付中 — ${crowd}`,
      detail:
        s.players === 0
          ? `大画面の QR をスマホで読み取ってもらいましょう。読んだ人は全員そのまま参加です（席はありません）。${auto}`
          : `${auto} 待たずに始めるなら「出撃する」。途中参加もできます。`,
      acts: [
        {
          label: '出撃する START',
          note: '約8秒の出撃演出のあと、戦闘が始まります（戦闘 約2分）',
          cmd: { command: 'START' },
          tone: 'primary',
        },
      ],
    };
  }
  if (p === 'COUNTDOWN' || p === 'DEPLOYMENT')
    return {
      title: '出撃中 — 演出が終わると戦闘',
      detail: '雷神が格納庫から出撃しています。スマホには3つのボタンが表示されています',
      acts: [
        {
          label: '演出をスキップ SKIP',
          note: 'すぐに戦闘を始めます',
          cmd: { command: 'SKIP_DEPLOY' },
          tone: 'primary',
        },
      ],
    };
  if (p === 'BATTLE') {
    if (s.paused)
      return {
        title: '一時停止中',
        detail: `大画面とスマホに「一時停止」と表示中。${fight}`,
        acts: [
          {
            label: '再開する RESUME',
            note: '止めたところから続けます',
            cmd: { command: 'RESUME' },
            tone: 'primary',
          },
          end,
        ],
      };
    const strike = s.threats.find((th) => th.target.type === 'CITY');
    return {
      title: strike ? '戦闘中 — 都市に攻撃予告！（みんなで「守る」）' : '戦闘中',
      detail: fight,
      acts: [
        {
          label: '一時停止 PAUSE',
          note: 'トラブルや説明のときに。タイマーも止まります',
          cmd: { command: 'PAUSE' },
          tone: 'primary',
        },
        end,
      ],
    };
  }
  return {
    title:
      p === 'VICTORY'
        ? '勝利！ 結果を表示中'
        : p === 'DEFEAT'
          ? '敗北 — 結果を表示中'
          : '結果表示中',
    detail:
      '何もしなくても、結果表示のあと自動で次の受付に戻ります（参加中のスマホはそのまま次へ）',
    acts: [
      {
        label: '次の作戦へ NEXT',
        note: '結果表示を飛ばして、すぐ次の受付へ',
        cmd: { command: 'NEXT_ROUND' },
        tone: 'primary',
      },
    ],
  };
}

function NowPanel({
  s,
  mt,
  toast,
  onResult,
}: {
  s: PublicMatchState;
  mt: number;
  toast: string;
  onResult: (m: string) => void;
}) {
  const run = async (a: Act) => {
    if (a.confirm && !window.confirm(a.confirm)) return;
    const r = await command(a.cmd);
    onResult(`${r.ok ? 'OK' : 'できませんでした'} — ${r.message ?? a.label}`);
  };
  const step = FLOW.findIndex((f) => f.phases.includes(s.phase));
  const now = plan(s, mt);
  return (
    <section className="panel sw-frame now">
      <h2>今の状態 NOW</h2>
      <ol className="flow" aria-label="作戦の流れ">
        {FLOW.map((f, i) => (
          <li
            key={f.key}
            className={i === step ? 'on' : i < step ? 'past' : undefined}
            aria-current={i === step ? 'step' : undefined}
          >
            {f.label}
          </li>
        ))}
      </ol>
      <div className={`state${s.threats.some((t) => t.target.type === 'CITY') ? ' crisis' : ''}`}>
        <b>{now.title}</b>
        <p>{now.detail}</p>
      </div>
      <div className="acts">
        {now.acts.map((a) => (
          <div key={a.label} className={`act ${a.tone ?? ''}`}>
            <button className={`b ${a.tone ?? ''}`} onClick={() => void run(a)}>
              {a.label}
            </button>
            <span>{a.note}</span>
          </div>
        ))}
      </div>
      <div className="foot">
        {toast ? <span className="toast">{toast}</span> : <span />}
        <button
          className="b small danger"
          onClick={() =>
            void run({
              label: 'RESET',
              note: '',
              cmd: { command: 'RESET' },
              confirm: 'この回を捨てて、最初の受付からやり直しますか？ / Reset to a fresh lobby?',
            })
          }
        >
          やり直す RESET
        </button>
      </div>
    </section>
  );
}

/** Exhibition switches, each said in one plain sentence. */
function DemoSettings({ onResult }: { onResult: (m: string) => void }) {
  const st = useSyncExternalStore(statusStore.subscribe, statusStore.get, statusStore.get);
  const run = async (cmd: OperatorCommand) => {
    const r = await command(cmd);
    onResult(`${r.ok ? 'OK' : 'できませんでした'} — ${r.message ?? cmd.command}`);
    return r.ok;
  };
  const sandbox = st?.mode !== 'live';
  return (
    <section className="panel sw-frame">
      <h2>展示の設定 EXHIBITION</h2>
      <div className="opts">
        <Toggle
          checked={st?.autoStart ?? true}
          onToggle={(v) => run({ command: 'SET_AUTO_START', enabled: v })}
        >
          <span>
            <b>自動出撃 — 最初の1人が来たら自動で始める</b>
            <small>
              最初の参加から約30秒で出撃します。オフにすると「出撃する」を押すまで待ちます
            </small>
          </span>
        </Toggle>
        <Toggle
          checked={st?.demoBots ?? false}
          onToggle={(v) => run({ command: 'SET_DEMO_BOTS', enabled: v })}
        >
          <span>
            <b>DEMO BOTS — 無人でも試合を回す</b>
            <small>
              BOT 6体が観客役で参加し、ときどき VIRTUAL の 21 sats も見せます（DEMO
              と表示・お金は動きません）
            </small>
          </span>
        </Toggle>
        {sandbox && st ? (
          <Toggle
            checked={st.payments.autoSettleVirtual}
            onToggle={(v) => run({ command: 'SET_AUTO_SETTLE_VIRTUAL', enabled: v })}
          >
            <span>
              <b>VIRTUAL を自動確定（デモ用）</b>
              <small>
                テストの sats 送信を約1.5秒で自動で着金扱いにします。オフなら下の sats
                欄で手動確定。お金は動きません
              </small>
            </span>
          </Toggle>
        ) : null}
      </div>
    </section>
  );
}

/** Rarely needed: presets, privacy, the big screen, connections. */
function Advanced({ s, onResult }: { s: PublicMatchState; onResult: (m: string) => void }) {
  const st = useSyncExternalStore(statusStore.subscribe, statusStore.get, statusStore.get);
  const run = async (cmd: OperatorCommand) => {
    const r = await command(cmd);
    onResult(`${r.ok ? 'OK' : 'できませんでした'} — ${r.message ?? cmd.command}`);
    return r.ok;
  };
  return (
    <section className="panel sw-frame">
      <h2>試合とプライバシー MATCH</h2>
      <div className="opts">
        <label>
          試合の長さ（次の回から）
          <select
            value={st?.nextPresetId ?? s.presetId}
            onChange={(e) =>
              void run({ command: 'SET_PRESET', presetId: e.target.value as 'STANDARD' | 'SHORT' })
            }
          >
            <option value="STANDARD">STANDARD — 戦闘 2分</option>
            <option value="SHORT">SHORT — 戦闘 1分30秒（混雑時）</option>
          </select>
        </label>
        <Toggle
          checked={st?.hideCallsigns ?? false}
          onToggle={(v) => run({ command: 'SET_HIDE_CALLSIGNS', hidden: v })}
        >
          <span>
            <b>コールサインを全員非表示</b>
            <small>名前をすべて PILOT-XXXX に（不適切な名前が出たときに）</small>
          </span>
        </Toggle>
      </div>
      <div className="kv">
        <div>
          <span>試合</span>
          <b className="sw-num">
            #{s.matchNumber} {s.presetId} — {PHASE_LABEL[s.phase].ja}
          </b>
        </div>
        <div>
          <span>接続</span>
          <b className="sw-num">
            大画面 {st?.connections.displays ?? 0} ・ スマホ {st?.connections.pilots ?? 0} ・ 運営{' '}
            {st?.connections.operators ?? 0}
          </b>
        </div>
        <div>
          <span>ボス HP</span>
          <b className="sw-num">{s.boss ? `${s.boss.hp} / ${s.boss.maxHp}` : '—'}</b>
        </div>
      </div>
      {st ? (
        <div className="join">
          <img src="/api/public/join.svg" width={112} height={112} alt="join QR" />
          <div>
            参加 URL（スマホが QR を読めないとき手入力）
            <code>{st.joinUrl}</code>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Who is in, and what the crowd is pressing. */
function Crowd({ s }: { s: PublicMatchState }) {
  const kinds = ['ATTACK', 'DEFEND', 'REPAIR'] as const;
  return (
    <section className="panel sw-frame">
      <h2>
        参加者 PLAYERS — 人 {s.humans}
        {s.bots ? ` ・ BOT ${s.bots}` : ''}
      </h2>
      <p className="explain">
        QR を読んだ人は全員参加（席・人数の上限なし）。スマホを閉じても約45秒は人数に数えます。
        ボスの強さは出撃時の人数で決まり、途中参加があると少し強くなります。
      </p>
      <table>
        <thead>
          <tr>
            <th>ボタン</th>
            <th style={{ textAlign: 'right' }}>タップ（無料）</th>
            <th style={{ textAlign: 'right' }}>21 sats</th>
          </tr>
        </thead>
        <tbody>
          {kinds.map((k) => (
            <tr key={k}>
              <td>
                {ACTION_LABEL[k].ja} <small>{ACTION_LABEL[k].en}</small>
              </td>
              <td className="sw-num" style={{ textAlign: 'right' }}>
                {s.stats.free[k]}
              </td>
              <td className="sw-num" style={{ textAlign: 'right' }}>
                {s.stats.paid[k]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Display({ onResult }: { onResult: (m: string) => void }) {
  const st = useSyncExternalStore(statusStore.subscribe, statusStore.get, statusStore.get);
  if (!st) return null;
  const set = async (settings: Parameters<typeof command>[0] & { command: 'SET_DISPLAY' }) => {
    const r = await command(settings);
    onResult(`${r.ok ? 'OK' : 'NG'} — ${r.message}`);
  };
  return (
    <section className="panel sw-frame">
      <h2>大画面 DISPLAY</h2>
      <div className="row">
        <label>
          VOLUME {Math.round(st.display.volume * 100)}%
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(st.display.volume * 100)}
            onChange={(e) =>
              set({ command: 'SET_DISPLAY', settings: { volume: Number(e.target.value) / 100 } })
            }
          />
        </label>
        <button
          className={`b ${st.display.muted ? 'danger' : ''}`}
          onClick={() => set({ command: 'SET_DISPLAY', settings: { muted: !st.display.muted } })}
        >
          {st.display.muted ? 'UNMUTE 音声ON' : 'MUTE 即ミュート'}
        </button>
      </div>
      <div className="row">
        <label>
          QUALITY 画質
          <select
            value={st.display.quality}
            onChange={(e) =>
              set({
                command: 'SET_DISPLAY',
                settings: { quality: e.target.value as QualityPreset },
              })
            }
          >
            <option value="CINEMATIC">CINEMATIC</option>
            <option value="BALANCED">BALANCED</option>
            <option value="SAFE">SAFE</option>
          </select>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={st.display.reduceFlash}
            onChange={(e) =>
              set({ command: 'SET_DISPLAY', settings: { reduceFlash: e.target.checked } })
            }
          />
          REDUCE FLASH 発光を抑える
        </label>
      </div>
      <table>
        <thead>
          <tr>
            <th>SCREEN</th>
            <th>FPS</th>
            <th>QUALITY</th>
            <th>SIZE</th>
          </tr>
        </thead>
        <tbody>
          {st.displays.length === 0 ? (
            <tr>
              <td colSpan={4}>
                <em>表示端末が接続されていません / no display connected</em>
              </td>
            </tr>
          ) : (
            st.displays.map((d) => (
              <tr key={d.id}>
                <td className="sw-num">{d.id.slice(0, 6)}</td>
                <td
                  className="sw-num"
                  style={{ color: d.stats && d.stats.fps < 30 ? 'var(--sw-danger)' : undefined }}
                >
                  {d.stats ? d.stats.fps.toFixed(0) : '…'}
                  {d.stats?.webglLost ? ' (GL LOST)' : ''}
                </td>
                <td>{d.stats?.quality ?? '…'}</td>
                <td className="sw-num">{d.stats ? `${d.stats.width}×${d.stats.height}` : '…'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

function CheckLine({ name, c }: { name: string; c: OperatorPaymentsView['checks']['backend'] }) {
  return (
    <div>
      <span>{name}</span>
      <b className={c ? (c.ok ? 'ally' : 'danger') : undefined}>
        {c ? `${c.ok ? 'PASS' : 'FAIL'} — ${c.detail} (${c.at.slice(11, 19)})` : 'not run 未実施'}
      </b>
    </div>
  );
}

/**
 * Lightning actions (spec §8, D-033). Sandbox: staff settle VIRTUAL invoices here. Live: the
 * operator checks the backend and the public webhook, then types LIVE; OFF is one click.
 */
function Payments({ s, onResult }: { s: PublicMatchState; onResult: (m: string) => void }) {
  const st = useSyncExternalStore(statusStore.subscribe, statusStore.get, statusStore.get);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  if (!st) return null;
  const p = st.payments;
  const live = p.mode === 'live';
  const run = async (cmd: OperatorCommand) => {
    setBusy(true);
    const r = await command(cmd);
    setBusy(false);
    onResult(`${r.ok ? 'OK' : 'NG'} — ${r.message ?? cmd.command}`);
    return r.ok;
  };
  return (
    <section className="panel sw-frame payments">
      <h2>
        21 sats の大きい一撃{' '}
        <b className={live ? (p.liveEnabled ? 'danger' : 'muted') : 'ally'}>
          {live
            ? p.liveEnabled
              ? 'LIVE ON 実決済中'
              : 'LIVE OFF（停止中）'
            : 'SANDBOX（架空のお金・テスト）'}
        </b>
      </h2>
      <p className="explain">
        戦闘中、スマホの各ボタンの横にある「{p.amountSats}{' '}
        sats」を押して支払うと、同じ行動の大きい版になります （撃つ {p.effect.ATTACK} ダメージ ・
        守る +{p.effect.DEFEND} ・ 直す +{p.effect.REPAIR}）。
        全員同じ大きさで、上限があるのでお金だけでは勝てません。払わなくても無料タップで遊べます。
      </p>
      <div className="kv">
        <div>
          <span>方式</span>
          <b>{p.provider}</b>
        </div>
        <div>
          <span>受取先</span>
          <b>{p.recipient}</b>
        </div>
        <div>
          <span>1回</span>
          <b className="sw-num">
            {p.amountSats} sats → 撃つ {p.effect.ATTACK} / 守る +{p.effect.DEFEND} / 直す +
            {p.effect.REPAIR}
          </b>
        </div>
        <div>
          <span>上限</span>
          <b className="sw-num">
            1人 {p.perPilotPerMatch}回/試合 ・ {p.cooldownSec}秒に1回 ・ 全体 {p.maxPerMatch}回 ・
            この回 {s.stats.lightning}回
          </b>
        </div>
        <div>
          <span>着金の合計</span>
          <b className="sw-num">
            {p.settledTotal.n} 件 / {p.settledTotal.sats} sats{live ? '' : '（架空）'}
          </b>
        </div>
        {live ? (
          <>
            <CheckLine name="BACKEND" c={p.checks.backend} />
            <CheckLine name="WEBHOOK" c={p.checks.webhook} />
          </>
        ) : null}
      </div>
      {live ? (
        <div className="row">
          <button
            className="b"
            disabled={busy}
            onClick={() => void run({ command: 'PAYMENTS_CHECK' })}
          >
            RUN CHECKS 接続確認
          </button>
          {p.liveEnabled ? (
            <button
              className="b danger"
              disabled={busy}
              onClick={() => void run({ command: 'PAYMENTS_DISABLE' })}
            >
              LIVE OFF 実決済を停止
            </button>
          ) : (
            <>
              <label>
                確認のため LIVE と入力 / type LIVE
                <input
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <button
                className="b warn"
                disabled={busy || confirm !== 'LIVE'}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `実際の Lightning 決済を開始します。\n受取先: ${p.recipient}\n金額: ${p.amountSats} sats / 回\nよろしいですか？`,
                    )
                  )
                    return;
                  if (await run({ command: 'PAYMENTS_ENABLE_LIVE', confirm })) setConfirm('');
                }}
              >
                LIVE ON 実決済を開始
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="hint">
          {p.autoSettleVirtual
            ? 'テストの送信は約1.5秒で自動的に着金扱いになります（展示の設定でオフにできます）。'
            : 'テストの送信は下の SETTLE を押すと着金扱いになります（お金は動きません）。'}
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>時刻</th>
            <th>行動</th>
            <th>支払い</th>
            <th>ゲーム反映</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {p.recent.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <em>まだありません（戦闘中にスマホから 21 sats を送ると、ここに出ます）</em>
              </td>
            </tr>
          ) : (
            p.recent.map((r) => (
              <tr key={r.intentId}>
                <td className="sw-num">{r.createdAt.slice(11, 19)}</td>
                <td>{ACTION_LABEL[r.action].ja}</td>
                <td className={r.status === 'settled' ? 'ally' : undefined}>
                  {r.status} {r.mode === 'sandbox' ? <em>VIRTUAL</em> : null}
                </td>
                <td>
                  {r.applied}
                  {r.note ? <em> {r.note}</em> : null}
                </td>
                <td>
                  {r.mode === 'sandbox' && r.status === 'pending' ? (
                    <button
                      className="b small"
                      disabled={busy}
                      onClick={() => void run({ command: 'SANDBOX_SETTLE', intentId: r.intentId })}
                    >
                      SETTLE
                    </button>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

/** Always on screen: whether real money can move right now. */
function ModeBadge() {
  const st = useSyncExternalStore(statusStore.subscribe, statusStore.get, statusStore.get);
  if (!st) return null;
  const live = st.mode === 'live';
  return (
    <span className={`mode ${live ? (st.payments.liveEnabled ? 'danger' : 'muted') : 'ally'}`}>
      {live
        ? st.payments.liveEnabled
          ? '本番モード — 実決済 ON'
          : '本番モード — 実決済は停止中'
        : 'テストモード — お金は動きません'}
    </span>
  );
}

function Audit() {
  const st = useSyncExternalStore(statusStore.subscribe, statusStore.get, statusStore.get);
  return (
    <section className="panel sw-frame audit">
      <h2>操作記録 AUDIT LOG</h2>
      <ol>
        {(st?.audit ?? []).map((a) => (
          <li key={a.id}>
            <span className="sw-num">{a.at.slice(11, 19)}</span> <b>{a.action}</b>{' '}
            <span>{a.actor}</span> <em>{a.detail}</em>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [toast, setToast] = useState('');
  const st = useStore(store);
  const now = useTicker(250);
  useEffect(() => {
    void checkSession().then(setAuthed);
  }, []);
  useEffect(() => {
    if (authed) socket.connect();
    socket.on('connect_error', (e) => {
      if (e.message === 'NOT_AUTHENTICATED') setAuthed(false);
    });
  }, [authed]);
  if (authed === null) return <main className="login">…</main>;
  if (!authed) return <Login onOk={() => setAuthed(true)} />;
  const s = st.snap?.state;
  return (
    <main className="op">
      <header>
        <h1>
          SATS WARS <span>OPERATOR 運営</span>
        </h1>
        <ModeBadge />
        <span className={st.connected ? 'ok' : 'bad'}>
          {st.connected ? 'SERVER CONNECTED' : 'RECONNECTING…'}
        </span>
        <button
          className="b small"
          onClick={async () => {
            await logout();
            setAuthed(false);
          }}
        >
          LOGOUT
        </button>
      </header>
      {s ? (
        <>
          <NowPanel s={s} mt={store.matchTime(now)} toast={toast} onResult={setToast} />
          <div className="grid">
            <Crowd s={s} />
            <Payments s={s} onResult={setToast} />
            <DemoSettings onResult={setToast} />
          </div>
          <details className="advanced">
            <summary>
              詳細設定・記録（試合の長さ、コールサイン、大画面の音量と画質、接続状況、操作記録）
            </summary>
            <div className="grid">
              <Advanced s={s} onResult={setToast} />
              <Display onResult={setToast} />
              <Audit />
            </div>
          </details>
        </>
      ) : (
        <p>Waiting for match state…</p>
      )}
    </main>
  );
}
