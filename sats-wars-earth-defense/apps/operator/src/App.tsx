import { useStore, useTicker } from '@swed/client';
import { percent } from '@swed/game-engine';
import { CITIES, CITY_IDS, formatClock, PHASE_LABEL, SEAT_IDS, SEATS } from '@swed/shared';
import type { OperatorCommand, PublicMatchState, QualityPreset } from '@swed/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { checkSession, command, login, logout, socket, statusStore, store } from './net';

/**
 * OPERATOR console (spec §4.8). Staff only: password-protected, every command server-checked
 * and written to the audit log. Live payments do not exist yet; the mode shows SANDBOX.
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

function Controls({ s, onResult }: { s: PublicMatchState; onResult: (m: string) => void }) {
  const run = async (cmd: OperatorCommand, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    const r = await command(cmd);
    onResult(`${r.ok ? 'OK' : 'NG'} — ${r.message ?? cmd.command}`);
  };
  const p = s.phase;
  const pre = p === 'ATTRACT' || p === 'LOBBY';
  const live =
    p === 'COUNTDOWN' || p === 'DEPLOYMENT' || p === 'WAVE_1' || p === 'WAVE_2' || p === 'BOSS';
  const done = p === 'VICTORY' || p === 'DEFEAT' || p === 'RESULTS';
  return (
    <section className="panel sw-frame">
      <h2>MATCH CONTROL 進行</h2>
      <div className="btns">
        <button className="b" disabled={p !== 'LOBBY'} onClick={() => run({ command: 'ATTRACT' })}>
          ATTRACT
        </button>
        <button
          className="b"
          disabled={p !== 'ATTRACT'}
          onClick={() => run({ command: 'OPEN_LOBBY' })}
        >
          OPEN LOBBY
        </button>
        <button className="b primary" disabled={!pre} onClick={() => run({ command: 'START' })}>
          START 出撃
        </button>
        <button
          className="b"
          disabled={p !== 'COUNTDOWN' && p !== 'DEPLOYMENT'}
          onClick={() => run({ command: 'SKIP_DEPLOY' })}
        >
          SKIP DEPLOY
        </button>
        <button
          className="b"
          disabled={!live || s.paused}
          onClick={() => run({ command: 'PAUSE' })}
        >
          PAUSE 一時停止
        </button>
        <button className="b" disabled={!s.paused} onClick={() => run({ command: 'RESUME' })}>
          RESUME 再開
        </button>
        <button
          className="b warn"
          disabled={!live}
          onClick={() => run({ command: 'END' }, '作戦を終了しますか？ / End this match now?')}
        >
          END 終了
        </button>
        <button className="b" disabled={!done} onClick={() => run({ command: 'NEXT_ROUND' })}>
          NEXT ROUND
        </button>
        <button
          className="b danger"
          onClick={() =>
            run(
              { command: 'RESET' },
              '試合をリセットし、全席を解放しますか？ / Reset and free all seats?',
            )
          }
        >
          RESET
        </button>
      </div>
      <div className="row">
        <label className="toggle">
          <input
            type="checkbox"
            checked={s.autoSupport}
            onChange={(e) => run({ command: 'SET_AUTO_SUPPORT', enabled: e.target.checked })}
          />
          AUTO SUPPORT（空席をAIが補助）
        </label>
        <label>
          PRESET
          <select
            value={statusStore.get()?.nextPresetId ?? s.presetId}
            onChange={(e) =>
              run({ command: 'SET_PRESET', presetId: e.target.value as 'STANDARD' | 'SHORT' })
            }
          >
            <option value="STANDARD">STANDARD (210s)</option>
            <option value="SHORT">SHORT (150s)</option>
          </select>
        </label>
      </div>
    </section>
  );
}

function Seats({ s, onResult }: { s: PublicMatchState; onResult: (m: string) => void }) {
  return (
    <section className="panel sw-frame">
      <h2>SEATS 席 ({s.humans}/8)</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>SEAT</th>
            <th>PILOT</th>
            <th>STATE</th>
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
                    seat.displayName
                  ) : seat.auto ? (
                    <em>AUTO SUPPORT</em>
                  ) : (
                    <em>empty</em>
                  )}
                </td>
                <td>
                  {seat.occupied
                    ? seat.connected
                      ? seat.ready
                        ? 'READY'
                        : 'CONNECTED'
                      : 'RECONNECTING'
                    : seat.open
                      ? 'OPEN'
                      : 'PHASE 2'}
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
                        onResult(`${r.ok ? 'OK' : 'NG'} — ${r.message}`);
                      }}
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
      <h2>DISPLAY 大画面</h2>
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

function Status({ s, mt }: { s: PublicMatchState; mt: number }) {
  const st = useSyncExternalStore(statusStore.subscribe, statusStore.get, statusStore.get);
  const end = s.combatEndsAt ?? s.phaseEndsAt;
  return (
    <section className="panel sw-frame status">
      <h2>STATUS 状況</h2>
      <div className="kv">
        <div>
          <span>MODE</span>
          <b className={st?.mode === 'live' ? 'danger' : 'ally'}>
            {st?.mode === 'live' ? 'LIVE' : 'SANDBOX（架空のお金・テスト）'}
          </b>
        </div>
        <div>
          <span>MATCH</span>
          <b className="sw-num">
            #{s.matchNumber} {s.presetId}
          </b>
        </div>
        <div>
          <span>PHASE</span>
          <b>
            {PHASE_LABEL[s.phase].en} {PHASE_LABEL[s.phase].ja} {s.paused ? '(PAUSED)' : ''}
          </b>
        </div>
        <div>
          <span>TIME</span>
          <b className="sw-num">{end !== null ? formatClock(end - mt) : '--:--'}</b>
        </div>
        <div>
          <span>CORE / SYNC</span>
          <b className="sw-num">
            {percent(s.coreHp, s.coreMax)}% / {s.teamSync}%
          </b>
        </div>
        <div>
          <span>BOSS</span>
          <b className="sw-num">{s.boss ? `${s.boss.hp} / ${s.boss.maxHp}` : '—'}</b>
        </div>
        <div>
          <span>CITIES</span>
          <b>
            {CITY_IDS.map((id) => (
              <span
                key={id}
                style={{
                  marginRight: 8,
                  color: s.cities[id].lost ? 'var(--sw-danger)' : undefined,
                }}
              >
                {CITIES[id].nameJa}
                {s.cities[id].lost ? '×' : s.cities[id].hp}
              </span>
            ))}
          </b>
        </div>
        <div>
          <span>CONNECTIONS</span>
          <b className="sw-num">
            display {st?.connections.displays ?? 0} / pilots {st?.connections.pilots ?? 0} /
            operators {st?.connections.operators ?? 0}
          </b>
        </div>
      </div>
      {st ? (
        <div className="join">
          <img src="/api/public/join.svg" width={112} height={112} alt="join QR" />
          <div>
            JOIN URL
            <code>{st.joinUrl}</code>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Audit() {
  const st = useSyncExternalStore(statusStore.subscribe, statusStore.get, statusStore.get);
  return (
    <section className="panel sw-frame audit">
      <h2>AUDIT LOG 操作記録</h2>
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
          SATS WARS <span>OPERATOR</span>
        </h1>
        <span className={st.connected ? 'ok' : 'bad'}>
          {st.connected ? 'SERVER CONNECTED' : 'RECONNECTING…'}
        </span>
        {toast ? <span className="toast">{toast}</span> : null}
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
        <div className="grid">
          <Status s={s} mt={store.matchTime(now)} />
          <Controls s={s} onResult={setToast} />
          <Seats s={s} onResult={setToast} />
          <Display onResult={setToast} />
          <Audit />
        </div>
      ) : (
        <p>Waiting for match state…</p>
      )}
    </main>
  );
}
