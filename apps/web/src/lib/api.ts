import { gameServerUrl } from './serverUrl';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await fetch(`${gameServerUrl()}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'サーバーに接続できません / Cannot reach the game server');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // fallthrough
  }
  if (!res.ok) {
    const j = (json ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, j.error ?? 'HTTP_ERROR', j.message ?? `HTTP ${res.status}`);
  }
  return json as T;
}

/** Random id for idempotent action retries. */
export function newClientActionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Safe localStorage wrapper: private mode / blocked storage must not crash the UI. */
export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};
