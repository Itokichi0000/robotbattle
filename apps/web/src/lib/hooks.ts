'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PublicMatchSnapshot, RoomRole } from '@sats-wars/shared';
import { MatchConnection } from './connection';

export function useMatchConnection(
  role: RoomRole,
  token: string | null = null,
): MatchConnection | null {
  const [conn, setConn] = useState<MatchConnection | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  useEffect(() => {
    const c = new MatchConnection(role, tokenRef.current);
    setConn(c);
    return () => c.close();
  }, [role]);
  useEffect(() => {
    conn?.setToken(token);
  }, [conn, token]);
  return conn;
}

export function useSnapshot(conn: MatchConnection | null): PublicMatchSnapshot | null {
  return useSyncExternalStore(
    (cb) => (conn ? conn.store.subscribe(cb) : () => undefined),
    () => conn?.store.snapshot ?? null,
    () => null,
  );
}

export function useConnectionState(conn: MatchConnection | null) {
  return useSyncExternalStore(
    (cb) => (conn ? conn.onState(cb) : () => undefined),
    () => conn?.state ?? 'connecting',
    () => 'connecting' as const,
  );
}

/** Re-render every `ms` (for countdowns). */
export function useTicker(ms = 250): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}
