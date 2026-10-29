import type { AddressInfo } from 'node:net';
import type {
  ActionResult,
  HealthInfo,
  JoinInfo,
  MatchEventMsg,
  MatchSnapshotMsg,
  OperatorCommand,
  OperatorCommandResult,
  SeatRequestResult,
  SessionStatusMsg,
} from '@swed/shared';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from './app';
import { EnvError, parseEnv } from './env';

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

async function settle() {
  await new Promise((r) => setTimeout(r, 30));
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

describe('http', () => {
  it('serves health and the join QR for the configured public URL', async () => {
    const health = (await (await fetch(`${url}/health`)).json()) as HealthInfo;
    expect(health).toMatchObject({ ok: true, mode: 'sandbox', phase: 'ATTRACT' });
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
    const pilot = await connect('/pilot', cookie);
    const snap = (await (await fetch(`${url}/api/public/match`)).json()) as MatchSnapshotMsg;
    await emitAck<SeatRequestResult>(pilot, 'pilot:joinSeat', {
      matchId: snap.matchId,
      seatId: 'GUNNER_L',
      requestId: key(),
    });
    const after = JSON.stringify(await (await fetch(`${url}/api/public/match`)).json());
    expect(after).toContain('"occupied":true');
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

  it('PHASE 1 SLICE: two phones in different roles drive one RAIJIN seen on the display', async () => {
    const display = await connect('/display');
    const displayEvents = collect<MatchEventMsg>(display, 'match:event');
    const displaySnaps = collect<MatchSnapshotMsg>(display, 'match:snapshot');

    const gunner = await connect('/pilot', await demoGuest());
    const guard = await connect('/pilot', await demoGuest());
    const gunnerStatus = collect<SessionStatusMsg>(gunner, 'pilot:sessionStatus');
    const operator = await connect('/operator', await operatorCookie());
    const op = (c: OperatorCommand) =>
      emitAck<OperatorCommandResult>(operator, 'operator:command', c);

    const matchId = built.runtime.state.matchId;
    expect(
      await emitAck<SeatRequestResult>(gunner, 'pilot:joinSeat', {
        matchId,
        seatId: 'GUNNER_L',
        requestId: key(),
      }),
    ).toEqual({ ok: true, seatId: 'GUNNER_L' });
    // Same seat twice: refused. Different role: fine.
    expect(
      await emitAck<SeatRequestResult>(guard, 'pilot:joinSeat', {
        matchId,
        seatId: 'GUNNER_L',
        requestId: key(),
      }),
    ).toEqual({ ok: false, reasonCode: 'SEAT_TAKEN' });
    expect(
      await emitAck<SeatRequestResult>(guard, 'pilot:joinSeat', {
        matchId,
        seatId: 'SHIELD_L',
        requestId: key(),
      }),
    ).toEqual({ ok: true, seatId: 'SHIELD_L' });
    await eventually(() => gunnerStatus.at(-1)?.assignedSeat === 'GUNNER_L');
    expect(built.runtime.state.phase).toBe('LOBBY');

    expect((await op({ command: 'START' })).ok).toBe(true);
    expect((await op({ command: 'SKIP_DEPLOY' })).ok).toBe(true);
    advance(3_000); // both tutorial drones have arrived

    // Gunner: LOCK → CHARGE → FIRE on the right-side drone (the front one is the shield's
    // tutorial attacker; leave it alive). The server lowers the enemy HP.
    const right = built.runtime.state.enemies.find((e) => e.orbit.bearing0 > 45)!;
    const lock = await emitAck<ActionResult>(gunner, 'pilot:action', {
      matchId,
      seatId: 'GUNNER_L',
      clientActionId: key(),
      action: { actionType: 'LOCK', payload: { targetId: right.id } },
    });
    expect(lock.accepted).toBe(true);
    const targetId = built.runtime.state.gunners.GUNNER_L.targetId!;
    const hpBefore = built.runtime.state.enemies.find((e) => e.id === targetId)!.hp;
    advance(1_500);
    const fireKey = key();
    const fire = await emitAck<ActionResult>(gunner, 'pilot:action', {
      matchId,
      seatId: 'GUNNER_L',
      clientActionId: fireKey,
      action: { actionType: 'FIRE', payload: {} },
    });
    expect(fire).toMatchObject({ clientActionId: fireKey, accepted: true });
    // A retry with the same key does not fire twice.
    const retry = await emitAck<ActionResult>(gunner, 'pilot:action', {
      matchId,
      seatId: 'GUNNER_L',
      clientActionId: fireKey,
      action: { actionType: 'FIRE', payload: {} },
    });
    expect(retry.accepted).toBe(true);
    // AUTO SUPPORT flies the empty right gun too; count only this pilot's shots.
    await eventually(() =>
      displayEvents.some(
        (e) => e.payload.type === 'weapon_fired' && e.payload.seatId === 'GUNNER_L',
      ),
    );
    const shots = displayEvents.filter(
      (e) => e.type === 'weapon_fired' && 'seatId' in e.payload && e.payload.seatId === 'GUNNER_L',
    );
    expect(shots).toHaveLength(1);
    const shot = shots[0]!.payload as Extract<MatchEventMsg['payload'], { type: 'weapon_fired' }>;
    const autoDamage = displayEvents
      .filter(
        (e) =>
          e.payload.type === 'weapon_fired' && e.payload.auto && e.payload.enemyId === targetId,
      )
      .reduce((a, e) => a + (e.payload as { damage: number }).damage, 0);
    const hpAfter = built.runtime.state.enemies.find((e) => e.id === targetId)?.hp ?? 0;
    expect(hpAfter).toBe(Math.max(0, hpBefore - shot.damage - autoDamage));
    expect(shot.auto).toBe(false);

    // The guard cannot fire someone else's gun, and cannot fire at all.
    const steal = await emitAck<ActionResult>(guard, 'pilot:action', {
      matchId,
      seatId: 'GUNNER_L',
      clientActionId: key(),
      action: { actionType: 'FIRE', payload: {} },
    });
    expect(steal.reasonCode).toBe('NOT_YOUR_SEAT');

    // Shield: wait for the scripted FRONT strike, deploy just before impact.
    let threat = built.runtime.state.threats.find((t) => t.dir === 'FRONT');
    for (let i = 0; i < 100 && !threat; i++) {
      advance(100);
      threat = built.runtime.state.threats.find((t) => t.dir === 'FRONT');
    }
    expect(threat).toBeTruthy();
    expect(threat!.impactAt - threat!.warnAt).toBeGreaterThanOrEqual(4_000);
    advance(threat!.impactAt - built.runtime.state.t - 700);
    const deploy = await emitAck<ActionResult>(guard, 'pilot:action', {
      matchId,
      seatId: 'SHIELD_L',
      clientActionId: key(),
      action: { actionType: 'DEPLOY_SHIELD', payload: { dir: 'FRONT' } },
    });
    expect(deploy.accepted).toBe(true);
    advance(900);
    const blocked = await eventually(() => displayEvents.find((e) => e.type === 'threat_blocked'));
    await eventually(() => (displaySnaps.at(-1)?.state.stats.threatsBlocked ?? 0) >= 1);
    expect(blocked?.payload).toMatchObject({ seatId: 'SHIELD_L', dir: 'FRONT', auto: false });
    expect(displaySnaps.at(-1)?.state.stats.threatsBlocked).toBeGreaterThanOrEqual(1);

    // Every accepted and refused action is on record.
    const rows = built.db.prepare('SELECT action_type, accepted FROM action_events').all();
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });

  it('refuses malformed and client-authoritative payloads', async () => {
    const gunner = await connect('/pilot', await demoGuest());
    const matchId = built.runtime.state.matchId;
    await emitAck(gunner, 'pilot:joinSeat', { matchId, seatId: 'GUNNER_L', requestId: key() });
    const forged = await emitAck<ActionResult>(gunner, 'pilot:action', {
      matchId,
      seatId: 'GUNNER_L',
      clientActionId: key(),
      action: { actionType: 'FIRE', payload: { damage: 99999 } },
    });
    expect(forged.reasonCode).toBe('INVALID');
    const stale = await emitAck<ActionResult>(gunner, 'pilot:action', {
      matchId: 'm_old',
      seatId: 'GUNNER_L',
      clientActionId: key(),
      action: { actionType: 'FIRE', payload: {} },
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

  it('holds a dropped pilot seat, and RESET opens a fresh match', async () => {
    const cookie = await demoGuest();
    const p1 = await connect('/pilot', cookie);
    const matchId = built.runtime.state.matchId;
    await emitAck(p1, 'pilot:joinSeat', { matchId, seatId: 'SHIELD_R', requestId: key() });
    p1.close();
    await settle();
    expect(built.runtime.state.seats.SHIELD_R.connected).toBe(false);
    expect(built.runtime.state.seats.SHIELD_R.pilotId).not.toBeNull();
    const p2 = await connect('/pilot', cookie);
    const status = await new Promise<SessionStatusMsg>((r) => p2.once('pilot:sessionStatus', r));
    expect(status.assignedSeat).toBe('SHIELD_R');
    expect(built.runtime.state.seats.SHIELD_R.connected).toBe(true);

    const operator = await connect('/operator', await operatorCookie());
    const res = await emitAck<OperatorCommandResult>(operator, 'operator:command', {
      command: 'RESET',
    });
    expect(res.ok).toBe(true);
    expect(built.runtime.state.matchId).not.toBe(matchId);
    expect(built.runtime.state.seats.SHIELD_R.pilotId).toBeNull();
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
