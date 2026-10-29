import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Role, Task, TaskInput, TaskResult } from '@sats-wars/shared';
import { ROLE_LABELS, TASK_ERROR_LABELS, type TaskErrorCode } from '@sats-wars/shared';
import type { Board } from '@sats-wars/game-engine';
import { type ChoiceOption, boardFrom, choiceOptions } from '../board';
import { type ClientError, type RaidClient, newSubmissionId } from '../client';
import { type RaidLike, type RaidView, raidView } from '../view';

export interface SeatState {
  boarded: boolean;
  role: Role | null;
  cooldownUntil: number;
  roleChangeReadyAt: number;
  /** Open task (e.g. after a reload); the station resumes it. */
  task: Task | null;
}

export type MissionPhase =
  | { k: 'idle' }
  | { k: 'requesting' }
  | { k: 'playing'; task: Task; offsetMs: number }
  | { k: 'sending'; task: Task }
  | { k: 'result'; result: TaskResult; until: number }
  | { k: 'timeout'; until: number };

export type Lx = (ja: string, en: string) => string;

const tErr = (code: string, L: Lx) => {
  const l = TASK_ERROR_LABELS[code as TaskErrorCode];
  return l ? L(l.ja, l.en) : code;
};

export interface Mission {
  phase: MissionPhase;
  error: string | null;
  busy: boolean;
  live: boolean;
  board: Board;
  view: RaidView;
  options: ChoiceOption[];
  chosen: ChoiceOption | null;
  pick: (key: string) => void;
  /** Ask the server for a mission at the chosen target (出撃). */
  sortie: () => void;
  submit: (task: Task, input: TaskInput) => void;
  cooldownLeft: number;
  durationMs: number;
  /** The last result, kept until the next one (for HUD feedback). */
  lastResult: TaskResult | null;
}

/**
 * The mission lifecycle of one station, moved unchanged from the old cockpit:
 * request a task for the chosen target, resume one left open by a reload,
 * expire it locally at its deadline, send the raw input once (same
 * clientSubmissionId on retries, so the server can never apply it twice),
 * then cool down. Every effect is decided by the server.
 */
export function useMission({
  client,
  raid,
  seat,
  onSeat,
  easy,
  L,
  gameNow,
}: {
  client: RaidClient;
  raid: RaidLike;
  seat: SeatState;
  onSeat: (patch: Partial<SeatState>) => void;
  easy?: boolean;
  L: Lx;
  gameNow: number;
}): Mission {
  const [phase, setPhase] = useState<MissionPhase>({ k: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [lastResult, setLastResult] = useState<TaskResult | null>(null);
  const resumed = useRef<string | null>(null);

  const board = useMemo(() => boardFrom(raid, gameNow), [raid, gameNow]);
  const view = useMemo(() => raidView(raid, gameNow), [raid, gameNow]);
  const role = seat.role;
  const live = raid.status === 'LIVE';
  const options = useMemo(
    () => (role && live ? choiceOptions(role, board, L) : []),
    [role, board, live, L],
  );
  const chosen = options.find((o) => o.key === picked) ?? options[0] ?? null;
  const durationMs = raid.config.miniGameDurationSeconds * 1000;

  // A new seat starts with the recommendation.
  useEffect(() => setPicked(null), [role]);

  // Resume a task that was open before a reload.
  useEffect(() => {
    const t = seat.task;
    if (!t || resumed.current === t.taskId || phase.k !== 'idle') return;
    resumed.current = t.taskId;
    const offset = client.gameNow() - t.createdAt;
    if (offset < durationMs - 1500)
      setPhase({ k: 'playing', task: t, offsetMs: Math.max(0, offset) });
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

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(
          (e as ClientError).message || L('通信エラー。もう一度どうぞ', 'Network error. Try again'),
        );
      } finally {
        setBusy(false);
      }
    },
    [L],
  );

  const sortie = () =>
    void run(async () => {
      setPhase({ k: 'requesting' });
      let res;
      try {
        res = await client.requestTask({
          ...(chosen?.choice ?? {}),
          ...(easy ? { difficulty: 'EASY' as const } : {}),
        });
      } catch (e) {
        setPhase({ k: 'idle' });
        throw e;
      }
      if (res.code !== 'OK' || !res.task) {
        if (res.cooldownUntil) onSeat({ cooldownUntil: res.cooldownUntil });
        // Nothing to do in this seat right now: point at the seat the robots need.
        const needed =
          res.code === 'NO_TARGET' && view.needed !== role ? ROLE_LABELS[view.needed] : null;
        setError(
          tErr(res.code, L) +
            (needed ? L(`。いま必要なのは${needed.ja}`, `. Needed now: ${needed.en}`) : ''),
        );
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
        setLastResult(result);
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

  const cooldownLeft = Math.max(
    0,
    Math.ceil((Math.max(seat.cooldownUntil, blockedUntil) - gameNow) / 1000),
  );

  return {
    phase,
    error,
    busy,
    live,
    board,
    view,
    options,
    chosen,
    pick: setPicked,
    sortie,
    submit,
    cooldownLeft,
    durationMs,
    lastResult,
  };
}

/** Boarding and seat changes (hangar and the in-battle station menu). */
export function useSeatControl({
  client,
  raid,
  seat,
  onSeat,
  L,
  gameNow,
}: {
  client: RaidClient;
  raid: RaidLike;
  seat: SeatState;
  onSeat: (patch: Partial<SeatState>) => void;
  L: Lx;
  gameNow: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickSeat = async (r: Role) => {
    setBusy(true);
    setError(null);
    try {
      if (seat.boarded) await client.changeRole(r);
      else await client.board(r);
      onSeat({
        boarded: true,
        role: r,
        roleChangeReadyAt: client.gameNow() + raid.config.roleChangeCooldownSeconds * 1000,
      });
    } catch (e) {
      setError(
        (e as ClientError).message || L('通信エラー。もう一度どうぞ', 'Network error. Try again'),
      );
    } finally {
      setBusy(false);
    }
  };
  const seatLeft =
    raid.status === 'LIVE' ? Math.max(0, Math.ceil((seat.roleChangeReadyAt - gameNow) / 1000)) : 0;
  return { pickSeat, busy, error, seatLeft };
}
