import type { ActionRequest, ActionResponse } from '@sats-wars/shared';
import type { WallClock } from '../clock';
import type { ParticipantRow, Repo } from '../db/repo';
import { AppError } from '../errors';
import { newId } from '../auth/tokens';
import type { MatchManager } from './manager';

type AckListener = (participantId: string, ack: ActionResponse) => void;

/** Per-participant sliding window limiter (AP already bounds successful actions). */
class ActionRateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}
  allow(key: string, now: number): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
  reset(): void {
    this.hits.clear();
  }
}

export class ActionService {
  private listeners = new Set<AckListener>();
  private limiter = new ActionRateLimiter(8, 10_000);

  constructor(
    private repo: Repo,
    private manager: MatchManager,
    private wall: WallClock,
  ) {
    manager.onMatchChanged(() => this.limiter.reset());
  }

  onAck(listener: AckListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  submit(p: ParticipantRow, req: ActionRequest): ActionResponse {
    const rt = this.manager.current();
    if (p.match_id !== rt.matchId) {
      throw new AppError(
        'FORBIDDEN',
        'この試合の参加者ではありません / Not a participant of the current match',
      );
    }
    if (p.status !== 'ACTIVE') {
      throw new AppError('FORBIDDEN', '参加が確定していません / Participation not confirmed yet');
    }
    const now = this.wall.now();
    if (!this.limiter.allow(p.id, now)) {
      throw new AppError(
        'RATE_LIMITED',
        '操作が多すぎます。少し待ってください / Too many requests',
      );
    }
    const r = rt.dispatch(
      {
        type: 'ACTION',
        participantId: p.id,
        clientActionId: req.clientActionId,
        actionType: req.type,
        regionId: req.type === 'CHARGE' ? null : (req.regionId ?? null),
      },
      (res) => {
        if (res.outcome.kind === 'action' && !res.outcome.result.duplicate) {
          this.repo.insertAction(
            newId('a'),
            rt.matchId,
            p.id,
            req.clientActionId,
            res.outcome.result,
            res.state.revision,
            now,
          );
        }
      },
    );
    if (r.outcome.kind !== 'action') throw new AppError('INTERNAL', 'unexpected outcome');
    const response: ActionResponse = {
      result: r.outcome.result,
      apRemaining: rt.participant(p.id)?.apRemaining ?? 0,
    };
    for (const l of this.listeners) l(p.id, response);
    return response;
  }
}
