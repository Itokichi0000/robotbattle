import type {
  CheerPush,
  RobotId,
  Role,
  SubmitResponse,
  TaskResponse,
  TaskResult,
} from '@sats-wars/shared';
import type { TaskChoice } from '@sats-wars/game-engine';
import { taskInputSchema } from '@sats-wars/shared';
import type { z } from 'zod';
import type { WallClock } from '../clock';
import type { PilotRow, Repo } from '../db/repo';
import { AppError } from '../errors';
import type { PassService } from '../payments/passes';
import type { PilotService } from '../pilots/service';
import type { RaidManager } from './manager';

type CheerListener = (cheer: CheerPush) => void;

/**
 * Everything a pilot does in a raid. The client only ever sends a seat, a
 * target choice and the raw minigame input; damage, shields, energy, SYNC and
 * scores are computed by the engine.
 */
export class PilotActionService {
  private cheerListeners = new Set<CheerListener>();
  private lastCheer = new Map<string, number>();

  constructor(
    private repo: Repo,
    private manager: RaidManager,
    private pilots: PilotService,
    private passes: PassService,
    private wall: WallClock,
  ) {}

  board(p: PilotRow, role: Role, robot?: RobotId) {
    if (this.manager.joinStopped)
      throw new AppError('JOIN_CLOSED', '現在、新規の搭乗を停止しています / Boarding is paused');
    const rt = this.manager.current();
    const already = rt.state.pilots[p.id];
    if (already)
      return { pilot: already, source: this.repo.getEntitlement(rt.raidId, p.id)?.source ?? null };
    const source = this.passes.ensureEntitled(p);
    this.pilots.applyNamePolicy(p);
    const r = rt.dispatch(
      { type: 'BOARD', pilotId: p.id, callsign: p.callsign, role, robot },
      (res) => {
        if (res.outcome.kind === 'board' && res.outcome.code === 'OK') {
          this.repo.insertPilotRaid(
            rt.raidId,
            p.id,
            role,
            res.outcome.pilot!.robot,
            this.wall.now(),
          );
        }
      },
    );
    if (r.outcome.kind !== 'board') throw new AppError('INTERNAL', 'unexpected outcome');
    switch (r.outcome.code) {
      case 'OK':
      case 'ALREADY_BOARDED':
        this.manager.invalidatePresence();
        return { pilot: r.outcome.pilot!, source };
      case 'RAID_FULL':
        throw new AppError(
          'JOIN_CLOSED',
          '満員です。次の作戦で搭乗してください（パスは次回に使えます）/ This raid is full',
        );
      default:
        throw new AppError(
          'JOIN_CLOSED',
          '今回の出撃受付は終了しました / Boarding is closed for this raid',
        );
    }
  }

  changeRole(p: PilotRow, role: Role, robot?: RobotId) {
    const r = this.manager.current().dispatch({ type: 'CHANGE_ROLE', pilotId: p.id, role, robot });
    if (r.outcome.kind !== 'role') throw new AppError('INTERNAL', 'unexpected outcome');
    if (r.outcome.code === 'NOT_BOARDED')
      throw new AppError('BAD_REQUEST', 'まだ搭乗していません / Not aboard');
    if (r.outcome.code === 'ROLE_COOLDOWN')
      throw new AppError('RATE_LIMITED', '席の変更は20秒に1回までです / Seat change cooling down');
    return { pilot: r.outcome.pilot! };
  }

  requestTask(p: PilotRow, choice: TaskChoice): TaskResponse {
    const rt = this.manager.current();
    const r = rt.dispatch({ type: 'REQUEST_TASK', pilotId: p.id, choice });
    if (r.outcome.kind !== 'task') throw new AppError('INTERNAL', 'unexpected outcome');
    return {
      code: r.outcome.code,
      task: r.outcome.task,
      cooldownUntil: r.outcome.cooldownUntil,
      gameMs: rt.state.gameMs,
    };
  }

  /** Idempotent: the same clientSubmissionId always returns the first result (no double effect). */
  submitTask(
    p: PilotRow,
    body: { taskId: string; clientSubmissionId: string; input: z.infer<typeof taskInputSchema> },
  ): SubmitResponse {
    const prior = this.repo.getSubmission(p.id, body.clientSubmissionId);
    if (prior) return { result: JSON.parse(prior.result_json) as TaskResult, duplicate: true };
    const rt = this.manager.current();
    const r = rt.dispatch(
      { type: 'SUBMIT_TASK', pilotId: p.id, taskId: body.taskId, input: body.input },
      (res) => {
        if (res.outcome.kind === 'submit') {
          this.repo.insertSubmission(
            p.id,
            body.clientSubmissionId,
            rt.raidId,
            body.taskId,
            JSON.stringify(res.outcome.result),
            this.wall.now(),
          );
        }
      },
    );
    if (r.outcome.kind !== 'submit') throw new AppError('INTERNAL', 'unexpected outcome');
    this.repo.touchPilot(p.id, this.wall.now());
    return { result: r.outcome.result, duplicate: false };
  }

  onCheer(l: CheerListener): () => void {
    this.cheerListeners.add(l);
    return () => {
      this.cheerListeners.delete(l);
    };
  }

  /** Free cheer (no pass, no wallet). Shown on the venue screen; no game effect. */
  cheer(p: PilotRow, emoji = '📣'): void {
    const now = this.wall.now();
    const cd = this.manager.current().state.config.cheerCooldownMs;
    if (now - (this.lastCheer.get(p.id) ?? 0) < cd) return;
    this.lastCheer.set(p.id, now);
    const rt = this.manager.current();
    this.pilots.applyNamePolicy(p);
    const push: CheerPush = { callsign: rt.displayName(p.id, p.callsign), emoji };
    for (const l of this.cheerListeners) l(push);
  }
}
