import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  boardRequestSchema,
  cheerRequestSchema,
  profilePatchSchema,
  roleChangeSchema,
  sponsoredRedeemSchema,
  taskRequestSchema,
  taskSubmitSchema,
} from '@sats-wars/shared';
import type { PilotRow } from '../db/repo';
import { AppError } from '../errors';
import type { Services } from '../services';

export function registerPublicRoutes(app: FastifyInstance, services: Services): void {
  const { manager, pilots, passes, actions, repo, env, sessions } = services;

  const requirePilot = (req: FastifyRequest): PilotRow => {
    const auth = sessions.authenticate(req);
    if (!auth) throw new AppError('UNAUTHORIZED', 'パイロット認証が必要です / Pilot login required');
    return auth.pilot;
  };

  const health = async () => ({ ok: true });
  app.get('/health', health);
  app.get('/healthz', health);
  const ready = async (_req: FastifyRequest, reply: import('fastify').FastifyReply) => {
    let dbOk = false;
    try {
      dbOk = repo.ping();
    } catch {
      dbOk = false;
    }
    return reply.code(dbOk ? 200 : 503).send({ ok: dbOk, db: dbOk, raidId: manager.current()?.raidId ?? null, paymentMode: env.PAYMENT_MODE });
  };
  app.get('/ready', ready);
  app.get('/readyz', ready);

  // ---- raids (public read) ---------------------------------------------------------

  app.get('/api/public/current-raid', async () => ({ snapshot: manager.snapshot() }));

  app.get('/api/raids', async () => ({
    raids: repo.listRaids(20).map((r) => ({
      id: r.id,
      eventId: r.event_id,
      status: r.status,
      phase: r.phase,
      outcome: r.outcome,
      score: r.score_total,
      createdAt: r.created_at,
      endedAt: r.ended_at,
    })),
  }));

  app.get('/api/raids/:id/snapshot', async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    if (id === manager.current().raidId) return { snapshot: manager.snapshot() };
    const row = repo.getRaid(id);
    if (!row?.final_snapshot_json) throw new AppError('NOT_FOUND', 'raid not found');
    return { snapshot: JSON.parse(row.final_snapshot_json) };
  });

  app.get('/api/raids/:id/results', async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const row = id === manager.current().raidId ? null : repo.getRaid(id);
    const result = id === manager.current().raidId ? manager.current().state.result : row?.result_json ? JSON.parse(row.result_json) : null;
    if (!result) throw new AppError('NOT_FOUND', 'no result yet');
    return { raidId: id, result };
  });

  /** Same-rules leaderboard: config hash + assist flag; raids with bots excluded. */
  app.get('/api/leaderboard', async (req) => {
    const q = z.object({ configHash: z.string().max(16).optional(), assisted: z.enum(['0', '1']).optional() }).parse(req.query);
    const hash = q.configHash ?? manager.current().state.configHash;
    return {
      configHash: hash,
      assisted: q.assisted === '1',
      raids: repo.leaderboard(hash, q.assisted === '1', 20).map((r) => ({
        raidId: r.id,
        eventId: r.event_id,
        score: r.score_total,
        outcome: r.outcome,
        endedAt: r.ended_at,
        result: r.result_json ? JSON.parse(r.result_json) : null,
      })),
    };
  });

  // ---- pilot ------------------------------------------------------------------------

  app.get('/api/me', async (req) => {
    const p = requirePilot(req);
    return pilots.me(p, passes.pendingInvoice(p));
  });

  app.patch('/api/me', async (req) => {
    const p = requirePilot(req);
    return { pilot: pilots.patch(p, profilePatchSchema.parse(req.body ?? {})) };
  });

  app.get('/api/me/passport', async (req) => pilots.passport(requirePilot(req)));

  app.post('/api/me/export', async (req) => pilots.export(requirePilot(req)));

  app.delete('/api/me', async (req, reply) => {
    const p = requirePilot(req);
    pilots.delete(p);
    sessions.clearCookie(reply);
    return { ok: true };
  });

  // ---- raid actions -----------------------------------------------------------------

  app.post('/api/raids/current/board', async (req) => {
    const p = requirePilot(req);
    const { role, robot } = boardRequestSchema.parse(req.body ?? {});
    const r = actions.board(p, role, robot);
    return { pilot: r.pilot, entitlementSource: r.source };
  });

  app.post('/api/raids/current/change-role', async (req) => {
    const p = requirePilot(req);
    const { role, robot } = roleChangeSchema.parse(req.body ?? {});
    return actions.changeRole(p, role, robot);
  });

  app.post('/api/raids/current/tasks', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const p = requirePilot(req);
    return actions.requestTask(p, taskRequestSchema.parse(req.body ?? {}));
  });

  app.post('/api/raids/current/tasks/submit', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const p = requirePilot(req);
    return actions.submitTask(p, taskSubmitSchema.parse(req.body ?? {}));
  });

  app.post('/api/cheer', async (req) => {
    const p = requirePilot(req);
    const { emoji } = cheerRequestSchema.parse(req.body ?? {});
    actions.cheer(p, emoji);
    return { ok: true };
  });

  // ---- passes ---------------------------------------------------------------------------

  app.post('/api/raids/current/pass/invoice', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    return passes.createInvoice(requirePilot(req));
  });

  app.get('/api/invoices/:id/status', async (req) => {
    const p = requirePilot(req);
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    // Opportunistic re-verification (covers missing webhooks).
    const inv = repo.getInvoice(id);
    if (inv?.pilot_id === p.id && inv.status === 'PENDING') await passes.checkInvoice(inv.id);
    return passes.status(p, id);
  });

  app.post('/api/raids/current/pass/sponsored', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const p = requirePilot(req);
    const { code } = sponsoredRedeemSchema.parse(req.body ?? {});
    return passes.redeemSponsored(p, code);
  });

  if (env.PAYMENT_MODE === 'mock') {
    // Test-only virtual payment. Not registered at all in lnbits mode.
    app.post('/api/dev/mock-pay', async (req) => {
      const p = requirePilot(req);
      const { invoiceId } = z.object({ invoiceId: z.string().min(1).max(64) }).parse(req.body ?? {});
      const status = await passes.mockPay(p, invoiceId);
      return passes.status(p, invoiceId) ?? { status };
    });
  }

  /**
   * LNbits webhook. The body is only a hint: we look up our own invoice by
   * payment_hash and re-query LNbits before granting anything. Always 200 so
   * the endpoint does not leak which hashes exist.
   */
  app.post('/api/webhooks/lnbits/:secret', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { secret } = z.object({ secret: z.string().max(256) }).parse(req.params);
    if (!env.LNBITS_WEBHOOK_SECRET || secret !== env.LNBITS_WEBHOOK_SECRET) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'not found' });
    }
    const body = z
      .object({ payment_hash: z.string().regex(/^[0-9a-fA-F]{64}$/) })
      .passthrough()
      .safeParse(req.body);
    if (body.success) await passes.handleWebhook(body.data.payment_hash.toLowerCase());
    return { ok: true };
  });
}
