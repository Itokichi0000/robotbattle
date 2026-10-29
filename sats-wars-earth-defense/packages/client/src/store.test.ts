import type { MatchEventMsg, MatchSnapshotMsg } from '@swed/shared';
import { describe, expect, it } from 'vitest';
import { newClientId } from './ids';
import { MatchStore } from './store';

const snap = (matchId: string, version: number, t: number, paused = false) =>
  ({
    matchId,
    phase: 'WAVE_1',
    version,
    serverTime: t,
    state: { t, paused },
  }) as unknown as MatchSnapshotMsg;

const ev = (matchId: string, seq: number) =>
  ({
    eventId: `${matchId}:${seq}`,
    matchId,
    seq,
    serverTime: 0,
    type: 'match_paused',
    payload: { type: 'match_paused', seq, t: 0 },
  }) as MatchEventMsg;

describe('MatchStore', () => {
  it('ignores stale snapshots but accepts a new match', () => {
    const s = new MatchStore();
    expect(s.applySnapshot(snap('a', 5, 1000), 0)).toBe(true);
    expect(s.applySnapshot(snap('a', 4, 900), 0)).toBe(false);
    expect(s.applySnapshot(snap('b', 1, 0), 0)).toBe(true);
    expect(s.getState().snap?.matchId).toBe('b');
  });

  it('delivers each event once', () => {
    const s = new MatchStore();
    const got: number[] = [];
    s.onEvent((e) => got.push(e.seq));
    s.applyEvent(ev('a', 1));
    s.applyEvent(ev('a', 2));
    s.applyEvent(ev('a', 2));
    s.applyEvent(ev('a', 1));
    s.applyEvent(ev('b', 1));
    expect(got).toEqual([1, 2, 1]);
  });

  it('interpolates match time between snapshots and freezes while paused', () => {
    const s = new MatchStore();
    s.applySnapshot(snap('a', 1, 10_000), 500);
    expect(s.matchTime(800)).toBe(10_300);
    s.applySnapshot(snap('a', 2, 10_400, true), 900);
    expect(s.matchTime(5_000)).toBe(10_400);
  });

  it('reports reconnecting only after a first connection', () => {
    const s = new MatchStore();
    s.setConnection(false);
    expect(s.getState().reconnecting).toBe(false);
    s.setConnection(true);
    s.setConnection(false);
    expect(s.getState().reconnecting).toBe(true);
  });
});

describe('newClientId', () => {
  it('makes unique, schema-safe ids', () => {
    const a = newClientId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(newClientId()).not.toBe(a);
  });
});
