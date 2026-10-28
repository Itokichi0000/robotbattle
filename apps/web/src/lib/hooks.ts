'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PublicRaidSnapshot, RoomRole } from '@sats-wars/shared';
import { RaidConnection } from './connection';

export function useRaidConnection(role: RoomRole, token: string | null = null): RaidConnection | null {
  const [conn, setConn] = useState<RaidConnection | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  useEffect(() => {
    const c = new RaidConnection(role, tokenRef.current);
    setConn(c);
    return () => c.close();
  }, [role]);
  return conn;
}

export function useRaid(conn: RaidConnection | null): PublicRaidSnapshot | null {
  return useSyncExternalStore(
    (cb) => (conn ? conn.store.subscribe(cb) : () => undefined),
    () => conn?.store.snapshot ?? null,
    () => null,
  );
}

export function useConnectionState(conn: RaidConnection | null) {
  return useSyncExternalStore(
    (cb) => (conn ? conn.onState(cb) : () => undefined),
    () => conn?.state ?? 'connecting',
    () => 'connecting' as const,
  );
}

export function usePilotsOnline(conn: RaidConnection | null): number {
  return useSyncExternalStore(
    (cb) => (conn ? conn.onState(cb) : () => undefined),
    () => conn?.pilotsOnline ?? 0,
    () => 0,
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
