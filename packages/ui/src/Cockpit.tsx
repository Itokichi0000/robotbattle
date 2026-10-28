import { useEffect, useMemo, useRef, useState } from 'react';
import type { Role, Task, TaskInput, TaskResult } from '@sats-wars/shared';
import { ROLES, ROLE_LABELS, TASK_ERROR_LABELS, type TaskErrorCode } from '@sats-wars/shared';
import { type ClientError, type RaidClient, newSubmissionId } from './client';
import { boardFrom, choiceOptions, resultSentence } from './board';
import { useGameNow } from './hooks';
import { Minigame } from './minigames';
import { type RaidLike, raidView } from './view';

export interface SeatState {
  boarded: boolean;
  role: Role | null;
  cooldownUntil: number;
  roleChangeReadyAt: number;
  /** Open task (e.g. after a reload); the cockpit resumes it. */
  task: Task | null;
}

export interface CockpitProps {
  client: RaidClient;
  raid: RaidLike;
  seat: SeatState;
  onSeat: (patch: Partial<SeatState>) => void;
  locale: 'ja' | 'en';
  /** Easier minigames (bigger targets). Same effect per success: fairness is kept. */
  easy?: boolean;
  /** Shown instead of the seat buttons when boarding is not possible (e.g. pass needed). */
  boardGate?: React.ReactNode;
}

type Phase =
  | { k: 'idle' }
  | { k: 'requesting' }
  | { k: 'playing'; task: Task; offsetMs: number }
  | { k: 'sending'; task: Task }
  | { k: 'result'; result: TaskResult; until: number }
  | { k: 'timeout'; until: number };

const tErr = (code: string, L: (ja: string, en: string) => string) => {
  const l = TASK_ERROR_LABELS[code as TaskErrorCode];
  return l ? L(l.ja, l.en) : code;
};

/** Seat selection: four big cards, the most needed seat is marked. */
export function SeatPicker({
  locale,
  current,
  needed,
  crew,
  disabledUntilSec,
  onPick,
  busy,
}: {
  locale: 'ja' | 'en';
  current: Role | null;
  needed: Role | null;
  crew: Record<Role, number>;
  disabledUntilSec: number;
  onPick: (r: Role) => void;
  busy?: boolean;
}) {
  const L = (ja: string, en: string) => (locale === 'ja' ? ja : en);
  return (
    <div className="swc-seats" role="group" aria-label={L('席を選ぶ', 'Choose a seat')}>
      {ROLES.map((r) => {
        const lab = ROLE_LABELS[r];
        const isCur = current === r;
        return (
          <button
            key={r}
            type="button"
            className={`swc-seat${isCur ? ' is-current' : ''}${needed === r && !isCur ? ' is-needed' : ''} swc-seat-${r.toLowerCase()}`}
            onClick={() => onPick(r)}
            disabled={busy || isCur || disabledUntilSec > 0}
            aria-pressed={isCur}
            data-testid={`seat-${r}`}
          >
            <span className="swc-seat-icon" aria-hidden="true">
              {lab.icon}
            </span>
            <span className="swc-seat-name">{L(lab.ja, lab.en)}</span>
            <span className="swc-seat-robot">{L(`操縦：${lab.robotJa}`, r === 'GUNNER' ? 'Raijin' : r === 'GUARDIAN' ? 'Fujin' : 'Both robots')}</span>
            <span className="swc-seat-do">{L(lab.doJa, lab.doEn)}</span>
            <span className="swc-seat-meta">
              {needed === r && !isCur ? <b className="swc-tag swc-tag-need">{L('いま必要！', 'Needed!')}</b> : null}
              <span>
                👥 {crew[r]}
                {L('人', '')}
              </span>
            </span>
          </button>
        );
      })}
      {disabledUntilSec > 0 && <p className="swc-note">{L(`席の変更はあと${disabledUntilSec}秒`, `Seat change in ${disabledUntilSec}s`)}</p>}
    </div>
  );
}

/**
 * The pilot cockpit: pick a seat, see what the robots need, press 出撃 to get
 * a mission, play its minigame, and read what it did. All effects are decided
 * by the server from the raw input.
 */
export function Cockpit({ client, raid, seat, onSeat, locale, easy, boardGate }: CockpitProps) {
  const L = (ja: string, en: string) => (locale === 'ja' ? ja : en);
  const gameNow = useGameNow(client.gameNow);
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const resumed = useRef<string | null>(null);

  const board = useMemo(() => boardFrom(raid, gameNow), [raid, gameNow]);
  const view = useMemo(() => raidView(raid, gameNow), [raid, gameNow]);
  const role = seat.role;
  const options = useMemo(() => (role && raid.status === 'LIVE' ? choiceOptions(role, board, L) : []), [role, board, raid.status, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = options.find((o) => o.key === picked) ?? options[0] ?? null;
  const live = raid.status === 'LIVE';
  const durationMs = raid.config.miniGameDurationSeconds * 1000;

  // Resume a task that was open before a reload.
  useEffect(() => {
    const t = seat.task;
    if (!t || resumed.current === t.taskId || phase.k !== 'idle') return;
    resumed.current = t.taskId;
    const offset = client.gameNow() - t.createdAt;
    if (offset < durationMs - 1500) setPhase({ k: 'playing', task: t, offsetMs: Math.max(0, offset) });
  }, [seat.task, phase.k, client, durationMs]);

  // Result banners and timeouts close by themselves.
  useEffect(() => {
    if (phase.k !== 'result' && phase.k !== 'timeout') return;
    const id = setTimeout(() => setPhase({ k: 'idle' }), Math.max(0, phase.until - Date.now()));
    return () => clearTimeout(id);
  }, [phase]);

  // A minigame left alone runs out: the server expires it after its deadline.
  useEffect(() => {
    if (phase.k !== 'playing') return;
    const left = durationMs - phase.offsetMs;
    const id = setTimeout(() => {
      setBlockedUntil(phase.task.deadline + 200);
      setPhase({ k: 'timeout', until: Date.now() + 1600 });
    }, left);
    return () => clearTimeout(id);
  }, [phase, durationMs]);

  // Raid ended or paused: drop any open minigame.
  useEffect(() => {
    if (!live && (phase.k === 'playing' || phase.k === 'requesting')) setPhase({ k: 'idle' });
  }, [live, phase.k]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as ClientError).message || L('通信エラー。もう一度どうぞ', 'Network error. Try again'));
    } finally {
      setBusy(false);
    }
  };

  const pickSeat = (r: Role) =>
    run(async () => {
      if (seat.boarded) await client.changeRole(r);
      else await client.board(r);
      setPicked(null);
      onSeat({ boarded: true, role: r, roleChangeReadyAt: client.gameNow() + raid.config.roleChangeCooldownSeconds * 1000 });
    });

  const sortie = () =>
    run(async () => {
      setPhase({ k: 'requesting' });
      let res;
      try {
        res = await client.requestTask({ ...(chosen?.choice ?? {}), ...(easy ? { difficulty: 'EASY' as const } : {}) });
      } catch (e) {
        setPhase({ k: 'idle' });
        throw e;
      }
      if (res.code !== 'OK' || !res.task) {
        if (res.cooldownUntil) onSeat({ cooldownUntil: res.cooldownUntil });
        setError(tErr(res.code, L));
        setPhase({ k: 'idle' });
        return;
      }
      setPhase({ k: 'playing', task: res.task, offsetMs: 0 });
    });

  const submit = (task: Task, input: TaskInput) => {
    setPhase({ k: 'sending', task });
    const id = newSubmissionId();
    const attempt = async (left: number): Promise<void> => {
      try {
        const { result } = await client.submitTask(task.taskId, input, id);
        onSeat({ cooldownUntil: result.cooldownUntil, task: null });
        if (!result.ok) setError(tErr(result.code, L));
        setPhase({ k: 'result', result, until: Date.now() + 2600 });
      } catch (e) {
        // Same clientSubmissionId: a retry can never apply the action twice.
        if (left > 0 && !(e as ClientError).status) return attempt(left - 1);
        setError((e as ClientError).message || L('送信できませんでした', 'Could not send'));
        setPhase({ k: 'idle' });
      }
    };
    void attempt(2);
  };

  const cooldownLeft = Math.max(0, Math.ceil((Math.max(seat.cooldownUntil, blockedUntil) - gameNow) / 1000));
  const seatLeft = live ? Math.max(0, Math.ceil((seat.roleChangeReadyAt - gameNow) / 1000)) : 0;

  if (!seat.boarded) {
    return (
      <section className="swc-cockpit">
        <h2 className="swc-h">{L('どの席に乗る？', 'Pick your seat')}</h2>
        {boardGate ?? <SeatPicker locale={locale} current={null} needed={live ? view.needed : null} crew={view.crewByRole} disabledUntilSec={0} onPick={pickSeat} busy={busy} />}
        {error && <p className="swc-error" role="alert">{error}</p>}
      </section>
    );
  }

  const lab = role ? ROLE_LABELS[role] : null;
  return (
    <section className={`swc-cockpit swc-cockpit-${(role ?? 'none').toLowerCase()}`}>
      {lab && (
        <header className="swc-seat-head">
          <span className="swc-seat-icon" aria-hidden="true">
            {lab.icon}
          </span>
          <div>
            <b>{L(lab.ja, lab.en)}</b> <span className="swc-muted">{L(`／${lab.robotJa}`, '')}</span>
            <div className="swc-muted">{L(lab.doJa, lab.doEn)}</div>
          </div>
        </header>
      )}

      {phase.k === 'playing' || phase.k === 'sending' ? (
        <div className="swc-mission-live" data-testid="minigame">
          <TimerBar startedAt={phase.k === 'playing' ? phase.offsetMs : 0} durationMs={durationMs} running={phase.k === 'playing'} />
          <Minigame key={phase.task.taskId} task={phase.task} locale={locale} offsetMs={phase.k === 'playing' ? phase.offsetMs : 0} onSubmit={(input) => submit(phase.task, input)} disabled={phase.k === 'sending'} />
          {phase.k === 'sending' && <p className="swc-muted">{L('送信中…', 'Sending…')}</p>}
        </div>
      ) : (
        <>
          {phase.k === 'result' && (
            <p className={`swc-result${phase.result.success >= 0.6 ? ' is-good' : phase.result.success > 0 ? ' is-ok' : ' is-miss'}`} role="status" data-testid="task-result">
              {resultSentence(phase.result, L)}
            </p>
          )}
          {phase.k === 'timeout' && (
            <p className="swc-result is-miss" role="status">
              {L('時間切れ！ 次はすばやく', 'Time up! Be quicker next time')}
            </p>
          )}
          {!live ? (
            <p className="swc-wait" data-testid="cockpit-wait">
              {raid.status === 'LOBBY_OPEN' || raid.status === 'CREATED'
                ? L('まもなく出撃。席はいつでも変えられます', 'Launching soon. You can still change seats')
                : raid.status === 'PAUSED'
                  ? L('一時停止中。そのまま待ってね', 'Paused. Please wait')
                  : L('作戦終了。大画面を見てね', 'Mission over. Look at the big screen')}
            </p>
          ) : (
            <>
              {options.length > 0 && (
                <div className="swc-choices" role="radiogroup" aria-label={L('ねらい', 'Target')}>
                  {options.map((o, i) => (
                    <button
                      key={o.key}
                      type="button"
                      role="radio"
                      aria-checked={chosen?.key === o.key}
                      className={`swc-chip${chosen?.key === o.key ? ' is-on' : ''}${o.danger ? ' is-danger' : ''}`}
                      onClick={() => setPicked(o.key)}
                    >
                      <span>{o.label}</span>
                      {o.hint && <small>{o.hint}</small>}
                      {i === 0 && <em className="swc-tag">{L('おすすめ', 'Best')}</em>}
                    </button>
                  ))}
                </div>
              )}
              <button type="button" className="swc-big-btn swc-sortie" onClick={sortie} disabled={busy || cooldownLeft > 0 || phase.k === 'requesting'} data-testid="sortie">
                {cooldownLeft > 0 ? L(`次の出撃まで ${cooldownLeft}`, `Next sortie in ${cooldownLeft}`) : L('出撃！', 'SORTIE!')}
              </button>
            </>
          )}
        </>
      )}
      {error && phase.k !== 'playing' && (
        <p className="swc-error" role="alert">
          {error}
        </p>
      )}

      {phase.k !== 'playing' && phase.k !== 'sending' && (
        <details className="swc-change-seat">
          <summary>{L('席を変える', 'Change seat')}</summary>
          <SeatPicker locale={locale} current={role} needed={live ? view.needed : null} crew={view.crewByRole} disabledUntilSec={seatLeft} onPick={pickSeat} busy={busy} />
        </details>
      )}
    </section>
  );
}

function TimerBar({ startedAt, durationMs, running }: { startedAt: number; durationMs: number; running: boolean }) {
  // CSS animation: no per-frame React work for a simple countdown.
  return (
    <div className="swc-timer" aria-hidden="true">
      <div
        className="swc-timer-fill"
        style={{ animationDuration: `${durationMs}ms`, animationDelay: `-${startedAt}ms`, animationPlayState: running ? 'running' : 'paused' }}
      />
    </div>
  );
}
