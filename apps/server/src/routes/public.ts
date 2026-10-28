import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  cheerRequestSchema,
  joinRequestSchema,
  nicknameChangeSchema,
  redeemPassRequestSchema,
  teamChangeSchema,
  topupRequestSchema,
  zapRequestSchema,
} from '@sats-wars/shared';
import { extractBearer } from '../auth/tokens';
import type { PlayerRow } from '../db/repo';
import { AppError } from '../errors';
import type { Services } from '../services';

export function registerPublicRoutes(app: FastifyInstance, services: Services): void {
  const { manager, players, zaps, repo, env } = services;

  const requirePlayer = (authorization: string | undefined): PlayerRow => {
    const p = players.authenticate(extractBearer(authorization));
    if (!p) throw new AppError('UNAUTHORIZED', 'プレイヤー情報が見つかりません / Unknown player');
    return p;
  };

  app.get('/health', async () => ({ ok: true }));

  app.get('/ready', async (_req, reply) => {
    let dbOk = false;
    try {
      dbOk = repo.ping();
    } catch {
      dbOk = false;
    }
    return reply.code(dbOk ? 200 : 503).send({
      ok: dbOk,
      db: dbOk,
      matchId: manager.current()?.matchId ?? null,
      paymentMode: env.PAYMENT_MODE,
    });
  });

  app.get('/api/public/current-match', async () => ({ snapshot: manager.snapshot() }));

  app.get('/api/matches', async () => ({
    matches: repo.listMatches(20).map((m) => ({
      id: m.id,
      status: m.status,
      createdAt: m.created_at,
      endedAt: m.ended_at,
      winnerTeamId: m.winner_team_id,
    })),
  }));

  app.get('/api/matches/:id/snapshot', async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    if (id === manager.current().matchId) return { snapshot: manager.snapshot() };
    const row = repo.getMatch(id);
    if (!row?.final_snapshot_json) throw new AppError('NOT_FOUND', 'match not found');
    return { snapshot: JSON.parse(row.final_snapshot_json) };
  });

  // ---- players ---------------------------------------------------------------

  app.post('/api/players', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    return players.join(joinRequestSchema.parse(req.body ?? {}));
  });

  app.get('/api/me', async (req) => players.me(requirePlayer(req.headers.authorization)));

  app.post('/api/me/team', async (req) => {
    const p = requirePlayer(req.headers.authorization);
    const { teamId } = teamChangeSchema.parse(req.body ?? {});
    players.changeTeam(p, teamId);
    return { teamId };
  });

  app.post('/api/me/nickname', async (req) => {
    const p = requirePlayer(req.headers.authorization);
    const { nickname } = nicknameChangeSchema.parse(req.body ?? {});
    return { nickname: players.changeNickname(p, nickname) };
  });

  // ---- credit -------------------------------------------------------------------

  app.post('/api/topups', async (req) => {
    const p = requirePlayer(req.headers.authorization);
    const { amountSats } = topupRequestSchema.parse(req.body ?? {});
    return players.createTopup(p, amountSats);
  });

  app.get('/api/topups/:invoiceId', async (req) => {
    const p = requirePlayer(req.headers.authorization);
    const { invoiceId } = z.object({ invoiceId: z.string().min(1).max(64) }).parse(req.params);
    // Opportunistically re-verify (covers missing webhooks).
    const inv = repo.getInvoice(invoiceId);
    if (inv?.player_id === p.id && inv.status === 'PENDING') await players.checkInvoice(inv.id);
    return players.topupStatus(p, invoiceId);
  });

  app.post('/api/codes/redeem', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const p = requirePlayer(req.headers.authorization);
    const { code } = redeemPassRequestSchema.parse(req.body ?? {});
    return players.redeemPass(p, code);
  });

  // ---- battle -------------------------------------------------------------------

  app.post('/api/zap', async (req) => {
    const p = requirePlayer(req.headers.authorization);
    return zaps.zap(p, zapRequestSchema.parse(req.body ?? {}));
  });

  app.post('/api/cheer', async (req) => {
    const p = requirePlayer(req.headers.authorization);
    const { emoji } = cheerRequestSchema.parse(req.body ?? {});
    zaps.cheer(p, emoji);
    return { ok: true };
  });

  // ---- payments -------------------------------------------------------------------

  if (env.PAYMENT_MODE === 'mock') {
    // Test-only virtual payment. Not registered at all in lnbits mode.
    app.post('/api/dev/mock-pay', async (req) => {
      const p = requirePlayer(req.headers.authorization);
      const { invoiceId } = z.object({ invoiceId: z.string().min(1).max(64) }).parse(req.body ?? {});
      const status = await players.mockPay(p, invoiceId);
      return { status, creditSats: repo.getPlayer(p.id)!.credit_sats };
    });
  }

  /**
   * LNbits webhook. The body is only a hint: we look up our own invoice by
   * payment_hash and re-query LNbits before crediting anything. Always 200 so
   * the endpoint does not leak which hashes exist.
   */
  app.post(
    '/api/webhooks/lnbits/:secret',
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { secret } = z.object({ secret: z.string().max(256) }).parse(req.params);
      if (!env.LNBITS_WEBHOOK_SECRET || secret !== env.LNBITS_WEBHOOK_SECRET) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'not found' });
      }
      const body = z
        .object({ payment_hash: z.string().regex(/^[0-9a-fA-F]{64}$/) })
        .passthrough()
        .safeParse(req.body);
      if (body.success) await players.handleWebhook(body.data.payment_hash.toLowerCase());
      return { ok: true };
    },
  );
}
