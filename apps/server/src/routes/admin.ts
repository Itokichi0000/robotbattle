import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ROLES } from '@sats-wars/shared';
import { extractBearer } from '../auth/tokens';
import { AppError } from '../errors';
import { ADMIN_LIFECYCLE_COMMANDS } from '../raid/manager';
import type { RealtimeStats } from '../realtime/socket';
import type { Services } from '../services';

/** Fixed broadcast templates (free text is allowed but sanitised and short). */
export const BROADCAST_TEMPLATES = {
  NEXT_RAID_SOON: { ja: 'まもなく次の作戦が始まります！ QRから搭乗しよう', en: 'The next raid starts soon! Scan the QR to board' },
  BREAK: { ja: 'まもなく休憩に入ります。次の作戦は少しお待ちください', en: 'Short break soon. The next raid will follow' },
  WIFI: { ja: '会場Wi-Fiに接続してから参加してください', en: 'Please connect to the venue Wi-Fi to join' },
  MAINTENANCE: { ja: 'システム調整中です。しばらくお待ちください', en: 'Maintenance in progress, please wait' },
  LAST_RAID: { ja: '本日最後の作戦です！', en: 'Last raid of the day!' },
} as const;

// Strips markup characters, control characters and bidi/zero-width marks from staff broadcast text.
// eslint-disable-next-line no-control-regex -- control characters are exactly what we remove
const clean = (s: string) => s.normalize('NFKC').replace(/[<>&"'`\\\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E]/g, '').trim().slice(0, 80);

const commandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.enum(ADMIN_LIFECYCLE_COMMANDS), reason: z.string().max(200).optional() }),
  z.object({ command: z.literal('SET_PAYMENTS_ENABLED'), enabled: z.boolean() }),
  z.object({ command: z.literal('SET_JOIN_STOPPED'), stopped: z.boolean() }),
  z.object({ command: z.literal('SET_NAMES_HIDDEN'), hidden: z.boolean() }),
  z.object({ command: z.literal('SET_PAYMENT_INTEGRATION'), enabled: z.boolean() }),
  z.object({ command: z.literal('SET_AUTO_LOOP'), enabled: z.boolean() }),
  z.object({ command: z.literal('SET_PASS_MODE'), mode: z.enum(['FREE', 'PAID']) }),
  z.object({ command: z.literal('SET_DEMO_BOTS'), count: z.number().int().min(0).max(100), skill: z.number().min(0).max(1).optional() }),
  z.object({ command: z.literal('SET_TIME_SCALE'), speed: z.number().min(0.5).max(10) }),
  z.object({
    command: z.literal('BROADCAST'),
    template: z.enum([...(Object.keys(BROADCAST_TEMPLATES) as [keyof typeof BROADCAST_TEMPLATES]), 'CUSTOM']),
    ja: z.string().max(200).optional(),
    en: z.string().max(200).optional(),
    seconds: z.number().int().min(5).max(600).default(30),
  }),
  z.object({ command: z.literal('BROADCAST_CLEAR') }),
  /** Emergency stop: pause the raid, stop boarding and paid invoices, stop auto-loop — one click. */
  z.object({ command: z.literal('EMERGENCY_STOP') }),
]);

export function registerAdminRoutes(
  app: FastifyInstance,
  services: Services,
  deps: { isAllowedOrigin: (o: string | undefined) => boolean; realtimeStats: () => RealtimeStats; onSettingsChanged: () => void },
): void {
  const { manager, passes, repo, adminAuth, bots, wall, env, pilots } = services;

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
    const s = rt.state;
    const roles = Object.fromEntries(ROLES.map((r) => [r, Object.values(s.pilots).filter((p) => p.role === r).length]));
    return {
      snapshot: manager.snapshot(),
      settings: {
        paymentMode: env.PAYMENT_MODE,
        paymentsEnabled: manager.paymentsEnabled,
        paymentIntegration: repo.getSetting<boolean>('paymentIntegration') ?? true,
        joinStopped: manager.joinStopped,
        namesHidden: manager.namesHidden,
        autoLoop: manager.autoLoop,
        passMode: manager.passMode,
        demoMode: env.DEMO_MODE,
        authMode: env.AUTH_MODE,
        timeScale: manager.clock.speed,
        demoBots: bots.enabledCount,
        demoBotSkill: bots.skill,
        eventId: env.EVENT_ID,
      },
      crew: { total: Object.keys(s.pilots).length, bots: Object.values(s.pilots).filter((p) => p.isBot).length, roles },
      entitlements: repo.entitlementSummary(rt.raidId),
      invoices: repo.invoiceSummary(),
      sponsored: repo.sponsoredSummary(),
      realtime: deps.realtimeStats(),
      server: {
        uptimeSec: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        eventLoopLagMs: services.metrics?.eventLoopLagMs() ?? null,
        tickLagMs: services.metrics?.tickLagMs() ?? null,
      },
      nextConfig: manager.nextConfig,
      broadcastTemplates: BROADCAST_TEMPLATES,
    };
  });

  app.post('/api/admin/command', async (req) => {
    const actor = requireAdmin(req);
    const cmd = commandSchema.parse(req.body ?? {});
    switch (cmd.command) {
      case 'SET_PAYMENTS_ENABLED':
        manager.setPaymentsEnabled(cmd.enabled, actor);
        break;
      case 'SET_JOIN_STOPPED':
        manager.setJoinStopped(cmd.stopped, actor);
        break;
      case 'SET_NAMES_HIDDEN':
        manager.setNamesHidden(cmd.hidden, actor);
        break;
      case 'SET_PAYMENT_INTEGRATION':
        repo.setSetting('paymentIntegration', cmd.enabled);
        repo.audit(actor, 'SET_PAYMENT_INTEGRATION', null, { enabled: cmd.enabled }, wall.now());
        if (!cmd.enabled) manager.setPaymentsEnabled(false, actor);
        break;
      case 'SET_AUTO_LOOP':
        manager.setAutoLoop(cmd.enabled, actor);
        break;
      case 'SET_PASS_MODE':
        manager.setPassMode(cmd.mode, actor);
        break;
      case 'SET_DEMO_BOTS':
        bots.setCount(cmd.count, actor, cmd.skill);
        break;
      case 'SET_TIME_SCALE':
        manager.setSpeed(cmd.speed, actor);
        break;
      case 'BROADCAST': {
        const t = cmd.template === 'CUSTOM' ? null : BROADCAST_TEMPLATES[cmd.template];
        const ja = t ? t.ja : clean(cmd.ja ?? '');
        const en = t ? t.en : clean(cmd.en ?? '');
        if (!ja && !en) throw new AppError('BAD_REQUEST', 'message required');
        manager.setBroadcast({ id: `b${wall.now()}`, messageJa: ja || en, messageEn: en || ja, until: wall.now() + cmd.seconds * 1000 }, actor);
        break;
      }
      case 'BROADCAST_CLEAR':
        manager.setBroadcast(null, actor);
        break;
      case 'EMERGENCY_STOP': {
        manager.setPaymentsEnabled(false, actor);
        manager.setJoinStopped(true, actor);
        manager.setAutoLoop(false, actor);
        if (manager.current().state.status === 'LIVE') manager.command('PAUSE', actor, 'EMERGENCY_STOP');
        repo.audit(actor, 'EMERGENCY_STOP', manager.current().raidId, null, wall.now());
        break;
      }
      default:
        manager.command(cmd.command, actor, cmd.reason ?? 'ADMIN');
    }
    deps.onSettingsChanged();
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

  app.get('/api/admin/pilots', async (req) => {
    requireAdmin(req);
    const s = manager.current().state;
    return {
      pilots: repo.listPilots(300).map((p) => ({
        id: p.id,
        code: p.code,
        callsign: p.callsign,
        hidden: p.callsign_hidden === 1,
        showName: p.show_name === 1,
        authType: p.auth_type,
        sorties: p.sorties,
        victories: p.victories,
        passCredits: p.pass_credits,
        aboard: !!s.pilots[p.id],
        role: s.pilots[p.id]?.role ?? null,
        lastSeenAt: p.last_seen_at,
      })),
    };
  });

  app.post('/api/admin/pilots/:id/name-visibility', async (req) => {
    const actor = requireAdmin(req);
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const { hidden } = z.object({ hidden: z.boolean() }).parse(req.body ?? {});
    const p = repo.getPilot(id);
    if (!p) throw new AppError('NOT_FOUND', 'pilot not found');
    repo.updatePilot(id, { callsign_hidden: hidden ? 1 : 0 });
    pilots.applyNamePolicy(repo.getPilot(id)!);
    repo.audit(actor, hidden ? 'HIDE_NAME' : 'SHOW_NAME', id, null, wall.now());
    return { ok: true };
  });

  /** Manual pass credit (e.g. paid but could not board). Reason required, audit-logged. */
  app.post('/api/admin/pilots/:id/pass-credit', async (req) => {
    const actor = requireAdmin(req);
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const body = z.object({ delta: z.number().int().min(-10).max(10), note: z.string().min(3).max(300) }).parse(req.body ?? {});
    if (!repo.getPilot(id)) throw new AppError('NOT_FOUND', 'pilot not found');
    if (!repo.changePassCredits(id, body.delta)) throw new AppError('BAD_REQUEST', 'credits cannot go below zero');
    repo.audit(actor, 'ADJUST_PASS_CREDIT', id, { delta: body.delta, note: body.note.slice(0, 200) }, wall.now());
    return { passCredits: repo.getPilot(id)!.pass_credits };
  });

  app.get('/api/admin/invoices', async (req) => {
    requireAdmin(req);
    return {
      invoices: repo.listInvoices(200).map((i) => ({
        id: i.id,
        pilotId: i.pilot_id,
        raidId: i.raid_id,
        amountSats: i.amount_sats,
        status: i.status,
        provider: i.provider,
        createdAt: i.created_at,
        expiresAt: i.expires_at,
        verifiedAt: i.verified_at,
        entitlementGrantedAt: i.entitlement_granted_at,
        latePolicy: i.late_policy,
        checkFailures: i.check_failures,
        // Shortened hash only: enough to reconcile with LNbits, nothing more.
        paymentHashPrefix: i.payment_hash.slice(0, 12),
      })),
    };
  });

  app.post('/api/admin/invoices/:id/recheck', async (req) => {
    const actor = requireAdmin(req);
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const status = await passes.checkInvoice(id);
    repo.audit(actor, 'INVOICE_RECHECK', id, { status }, wall.now());
    return { status };
  });

  app.post('/api/admin/sponsored-passes', async (req) => {
    const actor = requireAdmin(req);
    const body = z
      .object({
        count: z.number().int().min(1).max(500),
        expiresInMinutes: z.number().int().min(5).max(7 * 24 * 60).default(12 * 60),
        label: z.string().max(60).default('sponsored'),
        currentRaidOnly: z.boolean().default(false),
      })
      .parse(req.body ?? {});
    const codes = passes.issueSponsored(body.count, body.expiresInMinutes * 60_000, clean(body.label) || 'sponsored', body.currentRaidOnly ? manager.current().raidId : null, actor);
    return { codes };
  });

  app.get('/api/admin/sponsored-passes', async (req) => {
    requireAdmin(req);
    return {
      passes: repo.listSponsoredPasses(300).map((p) => ({
        idPrefix: p.id_hash.slice(0, 10),
        label: p.label,
        raidId: p.raid_id,
        status: p.status,
        issuedAt: p.issued_at,
        expiresAt: p.expires_at,
        redeemedAt: p.redeemed_at,
      })),
    };
  });

  app.post('/api/admin/sponsored-passes/:idPrefix/revoke', async (req) => {
    const actor = requireAdmin(req);
    const { idPrefix } = z.object({ idPrefix: z.string().min(10).max(64) }).parse(req.params);
    const pass = repo.listSponsoredPasses(10_000).find((p) => p.id_hash.startsWith(idPrefix));
    if (!pass) throw new AppError('NOT_FOUND', 'pass not found');
    const ok = repo.revokeSponsoredPass(pass.id_hash);
    repo.audit(actor, 'REVOKE_SPONSORED_PASS', idPrefix, { ok }, wall.now());
    return { ok };
  });

  app.get('/api/admin/audit', async (req) => {
    requireAdmin(req);
    return { entries: repo.listAudit(200) };
  });

  app.get('/api/admin/events', async (req) => {
    requireAdmin(req);
    const { afterSeq } = z.object({ afterSeq: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    return { events: repo.loadEvents(manager.current().raidId, afterSeq, 500) };
  });
}
