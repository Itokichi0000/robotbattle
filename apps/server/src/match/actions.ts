import type { ActionRequest, ActionResponse, CheerPush } from '@sats-wars/shared';
import type { WallClock } from '../clock';
import type { PlayerRow, Repo } from '../db/repo';
import { AppError } from '../errors';
import { newId } from '../auth/tokens';
import { actionRowToResult } from '../payments/players';
import type { MatchManager } from './manager';

type CheerListener = (cheer: CheerPush) => void;
type CreditListener = (playerId: string, creditSats: number) => void;

/**
 * Paid actions and free cheers.
 * An action is: credit check -> engine ACT -> debit, all synchronous inside one
 * DB transaction, so a refused action (no target, paused) never costs sats and
 * a retried clientActionId is answered from the stored result, uncharged.
 */
export class ActionService {
  private lastAction = new Map<string, number>();
  private lastCheer = new Map<string, number>();
  private cheerListeners = new Set<CheerListener>();
  private creditListeners = new Set<CreditListener>();

  constructor(
    private repo: Repo,
    private manager: MatchManager,
    private wall: WallClock,
  ) {}

  onCheer(l: CheerListener): () => void {
    this.cheerListeners.add(l);
    return () => {
      this.cheerListeners.delete(l);
    };
  }

  onCredit(l: CreditListener): () => void {
    this.creditListeners.add(l);
    return () => {
      this.creditListeners.delete(l);
    };
  }

  act(p: PlayerRow, req: ActionRequest): ActionResponse {
    const done = this.repo.getAction(p.id, req.clientActionId);
    if (done) return { result: actionRowToResult(done), creditSats: p.credit_sats, duplicate: true };
    const rt = this.manager.current();
    const cfg = rt.state.config;
    const now = this.wall.now();
    if (now - (this.lastAction.get(p.id) ?? 0) < cfg.actionCooldownMs) {
      throw new AppError('RATE_LIMITED', '少しだけ待ってね / Slow down a little');
    }
    if (p.credit_sats < cfg.actionCostSats) {
      throw new AppError(
        'INSUFFICIENT_CREDIT',
        `satsが足りません（1回 ${cfg.actionCostSats} sats）。チャージしてね / Not enough sats — top up first`,
      );
    }
    this.lastAction.set(p.id, now);
    let creditSats = p.credit_sats;
    const r = rt.dispatch(
      { type: 'ACT', participantId: p.id, nickname: p.nickname, action: req.action, regionId: req.regionId, enemyId: req.enemyId },
      (res) => {
        if (res.outcome.kind !== 'action' || !res.outcome.result.ok) return;
        const result = res.outcome.result;
        const balance = this.repo.changeCredit(p.id, -cfg.actionCostSats, 'ACTION', req.clientActionId, now);
        // Cannot happen (checked above, single-threaded); throwing rolls the action back.
        if (balance === null) throw new AppError('INSUFFICIENT_CREDIT', 'not enough sats');
        creditSats = balance;
        this.repo.insertAction({
          id: newId('a'),
          player_id: p.id,
          match_id: rt.matchId,
          client_action_id: req.clientActionId,
          action: result.action!,
          region_id: result.regionId,
          damage: result.damage,
          kills: result.kills,
          liberated: result.liberated ? 1 : 0,
          cost_sats: cfg.actionCostSats,
          at_game_ms: result.atGameMs,
          created_at: now,
        });
        this.repo.touchPlayer(p.id, now);
      },
    );
    if (r.outcome.kind !== 'action') throw new AppError('INTERNAL', 'unexpected outcome');
    if (r.outcome.result.ok) for (const l of this.creditListeners) l(p.id, creditSats);
    return { result: r.outcome.result, creditSats, duplicate: false };
  }

  /** Free cheer: shown on the big screen, no effect on the game. */
  cheer(p: PlayerRow, emoji: string | undefined): void {
    const now = this.wall.now();
    const cd = this.manager.current().state.config.cheerCooldownMs;
    if (now - (this.lastCheer.get(p.id) ?? 0) < cd) {
      throw new AppError('RATE_LIMITED', '応援は1秒に1回まで / One cheer per second');
    }
    this.lastCheer.set(p.id, now);
    this.repo.touchPlayer(p.id, now);
    const nickname = p.nickname_hidden ? '匿名' : p.nickname;
    for (const l of this.cheerListeners) l({ nickname, emoji: emoji ?? '📣' });
  }
}
