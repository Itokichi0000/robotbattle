import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db';
import type { Env } from '../env';
import type { PaymentService } from '../payments/service';
import type { Realtime } from '../realtime';
import type { MatchRuntime } from '../runtime';

/** What route modules share. Built once in app.ts. */
export interface RouteContext {
  env: Env;
  db: Db;
  runtime: MatchRuntime;
  realtime: Realtime;
  payments: PaymentService;
  /** Public origin (no trailing slash). */
  base: string;
  cookieOpts: (
    maxAgeSec: number,
    sameSite: 'Lax' | 'Strict',
  ) => {
    secure: boolean;
    maxAgeSec: number;
    sameSite: 'Lax' | 'Strict';
  };
  /** CSRF guard for cookie-authenticated state changes. */
  sameOrigin: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}
