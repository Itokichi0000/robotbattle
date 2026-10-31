import type { AddressInfo } from 'node:net';
import type {
  ActionResult,
  HealthInfo,
  JoinInfo,
  MatchEventMsg,
  MatchSnapshotMsg,
  OperatorCommand,
  OperatorCommandResult,
  SessionStatusMsg,
} from '@swed/shared';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from './app';
import { EnvError, lanAddresses, parseEnv } from './env';

const ORIGIN = 'http://localhost:4400';

function testEnv(extra: Record<string, string> = {}) {
  return parseEnv(
    {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      OPERATOR_PASSWORD: 'test-operator-password',
      MATCH_PRESET: 'TEST',
      MATCH_SEED: '42',
      PUBLIC_BASE_URL: ORIGIN,
      LOG_LEVEL: 'silent',
      ...extra,
    },
    () => 'unused',
  );
}

let built: BuiltApp;
let url: string;
let now = 0;
const sockets: Socket[] = [];

/** Advances the match clock and runs the server tick, like 50 ms intervals would. */
function advance(ms: number) {
  const end = now + ms;
  while (now < end) {
    now = Math.min(end, now + 50);
    built.runtime.tick();
  }
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

async function demoGuest(): Promise<string> {
  const res = await post('/api/auth/demo-guest', {});
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie')!;
  expect(cookie).toContain('HttpOnly');
  return cookie.split(';')[0]!;
}

async function operatorCookie(): Promise<string> {
  const res = await post('/api/operator/login', { password: 'test-operator-password' });
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

function connect(ns: string, cookie?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(`${url}${ns}`, {
      transports: ['websocket'],
      extraHeaders: cookie ? { cookie } : {},
      reconnection: false,
      // Each test socket is its own "phone": no multiplexing over a shared connection.
      forceNew: true,
    });
    sockets.push(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(e));
  });
}

function emitAck<T>(s: Socket, ev: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => s.emit(ev, payload, (r: T) => resolve(r)));
}

function collect<T>(s: Socket, ev: string): T[] {
  const out: T[] = [];
  s.on(ev, (m: T) => out.push(m));
  return out;
}

/** Socket delivery is asynchronous; poll instead of guessing a delay (CI machines are slow). */
async function eventually<T>(
  fn: () => T | undefined | null | false,
  timeoutMs = 3_000,
): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

let n = 0;
const key = () => `k-${Date.now().toString(36)}-${(n++).toString(36)}`.padEnd(10, 'x');

beforeEach(async () => {
  now = 0;
  built = await buildApp(testEnv(), { source: () => now, logger: false });
  await built.app.listen({ host: '127.0.0.1', port: 0 });
  url = `http://127.0.0.1:${(built.app.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await built.app.close();
});

describe('join QR address', () => {
  it('prefers the Wi-Fi/Ethernet address over VPN tunnels and sharing bridges', () => {
    const v4 = (address: string) =>
      ({
        address,
        family: 'IPv4',
        internal: false,
        netmask: '255.255.255.0',
        mac: '',
        cidr: null,
      }) as const;
    const ranked = lanAddresses({
      lo0: [{ ...v4('127.0.0.1'), internal: true }],
      utun4: [v4('10.8.0.2')],
      bridge100: [v4('192.168.2.1')],
      awdl0: [v4('169.254.10.1')],
      en0: [v4('192.168.114.24')],
    });
    expect(ranked[0]).toEqual({ name: 'en0', address: '192.168.114.24' });
    expect(ranked.map((a) => a.name)).not.toContain('lo0');
    expect(ranked.map((a) => a.name)).not.toContain('awdl0');
  });
});

describe('http', () => {
  it('serves health and the join QR for the configured public URL', async () => {
    const health = (await (await fetch(`${url}/health`)).json()) as HealthInfo;
    expect(health).toMatchObject({ ok: true, mode: 'sandbox', phase: 'LOBBY' });
    const join = (await (await fetch(`${url}/api/public/join`)).json()) as JoinInfo;
    expect(join.joinUrl).toBe(`${ORIGIN}/pilot/`);
    expect(join.qrSvg).toContain('<svg');
  });

  it('issues a DEMO GUEST session cookie and reports it', async () => {
    const cookie = await demoGuest();
    const session = (await (await fetch(`${url}/api/session`, { headers: { cookie } })).json()) as {
      authenticated: boolean;
      pilot: { publicName: string; kind: string };
    };
    expect(session.authenticated).toBe(true);
    expect(session.pilot.publicName).toMatch(/^PILOT-[0-9A-F]{4}$/);
    expect(session.pilot.kind).toBe('DEMO_GUEST');
  });

  it('refuses cookie-authenticated POSTs from a foreign Origin (CSRF)', async () => {
    const res = await post('/api/auth/demo-guest', {}, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    const op = await post(
      '/api/operator/login',
      { password: 'test-operator-password' },
      { origin: 'https://evil.example' },
    );
    expect(op.status).toBe(403);
  });

  it('rejects a wrong operator password', async () => {
    const res = await post('/api/operator/login', { password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('never leaks pilot ids in the public match', async () => {
    const cookie = await demoGuest();
    await connect('/pilot', cookie);
    await eventually(
      () => built.runtime.state.players && Object.keys(built.runtime.state.players).length === 1,
    );
    const after = JSON.stringify(await (await fetch(`${url}/api/public/match`)).json());
    expect(after).toContain('"players":1');
    expect(after).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
  });
});

describe('sockets', () => {
  it('refuses pilots without a session and operators without login', async () => {
    await expect(connect('/pilot')).rejects.toThrow('NOT_AUTHENTICATED');
    await expect(connect('/operator')).rejects.toThrow('NOT_AUTHENTICATED');
  });

  it('refuses a socket handshake from a foreign Origin', async () => {
    const s = ioClient(`${url}/display`, {
      transports: ['websocket'],
      extraHeaders: { origin: 'https://evil.example' },
      reconnection: false,
    });
    sockets.push(s);
    await expect(
      new Promise<void>((resolve, reject) => {
        s.once('connect', () => resolve());
        s.once('connect_error', reject);
      }),
    ).rejects.toBeTruthy();
  });

  it('SLICE: scanning joins the crowd; three buttons drive one RAIJIN seen on the display', async () => {
    const display = await connect('/display');
    const displayEvents = collect<MatchEventMsg>(display, 'match:event');
    const displaySnaps = collect<MatchSnapshotMsg>(display, 'match:snapshot');

    const a = await connect('/pilot', await demoGuest());
    const b = await connect('/pilot', await demoGuest());
    const operator = await connect('/operator', await operatorCookie());
    const op = (c: OperatorCommand) =>
      emitAck<OperatorCommandResult>(operator, 'operator:command', c);
    await eventually(() => built.runtime.snapshotMsg().state.players === 2);
    const matchId = built.runtime.state.matchId;

    // Before the battle the buttons answer "not yet", in words.
    const early = await emitAck<ActionResult>(a, 'pilot:action', {
      matchId,
      clientActionId: key(),
      action: { kind: 'ATTACK' },
    });
    expect(early).toMatchObject({ accepted: false, reasonCode: 'NOT_IN_COMBAT' });

    expect((await op({ command: 'START' })).ok).toBe(true);
    expect((await op({ command: 'SKIP_DEPLOY' })).ok).toBe(true);
    advance(2_000);
    const boss = built.runtime.state.enemies[0]!;
    const hp = boss.hp;

    // 撃つ: the server lowers the boss HP. A retry with the same key does not count twice.
    const k = key();
    const fire = await emitAck<ActionResult>(a, 'pilot:action', {
      matchId,
      clientActionId: k,
      action: { kind: 'ATTACK' },
    });
    expect(fire).toMatchObject({ clientActionId: k, accepted: true });
    const retry = await emitAck<ActionResult>(a, 'pilot:action', {
      matchId,
      clientActionId: k,
      action: { kind: 'ATTACK' },
    });
    expect(retry.accepted).toBe(true);
    expect(built.runtime.state.enemies[0]!.hp).toBe(
      hp - built.runtime.state.config.free.effect.ATTACK,
    );
    // Mashing faster than the free cooldown is refused, not multiplied.
    const mash = await emitAck<ActionResult>(a, 'pilot:action', {
      matchId,
      clientActionId: key(),
      action: { kind: 'ATTACK' },
    });
    expect(mash.reasonCode).toBe('COOLDOWN');

    // 守る from the other phone fills the shared shield.
    const guard = await emitAck<ActionResult>(b, 'pilot:action', {
      matchId,
      clientActionId: key(),
      action: { kind: 'DEFEND' },
    });
    expect(guard.accepted).toBe(true);
    advance(300);
    const batch = await eventually(() =>
      displayEvents.find((e) => e.payload.type === 'action' && e.payload.kind === 'DEFEND'),
    );
    expect(batch.payload).toMatchObject({ paid: false, count: 1 });
    await eventually(() => (displaySnaps.at(-1)?.state.shield ?? 0) > 0);

    // A city strike is announced well ahead on every screen.
    advance(built.runtime.state.config.strikes.firstAtMs);
    const warn = await eventually(() =>
      displayEvents.find((e) => e.payload.type === 'threat_warning' && e.payload.target === 'CITY'),
    );
    const w = warn.payload as Extract<MatchEventMsg['payload'], { type: 'threat_warning' }>;
    expect(w.impactAt - warn.serverTime).toBeGreaterThanOrEqual(4_000);

    const rows = built.db.prepare('SELECT action_type, accepted FROM action_events').all();
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it('refuses malformed and client-authoritative payloads', async () => {
    const p = await connect('/pilot', await demoGuest());
    const matchId = built.runtime.state.matchId;
    const forged = await emitAck<ActionResult>(p, 'pilot:action', {
      matchId,
      clientActionId: key(),
      action: { kind: 'ATTACK', damage: 99999 },
    });
    expect(forged.reasonCode).toBe('INVALID');
    const unknown = await emitAck<ActionResult>(p, 'pilot:action', {
      matchId,
      clientActionId: key(),
      action: { kind: 'NUKE' },
    });
    expect(unknown.reasonCode).toBe('INVALID');
    const stale = await emitAck<ActionResult>(p, 'pilot:action', {
      matchId: 'm_old',
      clientActionId: key(),
      action: { kind: 'ATTACK' },
    });
    expect(stale.reasonCode).toBe('STALE_MATCH');
  });

  it('pause freezes the match clock; resume continues where it stopped', async () => {
    const operator = await connect('/operator', await operatorCookie());
    const op = (c: OperatorCommand) =>
      emitAck<OperatorCommandResult>(operator, 'operator:command', c);
    await op({ command: 'START' });
    await op({ command: 'SKIP_DEPLOY' });
    advance(5_000);
    const t0 = built.runtime.state.t;
    const endsAt = built.runtime.state.phaseEndsAt;
    expect((await op({ command: 'PAUSE' })).ok).toBe(true);
    advance(20_000);
    expect(built.runtime.state.t).toBe(t0);
    expect((await op({ command: 'RESUME' })).ok).toBe(true);
    advance(1_000);
    expect(built.runtime.state.t).toBeGreaterThanOrEqual(t0 + 950);
    expect(built.runtime.state.phaseEndsAt).toBe(endsAt);
  });

  it('keeps a dropped phone in the crowd; the next match keeps connected phones; RESET works', async () => {
    const cookie = await demoGuest();
    const p1 = await connect('/pilot', cookie);
    await eventually(() => Object.keys(built.runtime.state.players).length === 1);
    const pilotId = Object.keys(built.runtime.state.players)[0]!;
    const matchId = built.runtime.state.matchId;
    p1.close();
    await eventually(() => built.runtime.state.players[pilotId]?.connected === false);
    expect(built.runtime.snapshotMsg().state.players).toBe(1);
    const p2 = await connect('/pilot', cookie);
    const status = await new Promise<SessionStatusMsg>((r) => p2.once('pilot:sessionStatus', r));
    expect(status.joined).toBe(true);
    await eventually(() => built.runtime.state.players[pilotId]?.connected === true);

    const operator = await connect('/operator', await operatorCookie());
    const res = await emitAck<OperatorCommandResult>(operator, 'operator:command', {
      command: 'RESET',
    });
    expect(res.ok).toBe(true);
    expect(built.runtime.state.matchId).not.toBe(matchId);
    // Still connected → already in the new match, no rescan.
    expect(built.runtime.isJoined(pilotId)).toBe(true);
    const audit = built.db.prepare("SELECT action FROM audit_log WHERE action = 'RESET'").all();
    expect(audit).toHaveLength(1);
  });
});

describe('env safety', () => {
  it('refuses live mode until Phase 3/4 and owner approval', () => {
    expect(() => testEnv({ APP_MODE: 'live' })).toThrow(EnvError);
  });

  it('refuses production without a strong operator password and https URL', () => {
    expect(() =>
      parseEnv({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://x.example' }, () => 'gen'),
    ).toThrow(/OPERATOR_PASSWORD/);
    expect(() =>
      parseEnv(
        {
          NODE_ENV: 'production',
          OPERATOR_PASSWORD: 'long-enough-password',
          PUBLIC_BASE_URL: 'http://x.example',
        },
        () => 'gen',
      ),
    ).toThrow(/https/);
    expect(() =>
      parseEnv(
        {
          NODE_ENV: 'production',
          OPERATOR_PASSWORD: 'long-enough-password',
          PUBLIC_BASE_URL: 'https://x.example',
          MATCH_PRESET: 'TEST',
        },
        () => 'gen',
      ),
    ).toThrow(/TEST/);
  });

  it('starts sandbox in development with no keys at all', () => {
    const env = parseEnv({}, () => 'generated-pw');
    expect(env.APP_MODE).toBe('sandbox');
    expect(env.demoGuestEnabled).toBe(true);
    expect(env.operatorPasswordGenerated).toBe(true);
  });
});
