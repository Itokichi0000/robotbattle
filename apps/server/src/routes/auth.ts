import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { guestRequestSchema } from '@sats-wars/shared';
import { appendCookie, readCookie } from '../auth/sessions';
import { newToken, sha256 } from '../auth/tokens';
import { AppError } from '../errors';
import type { Services } from '../services';

const BIND_COOKIE = 'sw_lnurl_bind';
const MERGE_TTL_MS = 10 * 60_000;

/**
 * Pilot authentication: guest pilots, Lightning (LNURL-auth, LUD-04) and the
 * dev-only mock wallet. Authentication only proves who is playing; it never
 * grants a raid pass by itself.
 */
export function registerAuthRoutes(app: FastifyInstance, services: Services): void {
  const { sessions, pilots, lnurl, env, repo, wall } = services;
  const merges = new Map<string, { guestId: string; targetId: string; expiresAt: number }>();

  const setBinding = (reply: FastifyReply, binding: string) =>
    appendCookie(reply, `${BIND_COOKIE}=${binding}; Path=/api/auth/lightning; HttpOnly; SameSite=Lax; Max-Age=300${sessions.secure ? '; Secure' : ''}`);
  const bindingOf = (req: FastifyRequest) => readCookie(req.headers.cookie, BIND_COOKIE) ?? (req.headers['x-lnurl-binding'] as string | undefined) ?? null;

  app.post('/api/auth/guest', { config: { rateLimit: { max: env.GUEST_SIGNUPS_PER_MINUTE, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = guestRequestSchema.parse(req.body ?? {});
    const { pilot, token, expiresAt } = pilots.guest(body);
    sessions.setCookie(reply, token, expiresAt);
    pilots.applyNamePolicy(pilot);
    return { pilot: pilots.profile(pilot), token };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const auth = sessions.authenticate(req);
    if (auth) sessions.revoke(auth.token);
    sessions.clearCookie(reply);
    return { ok: true };
  });

  app.post('/api/auth/logout-all', async (req, reply) => {
    const auth = sessions.authenticate(req);
    if (!auth) throw new AppError('UNAUTHORIZED', 'login required');
    const n = sessions.revokeAll(auth.pilot.id);
    sessions.clearCookie(reply);
    return { revoked: n };
  });

  // ---- Lightning (LNURL-auth) ------------------------------------------------

  app.get('/api/auth/modes', async () => ({ mock: env.mockAuth, lightning: env.lnurlAuth, demo: env.DEMO_MODE }));

  app.post('/api/auth/lightning/start', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { purpose } = z.object({ purpose: z.enum(['LOGIN', 'LINK']).default('LOGIN') }).parse(req.body ?? {});
    const auth = sessions.authenticate(req);
    if (purpose === 'LINK' && !auth) throw new AppError('UNAUTHORIZED', 'login required to link a wallet');
    if (!env.lnurlAuth && !env.mockAuth) throw new AppError('FORBIDDEN', 'Lightning login is disabled');
    // In mock mode the challenge can also be signed by the built-in mock wallet.
    const start = env.mockAuth ? lnurl.startWithMock(purpose, auth?.pilot.id ?? null) : lnurl.start(purpose, auth?.pilot.id ?? null);
    setBinding(reply, start.binding);
    const { binding: _b, ...rest } = start;
    return { ...rest, mockWallet: env.mockAuth, realWallets: env.lnurlAuth && lnurl.enabled };
  });

  /** LUD-04 wallet callback. Always 200 with LNURL status JSON (wallets show the reason). */
  app.get('/api/auth/lightning/callback', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const q = z.object({ k1: z.string().max(128).optional(), sig: z.string().max(200).optional(), key: z.string().max(132).optional() }).passthrough().parse(req.query);
    if (!env.lnurlAuth && !env.mockAuth) return { status: 'ERROR', reason: 'disabled' };
    return lnurl.callback(q);
  });

  app.post('/api/auth/lightning/mock-approve', async (req) => {
    if (!env.mockAuth) throw new AppError('NOT_FOUND', 'not available');
    const body = z.object({ challengeId: z.string().min(1).max(64), walletSeed: z.string().min(8).max(128) }).parse(req.body ?? {});
    return lnurl.mockApprove(body.challengeId, bindingOf(req), body.walletSeed);
  });

  app.get('/api/auth/lightning/status/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const st = lnurl.status(id, bindingOf(req));
    if (st.status !== 'VERIFIED') return st;
    const current = sessions.authenticate(req);
    if (st.purpose === 'LINK') return { status: 'VERIFIED', purpose: 'LINK', pilot: pilots.profile(repo.getPilot(st.pilot.id)!) };
    const { token, expiresAt } = sessions.issue(st.pilot.id, 'LIGHTNING');
    sessions.setCookie(reply, token, expiresAt);
    pilots.applyNamePolicy(st.pilot);
    repo.touchPilot(st.pilot.id, wall.now());
    // A guest on this browser may bring their history along — only if they confirm.
    let mergeOffer: { token: string; guestCallsign: string; sorties: number } | null = null;
    if (current && current.pilot.auth_type === 'GUEST' && current.pilot.id !== st.pilot.id && !current.pilot.merged_into) {
      const mt = newToken();
      merges.set(sha256(mt), { guestId: current.pilot.id, targetId: st.pilot.id, expiresAt: wall.now() + MERGE_TTL_MS });
      mergeOffer = { token: mt, guestCallsign: current.pilot.callsign, sorties: current.pilot.sorties };
    }
    return { status: 'VERIFIED', purpose: 'LOGIN', pilot: pilots.profile(st.pilot), token, mergeOffer };
  });

  app.post('/api/auth/merge-guest', async (req) => {
    const auth = sessions.authenticate(req);
    if (!auth) throw new AppError('UNAUTHORIZED', 'login required');
    const { token } = z.object({ token: z.string().min(16).max(128) }).parse(req.body ?? {});
    const key = sha256(token);
    const m = merges.get(key);
    merges.delete(key);
    if (!m || m.expiresAt <= wall.now() || m.targetId !== auth.pilot.id) throw new AppError('BAD_REQUEST', '統合の有効期限が切れました / Merge offer expired');
    const guest = repo.getPilot(m.guestId);
    if (!guest) throw new AppError('NOT_FOUND', 'guest not found');
    return { pilot: pilots.mergeGuest(guest, auth.pilot) };
  });
}
