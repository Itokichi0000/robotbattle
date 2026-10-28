import type { CheerPush, ZapRequest, ZapResponse } from '@sats-wars/shared';
import type { WallClock } from '../clock';
import type { PlayerRow, Repo } from '../db/repo';
import { AppError } from '../errors';
import { newId } from '../auth/tokens';
import { zapRowToResult } from '../payments/players';
import type { MatchManager } from './manager';

type CheerListener = (cheer: CheerPush) => void;
type CreditListener = (playerId: string, creditSats: number) => void;

/**
 * Punches and cheers.
 * A punch is: credit check -> engine ZAP -> debit, all synchronous inside one
 * DB transaction, so a rejected punch (between rounds, paused) never costs sats
 * and a retried clientActionId is answered from the stored result, uncharged.
 */
export class ZapService {
  private lastZap = new Map<string, number>();
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

  zap(p: PlayerRow, req: ZapRequest): ZapResponse {
    const done = this.repo.getZap(p.id, req.clientActionId);
    if (done) {
      return { result: zapRowToResult(done), creditSats: p.credit_sats, duplicate: true };
    }
    const rt = this.manager.current();
    const cfg = rt.state.config;
    const now = this.wall.now();
    const last = this.lastZap.get(p.id) ?? 0;
    if (now - last < cfg.zapCooldownMs) {
      throw new AppError('RATE_LIMITED', '連打が速すぎます。少しだけ待ってね / Slow down a little');
    }
    if (p.credit_sats < cfg.zapCostSats) {
      throw new AppError(
        'INSUFFICIENT_CREDIT',
        `satsが足りません（1発 ${cfg.zapCostSats} sats）。チャージしてね / Not enough sats — top up first`,
      );
    }
    this.lastZap.set(p.id, now);
    let creditSats = p.credit_sats;
    const r = rt.dispatch({ type: 'ZAP', participantId: p.id, nickname: p.nickname, teamId: p.team_id }, (res) => {
      if (res.outcome.kind !== 'zap' || !res.outcome.result.ok) return;
      const result = res.outcome.result;
      const balance = this.repo.changeCredit(p.id, -cfg.zapCostSats, 'ZAP', req.clientActionId, now);
      // Cannot happen (checked above, single-threaded); throwing rolls the punch back.
      if (balance === null) throw new AppError('INSUFFICIENT_CREDIT', 'not enough sats');
      creditSats = balance;
      this.repo.insertZap({
        id: newId('z'),
        player_id: p.id,
        match_id: rt.matchId,
        client_action_id: req.clientActionId,
        round_index: result.roundIndex,
        team_id: p.team_id,
        code: result.code,
        damage: result.damage,
        special: result.special ? 1 : 0,
        pinch: result.pinch ? 1 : 0,
        cost_sats: cfg.zapCostSats,
        at_game_ms: result.atGameMs,
        created_at: now,
      });
      this.repo.touchPlayer(p.id, now);
    });
    if (r.outcome.kind !== 'zap') throw new AppError('INTERNAL', 'unexpected outcome');
    if (r.outcome.result.ok) for (const l of this.creditListeners) l(p.id, creditSats);
    return { result: r.outcome.result, creditSats, duplicate: false };
  }

  /** Free cheer: shown on the big screen, no effect on the battle. */
  cheer(p: PlayerRow, emoji: string | undefined): void {
    const now = this.wall.now();
    const cd = this.manager.current().state.config.cheerCooldownMs;
    if (now - (this.lastCheer.get(p.id) ?? 0) < cd) {
      throw new AppError('RATE_LIMITED', '応援は1秒に1回まで / One cheer per second');
    }
    this.lastCheer.set(p.id, now);
    this.repo.touchPlayer(p.id, now);
    const nickname = p.nickname_hidden ? '匿名' : p.nickname;
    for (const l of this.cheerListeners) l({ teamId: p.team_id, nickname, emoji: emoji ?? '📣' });
  }
}
