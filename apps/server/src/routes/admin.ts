import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { extractBearer } from '../auth/tokens';
import { AppError } from '../errors';
import { ADMIN_LIFECYCLE_COMMANDS } from '../match/manager';
import type { RealtimeStats } from '../realtime/socket';
import type { Services } from '../services';

const commandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.enum(ADMIN_LIFECYCLE_COMMANDS), reason: z.string().max(200).optional() }),
  z.object({ command: z.literal('SET_PAYMENTS_ENABLED'), enabled: z.boolean() }),
  z.object({ command: z.literal('SET_DEMO_BOTS'), perTeam: z.number().int().min(0).max(200) }),
  /** Emergency stop: pause the match AND stop accepting payments in one click. */
  z.object({ command: z.literal('EMERGENCY_STOP') }),
]);

export function registerAdminRoutes(
  app: FastifyInstance,
  services: Services,
  deps: { isAllowedOrigin: (o: string | undefined) => boolean; realtimeStats: () => RealtimeStats },
): void {
  const { manager, join, repo, adminAuth, bots, wall, env } = services;

  const requireAdmin = (req: FastifyRequest): string => {
    const origin = req.headers.origin;
    if (origin && !deps.isAllowedOrigin(origin)) throw new AppError('FORBIDDEN', 'origin not allowed');
    const session = adminAuth.verify(extractBearer(req.headers.authorization));
    if (!session) throw new AppError('UNAUTHORIZED', 'admin login required');
    return session.actor;
  };

  app.post('/api/admin/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const origin = req.headers.origin;
    if (origin && !deps.isAllowedOrigin(origin)) throw new AppError('FORBIDDEN', 'origin not allowed');
    const { password } = z.object({ password: z.string().min(1).max(256) }).parse(req.body ?? {});
    const token = adminAuth.login(password);
    repo.audit('admin', token ? 'LOGIN' : 'LOGIN_FAILED', null, { ip: req.ip.replace(/\d+$/, 'x') }, wall.now());
    if (!token) throw new AppError('UNAUTHORIZED', 'パスワードが違います / Wrong password');
    return { token };
  });

  app.post('/api/admin/logout', async (req) => {
    adminAuth.logout(extractBearer(req.headers.authorization));
    return { ok: true };
  });

  app.get('/api/admin/overview', async (req) => {
    requireAdmin(req);
    const rt = manager.current();
    const participants = repo.listParticipants(rt.matchId);
    const byStatus: Record<string, number> = {};
    for (const p of participants) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    return {
      snapshot: manager.snapshot(),
      paymentMode: env.PAYMENT_MODE,
      paymentsEnabled: manager.paymentsEnabled,
      demoBotsPerTeam: bots.enabledPerTeam,
      participantsByStatus: byStatus,
      invoices: { currentMatch: repo.invoiceSummary(rt.matchId), allTime: repo.invoiceSummary(null) },
      passes: repo.passSummary(),
      actions: repo.actionCounts(rt.matchId),
      realtime: deps.realtimeStats(),
      server: {
        uptimeSec: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        eventLoopLagMs: services.metrics?.eventLoopLagMs() ?? null,
        tickLagMs: services.metrics?.tickLagMs() ?? null,
      },
      nextConfig: manager.nextConfig,
    };
  });

  app.post('/api/admin/command', async (req) => {
    const actor = requireAdmin(req);
    const cmd = commandSchema.parse(req.body ?? {});
    switch (cmd.command) {
      case 'SET_PAYMENTS_ENABLED':
        manager.setPaymentsEnabled(cmd.enabled, actor);
        break;
      case 'SET_DEMO_BOTS':
        bots.setPerTeam(cmd.perTeam, actor);
        break;
      case 'EMERGENCY_STOP': {
        manager.setPaymentsEnabled(false, actor);
        const st = manager.current().state.status;
        if (st === 'LOBBY' || st === 'LIVE' || st === 'FINALIZING') manager.command('PAUSE', actor, 'EMERGENCY_STOP');
        repo.audit(actor, 'EMERGENCY_STOP', manager.current().matchId, null, wall.now());
        break;
      }
      default:
        manager.command(cmd.command, actor, cmd.reason ?? 'ADMIN');
    }
    return { ok: true, snapshot: manager.snapshot() };
  });

  app.get('/api/admin/next-config', async (req) => {
    requireAdmin(req);
    return { config: manager.nextConfig };
  });

  app.put('/api/admin/next-config', async (req) => {
    const actor = requireAdmin(req);
    const body = z.object({ config: z.unknown() }).parse(req.body ?? {});
    return { config: manager.setNextConfig(body.config, actor) };
  });

  app.get('/api/admin/participants', async (req) => {
    requireAdmin(req);
    const rt = manager.current();
    return {
      participants: repo.listParticipants(rt.matchId).map((p) => ({
        id: p.id,
        teamId: p.team_id,
        nickname: p.nickname_sanitized,
        nicknameHidden: p.nickname_hidden === 1,
        source: p.source,
        status: p.status,
        joinedAt: p.joined_at,
        apRemaining: rt.participant(p.id)?.apRemaining ?? 0,
        apTotal: p.ap_total,
      })),
    };
  });

  app.post('/api/admin/participants/:id/nickname-visibility', async (req) => {
    const actor = requireAdmin(req);
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const { hidden } = z.object({ hidden: z.boolean() }).parse(req.body ?? {});
    const p = repo.getParticipant(id);
    if (!p) throw new AppError('NOT_FOUND', 'participant not found');
    repo.setNicknameHidden(id, hidden);
    manager.current().setNicknameHidden(id, hidden);
    repo.audit(actor, hidden ? 'HIDE_NICKNAME' : 'SHOW_NICKNAME', id, null, wall.now());
    return { ok: true };
  });

  app.get('/api/admin/invoices', async (req) => {
    requireAdmin(req);
    return {
      invoices: repo.listInvoices(null, 200).map((i) => ({
        id: i.id,
        matchId: i.match_id,
        participantId: i.participant_id,
        amountSats: i.amount_sats,
        status: i.status,
        provider: i.provider,
        createdAt: i.created_at,
        expiresAt: i.expires_at,
        verifiedAt: i.verified_at,
        fulfillmentAt: i.fulfillment_at,
        checkFailures: i.check_failures,
        lateDisposition: i.late_payment_disposition,
        lateNote: i.late_payment_note,
        // Shortened hash only: enough to reconcile with LNbits, nothing more.
        paymentHashPrefix: i.payment_hash.slice(0, 12),
      })),
    };
  });

  app.post('/api/admin/invoices/:id/recheck', async (req) => {
    const actor = requireAdmin(req);
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const status = await join.checkInvoice(id);
    repo.audit(actor, 'INVOICE_RECHECK', id, { status }, wall.now());
    return { status };
  });

  app.post('/api/admin/invoices/:id/disposition', async (req) => {
    const actor = requireAdmin(req);
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const body = z
      .object({ disposition: z.enum(['CARRY_OVER', 'REFUND_REQUESTED', 'RESOLVED']), note: z.string().max(500).default('') })
      .parse(req.body ?? {});
    const inv = join.setLateDisposition(id, body.disposition, body.note, actor);
    return { ok: true, disposition: inv.late_payment_disposition };
  });

  app.post('/api/admin/passes', async (req) => {
    const actor = requireAdmin(req);
    const body = z
      .object({
        count: z.number().int().min(1).max(200),
        expiresInMinutes: z.number().int().min(5).max(7 * 24 * 60).default(180),
        label: z.string().max(60).default('sponsored'),
        currentMatchOnly: z.boolean().default(false),
      })
      .parse(req.body ?? {});
    const codes = join.issuePasses(
      body.count,
      body.expiresInMinutes * 60_000,
      body.label,
      actor,
      body.currentMatchOnly ? manager.current().matchId : null,
    );
    return { codes };
  });

  app.get('/api/admin/passes', async (req) => {
    requireAdmin(req);
    return {
      passes: repo.listPasses(200).map((p) => ({
        idPrefix: p.id_hash.slice(0, 10),
        label: p.label,
        kind: p.kind,
        status: p.status,
        issuedAt: p.issued_at,
        expiresAt: p.expires_at,
        redeemedAt: p.redeemed_at,
        matchId: p.match_id,
      })),
    };
  });

  app.post('/api/admin/passes/:idPrefix/revoke', async (req) => {
    const actor = requireAdmin(req);
    const { idPrefix } = z.object({ idPrefix: z.string().min(10).max(64) }).parse(req.params);
    const pass = repo.listPasses(10_000).find((p) => p.id_hash.startsWith(idPrefix));
    if (!pass) throw new AppError('NOT_FOUND', 'pass not found');
    const ok = repo.revokePass(pass.id_hash);
    repo.audit(actor, 'REVOKE_PASS', idPrefix, { ok }, wall.now());
    return { ok };
  });

  app.get('/api/admin/audit', async (req) => {
    requireAdmin(req);
    return { entries: repo.listAudit(200) };
  });

  app.get('/api/admin/events', async (req) => {
    requireAdmin(req);
    const { afterSeq } = z.object({ afterSeq: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    return { events: repo.loadEvents(manager.current().matchId, afterSeq, 500) };
  });
}
