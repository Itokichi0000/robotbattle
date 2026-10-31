import type { PilotIdentity } from '@swed/shared';
import { callsignReqSchema } from '@swed/shared/schemas';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { audit } from '../db';
import { AUTH_COOKIE, ATTEMPT_TTL_MS, claimAttempt, createAttempt, handleCallback } from '../lnurl';
import {
  cookieHeader,
  createDemoGuest,
  issuePilotSession,
  parseCookies,
  perBrowserKey,
  PILOT_COOKIE,
  PILOT_COOKIE_MAX_AGE,
  pilotForToken,
  revokeOtherPilotSessions,
  revokePilotSession,
  sanitizeCallsign,
  setCallsign,
  type PilotRow,
} from '../sessions';
import type { RouteContext } from './context';

export function identity(p: PilotRow): PilotIdentity {
  return {
    publicName: p.public_name,
    kind: p.kind,
    callsign: p.callsign,
    showCallsign: !!p.show_callsign,
  };
}

/** Pilot sign-in: free DEMO GUEST (sandbox) and LNURL-auth (spec §7). */
export function registerAuthRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { env, db, runtime, realtime, base, cookieOpts, sameOrigin } = ctx;
  const pilotOf = (cookie: string | undefined) =>
    pilotForToken(db, parseCookies(cookie)[PILOT_COOKIE]);

  app.get('/api/session', async (req) => {
    const pilot = pilotOf(req.headers.cookie);
    return {
      authenticated: !!pilot,
      pilot: pilot ? identity(pilot) : null,
      mode: env.APP_MODE,
      demoGuestEnabled: env.demoGuestEnabled,
      lnurlDomain: new URL(base).host,
    };
  });

  app.post(
    '/api/auth/demo-guest',
    // Per IP: phones behind venue NAT share one, so the cap is generous (sandbox only).
    { preHandler: sameOrigin, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!env.demoGuestEnabled) return reply.code(403).send({ error: 'DEMO_GUEST_DISABLED' });
      const existing = pilotOf(req.headers.cookie);
      if (existing) return { pilot: identity(existing) };
      const { pilot, token } = createDemoGuest(db);
      audit(db, `pilot:${pilot.public_name}`, 'DEMO_GUEST_SIGNIN');
      reply.header(
        'Set-Cookie',
        cookieHeader(PILOT_COOKIE, token, cookieOpts(PILOT_COOKIE_MAX_AGE, 'Lax')),
      );
      return { pilot: identity(pilot) };
    },
  );

  app.post('/api/auth/logout', { preHandler: sameOrigin }, async (req, reply) => {
    const token = parseCookies(req.headers.cookie)[PILOT_COOKIE];
    const pilot = pilotForToken(db, token);
    revokePilotSession(db, token);
    if (pilot) {
      runtime.leave(pilot.id);
      realtime.disconnectPilot(pilot.id);
    }
    reply.header('Set-Cookie', cookieHeader(PILOT_COOKIE, '', cookieOpts(0, 'Lax')));
    return { ok: true };
  });

  /* ------------------------------------------------------------ LNURL-auth */

  // 1. The phone asks for a challenge. The k1 is bound to this browser by an HttpOnly cookie.
  app.post(
    '/api/auth/attempt',
    { preHandler: sameOrigin, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (_req, reply) => {
      const a = createAttempt(db, base);
      reply.header(
        'Set-Cookie',
        cookieHeader(
          AUTH_COOKIE,
          a.browserToken,
          cookieOpts(Math.ceil(ATTEMPT_TTL_MS / 1000) + 60, 'Lax'),
        ),
      );
      // For signing in from a second device; the phone's own wallet opens via the link.
      const qrSvg = await QRCode.toString(`LIGHTNING:${a.lnurl}`, {
        type: 'svg',
        margin: 2,
        errorCorrectionLevel: 'M',
      });
      return {
        attemptId: a.attemptId,
        lnurl: a.lnurl,
        callbackUrl: a.callbackUrl,
        expiresAt: a.expiresAt,
        qrSvg,
      };
    },
  );

  // 2. The wallet calls back with the signature (LUD-04). No cookies, any origin: wallets.
  app.get(
    '/api/auth/lnurl',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const result = handleCallback(db, req.query as Record<string, unknown>);
      if (result.status === 'OK') audit(db, 'lnurl-auth', 'LNURL_VERIFIED');
      else audit(db, 'lnurl-auth', 'LNURL_REJECTED', result.reason);
      // LUD-04 wallets read the JSON body; keep the HTTP status 200 either way.
      return reply.header('Cache-Control', 'no-store').send(result);
    },
  );

  // 3. The same browser polls; on success it receives the pilot session.
  app.get<{ Params: { id: string } }>(
    '/api/auth/attempt/:id/status',
    {
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute', keyGenerator: perBrowserKey(AUTH_COOKIE) },
      },
    },
    async (req, reply) => {
      const token = parseCookies(req.headers.cookie)[AUTH_COOKIE];
      const st = claimAttempt(db, req.params.id.slice(0, 64), token);
      if (st.status !== 'AUTHORIZED')
        return st.status === 'PENDING'
          ? st
          : { status: st.status, ...('reason' in st ? { reason: st.reason } : {}) };
      const session = issuePilotSession(db, st.pilot.id);
      // One wallet, one phone: other sessions of this pilot end (spec §7.4).
      const replaced = revokeOtherPilotSessions(db, st.pilot.id, session);
      if (replaced > 0) realtime.replacePilotSessions(st.pilot.id);
      audit(
        db,
        `pilot:${st.pilot.public_name}`,
        'LNURL_SIGNIN',
        replaced ? `replaced ${replaced} session(s)` : '',
      );
      reply.header('Set-Cookie', [
        cookieHeader(PILOT_COOKIE, session, cookieOpts(PILOT_COOKIE_MAX_AGE, 'Lax')),
        cookieHeader(AUTH_COOKIE, '', cookieOpts(0, 'Lax')),
      ]);
      return { status: 'AUTHORIZED', pilot: identity(st.pilot) };
    },
  );

  /* -------------------------------------------------------------- callsign */

  app.post('/api/pilot/callsign', { preHandler: sameOrigin }, async (req, reply) => {
    const pilot = pilotOf(req.headers.cookie);
    if (!pilot) return reply.code(401).send({ error: 'NOT_AUTHENTICATED' });
    const body = callsignReqSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID' });
    const callsign = body.data.callsign === null ? null : sanitizeCallsign(body.data.callsign);
    if (body.data.callsign !== null && !callsign)
      return reply.code(400).send({ error: 'BAD_CALLSIGN' });
    setCallsign(db, pilot.id, callsign, body.data.showOnScreen);
    realtime.refreshPilot(pilot.id);
    return { ok: true, callsign, showOnScreen: !!callsign && body.data.showOnScreen };
  });
}
