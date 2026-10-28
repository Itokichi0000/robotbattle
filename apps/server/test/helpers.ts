import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
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
  return pathJoin(mkdtempSync(pathJoin(tmpdir(), 'satswars-')), 'test.db');
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

export interface PilotHandle {
  pilotId: string;
  token: string;
  callsign: string;
}

/** Guest pilot (no wallet). */
export async function guest(s: TestServer, extra: { callsign?: string; deviceId?: string } = {}): Promise<PilotHandle> {
  const res = await s.inject({ method: 'POST', url: '/api/auth/guest', payload: extra });
  if (res.statusCode !== 200) throw new Error(`guest failed ${res.statusCode} ${res.body}`);
  const j = res.json();
  return { pilotId: j.pilot.pilotId, token: j.token, callsign: j.pilot.callsign };
}

export async function board(s: TestServer, p: PilotHandle, role = 'GUNNER', robot?: string) {
  return s.inject({ method: 'POST', url: '/api/raids/current/board', headers: auth(p.token), payload: { role, ...(robot ? { robot } : {}) } });
}

export async function requestTask(s: TestServer, p: PilotHandle, choice: Record<string, unknown> = {}) {
  return s.inject({ method: 'POST', url: '/api/raids/current/tasks', headers: auth(p.token), payload: choice });
}

let submitCounter = 0;
export async function submitTask(s: TestServer, p: PilotHandle, taskId: string, input: unknown, clientSubmissionId = `sub-${++submitCounter}-${Date.now()}`) {
  return s.inject({ method: 'POST', url: '/api/raids/current/tasks/submit', headers: auth(p.token), payload: { taskId, clientSubmissionId, input } });
}

/** Lobby → start the raid now (admin). */
export async function startRaid(s: TestServer) {
  const token = await s.adminToken();
  const st = s.services.manager.current().state.status;
  if (st === 'CREATED') await admin(s, token, { command: 'OPEN_LOBBY' });
  await admin(s, token, { command: 'START' });
  return token;
}
