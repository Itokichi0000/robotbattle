import { timingSafeEqual } from 'node:crypto';
import { pulseIntentReqSchema } from '@swed/shared/schemas';
import type { PaymentIntentView } from '@swed/shared';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { parseCookies, perBrowserKey, PILOT_COOKIE, pilotForToken } from '../sessions';
import type { RouteContext } from './context';

export const LNBITS_WEBHOOK_PATH = '/api/payments/webhook/lnbits';

function tokenOk(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

async function withQr(view: PaymentIntentView): Promise<PaymentIntentView> {
  if (view.mode !== 'live' || !view.paymentRequest) return { ...view, qrSvg: null };
  const qrSvg = await QRCode.toString(`lightning:${view.paymentRequest}`.toUpperCase(), {
    type: 'svg',
    margin: 2,
    errorCorrectionLevel: 'L',
  });
  return { ...view, qrSvg };
}

/** Lightning actions (spec §8, §11.5). The phone may only see and create its own intents. */
export function registerPaymentRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { db, payments, env, sameOrigin } = ctx;
  const pilotOf = (cookie: string | undefined) =>
    pilotForToken(db, parseCookies(cookie)[PILOT_COOKIE]);

  app.get('/api/payments/quote', async (req, reply) => {
    const pilot = pilotOf(req.headers.cookie);
    if (!pilot) return reply.code(401).send({ error: 'NOT_AUTHENTICATED' });
    return payments.quote(pilot);
  });

  app.post(
    '/api/payments/intent',
    {
      preHandler: sameOrigin,
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: perBrowserKey(PILOT_COOKIE) },
      },
    },
    async (req, reply) => {
      const pilot = pilotOf(req.headers.cookie);
      if (!pilot) return reply.code(401).send({ error: 'NOT_AUTHENTICATED' });
      const body = pulseIntentReqSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'INVALID' });
      const r = await payments.createIntent(pilot, body.data.matchId, body.data.action);
      if (!r.ok)
        return reply.code(409).send({ error: r.code, retryAfterMs: r.retryAfterMs ?? null });
      return withQr(r.intent);
    },
  );

  app.get<{ Params: { id: string } }>('/api/payments/intent/:id', async (req, reply) => {
    const pilot = pilotOf(req.headers.cookie);
    if (!pilot) return reply.code(401).send({ error: 'NOT_AUTHENTICATED' });
    const view = payments.getIntent(pilot, req.params.id.slice(0, 64));
    return view ? withQr(view) : reply.code(404).send({ error: 'NOT_FOUND' });
  });

  // LNbits calls this when an invoice is paid. It is only a hint: the service re-queries
  // LNbits before anything is applied, so a forged body cannot create a pulse.
  app.post(
    LNBITS_WEBHOOK_PATH,
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!tokenOk((req.query as { token?: unknown }).token, env.webhookSecret)) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }
      await payments.onWebhook(req.body);
      return { ok: true };
    },
  );

  // Reachability check used by the operator before LIVE payments can be turned on.
  app.get(`${LNBITS_WEBHOOK_PATH}/ping`, async (req, reply) => {
    if (!tokenOk((req.query as { token?: unknown }).token, env.webhookSecret)) {
      return reply.code(403).send({ error: 'FORBIDDEN' });
    }
    return { ok: true };
  });
}
