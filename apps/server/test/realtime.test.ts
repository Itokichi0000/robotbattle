import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { type Socket, io as connect } from 'socket.io-client';
import type {
  CheerPush,
  ClientToServerEvents,
  EntitlementPush,
  GameEvent,
  PublicRaidSnapshot,
  ServerToClientEvents,
  Task,
} from '@sats-wars/shared';
import { RaidStore } from '@sats-wars/shared';
import { mulberry32, solveTask } from '@sats-wars/game-engine';
import {
  type PilotHandle,
  type TestServer,
  auth,
  board,
  guest,
  makeServer,
  requestTask,
  startRaid,
  submitTask,
} from './helpers';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let s: TestServer | null = null;
const sockets: ClientSocket[] = [];
afterEach(async () => {
  for (const c of sockets.splice(0)) c.close();
  await s?.close();
  s = null;
});

async function listen(server: TestServer): Promise<string> {
  await server.app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = server.app.server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

interface Client {
  socket: ClientSocket;
  store: RaidStore;
  events: GameEvent[];
  gaps: number;
}

function onEvent(c: Client) {
  return (e: GameEvent) => {
    c.events.push(e);
    if (c.store.applyEvent(e, Date.now()) === 'gap') {
      c.gaps++;
      c.socket.emit('raid:request-snapshot', (snap) => c.store.applySnapshot(snap));
    }
  };
}

async function client(
  url: string,
  role: 'arena' | 'pilot' | 'spectator' = 'spectator',
  token?: string,
) {
  const socket: ClientSocket = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  const c: Client = { socket, store: new RaidStore(), events: [], gaps: 0 };
  socket.on('raid:snapshot', (snap) => c.store.applySnapshot(snap));
  socket.on('raid:event', onEvent(c));
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () =>
      socket.emit('raid:subscribe', { role, token }, (res) =>
        res.ok ? resolve() : reject(new Error(res.error)),
      ),
    );
    socket.on('connect_error', reject);
  });
  await waitFor(() => c.store.snapshot !== null);
  return c;
}

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function comparable(snap: PublicRaidSnapshot | null) {
  if (!snap) return null;
  const {
    cities,
    robots,
    enemies,
    telegraphs,
    sync,
    special,
    status,
    phase,
    lastSeq,
    reserveEnergy,
    crew,
  } = snap;
  return {
    cities,
    robots,
    enemies,
    telegraphs,
    sync,
    special,
    status,
    phase,
    lastSeq,
    reserveEnergy,
    crew,
  };
}

async function play(srv: TestServer, p: PilotHandle) {
  const r = (await requestTask(srv, p)).json() as { task: Task | null };
  if (!r.task) return;
  const input = solveTask(r.task.params, 1, mulberry32(3), 700);
  await srv.advance(
    ('stopAtMs' in input ? input.stopAtMs : 'releaseAtMs' in input ? input.releaseAtMs : 1200) +
      100,
  );
  await submitTask(srv, p, r.task.taskId, input);
}

const DEMO = { env: { DEMO_MODE: 'true' } };

describe('realtime sync', () => {
  it('several screens converge to the server raid via seq-numbered events', async () => {
    s = await makeServer(DEMO);
    const url = await listen(s);
    const clients = await Promise.all([client(url, 'arena'), client(url), client(url)]);
    const a = await guest(s);
    const b = await guest(s);
    clients.push(await client(url, 'pilot', a.token));
    await board(s, a, 'GUNNER');
    await board(s, b, 'GUARDIAN');
    await startRaid(s);
    for (let i = 0; i < 4; i++) {
      await s.advance(6000);
      await play(s, a);
      await play(s, b);
    }
    const server = s.services.manager.snapshot();
    await waitFor(() => clients.every((c) => c.store.snapshot?.lastSeq === server.lastSeq));
    for (const c of clients) expect(comparable(c.store.snapshot)).toEqual(comparable(server));
    expect(clients.every((c) => c.gaps === 0)).toBe(true);
    const seqs = clients[0]!.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
  });

  it('a client that misses events detects the gap and resyncs from a snapshot', async () => {
    s = await makeServer(DEMO);
    const url = await listen(s);
    const a = await guest(s);
    await board(s, a, 'GUNNER');
    const c = await client(url);
    c.socket.off('raid:event');
    await startRaid(s);
    await s.advance(9000);
    await new Promise((r) => setTimeout(r, 100));
    c.socket.on('raid:event', onEvent(c));
    await s.advance(9000);
    await play(s, a);
    const server = s.services.manager.snapshot();
    await waitFor(() => c.store.snapshot?.lastSeq === server.lastSeq);
    expect(c.gaps).toBeGreaterThan(0);
    expect(comparable(c.store.snapshot)).toEqual(comparable(server));
  });

  it('reconnecting clients get a fresh snapshot', async () => {
    s = await makeServer(DEMO);
    const url = await listen(s);
    const c = await client(url);
    c.socket.disconnect();
    const a = await guest(s);
    await board(s, a, 'ROUTER');
    c.socket.connect();
    await new Promise<void>((resolve) => c.socket.once('connect', () => resolve()));
    c.socket.emit('raid:subscribe', { role: 'spectator' });
    const server = s.services.manager.snapshot();
    await waitFor(() => c.store.snapshot?.lastSeq === server.lastSeq);
    expect(c.store.snapshot?.crew).toHaveLength(1);
  });

  it('pass grants go only to that pilot; cheers go to every screen with the consented name', async () => {
    s = await makeServer({ env: { PASS_MODE: 'PAID' } });
    const url = await listen(s);
    const a = await guest(s, { callsign: 'one', deviceId: 'device-one-0001' });
    const b = await guest(s, { callsign: 'two', deviceId: 'device-two-0002' });
    const ca = await client(url, 'pilot', a.token);
    const cb = await client(url, 'pilot', b.token);
    const screen = await client(url, 'arena');
    const ent1: EntitlementPush[] = [];
    const ent2: EntitlementPush[] = [];
    const cheers: CheerPush[] = [];
    ca.socket.on('pilot:entitlement', (m) => ent1.push(m));
    cb.socket.on('pilot:entitlement', (m) => ent2.push(m));
    screen.socket.on('raid:cheer', (m) => cheers.push(m));
    const inv = (
      await s.inject({
        method: 'POST',
        url: '/api/raids/current/pass/invoice',
        headers: auth(a.token),
      })
    ).json();
    await s.inject({
      method: 'POST',
      url: '/api/dev/mock-pay',
      headers: auth(a.token),
      payload: { invoiceId: inv.invoiceId },
    });
    await waitFor(() => ent1.length === 1);
    expect(ent1[0]).toMatchObject({ source: 'LIGHTNING', invoiceId: inv.invoiceId });
    await s.inject({
      method: 'POST',
      url: '/api/cheer',
      headers: auth(b.token),
      payload: { emoji: '👏' },
    });
    await waitFor(() => cheers.length === 1);
    expect(cheers[0]!.emoji).toBe('👏');
    expect(cheers[0]!.callsign).toMatch(/^PILOT-/);
    await new Promise((r) => setTimeout(r, 50));
    expect(ent2).toHaveLength(0);
  });

  it('pilot subscriptions accept the session cookie; bad tokens are refused', async () => {
    s = await makeServer(DEMO);
    const url = await listen(s);
    await expect(client(url, 'pilot', 'x'.repeat(40))).rejects.toThrow('UNAUTHORIZED');
    const a = await guest(s);
    const socket: ClientSocket = connect(url, {
      transports: ['websocket'],
      forceNew: true,
      extraHeaders: { cookie: `sw_session=${a.token}` },
    });
    sockets.push(socket);
    const res = await new Promise<{ ok: boolean }>((resolve) =>
      socket.on('connect', () => socket.emit('raid:subscribe', { role: 'pilot' }, resolve)),
    );
    expect(res.ok).toBe(true);
  });

  it('time sync returns server time', async () => {
    s = await makeServer(DEMO);
    const url = await listen(s);
    const c = await client(url);
    const t = await new Promise<number>((resolve) =>
      c.socket.emit('time:sync', Date.now(), resolve),
    );
    expect(t).toBe(s.clock.now());
  });
});
