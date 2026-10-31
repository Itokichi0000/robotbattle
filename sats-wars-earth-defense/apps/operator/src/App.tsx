import { useStore, useTicker } from '@swed/client';
import { percent } from '@swed/game-engine';
import { CITY_IDS, formatClock, PHASE_LABEL, SEAT_IDS, SEATS } from '@swed/shared';
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

/** The steps of one round, so staff always see where they are (D-032). */
const FLOW: Array<{ key: string; label: string; phases: string[] }> = [
  { key: 'lobby', label: '受付', phases: ['ATTRACT', 'LOBBY'] },
  { key: 'deploy', label: '出撃', phases: ['COUNTDOWN', 'DEPLOYMENT'] },
  { key: 'w1', label: '第1幕 ドローン迎撃', phases: ['WAVE_1'] },
  { key: 'w2', label: '第2幕 都市を守れ', phases: ['WAVE_2'] },
  { key: 'boss', label: '第3幕 NULL CORE 撃破', phases: ['BOSS'] },
  { key: 'done', label: '結果', phases: ['VICTORY', 'DEFEAT', 'RESULTS'] },
];

/** People and demo bots aboard, counted apart (`humans` counts every occupied seat). */
function crew(s: PublicMatchState) {
  const people = SEAT_IDS.filter((id) => s.seats[id].occupied && !s.seats[id].bot).length;
  const bots = SEAT_IDS.filter((id) => s.seats[id].occupied && s.seats[id].bot).length;
  return { people, bots };
}

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
  const { people, bots } = crew(s);
  const aboard = bots ? `人 ${people}人 ＋ BOT ${bots}` : `${people}人`;
  const left = s.combatEndsAt !== null ? formatClock(s.combatEndsAt - mt) : '--:--';
  const cities = CITY_IDS.filter((id) => !s.cities[id].lost).length;
  const gauge = Math.round(Math.min(100, s.teamCapacitor));
  const fight = `残り ${left} ・ 都市 ${cities}/${CITY_IDS.length} ・ 機体 ${percent(s.coreHp, s.coreMax)}% ・ 雷神ゲージ ${gauge}%`;
  const end: Act = {
    label: '作戦を中止 END',
    note: 'この回を敗北扱いで終わらせ、結果画面へ',
    cmd: { command: 'END' },
    tone: 'danger',
    confirm: 'この作戦を中止しますか？ / End this match now?',
  };
  if (p === 'ATTRACT')
    return {
      title: '待機中（客寄せ画面）',
      detail: `大画面に QR とタイトルを表示中。誰かが QR から搭乗すると自動で受付になります（搭乗 ${aboard}）`,
      acts: [
        {
          label: '搭乗受付を始める',
          note: '大画面に8つの席を表示して、パイロットを募集します',
          cmd: { command: 'OPEN_LOBBY' },
          tone: 'primary',
        },
        {
          label: 'すぐ出撃 START',
          note: '今いる人だけで出撃。空席は AUTO SUPPORT（AI）が担当',
          cmd: { command: 'START' },
        },
      ],
    };
  if (p === 'LOBBY')
    return {
      title: `搭乗受付中 — ${aboard} / 8席`,
      detail:
        people === 0
          ? 'まだ誰も乗っていません。大画面の QR をスマホで読み取ってもらいましょう'
          : '揃ったら出撃。空席は AUTO SUPPORT（AI）が担当するので、1人からでも遊べます',
      acts: [
        {
          label: '出撃する START',
          note: '約8秒の出撃演出のあと、第1幕が始まります（全体 約3分半）',
          cmd: { command: 'START' },
          tone: 'primary',
        },
        {
          label: '客寄せ画面に戻す',
          note: '席の一覧を閉じてタイトル画面へ（搭乗中の人はそのまま）',
          cmd: { command: 'ATTRACT' },
        },
      ],
    };
  if (p === 'COUNTDOWN' || p === 'DEPLOYMENT')
    return {
      title: '出撃中 — 演出が終わると第1幕',
      detail: '機体が格納庫から出撃しています。演出中はスマホの操作を受け付けません',
      acts: [
        {
          label: '演出をスキップ SKIP',
          note: 'すぐに第1幕を始めます',
          cmd: { command: 'SKIP_DEPLOY' },
          tone: 'primary',
        },
      ],
    };
  if (p === 'WAVE_1' || p === 'WAVE_2' || p === 'BOSS') {
    const act = FLOW.find((f) => f.phases.includes(p))!.label;
    if (s.paused)
      return {
        title: `一時停止中 — ${act}`,
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
    return {
      title: s.crisis ? `${act} — 炉心停止中！` : `${act} — 戦闘中`,
      detail: s.crisis ? `電力B が回路をつなぐか、誰かが sats を送ると復旧。${fight}` : fight,
      acts: [
        {
          label: '一時停止 PAUSE',
          note: 'トラブルや説明のときに。タイマーも止まります',
          cmd: { command: 'PAUSE' },
          tone: 'primary',
        },
        {
          label: '炉心停止を起こす',
          note: 'sats の見せ場を今すぐ。全員のスマホに「21 sats で即時復旧」が出ます（電力B が直してもOK）',
          cmd: { command: 'TRIGGER_BLACKOUT' },
          tone: 'warn',
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
    detail: '何もしなくても、結果表示のあと自動で次の受付（客寄せ画面）に戻ります',
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
      <div className={`state${s.crisis ? ' crisis' : ''}`}>
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
              confirm: '最初からやり直します。全員の席を解放しますか？ / Reset and free all seats?',
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
function DemoSettings({ s, onResult }: { s: PublicMatchState; onResult: (m: string) => void }) {
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
          checked={st?.demoBots ?? false}
          onToggle={(v) => run({ command: 'SET_DEMO_BOTS', enabled: v })}
        >
          <span>
            <b>DEMO BOTS — 無人でも試合を回す</b>
            <small>空席を BOT で埋め、受付が静かなら自動で出撃。人が乗ると BOT と交代します</small>
          </span>
        </Toggle>
        <Toggle
          checked={s.autoSupport}
          onToggle={(v) => run({ command: 'SET_AUTO_SUPPORT', enabled: v })}
        >
          <span>
            <b>AUTO SUPPORT — 空席の役割を AI が補助</b>
            <small>人より弱い最低限の操作。オフにすると空席の役割は何もしません</small>
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
            <option value="STANDARD">STANDARD — 戦闘 3分30秒</option>
            <option value="SHORT">SHORT — 戦闘 2分30秒（混雑時）</option>
          </select>
        </label>
        <Toggle
          checked={st?.hideCallsigns ?? false}
          onToggle={(v) => run({ command: 'SET_HIDE_CALLSIGNS', hidden: v })}
        >
          <span>
            <b>コールサインを全員非表示</b>
            <small>大画面の名前をすべて PILOT-XXXX に（不適切な名前が出たときに）</small>
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

function Seats({ s, onResult }: { s: PublicMatchState; onResult: (m: string) => void }) {
  return (
    <section className="panel sw-frame">
      <h2>
        席 SEATS — 人 {crew(s).people}
        {crew(s).bots ? ` ・ BOT ${crew(s).bots}` : ''} / 8
      </h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>席</th>
            <th>だれ</th>
            <th>状態</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {SEAT_IDS.map((id) => {
            const seat = s.seats[id];
            return (
              <tr key={id}>
                <td className="sw-num">{SEATS[id].no}</td>
                <td>
                  {SEATS[id].labelJa} <small>{SEATS[id].labelEn}</small>
                </td>
                <td>
                  {seat.occupied ? (
                    <>
                      {seat.displayName} {seat.bot ? <em>BOT</em> : null}
                    </>
                  ) : seat.auto ? (
                    <em>AUTO SUPPORT（AI）</em>
                  ) : (
                    <em>空席</em>
                  )}
                </td>
                <td>
                  {seat.occupied
                    ? seat.connected
                      ? seat.ready
                        ? '準備完了'
                        : '搭乗中'
                      : '再接続待ち'
                    : seat.open
                      ? '募集中'
                      : '閉鎖'}
                </td>
                <td>
                  {seat.occupied ? (
                    <button
                      className="b small warn"
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `${SEATS[id].labelEn} のパイロットを降ろしますか？ / Kick this pilot?`,
                          )
                        )
                          return;
                        const r = await command({ command: 'KICK_SEAT', seatId: id });
                        onResult(`${r.ok ? 'OK' : 'できませんでした'} — ${r.message}`);
                      }}
                      title="この席を空けます（AUTO SUPPORT が代わりに担当）"
                    >
                      KICK
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
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
 * Shared energy pulses (spec §8). Sandbox: staff settle VIRTUAL invoices here. Live: the
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
        sats（共有エネルギー）{' '}
        <b className={live ? (p.liveEnabled ? 'danger' : 'muted') : 'ally'}>
          {live
            ? p.liveEnabled
              ? 'LIVE ON 実決済中'
              : 'LIVE OFF（停止中）'
            : 'SANDBOX（架空のお金・テスト）'}
        </b>
      </h2>
      <p className="explain">
        sats を送れるのは <b>炉心停止（ブラックアウト）の間だけ</b>。パイロットが {p.amountSats}{' '}
        sats を送ると即時復旧し、雷神ゲージ +{p.capacitorGain}%。電力B
        が回路をつないでも同じ効果なので、払わなくても勝てます。
        {s.crisis ? <strong> いま炉心停止中 — 送信できます</strong> : null}
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
            {p.amountSats} sats → 炉心復旧 ＋ 雷神ゲージ +{p.capacitorGain}%
          </b>
        </div>
        <div>
          <span>上限</span>
          <b className="sw-num">
            1人 {p.perPilotPerMatch}回/試合 ・ {p.cooldownSec}秒に1回 ・ 全体 {p.maxPerMatch}回 ・
            この回 {s.stats.pulses}回
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
            <th>席</th>
            <th>支払い</th>
            <th>ゲーム反映</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {p.recent.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <em>まだありません（炉心停止中にパイロットが送ると、ここに出ます）</em>
              </td>
            </tr>
          ) : (
            p.recent.map((r) => (
              <tr key={r.intentId}>
                <td className="sw-num">{r.createdAt.slice(11, 19)}</td>
                <td>{r.seatId ?? '—'}</td>
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
            <Seats s={s} onResult={setToast} />
            <Payments s={s} onResult={setToast} />
            <DemoSettings s={s} onResult={setToast} />
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
