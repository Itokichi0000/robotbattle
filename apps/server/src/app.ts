import { monitorEventLoopDelay } from 'node:perf_hooks';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { GameConfig } from '@sats-wars/shared';
import { AdminAuth } from './auth/admin';
import { LnurlAuthService } from './auth/lnurl';
import { SESSION_COOKIE, SessionService, readCookie } from './auth/sessions';
import { extractBearer, sha256 } from './auth/tokens';
import { type MonoClock, type WallClock, systemMonoClock, systemWallClock } from './clock';
import { openDatabase } from './db/database';
import { Repo } from './db/repo';
import { DemoBots } from './demo/bots';
import type { Env } from './env';
import { AppError } from './errors';
import type { PaymentAdapter } from './payments/adapter';
import { LnbitsPaymentAdapter } from './payments/lnbits';
import { MockPaymentAdapter } from './payments/mock';
import { PassService } from './payments/passes';
import { PilotService } from './pilots/service';
import { RaidManager } from './raid/manager';
import { PilotActionService } from './raid/pilotActions';
import { type Realtime, createRealtime } from './realtime/socket';
import { registerAdminRoutes } from './routes/admin';
import { registerAuthRoutes } from './routes/auth';
import { registerPublicRoutes } from './routes/public';
import type { Services } from './services';

export interface BuildOptions {
  env: Env;
  mono?: MonoClock;
  wall?: WallClock;
  adapter?: PaymentAdapter;
  /** Start tick/poll timers. Tests drive time manually and pass false. */
  startLoops?: boolean;
  logger?: boolean;
  configOverrides?: Partial<GameConfig>;
}

export interface SatsWarsServer {
  app: FastifyInstance;
  services: Services;
  realtime: Realtime;
  /** Run one iteration of the background loops (used by tests). */
  step(): Promise<void>;
  close(): Promise<void>;
}

export async function buildServer(opts: BuildOptions): Promise<SatsWarsServer> {
  const { env } = opts;
  const mono = opts.mono ?? systemMonoClock;
  const wall = opts.wall ?? systemWallClock;
  const app = Fastify({
    logger: opts.logger === false ? false : { level: env.LOG_LEVEL },
    trustProxy: true,
    bodyLimit: 32 * 1024,
  });

  const isAllowedOrigin = (origin: string | undefined): boolean => {
    if (!origin) return true; // non-browser clients (curl, wallets, LNbits webhook)
    if (env.allowedOrigins.length === 0) return env.NODE_ENV !== 'production';
    return env.allowedOrigins.includes('*') || env.allowedOrigins.includes(origin);
  };

  const db = openDatabase(env.DATABASE_PATH);
  const repo = new Repo(db);
  const adapter: PaymentAdapter =
    opts.adapter ??
    (env.PAYMENT_MODE === 'lnbits'
      ? new LnbitsPaymentAdapter(env.LNBITS_URL, env.LNBITS_INVOICE_KEY)
      : new MockPaymentAdapter(wall));
  const configOverrides: Partial<GameConfig> = {
    ...(env.TICKET_PRICE_SATS !== undefined ? { ticketPriceSats: env.TICKET_PRICE_SATS } : {}),
    ...(env.RAID_SECONDS !== undefined ? { matchSeconds: env.RAID_SECONDS } : {}),
    ...opts.configOverrides,
  };
  const manager = new RaidManager({
    repo,
    mono,
    wall,
    paymentMode: adapter.mode,
    playUrl: env.playUrl,
    eventId: env.EVENT_ID,
    demoMode: env.DEMO_MODE,
    defaultPassMode: env.passMode,
    configOverrides,
  }).init();
  const webhookUrl =
    env.PAYMENT_MODE === 'lnbits' && env.SERVER_PUBLIC_URL && env.LNBITS_WEBHOOK_SECRET
      ? `${env.SERVER_PUBLIC_URL.replace(/\/+$/, '')}/api/webhooks/lnbits/${env.LNBITS_WEBHOOK_SECRET}`
      : undefined;
  const sessions = new SessionService(repo, wall, env.secureCookies);
  const pilots = new PilotService({ repo, manager, sessions, wall });
  const passes = new PassService({
    repo,
    manager,
    adapter,
    wall,
    payeeDescription: env.PAYEE_DESCRIPTION,
    webhookUrl,
    log: app.log,
  });
  const actions = new PilotActionService(repo, manager, pilots, passes, wall);
  const lnurl = new LnurlAuthService(repo, pilots, wall, env.SERVER_PUBLIC_URL);
  const bots = new DemoBots(repo, manager, wall);
  const botCount = env.DEMO_BOTS || (env.DEMO_AUTOPILOT ? 6 : 0);
  if (botCount > 0) bots.setCount(botCount, 'env', env.DEMO_BOT_SKILL);
  const adminAuth = new AdminAuth(env.ADMIN_PASSWORD, wall);
  // Careers are written once per finished raid.
  manager.onRaidEnded((state) => pilots.recordRaid(state));
  // Name consent of pilots already aboard (after a restart).
  const applyCrewPolicies = () => {
    for (const id of Object.keys(manager.current().state.pilots)) {
      const p = repo.getPilot(id);
      if (p) pilots.applyNamePolicy(p);
    }
  };
  applyCrewPolicies();
  manager.onRaidChanged(applyCrewPolicies);

  const loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();
  let lastTickAt = mono.now();
  let tickLag = 0;
  const services: Services = {
    env,
    repo,
    manager,
    sessions,
    pilots,
    passes,
    actions,
    lnurl,
    bots,
    adminAuth,
    adapter,
    mono,
    wall,
    metrics: {
      eventLoopLagMs: () => Math.round(loopDelay.mean / 1e6),
      tickLagMs: () => Math.round(tickLag),
    },
  };

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    // Venue Wi-Fi often NATs everyone to one IP, so prefer the session.
    keyGenerator: (req) => {
      const token =
        extractBearer(req.headers.authorization) ?? readCookie(req.headers.cookie, SESSION_COOKIE);
      return token ? `t:${sha256(token).slice(0, 24)}` : `ip:${req.ip}`;
    },
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'リクエストが多すぎます。少し待ってください / Too many requests',
    }),
  });

  // CSRF: a browser request authenticated by the session cookie must come
  // from an allowed origin (JSON-only API + SameSite=Lax + this check).
  app.addHook('onRequest', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    if (extractBearer(req.headers.authorization)) return;
    if (!readCookie(req.headers.cookie, SESSION_COOKIE)) return;
    const origin = req.headers.origin;
    if (!origin || !isAllowedOrigin(origin)) throw new AppError('FORBIDDEN', 'origin not allowed');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError)
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'BAD_REQUEST',
        message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({
        error: status === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST',
        message: (err as Error).message,
      });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'INTERNAL', message: 'Internal error' });
  });

  registerPublicRoutes(app, services);
  registerAuthRoutes(app, services);
  // Assigned after app.ready(); admin routes only read it at request time.
  const holder: { realtime: Realtime | null } = { realtime: null };
  registerAdminRoutes(app, services, {
    isAllowedOrigin,
    realtimeStats: () => holder.realtime!.stats(),
    onSettingsChanged: () => holder.realtime?.broadcastSnapshot(),
  });

  await app.ready();
  const realtime = createRealtime(app.server, services, isAllowedOrigin);
  holder.realtime = realtime;

  // Lobby countdown/join state change without game events: push snapshots when they flip.
  let lastShape = '';
  const tick = () => {
    const now = mono.now();
    tickLag = Math.max(0, now - lastTickAt - 100);
    lastTickAt = now;
    try {
      manager.tick();
      bots.step();
      const snap = manager.snapshot();
      const shape = `${snap.raidId}|${snap.lobbyEndsAt}|${snap.joinOpen}|${snap.broadcast?.id ?? ''}`;
      if (shape !== lastShape) {
        lastShape = shape;
        realtime.broadcastSnapshot();
      }
    } catch (err) {
      app.log.error({ err }, 'tick failed');
    }
  };
  let polling = false;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      await passes.pollPending();
    } catch (err) {
      app.log.warn({ err }, 'payment poll failed');
    } finally {
      polling = false;
    }
  };

  const timers: NodeJS.Timeout[] = [];
  if (opts.startLoops !== false) {
    timers.push(setInterval(tick, 100));
    timers.push(setInterval(() => realtime.broadcastClock(), 2000));
    timers.push(setInterval(() => realtime.broadcastPresence(), 1000));
    timers.push(setInterval(() => void poll(), 2000));
  }

  return {
    app,
    services,
    realtime,
    async step() {
      tick();
      await poll();
    },
    async close() {
      for (const t of timers) clearInterval(t);
      loopDelay.disable();
      await new Promise<void>((resolve) => realtime.io.close(() => resolve()));
      await app.close().catch(() => undefined);
      db.close();
    },
  };
}
