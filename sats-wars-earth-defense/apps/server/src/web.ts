import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { PROJECT_ROOT } from './env';

/**
 * One origin for everything: /display, /pilot, /operator, /api, /socket.io, /health
 * (spec §2). Cookies, CSRF checks and the LNURL callback domain stay simple that way.
 *   dev    → each app's Vite dev server runs in middleware mode inside this process
 *   static → each app's built dist/ is served with immutable caching for hashed assets
 */

export const WEB_APPS = ['display', 'pilot', 'operator'] as const;
export type WebApp = (typeof WEB_APPS)[number];

/** Handles the request when it belongs to a web app; returns false to let Fastify route it. */
export type RawHandler = (req: IncomingMessage, res: ServerResponse, next: () => void) => boolean;

export interface DevWeb {
  handler: RawHandler;
  close(): Promise<void>;
}

/** First HMR websocket port; the apps use the next three. */
export const HMR_PORT_BASE = 24700;

export async function createDevWeb(): Promise<DevWeb> {
  const { createServer } = await import('vite');
  const servers: Array<{ prefix: string; vite: Awaited<ReturnType<typeof createServer>> }> = [];
  for (const [i, name] of WEB_APPS.entries()) {
    const root = path.join(PROJECT_ROOT, 'apps', name);
    const vite = await createServer({
      root,
      configFile: path.join(root, 'vite.config.ts'),
      // In-memory config loading: no temp files for the dev watcher to trip over.
      configLoader: 'runner',
      appType: 'spa',
      logLevel: 'warn',
      server: { middlewareMode: true, hmr: { port: HMR_PORT_BASE + i + 1 } },
    });
    servers.push({ prefix: `/${name}/`, vite });
  }
  return {
    handler: (req, res, next) => {
      const url = req.url ?? '/';
      for (const s of servers) {
        if (url === s.prefix.slice(0, -1) || url.startsWith(`${s.prefix.slice(0, -1)}?`)) {
          res.statusCode = 302;
          res.setHeader('Location', s.prefix + url.slice(s.prefix.length - 1));
          res.end();
          return true;
        }
        if (url.startsWith(s.prefix)) {
          s.vite.middlewares(req, res, next);
          return true;
        }
      }
      return false;
    },
    close: async () => {
      await Promise.all(servers.map((s) => s.vite.close()));
    },
  };
}

export async function registerStaticWeb(app: FastifyInstance): Promise<void> {
  let first = true;
  for (const name of WEB_APPS) {
    const root = path.join(PROJECT_ROOT, 'apps', name, 'dist');
    if (!existsSync(path.join(root, 'index.html'))) {
      app.log.warn({ app: name, root }, 'web app not built; run `pnpm build`');
      app.get(`/${name}/*`, async (_req, reply) =>
        reply.code(503).type('text/plain').send(`${name} is not built. Run: pnpm build`),
      );
    } else {
      await app.register(fastifyStatic, {
        root,
        prefix: `/${name}/`,
        decorateReply: first,
        index: ['index.html'],
        // Our setHeaders decides caching; the plugin default would override it.
        cacheControl: false,
        setHeaders: (res, file) => {
          // Vite fingerprints assets; HTML must always revalidate so a redeploy takes effect.
          res.setHeader(
            'Cache-Control',
            file.includes(`${path.sep}assets${path.sep}`)
              ? 'public, max-age=31536000, immutable'
              : 'no-cache',
          );
        },
      });
      first = false;
    }
    app.get(`/${name}`, async (_req, reply) => reply.redirect(`/${name}/`));
  }
}
