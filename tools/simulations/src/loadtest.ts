/**
 * Load / latency probe against a RUNNING game server in mock payment mode.
 *
 *   pnpm --filter @sats-wars/simulations exec tsx src/loadtest.ts \
 *     --url http://localhost:4000 --password <ADMIN_PASSWORD> --pilots 100 --spectators 300 --duration 60000
 *
 * Steps: switches the event to FREE passes (mock server only), opens the lobby
 * and starts the raid; N guest pilots board (seats spread evenly); S spectator
 * sockets subscribe; every pilot loops request mission → play (solver) →
 * submit. Reports HTTP latency for mission/submit and the time from submit
 * until EVERY spectator socket received that pilot's TASK_RESOLVED event.
 * Never run against a production server with real payments.
 */
import { io, type Socket } from 'socket.io-client';
import type { GameEvent, Role, SubmitResponse, TaskResponse } from '@sats-wars/shared';
import { ROLES } from '@sats-wars/shared';
import { solveTask } from '@sats-wars/game-engine';

const args = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const URL_ = arg('url', 'http://localhost:4000');
const PASSWORD = arg('password', process.env.ADMIN_PASSWORD ?? '');
const PILOTS = Number(arg('pilots', '100'));
const SPECTATORS = Number(arg('spectators', '200'));
const DURATION_MS = Number(arg('duration', '60000'));

async function call<T>(
  method: string,
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; json: T }> {
  const r = await fetch(URL_ + path, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: URL_,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as T };
}
async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const r = await call<T>('POST', path, body, token);
  if (r.status >= 400) throw new Error(`${path} ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

function pctl(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!PASSWORD) throw new Error('--password (ADMIN_PASSWORD) is required');
  const snap = (await (await fetch(`${URL_}/api/public/current-raid`)).json()) as {
    snapshot: { paymentMode: string; status: string };
  };
  if (snap.snapshot.paymentMode !== 'mock')
    throw new Error('Refusing to run: server is not in PAYMENT_MODE=mock');
  const { token: admin } = await post<{ token: string }>('/api/admin/login', {
    password: PASSWORD,
  });
  const cmd = (body: Record<string, unknown>) =>
    post('/api/admin/command', body, admin).catch(() => undefined);
  await cmd({ command: 'SET_PASS_MODE', mode: 'FREE' });
  await cmd({ command: 'SET_JOIN_STOPPED', stopped: false });
  const st = snap.snapshot.status;
  // A fresh, empty raid for every run (a running one must be ended first).
  if (st === 'LIVE' || st === 'PAUSED') await cmd({ command: 'END', reason: 'LOADTEST' });
  if (st !== 'CREATED' && st !== 'LOBBY_OPEN') await cmd({ command: 'NEXT_RAID' });
  await cmd({ command: 'OPEN_LOBBY' });

  // Spectators
  const sockets: Socket[] = [];
  const firstSeen = new Map<string, { count: number; last: number }>();
  for (let i = 0; i < SPECTATORS; i++) {
    const s = io(URL_, {
      transports: ['websocket'],
      forceNew: true,
      extraHeaders: { origin: URL_ },
    });
    s.on('connect', () => s.emit('raid:subscribe', { role: 'spectator' }));
    s.on('raid:event', (e: GameEvent) => {
      if (e.type !== 'TASK_RESOLVED') return;
      const k = `${e.data.pilotId}:${e.seq}`;
      const cur = firstSeen.get(k) ?? { count: 0, last: 0 };
      cur.count++;
      cur.last = performance.now();
      firstSeen.set(k, cur);
    });
    sockets.push(s);
  }
  await sleep(2000);
  const connected = sockets.filter((s) => s.connected).length;

  // Pilots board with evenly spread seats.
  const t0 = performance.now();
  const pilots: Array<{ token: string; id: string; role: Role }> = [];
  await Promise.all(
    Array.from({ length: PILOTS }, async (_, i) => {
      const r = await post<{ token: string; pilot: { pilotId: string } }>('/api/auth/guest', {
        callsign: `load${i}`,
      });
      const role = ROLES[i % ROLES.length]!;
      await post('/api/raids/current/board', { role }, r.token);
      pilots.push({ token: r.token, id: r.pilot.pilotId, role });
    }),
  );
  const boardMs = performance.now() - t0;
  await cmd({ command: 'START' });

  const reqLat: number[] = [];
  const subLat: number[] = [];
  const fanout: number[] = [];
  const counts = { tasks: 0, successes: 0, refused: 0, errors: 0, rateLimited: 0 };
  const refusedBy: Record<string, number> = {};
  const until = performance.now() + DURATION_MS;
  const loops = pilots.map(async (p) => {
    await sleep(Math.random() * 3000);
    while (performance.now() < until) {
      try {
        const a = performance.now();
        const r = await call<TaskResponse>('POST', '/api/raids/current/tasks', {}, p.token);
        reqLat.push(performance.now() - a);
        if (r.status === 429) {
          counts.rateLimited++;
          await sleep(2000);
          continue;
        }
        if (r.status >= 400 || r.json.code !== 'OK' || !r.json.task) {
          counts.refused++;
          refusedBy[r.json.code ?? r.status] = (refusedBy[r.json.code ?? r.status] ?? 0) + 1;
          await sleep(
            r.json.cooldownUntil ? Math.max(500, r.json.cooldownUntil - r.json.gameMs) : 2000,
          );
          continue;
        }
        const task = r.json.task;
        const input = solveTask(
          task.params,
          0.7,
          Math.random,
          900,
          task.target.kind === 'ENERGY' ? task.target.sink : undefined,
        );
        const playMs =
          'stopAtMs' in input ? input.stopAtMs : 'releaseAtMs' in input ? input.releaseAtMs : 2500;
        await sleep(playMs);
        const b = performance.now();
        const s = await post<SubmitResponse>(
          '/api/raids/current/tasks/submit',
          {
            taskId: task.taskId,
            clientSubmissionId: `lt-${Math.random().toString(36).slice(2)}`,
            input,
          },
          p.token,
        );
        subLat.push(performance.now() - b);
        counts.tasks++;
        if (s.result.ok && s.result.success > 0) counts.successes++;
        // Fan-out: the newest TASK_RESOLVED of this pilot reaching every spectator.
        const deadline = b + 10_000;
        let done = false;
        while (!done && performance.now() < deadline) {
          for (const [k, v] of firstSeen) {
            if (k.startsWith(`${p.id}:`) && v.count >= connected && v.last >= b) {
              fanout.push(v.last - b);
              firstSeen.delete(k);
              done = true;
              break;
            }
          }
          if (!done) await sleep(10);
        }
        await sleep(
          Math.max(0, s.result.cooldownUntil - s.result.atGameMs) + 500 + Math.random() * 2000,
        );
      } catch {
        counts.errors++;
        await sleep(1000);
      }
    }
  });
  await Promise.all(loops);
  for (const s of sockets) s.close();
  const round = (o: Record<string, number>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
  console.log(
    JSON.stringify(
      {
        pilots: PILOTS,
        spectatorsConnected: `${connected}/${SPECTATORS}`,
        boardAllMs: Math.round(boardMs),
        counts,
        refusedBy,
        requestMissionMs: round({
          p50: pctl(reqLat, 50),
          p95: pctl(reqLat, 95),
          max: Math.max(...reqLat),
        }),
        submitMs: round({ p50: pctl(subLat, 50), p95: pctl(subLat, 95), max: Math.max(...subLat) }),
        submitToAllSpectatorsMs: {
          ...round({ p50: pctl(fanout, 50), p95: pctl(fanout, 95), max: Math.max(...fanout) }),
          samples: fanout.length,
        },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
