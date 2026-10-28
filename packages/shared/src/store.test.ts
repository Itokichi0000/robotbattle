import { describe, expect, it } from 'vitest';
import type { GameEvent } from './events';
import type { PublicMatchSnapshot } from './protocol';
import { DEFAULT_GAME_CONFIG } from './config';
import { REGION_IDS } from './regions';
import { MatchStore } from './store';

function snap(lastSeq = 0): PublicMatchSnapshot {
  return {
    matchId: 'm',
    configVersion: 'v',
    config: DEFAULT_GAME_CONFIG,
    status: 'LIVE',
    pausedFrom: null,
    pauseReason: null,
    clockMs: 0,
    gameMs: 0,
    liveStartClock: 0,
    running: true,
    serverTime: 0,
    wave: 1,
    waveRemaining: 3,
    actionsThisTurn: 0,
    combo: 0,
    regions: REGION_IDS.map((regionId) => ({ regionId, cityHp: 100, fallen: false, shield: 0 })),
    enemies: [{ id: 1, kind: 'SCOUT', regionId: 'kanto', hp: 30, hpMax: 30, attack: 8 }],
    incoming: [],
    stats: { actions: 0, kills: 0, alienTurns: 0, regionsLost: 0, regionsLiberated: 0, combos: 0 },
    result: null,
    lastSeq,
    recentEvents: [],
    playersOnline: 0,
    bestWave: 0,
    paymentsEnabled: true,
    paymentMode: 'mock',
    playUrl: '',
  };
}

function act(seq: number): GameEvent {
  return {
    matchId: 'm',
    seq,
    t: 1000,
    gameMs: 1000,
    type: 'PLAYER_ACTION',
    data: { participantId: 'p', nickname: 'n', action: 'RAIJIN', auto: false, regionId: 'kanto', targetIds: [1], damage: 30, kills: 1, liberated: false },
    patch: { enemies: [], actionsThisTurn: 1, combo: 1 },
  };
}

describe('MatchStore', () => {
  it('applies in-order events and ignores duplicates', () => {
    const s = new MatchStore();
    s.applySnapshot(snap(5));
    expect(s.applyEvent(act(6), 10)).toBe('applied');
    expect(s.snapshot!.enemies).toEqual([]);
    expect(s.snapshot!.actionsThisTurn).toBe(1);
    expect(s.applyEvent(act(6), 10)).toBe('duplicate');
    expect(s.snapshot!.lastSeq).toBe(6);
  });
  it('reports gaps and other-match events', () => {
    const s = new MatchStore();
    expect(s.applyEvent(act(1), 0)).toBe('gap');
    s.applySnapshot(snap(5));
    expect(s.applyEvent(act(8), 0)).toBe('gap');
    expect(s.applyEvent({ ...act(6), matchId: 'other' }, 0)).toBe('gap');
    expect(
      s.applyClock({ matchId: 'm', status: 'LIVE', clockMs: 1, gameMs: 1, liveStartClock: 0, running: true, serverTime: 1, lastSeq: 9 }),
    ).toBe('gap');
  });
  it('ignores stale snapshots of the same match and tracks presence', () => {
    const s = new MatchStore();
    s.applySnapshot(snap(5));
    expect(s.applySnapshot(snap(3))).toBe('ignored');
    s.applyPresence(7);
    expect(s.snapshot!.playersOnline).toBe(7);
    expect(s.applySnapshot({ ...snap(1), matchId: 'next' })).toBe('applied');
  });
});
