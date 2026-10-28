import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  actionRequestSchema,
  invoiceRequestSchema,
  redeemPassRequestSchema,
  reserveRequestSchema,
} from '@sats-wars/shared';
import { extractBearer } from '../auth/tokens';
import type { ParticipantRow } from '../db/repo';
import { AppError } from '../errors';
import type { Services } from '../services';

export function registerPublicRoutes(app: FastifyInstance, services: Services): void {
  const { manager, join, actions, repo, env } = services;

  const requireParticipant = (authorization: string | undefined): ParticipantRow => {
    const p = join.authenticate(extractBearer(authorization));
    if (!p) throw new AppError('UNAUTHORIZED', '参加情報が見つかりません / Unknown participant');
    return p;
  };

  app.get('/health', async () => ({ ok: true }));

  app.get('/ready', async (_req, reply) => {
    const dbOk = (() => {
      try {
        return repo.ping();
      } catch {
        return false;
      }
    })();
    const ok = dbOk && !!manager.current();
    return reply.code(ok ? 200 : 503).send({
      ok,
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

  // ---- join flow ----------------------------------------------------------

  app.post(
    '/api/join/reserve',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req) => {
      const body = reserveRequestSchema.parse(req.body ?? {});
      return join.reserve(body);
    },
  );

  app.post('/api/join/invoice', async (req) => {
    const p = requireParticipant(req.headers.authorization);
    const { reservationId } = invoiceRequestSchema.parse(req.body ?? {});
    return join.createInvoice(p, reservationId);
  });

  app.get('/api/join/payment-status/:reservationId', async (req) => {
    const p = requireParticipant(req.headers.authorization);
    const { reservationId } = z
      .object({ reservationId: z.string().min(1).max(64) })
      .parse(req.params);
    const res = repo.getReservation(reservationId);
    if (!res || res.participant_id !== p.id)
      throw new AppError('NOT_FOUND', 'reservation not found');
    // Opportunistically re-verify the pending invoice (covers missing webhooks).
    const inv = repo.latestInvoiceForReservation(res.id);
    if (inv?.status === 'PENDING') await join.checkInvoice(inv.id);
    return join.paymentStatus(repo.getParticipant(p.id)!);
  });

  app.post(
    '/api/join/redeem-pass',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const p = requireParticipant(req.headers.authorization);
      const { reservationId, code } = redeemPassRequestSchema.parse(req.body ?? {});
      return join.redeemPass(p, reservationId, code);
    },
  );

  app.get('/api/me', async (req) => {
    const p = requireParticipant(req.headers.authorization);
    return join.me(p);
  });

  app.post('/api/actions', async (req) => {
    const p = requireParticipant(req.headers.authorization);
    const body = actionRequestSchema.parse(req.body ?? {});
    return actions.submit(p, body);
  });

  // ---- payments -----------------------------------------------------------

  if (env.PAYMENT_MODE === 'mock') {
    // Test-only virtual payment. Not registered at all in lnbits mode.
    app.post('/api/dev/mock-pay', async (req) => {
      const p = requireParticipant(req.headers.authorization);
      const { invoiceId } = z
        .object({ invoiceId: z.string().min(1).max(64) })
        .parse(req.body ?? {});
      const status = await join.mockPay(p, invoiceId);
      return { ...join.paymentStatus(repo.getParticipant(p.id)!), invoiceStatus: status };
    });
  }

  /**
   * LNbits webhook. The body is only a hint: we look up our own invoice by
   * payment_hash and re-query LNbits before granting anything. Always 200 so
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
      if (body.success) await join.handleWebhook(body.data.payment_hash.toLowerCase());
      return { ok: true };
    },
  );
}
