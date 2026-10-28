import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TeamId } from '@sats-wars/shared';
import { buildServer, type SatsWarsServer } from '../src/app';
import { FakeClock } from '../src/clock';
import { loadEnv } from '../src/env';
import type { PaymentAdapter } from '../src/payments/adapter';

export const ADMIN_PASSWORD = 'test-admin-password-123';

export interface TestServer extends SatsWarsServer {
  clock: FakeClock;
  /** Advance fake time in 100ms ticks (like the real loop). */
  advance(ms: number): Promise<void>;
  inject: SatsWarsServer['app']['inject'];
  adminToken(): Promise<string>;
}

export function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'satswars-')), 'test.db');
}

export async function makeServer(
  opts: {
    env?: Record<string, string>;
    adapter?: PaymentAdapter;
    clock?: FakeClock;
    dbPath?: string;
  } = {},
): Promise<TestServer> {
  const clock = opts.clock ?? new FakeClock();
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_PATH: opts.dbPath ?? ':memory:',
    ADMIN_PASSWORD,
    LOG_LEVEL: 'silent',
    PUBLIC_PLAY_URL: 'http://localhost:3000/play',
    OPENING_MS: '1000',
    ...opts.env,
  });
  const server = await buildServer({
    env,
    mono: clock,
    wall: clock,
    adapter: opts.adapter,
    startLoops: false,
    logger: false,
  });
  return {
    ...server,
    clock,
    inject: server.app.inject.bind(server.app),
    async advance(ms: number) {
      const steps = Math.ceil(ms / 100);
      for (let i = 0; i < steps; i++) {
        clock.advance(Math.min(100, ms - i * 100));
        await server.step();
      }
    },
    async adminToken() {
      const res = await server.app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { password: ADMIN_PASSWORD },
      });
      return res.json().token as string;
    },
  };
}

export function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

export async function admin(s: TestServer, token: string, body: Record<string, unknown>) {
  const res = await s.inject({
    method: 'POST',
    url: '/api/admin/command',
    headers: auth(token),
    payload: body,
  });
  if (res.statusCode !== 200) throw new Error(`admin ${JSON.stringify(body)} -> ${res.statusCode} ${res.body}`);
  return res.json();
}

/** Pick a team (free, instant). */
export async function joinTeam(s: TestServer, teamId: TeamId = 'RAIJIN', extra: { nickname?: string; deviceId?: string } = {}) {
  const res = await s.inject({ method: 'POST', url: '/api/players', payload: { teamId, ...extra } });
  if (res.statusCode !== 200) throw new Error(`join failed ${res.statusCode} ${res.body}`);
  return res.json() as { playerId: string; token: string; nickname: string; teamId: TeamId; creditSats: number };
}

export async function topup(s: TestServer, token: string, amountSats = 210) {
  return s.inject({ method: 'POST', url: '/api/topups', headers: auth(token), payload: { amountSats } });
}

export async function mockPay(s: TestServer, token: string, invoiceId: string) {
  return s.inject({ method: 'POST', url: '/api/dev/mock-pay', headers: auth(token), payload: { invoiceId } });
}

/** Join, top up and mock-pay in one go. */
export async function fundedPlayer(s: TestServer, teamId: TeamId = 'RAIJIN', amountSats = 525, nickname?: string) {
  const p = await joinTeam(s, teamId, nickname ? { nickname } : {});
  const inv = await topup(s, p.token, amountSats);
  if (inv.statusCode !== 200) throw new Error(`topup failed ${inv.body}`);
  const pay = await mockPay(s, p.token, inv.json().invoiceId);
  if (pay.statusCode !== 200) throw new Error(`pay failed ${pay.body}`);
  return { ...p, invoiceId: inv.json().invoiceId as string, creditSats: pay.json().creditSats as number };
}

let zapCounter = 0;
export function zap(s: TestServer, token: string, clientActionId = `cid-${++zapCounter}-${Date.now()}`) {
  return s.inject({ method: 'POST', url: '/api/zap', headers: auth(token), payload: { clientActionId } });
}

/** Advance until the current season is in a fighting round. */
export async function untilRound(s: TestServer, maxMs = 120_000): Promise<void> {
  let waited = 0;
  while (s.services.manager.current().state.phase !== 'ROUND') {
    if (waited >= maxMs) throw new Error('never reached ROUND');
    await s.advance(100);
    waited += 100;
  }
}
