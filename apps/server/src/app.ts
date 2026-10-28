import { monitorEventLoopDelay } from 'node:perf_hooks';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AdminAuth } from './auth/admin';
import { extractBearer, sha256 } from './auth/tokens';
import { type MonoClock, type WallClock, systemMonoClock, systemWallClock } from './clock';
import { openDatabase } from './db/database';
import { Repo } from './db/repo';
import { DemoBots } from './demo/bots';
import type { Env } from './env';
import { AppError } from './errors';
import { ActionService } from './match/actions';
import { MatchManager } from './match/manager';
import type { PaymentAdapter } from './payments/adapter';
import { JoinService } from './payments/join';
import { LnbitsPaymentAdapter } from './payments/lnbits';
import { MockPaymentAdapter } from './payments/mock';
import { type Realtime, createRealtime } from './realtime/socket';
import { registerAdminRoutes } from './routes/admin';
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
    if (!origin) return true; // non-browser clients (curl, LNbits webhook)
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
  const configOverrides = env.LOBBY_MS !== undefined ? { lobbyMs: env.LOBBY_MS } : {};
  const manager = new MatchManager({
    repo,
    mono,
    wall,
    paymentMode: adapter.mode,
    playUrl: env.PUBLIC_PLAY_URL,
    configOverrides,
  }).init();
  const webhookUrl =
    env.PAYMENT_MODE === 'lnbits' && env.SERVER_PUBLIC_URL && env.LNBITS_WEBHOOK_SECRET
      ? `${env.SERVER_PUBLIC_URL.replace(/\/+$/, '')}/api/webhooks/lnbits/${env.LNBITS_WEBHOOK_SECRET}`
      : undefined;
  const join = new JoinService({
    repo,
    manager,
    adapter,
    wall,
    payeeDescription: env.PAYEE_DESCRIPTION,
    webhookUrl,
    log: app.log,
  });
  const actions = new ActionService(repo, manager, wall);
  const bots = new DemoBots(repo, manager, wall);
  if (env.DEMO_BOTS_PER_TEAM > 0) bots.setPerTeam(env.DEMO_BOTS_PER_TEAM, 'env');
  const adminAuth = new AdminAuth(env.ADMIN_PASSWORD, wall);

  const loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();
  let lastTickAt = mono.now();
  let tickLag = 0;
  const services: Services = {
    env,
    repo,
    manager,
    join,
    actions,
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

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    methods: ['GET', 'POST', 'PUT'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    // Venue Wi-Fi often NATs everyone to one IP, so prefer the participant token.
    keyGenerator: (req) => {
      const token = extractBearer(req.headers.authorization);
      return token ? `t:${sha256(token).slice(0, 24)}` : `ip:${req.ip}`;
    },
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'リクエストが多すぎます。少し待ってください / Too many requests',
    }),
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply
        .code(status)
        .send({ error: status === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST', message: (err as Error).message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'INTERNAL', message: 'Internal error' });
  });

  registerPublicRoutes(app, services);
  let realtime!: Realtime;
  registerAdminRoutes(app, services, {
    isAllowedOrigin,
    realtimeStats: () => realtime.stats(),
  });

  await app.ready();
  realtime = createRealtime(app.server, services, isAllowedOrigin);

  const tick = () => {
    const now = mono.now();
    tickLag = Math.max(0, now - lastTickAt - 100);
    lastTickAt = now;
    try {
      manager.tick();
      bots.step();
    } catch (err) {
      app.log.error({ err }, 'tick failed');
    }
  };
  let polling = false;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      await join.pollPending();
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
    timers.push(setInterval(() => void poll(), 2000));
    if (env.DEMO_AUTOPILOT) timers.push(setInterval(() => autopilot(services), 1000));
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

/**
 * Unattended demo loop: open the lobby when a match is created, start bots,
 * and roll to the next match 20s after the previous one finished.
 */
let finishedAt: number | null = null;
function autopilot(services: Services): void {
  const { manager, bots, wall } = services;
  const st = manager.current().state.status;
  if (bots.enabledPerTeam === 0) bots.setPerTeam(4, 'autopilot');
  if (st === 'CREATED') manager.command('OPEN_LOBBY', 'autopilot');
  if (st === 'FINISHED' || st === 'CANCELLED') {
    finishedAt ??= wall.now();
    if (wall.now() - finishedAt > 20_000) {
      finishedAt = null;
      manager.command('NEXT_MATCH', 'autopilot');
    }
  }
}
