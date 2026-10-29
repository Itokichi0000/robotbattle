import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NOSTR_LINK_KIND, type NostrEvent, NostrChallenges, verifyLinkEvent } from '../auth/nostr';
import { AppError } from '../errors';
import type { Services } from '../services';

const eventSchema = z.object({
  id: z.string().max(64),
  pubkey: z.string().max(64),
  created_at: z.number().int(),
  kind: z.number().int(),
  tags: z.array(z.array(z.string().max(200)).max(4)).max(8),
  content: z.string().max(200),
  sig: z.string().max(128),
});

/**
 * Optional Nostr link (NOSTR_LINK=true, off by default). Display-only: the
 * npub can appear on the pilot's own license card if they choose. Never a
 * login, never posts, never contacts relays.
 */
export function registerNostrRoutes(app: FastifyInstance, services: Services): void {
  const { env, sessions, repo, wall, pilots } = services;
  const challenges = new NostrChallenges();

  const requirePilot = (req: FastifyRequest) => {
    if (!env.NOSTR_LINK) throw new AppError('NOT_FOUND', 'Nostr link is disabled');
    const auth = sessions.authenticate(req);
    if (!auth)
      throw new AppError('UNAUTHORIZED', 'パイロット認証が必要です / Pilot login required');
    return auth.pilot;
  };

  /**
   * The domain the browser signs for: a configured site (ALLOWED_ORIGINS /
   * the play URL) or, in development without a list, the request's Origin.
   */
  const domainFor = (req: FastifyRequest): string => {
    const hosts = [...env.allowedOrigins, env.playUrl]
      .map((u) => {
        try {
          return new URL(u).host;
        } catch {
          return '';
        }
      })
      .filter(Boolean);
    const origin = req.headers.origin;
    let fromOrigin = '';
    try {
      fromOrigin = origin ? new URL(origin).host : '';
    } catch {
      fromOrigin = '';
    }
    if (fromOrigin && (hosts.includes(fromOrigin) || env.allowedOrigins.length === 0))
      return fromOrigin;
    if (hosts[0]) return hosts[0];
    throw new AppError('BAD_REQUEST', 'unknown site domain');
  };

  app.post(
    '/api/me/nostr/challenge',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const p = requirePilot(req);
      const c = challenges.issue(p.id, wall.now());
      return { ...c, domain: domainFor(req), kind: NOSTR_LINK_KIND };
    },
  );

  app.post(
    '/api/me/nostr/link',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const p = requirePilot(req);
      const { event } = z.object({ event: eventSchema }).parse(req.body ?? {});
      const challenge = challenges.take(p.id, wall.now());
      if (!challenge) throw new AppError('BAD_REQUEST', 'challenge expired — try again');
      const check = verifyLinkEvent(event as NostrEvent, {
        challenge,
        domain: domainFor(req),
        nowMs: wall.now(),
      });
      if (!check.ok) throw new AppError('BAD_REQUEST', `Nostr proof rejected: ${check.reason}`);
      const other = repo.pilotByNostrKey(check.pubkey);
      if (other && other.id !== p.id)
        throw new AppError(
          'CONFLICT',
          'この Nostr 鍵は別のパイロットに連携済みです / Key already linked',
        );
      repo.setNostrKey(p.id, check.pubkey);
      repo.audit(
        `pilot:${p.id}`,
        'NOSTR_LINK',
        p.id,
        { pubkeyPrefix: check.pubkey.slice(0, 8) },
        wall.now(),
      );
      return { pilot: pilots.profile(repo.getPilot(p.id)!) };
    },
  );

  app.delete('/api/me/nostr', async (req) => {
    const p = requirePilot(req);
    repo.setNostrKey(p.id, null);
    repo.audit(`pilot:${p.id}`, 'NOSTR_UNLINK', p.id, null, wall.now());
    return { pilot: pilots.profile(repo.getPilot(p.id)!) };
  });
}
