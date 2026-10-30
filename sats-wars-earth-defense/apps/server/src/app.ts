import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import type { HealthInfo, JoinInfo } from '@swed/shared';
import { PRESETS } from '@swed/shared';
import { operatorLoginSchema } from '@swed/shared/schemas';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { audit, openDb, type Db } from './db';
import { PROJECT_ROOT, publicBaseUrl, type Env } from './env';
import { LnbitsPaymentProvider } from './payments/lnbits';
import { SandboxPaymentProvider } from './payments/sandbox';
import { PaymentService } from './payments/service';
import { Realtime } from './realtime';
import { registerAuthRoutes } from './routes/auth';
import type { RouteContext } from './routes/context';
import { LNBITS_WEBHOOK_PATH, registerPaymentRoutes } from './routes/payments';
import { MatchRuntime } from './runtime';
import {
  cookieHeader,
  isOperatorToken,
  issueOperatorSession,
  OPERATOR_COOKIE,
  OPERATOR_COOKIE_MAX_AGE,
  parseCookies,
  passwordMatches,
  revokeOperatorSession,
} from './sessions';
import { createDevWeb, registerStaticWeb, type DevWeb, type RawHandler } from './web';

export const SERVER_VERSION = '0.1.0';

/** Request log line without the query string (k1/sig/key, webhook tokens). */
export function logRequest(req: { method: string; url: string; ip?: string }) {
  return { method: req.method, url: req.url.split('?')[0], ip: req.ip };
}

export interface BuildOptions {
  /** Monotonic clock source for the match (tests pass a manual clock). */
  source?: () => number;
  db?: Db;
  logger?: boolean;
  /** HTTP client for the payment backend (tests inject a fake LNbits). */
  fetch?: typeof fetch;
}

export interface BuiltApp {
  app: FastifyInstance;
  runtime: MatchRuntime;
  realtime: Realtime;
  db: Db;
  joinUrl: string;
  payments: PaymentService;
}

export async function buildApp(env: Env, opts: BuildOptions = {}): Promise<BuiltApp> {
  // Relative paths are relative to the project root, whichever directory started the server.
  const dbFile =
    env.DATABASE_PATH === ':memory:' ? ':memory:' : path.resolve(PROJECT_ROOT, env.DATABASE_PATH);
  const db = opts.db ?? openDb(dbFile);
  const prod = env.NODE_ENV === 'production';
  let rawHandler: RawHandler | null = null;

  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: [
              'req.headers.cookie',
              'req.headers.authorization',
              'res.headers["set-cookie"]',
            ],
            // Query strings never reach the logs: LNURL callbacks carry k1/sig/key and the
            // payment webhook carries its secret token.
            serializers: { req: logRequest },
          },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 16 * 1024,
    // Dev web apps (Vite middleware) see the raw request before Fastify's router does.
    serverFactory: (handler) =>
      createServer((req: IncomingMessage, res: ServerResponse) => {
        if (rawHandler?.(req, res, () => handler(req, res))) return;
        handler(req, res);
      }),
  });

  const base = publicBaseUrl(env);
  const baseOrigin = new URL(base).origin;
  const joinUrl = `${base}/pilot/`;

  /** Same host, the configured public origin, or an explicitly allowed origin. */
  const isOriginAllowed = (origin: string | undefined, host: string | undefined): boolean => {
    if (!origin) return true; // non-browser client: it cannot carry a victim's cookies
    const o = origin.replace(/\/$/, '');
    if (o === baseOrigin || env.allowedOrigins.includes(o)) return true;
    return !!host && (o === `http://${host}` || o === `https://${host}`);
  };

  await app.register(fastifyHelmet, {
    // Dev needs Vite's inline scripts; production gets a strict, eval-free policy.
    contentSecurityPolicy: prod
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            fontSrc: ["'self'", 'data:'],
            connectSrc: ["'self'", baseOrigin.replace(/^http/, 'ws')],
            workerSrc: ["'self'", 'blob:'],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
    hsts: prod,
  });
  await app.register(fastifyRateLimit, { global: false });

  const realtime = new Realtime(app.server, { env, db, joinUrl, isOriginAllowed, log: app.log });
  const runtime = new MatchRuntime({
    db,
    presetId: env.MATCH_PRESET,
    source: opts.source,
    seed: env.MATCH_SEED !== undefined ? () => env.MATCH_SEED! : undefined,
    log: app.log,
    hooks: {
      events: (m) => realtime.onEvents(m),
      snapshot: realtime.onSnapshot,
      matchReplaced: () => realtime.onMatchReplaced(),
    },
  });
  const webhookBase = `${base}${LNBITS_WEBHOOK_PATH}`;
  const provider =
    env.APP_MODE === 'live'
      ? new LnbitsPaymentProvider({
          url: env.LNBITS_URL!,
          invoiceKey: env.LNBITS_INVOICE_KEY!,
          fetch: opts.fetch,
        })
      : new SandboxPaymentProvider();
  const payments = new PaymentService({
    db,
    runtime,
    provider,
    recipient: env.PAYMENT_RECIPIENT_LABEL ?? 'SATS WARS SANDBOX — VIRTUAL（架空・テスト）',
    amountSats: env.PULSE_AMOUNT_SATS ?? PRESETS[env.MATCH_PRESET].pulses.amountSats,
    webhookUrl: env.APP_MODE === 'live' ? `${webhookBase}?token=${env.webhookSecret}` : undefined,
    pingUrl: `${webhookBase}/ping?token=${env.webhookSecret}`,
    notify: (pilotId, view) => realtime.notifyPayment(pilotId, view),
    log: app.log,
    fetch: opts.fetch,
  });
  realtime.bind(runtime, payments);

  const cookieOpts = (maxAgeSec: number, sameSite: 'Lax' | 'Strict') => ({
    secure: base.startsWith('https://'),
    maxAgeSec,
    sameSite,
  });

  /** CSRF: state-changing requests must come from an allowed Origin. */
  const sameOrigin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isOriginAllowed(req.headers.origin, req.headers.host)) {
      return reply.code(403).send({ error: 'FORBIDDEN_ORIGIN' });
    }
  };

  /* ---------------------------------------------------------------- public */

  app.get('/health', async (): Promise<HealthInfo> => ({
    ok: true,
    mode: env.APP_MODE,
    version: SERVER_VERSION,
    matchId: runtime.state.matchId,
    phase: runtime.state.phase,
    uptimeSec: Math.round(process.uptime()),
  }));

  app.get('/api/public/match', async () => runtime.snapshotMsg());

  const qrSvg = await QRCode.toString(joinUrl, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    color: { dark: '#050B13', light: '#E5EEF3' },
  });
  app.get('/api/public/join', async (): Promise<JoinInfo> => ({
    joinUrl,
    qrSvg,
    mode: env.APP_MODE,
  }));
  app.get('/api/public/join.svg', async (_req, reply) =>
    reply.type('image/svg+xml').header('Cache-Control', 'no-cache').send(qrSvg),
  );

  /* ------------------------------------------------- pilots and payments */

  const ctx: RouteContext = { env, db, runtime, realtime, payments, base, cookieOpts, sameOrigin };
  registerAuthRoutes(app, ctx);
  registerPaymentRoutes(app, ctx);

  /* -------------------------------------------------------------- operator */

  app.post(
    '/api/operator/login',
    { preHandler: sameOrigin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = operatorLoginSchema.safeParse(req.body);
      if (!body.success || !passwordMatches(body.data.password, env.operatorPassword)) {
        audit(db, 'operator', 'LOGIN_FAILED', `ip=${req.ip}`);
        return reply.code(401).send({ error: 'BAD_PASSWORD' });
      }
      const token = issueOperatorSession(db);
      audit(db, 'operator', 'LOGIN', `ip=${req.ip}`);
      reply.header(
        'Set-Cookie',
        cookieHeader(OPERATOR_COOKIE, token, cookieOpts(OPERATOR_COOKIE_MAX_AGE, 'Strict')),
      );
      return { ok: true };
    },
  );

  app.post('/api/operator/logout', { preHandler: sameOrigin }, async (req, reply) => {
    revokeOperatorSession(db, parseCookies(req.headers.cookie)[OPERATOR_COOKIE]);
    reply.header('Set-Cookie', cookieHeader(OPERATOR_COOKIE, '', cookieOpts(0, 'Strict')));
    return { ok: true };
  });

  app.get('/api/operator/session', async (req) => ({
    authenticated: isOperatorToken(db, parseCookies(req.headers.cookie)[OPERATOR_COOKIE]),
  }));

  /* ------------------------------------------------------------------- web */

  let devWeb: DevWeb | null = null;
  if (env.webMode === 'dev') {
    devWeb = await createDevWeb();
    rawHandler = devWeb.handler;
  } else if (env.webMode === 'static') {
    await registerStaticWeb(app);
  }
  // Strangers who type the bare domain are almost always would-be pilots.
  app.get('/', async (_req, reply) => reply.redirect('/pilot/'));

  app.addHook('onClose', async () => {
    runtime.stop();
    payments.stop();
    realtime.close();
    await devWeb?.close();
    if (!opts.db) db.close();
  });

  return { app, runtime, realtime, db, joinUrl, payments };
}
