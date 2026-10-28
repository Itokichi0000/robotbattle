import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

export async function admin(s: TestServer, token: string, body: Record<string, unknown>) {
  const res = await s.inject({
    method: 'POST',
    url: '/api/admin/command',
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  });
  if (res.statusCode !== 200) throw new Error(`admin ${JSON.stringify(body)} -> ${res.statusCode} ${res.body}`);
  return res.json();
}

export async function reserve(s: TestServer, nickname = 'tester', deviceId?: string) {
  const res = await s.inject({
    method: 'POST',
    url: '/api/join/reserve',
    payload: { nickname, ...(deviceId ? { deviceId } : {}) },
  });
  return res;
}

export function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** Reserve, invoice and mock-pay; returns the participant token and ids. */
export async function joinAndPay(s: TestServer, nickname = 'tester') {
  const r = (await reserve(s, nickname)).json();
  const inv = await s.inject({
    method: 'POST',
    url: '/api/join/invoice',
    headers: auth(r.token),
    payload: { reservationId: r.reservationId },
  });
  if (inv.statusCode !== 200) throw new Error(`invoice failed ${inv.body}`);
  const pay = await s.inject({
    method: 'POST',
    url: '/api/dev/mock-pay',
    headers: auth(r.token),
    payload: { invoiceId: inv.json().invoiceId },
  });
  if (pay.statusCode !== 200) throw new Error(`pay failed ${pay.body}`);
  return { ...r, invoiceId: inv.json().invoiceId as string, pay: pay.json() };
}

let actionCounter = 0;
export async function act(
  s: TestServer,
  token: string,
  type: 'ATTACK' | 'DEFEND' | 'CHARGE',
  regionId?: string,
  clientActionId = `cid-${++actionCounter}-${Date.now()}`,
) {
  return s.inject({
    method: 'POST',
    url: '/api/actions',
    headers: auth(token),
    payload: { clientActionId, type, regionId },
  });
}
