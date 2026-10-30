import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket } from 'socket.io-client';
import { buildApp, type BuildOptions, type BuiltApp } from './app';
import { parseEnv } from './env';

/**
 * Integration-test harness: a real server on a random port with an in-memory database and
 * a manual match clock. Each socket is its own "phone" (no multiplexing).
 */
export class TestServer {
  built!: BuiltApp;
  url = '';
  now = 0;
  readonly origin: string;
  private readonly sockets: Socket[] = [];

  constructor(
    private readonly envExtra: Record<string, string> = {},
    private readonly opts: Omit<BuildOptions, 'source'> = {},
  ) {
    this.origin = envExtra.PUBLIC_BASE_URL ?? 'http://localhost:4400';
  }

  async start(): Promise<this> {
    const env = parseEnv(
      {
        NODE_ENV: 'test',
        DATABASE_PATH: ':memory:',
        OPERATOR_PASSWORD: 'test-operator-password',
        MATCH_PRESET: 'TEST',
        MATCH_SEED: '42',
        PUBLIC_BASE_URL: this.origin,
        LOG_LEVEL: 'silent',
        LNBITS_WEBHOOK_SECRET: 'test-webhook-secret-0123456789',
        ...this.envExtra,
      },
      () => 'unused',
    );
    this.built = await buildApp(env, { ...this.opts, source: () => this.now, logger: false });
    await this.built.app.listen({ host: '127.0.0.1', port: 0 });
    this.url = `http://127.0.0.1:${(this.built.app.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    for (const s of this.sockets.splice(0)) s.close();
    await this.built.app.close();
  }

  get runtime() {
    return this.built.runtime;
  }

  /** Advances the match clock and runs server ticks, like 50 ms intervals would. */
  advance(ms: number): void {
    const end = this.now + ms;
    while (this.now < end) {
      this.now = Math.min(end, this.now + 50);
      this.built.runtime.tick();
    }
  }

  fetch(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (init.cookie) headers.cookie = init.cookie;
    return fetch(this.url + path, { ...init, headers });
  }

  post(
    path: string,
    body: unknown,
    cookie?: string,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return this.fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: this.origin, ...headers },
      body: JSON.stringify(body),
      cookie,
    });
  }

  async demoGuest(): Promise<string> {
    const res = await this.post('/api/auth/demo-guest', {});
    if (res.status !== 200) throw new Error(`demo guest ${res.status}`);
    return cookiePair(res, 'sw_pilot')!;
  }

  async operatorCookie(): Promise<string> {
    const res = await this.post('/api/operator/login', { password: 'test-operator-password' });
    if (res.status !== 200) throw new Error(`operator login ${res.status}`);
    return cookiePair(res, 'sw_operator')!;
  }

  connect(ns: string, cookie?: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const s = ioClient(`${this.url}${ns}`, {
        transports: ['websocket'],
        extraHeaders: cookie ? { cookie } : {},
        reconnection: false,
        forceNew: true,
      });
      this.sockets.push(s);
      s.once('connect', () => resolve(s));
      s.once('connect_error', (e) => reject(e));
    });
  }
}

export function cookiePair(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie()) {
    if (c.startsWith(`${name}=`)) return c.split(';')[0]!;
  }
  return null;
}

export function emitAck<T>(s: Socket, ev: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => s.emit(ev, payload, (r: T) => resolve(r)));
}

export function collect<T>(s: Socket, ev: string): T[] {
  const out: T[] = [];
  s.on(ev, (m: T) => out.push(m));
  return out;
}

/** Socket delivery is asynchronous; poll instead of guessing a delay. */
export async function eventually<T>(
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
export const key = () => `k-${Date.now().toString(36)}-${(n++).toString(36)}`.padEnd(10, 'x');
