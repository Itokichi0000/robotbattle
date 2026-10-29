import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  boardRequestSchema,
  nextRaidSettingsSchema,
  roleChangeSchema,
  sponsoredRedeemSchema,
  taskRequestSchema,
  taskSubmitSchema,
} from '@sats-wars/shared';
import { extractBearer } from '../auth/tokens';
import { AppError } from '../errors';
import type { AdminLifecycleCommand } from '../raid/manager';
import type { RealtimeStats } from '../realtime/socket';
import type { Services } from '../services';

/**
 * The HTTP contract of the spec (F5) on top of the venue's "current raid"
 * routes: the same handlers, addressed by raid id. A request for any raid but
 * the running one answers 409 NO_RAID (one venue runs one raid at a time).
 * docs/API.md lists both forms.
 */
export function registerSpecAliases(
  app: FastifyInstance,
  services: Services,
  deps: {
    isAllowedOrigin: (o: string | undefined) => boolean;
    realtimeStats: () => RealtimeStats;
    onSettingsChanged: () => void;
  },
): void {
  const { manager, sessions, actions, passes, pilots, adminAuth, repo, wall, env } = services;
  const idParam = z.object({ id: z.string().min(1).max(64) });

  const requirePilot = (req: FastifyRequest) => {
    const auth = sessions.authenticate(req);
    if (!auth)
      throw new AppError('UNAUTHORIZED', 'パイロット認証が必要です / Pilot login required');
    return auth.pilot;
  };
  const current = (req: FastifyRequest) => {
    const { id } = idParam.parse(req.params);
    if (id !== manager.current().raidId)
      throw new AppError('NO_RAID', 'この作戦は現在の作戦ではありません / Not the running raid');
    return id;
  };
  const requireAdmin = (req: FastifyRequest): string => {
    const origin = req.headers.origin;
    if (origin && !deps.isAllowedOrigin(origin))
      throw new AppError('FORBIDDEN', 'origin not allowed');
    const session = adminAuth.verify(extractBearer(req.headers.authorization));
    if (!session) throw new AppError('UNAUTHORIZED', 'admin login required');
    return session.actor;
  };

  // ---- public / pilot ------------------------------------------------------------

  app.get('/api/raids/:id/status', async (req) => {
    const { id } = idParam.parse(req.params);
    const snap = manager.snapshot();
    if (id === snap.raidId) {
      return {
        raidId: id,
        current: true,
        status: snap.status,
        phase: snap.phase,
        gameMs: snap.gameMs,
        timeLeftMs: Math.max(0, snap.config.matchSeconds * 1000 - snap.gameMs),
        joinOpen: snap.joinOpen,
        joinClosesAtGameMs: snap.config.cutoffForPaidJoinAtSeconds * 1000,
        passMode: snap.passMode,
        ticketPriceSats: snap.ticketPriceSats,
        paymentsEnabled: snap.paymentsEnabled,
        pilotsAboard: snap.crew.length,
        maxPilots: snap.config.maxPilots,
      };
    }
    const row = repo.getRaid(id);
    if (!row) throw new AppError('NOT_FOUND', 'raid not found');
    return {
      raidId: id,
      current: false,
      status: row.status,
      outcome: row.outcome,
      endedAt: row.ended_at,
    };
  });

  /**
   * "Reserve" = a dry run of boarding: can this pilot join this raid now, until
   * when, and what pass applies. Nothing is held (passes are per raid and
   * boarding is instant), so there is nothing to expire.
   */
  app.post('/api/raids/:id/join/reserve', async (req) => {
    const p = requirePilot(req);
    current(req);
    const snap = manager.snapshot();
    const ent = repo.getEntitlement(snap.raidId, p.id);
    return {
      raidId: snap.raidId,
      joinOpen: snap.joinOpen,
      joinClosesAtGameMs: snap.config.cutoffForPaidJoinAtSeconds * 1000,
      passMode: snap.passMode,
      ticketPriceSats: snap.ticketPriceSats,
      entitled: !!ent,
      entitlementSource: ent?.source ?? null,
      passCredits: p.pass_credits,
    };
  });
  app.post('/api/raids/:id/join/invoice', async (req) => {
    current(req);
    return passes.createInvoice(requirePilot(req));
  });
  app.post('/api/raids/:id/join/sponsored', async (req) => {
    current(req);
    const p = requirePilot(req);
    return passes.redeemSponsored(p, sponsoredRedeemSchema.parse(req.body ?? {}).code);
  });
  app.post('/api/raids/:id/board', async (req) => {
    current(req);
    const p = requirePilot(req);
    const { role, robot } = boardRequestSchema.parse(req.body ?? {});
    const r = actions.board(p, role, robot);
    return { pilot: r.pilot, entitlementSource: r.source };
  });
  app.post('/api/raids/:id/change-role', async (req) => {
    current(req);
    const p = requirePilot(req);
    const { role, robot } = roleChangeSchema.parse(req.body ?? {});
    return actions.changeRole(p, role, robot);
  });
  /** The pilot's open mission (parameters are private to that pilot). */
  app.get('/api/raids/:id/tasks', async (req) => {
    current(req);
    const p = requirePilot(req);
    const seat = pilots.me(p, null).seat;
    return { task: seat.task, cooldownUntil: seat.cooldownUntil };
  });
  app.post(
    '/api/raids/:id/tasks',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req) => {
      current(req);
      return actions.requestTask(requirePilot(req), taskRequestSchema.parse(req.body ?? {}));
    },
  );
  app.post(
    '/api/raids/:id/tasks/:taskId/submit',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req) => {
      current(req);
      const { taskId } = z.object({ taskId: z.string().min(1).max(80) }).parse(req.params);
      const body = (req.body ?? {}) as Record<string, unknown>;
      return actions.submitTask(requirePilot(req), taskSubmitSchema.parse({ ...body, taskId }));
    },
  );
  /** Linking another wallet = Lightning login with purpose LINK (needs the current session). */
  app.post('/api/me/link-wallet/start', async (req, reply) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/lightning/start',
      headers: {
        ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        ...(req.headers.origin ? { origin: req.headers.origin } : {}),
      },
      payload: { purpose: 'LINK' },
    });
    const cookie = res.headers['set-cookie'];
    if (cookie) void reply.header('set-cookie', cookie);
    return reply.code(res.statusCode).send(res.json());
  });

  // ---- operators ---------------------------------------------------------------------

  app.get('/api/admin/raids', async (req) => {
    requireAdmin(req);
    return {
      current: manager.current().raidId,
      raids: repo.listRaids(50).map((r) => ({
        raidId: r.id,
        eventId: r.event_id,
        status: r.status,
        phase: r.phase,
        configHash: r.config_hash,
        outcome: r.outcome,
        score: r.score_total,
        bots: r.bots > 0,
        startedAt: r.started_at,
        endedAt: r.ended_at,
      })),
    };
  });
  /** Create the next raid: optional settings (preset, price, event…), then NEXT_RAID. */
  app.post('/api/admin/raids', async (req) => {
    const actor = requireAdmin(req);
    const settings = nextRaidSettingsSchema.parse(req.body ?? {});
    manager.setNextRaid(settings, actor);
    manager.command('NEXT_RAID', actor);
    deps.onSettingsChanged();
    return { raidId: manager.current().raidId, snapshot: manager.snapshot() };
  });
  const lifecycle: Array<[string, AdminLifecycleCommand]> = [
    ['lobby/open', 'OPEN_LOBBY'],
    ['start', 'START'],
    ['pause', 'PAUSE'],
    ['resume', 'RESUME'],
    ['end', 'END'],
    ['cancel', 'CANCEL'],
  ];
  for (const [path, command] of lifecycle)
    app.post(`/api/admin/raids/:id/${path}`, async (req) => {
      const actor = requireAdmin(req);
      current(req);
      const { reason } = z.object({ reason: z.string().max(200).optional() }).parse(req.body ?? {});
      manager.command(command, actor, reason ?? 'ADMIN');
      deps.onSettingsChanged();
      return { ok: true, snapshot: manager.snapshot() };
    });
  /** Same as the command endpoint's EMERGENCY_STOP / BROADCAST (spec names). */
  app.post('/api/admin/emergency-stop', async (req) => forward(req, { command: 'EMERGENCY_STOP' }));
  app.post('/api/admin/broadcast', async (req) =>
    forward(req, { command: 'BROADCAST', ...((req.body as object) ?? {}) }),
  );
  async function forward(req: FastifyRequest, body: Record<string, unknown>) {
    requireAdmin(req);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/command',
      headers: {
        authorization: req.headers.authorization ?? '',
        ...(req.headers.origin ? { origin: req.headers.origin } : {}),
      },
      payload: body,
    });
    if (res.statusCode !== 200) {
      const j = res.json() as { error?: string; message?: string };
      throw new AppError((j.error as never) ?? 'BAD_REQUEST', j.message ?? 'failed');
    }
    return res.json();
  }
  /** Live operations metrics (spec E4 画面): crew, seats, devices, latency, payments. */
  app.get('/api/admin/metrics', async (req) => {
    requireAdmin(req);
    const s = manager.current().state;
    const pilotsList = Object.values(s.pilots);
    return {
      at: wall.now(),
      raid: {
        raidId: s.raidId,
        status: s.status,
        phase: s.phase,
        gameMs: s.gameMs,
        lastSeq: s.seq,
        bossHp: s.enemies.find((e) => e.id === s.bossId)?.hp ?? null,
        citiesStanding: Object.values(s.cities).filter((c) => !c.destroyed).length,
        sync: s.sync,
      },
      crew: {
        total: pilotsList.length,
        bots: pilotsList.filter((p) => p.isBot).length,
        roles: Object.fromEntries(
          ['GUNNER', 'GUARDIAN', 'ROUTER', 'ENGINEER'].map((r) => [
            r,
            pilotsList.filter((p) => p.role === r).length,
          ]),
        ),
      },
      realtime: deps.realtimeStats(),
      payments: {
        mode: env.PAYMENT_MODE,
        invoices: repo.invoiceSummary(),
        entitlements: repo.entitlementSummary(s.raidId),
        sponsored: repo.sponsoredSummary(),
      },
      server: {
        uptimeSec: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        eventLoopLagMs: services.metrics?.eventLoopLagMs() ?? null,
        tickLagMs: services.metrics?.tickLagMs() ?? null,
      },
    };
  });
}
