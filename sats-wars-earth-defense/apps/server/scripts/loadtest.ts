/**
 * Venue load test against a running sandbox server: N phones in the crowd (D-033: no seats,
 * everyone plays), D big screens, one operator. Phones press what the screen recommends,
 * like the demo bots, through the real pilot socket (cookies, acks, limits).
 *
 *   OPERATOR_PASSWORD=... pnpm --filter @swed/server loadtest -- --url http://127.0.0.1:4400 \
 *     --pilots 40 --displays 3 --seconds 90 [--mash]
 *
 * Reports action round-trip latency, refusals, snapshot cadence and size per screen.
 * Sandbox only: it signs in with DEMO GUEST and never touches payments.
 */
import { randomUUID } from 'node:crypto';
import { botChoose } from '@swed/game-engine';
import type { MatchSnapshotMsg, PublicMatchState } from '@swed/shared';
import { io, type Socket } from 'socket.io-client';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : def;
};
const url = arg('url', 'http://127.0.0.1:4400');
const pilots = Number(arg('pilots', '30'));
const displays = Number(arg('displays', '2'));
const seconds = Number(arg('seconds', '60'));
// --mash: every phone sends every 50 ms (a crowd hammering buttons): the free cooldown and the
// socket rate limit refuse the excess cheaply.
const mash = process.argv.includes('--mash');
const everyMs = mash ? 50 : 900;
const password = process.env.OPERATOR_PASSWORD;
if (!password) throw new Error('Set OPERATOR_PASSWORD');
const origin = new URL(url).origin;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) =>
  xs.length
    ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!
    : 0;

function cookieFrom(res: Response, name: string): string {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  if (!raw) throw new Error(`no ${name} cookie (HTTP ${res.status})`);
  return raw.split(';')[0]!;
}

function connect(ns: string, cookie?: string): Socket {
  return io(`${url}${ns}`, {
    transports: ['websocket'],
    forceNew: true,
    extraHeaders: { origin, ...(cookie ? { cookie } : {}) },
  });
}

// Operator: reset to an empty mech, start later.
const opRes = await fetch(`${url}/api/operator/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin },
  body: JSON.stringify({ password }),
});
const op = connect('/operator', cookieFrom(opRes, 'sw_operator'));
const opCmd = (cmd: object) =>
  op.timeout(5_000).emitWithAck('operator:command', cmd) as Promise<{
    ok: boolean;
    message?: string;
  }>;
await new Promise<void>((r) => op.once('connect', () => r()));
await opCmd({ command: 'SET_DEMO_BOTS', enabled: false });
await opCmd({ command: 'RESET' });

// Big screens: count snapshots, bytes and gaps.
const screens = Array.from({ length: displays }, () => {
  const s = connect('/display');
  const stat = { snaps: 0, bytes: 0, gaps: [] as number[], last: 0, events: 0 };
  s.on('match:snapshot', (m: MatchSnapshotMsg) => {
    const now = performance.now();
    if (stat.last) stat.gaps.push(now - stat.last);
    stat.last = now;
    stat.snaps += 1;
    stat.bytes += JSON.stringify(m).length;
  });
  s.on('match:event', () => (stat.events += 1));
  return { s, stat };
});

interface Phone {
  s: Socket;
  state: PublicMatchState | null;
  matchId: string;
}
const phones: Phone[] = [];
for (let i = 0; i < pilots; i++) {
  const res = await fetch(`${url}/api/auth/demo-guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: '{}',
  });
  const s = connect('/pilot', cookieFrom(res, 'sw_pilot'));
  const ph: Phone = { s, state: null, matchId: '' };
  s.on('match:snapshot', (m: MatchSnapshotMsg) => {
    ph.state = m.state;
    ph.matchId = m.matchId;
  });
  phones.push(ph);
}
await sleep(1_500);
console.log(`phones ${phones.length} (all in the crowd), screens ${displays}`);
console.log('START', await opCmd({ command: 'START' }));

const lat: number[] = [];
const refused = new Map<string, number>();
let sent = 0;
let lost = 0;
const until = performance.now() + seconds * 1_000;
await Promise.all(
  phones.map(async (ph) => {
    while (performance.now() < until) {
      await sleep(everyMs + Math.random() * 300);
      const st = ph.state;
      if (!st) continue;
      const kind = botChoose(st, Math.random(), 0.85);
      const t0 = performance.now();
      sent += 1;
      try {
        const r = (await ph.s.timeout(3_000).emitWithAck('pilot:action', {
          matchId: ph.matchId,
          clientActionId: randomUUID(),
          action: { kind },
        })) as { accepted: boolean; reasonCode?: string };
        lat.push(performance.now() - t0);
        if (!r.accepted)
          refused.set(r.reasonCode ?? '?', (refused.get(r.reasonCode ?? '?') ?? 0) + 1);
      } catch {
        lost += 1;
      }
    }
  }),
);

const health = (await (await fetch(`${url}/health`)).json()) as { phase: string };
const end = phones[0]?.state;
const report = {
  mode: mash ? 'mash (every 50 ms)' : 'crowd tapping ~1/s',
  pilots,
  displays,
  seconds,
  phase: health.phase,
  actions: {
    sent,
    acked: lat.length,
    lost,
    p50ms: pct(lat, 0.5),
    p95ms: pct(lat, 0.95),
    maxms: Math.max(0, ...lat),
  },
  refused: Object.fromEntries(refused),
  screens: screens.map(({ stat }) => ({
    snapshotsPerSec: +(stat.snaps / seconds).toFixed(1),
    avgSnapshotJsonKB: +(stat.bytes / Math.max(1, stat.snaps) / 1024).toFixed(1),
    gapP95ms: Math.round(pct(stat.gaps, 0.95)),
    gapMaxms: Math.round(Math.max(0, ...stat.gaps)),
    events: stat.events,
  })),
  match: end
    ? { t: end.t, players: end.players, boss: end.boss, mech: end.mechHp, stats: end.stats }
    : null,
};
console.log(JSON.stringify(report, null, 2));
await opCmd({ command: 'RESET' });
for (const p of phones) p.s.close();
for (const { s } of screens) s.close();
op.close();
process.exit(0);
