import { describe, expect, it } from 'vitest';
import type { GameEvent } from './events';
import type { PublicMatchSnapshot } from './protocol';
import { DEFAULT_GAME_CONFIG } from './config';
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
    teams: {
      RAIJIN: { teamId: 'RAIJIN', robotId: 'raijin', hp: 100, energy: 0, participantCount: 0, apRemaining: 0, apTotal: 0, actionCount: 0 },
      FUJIN: { teamId: 'FUJIN', robotId: 'fujin', hp: 100, energy: 0, participantCount: 0, apRemaining: 0, apTotal: 0, actionCount: 0 },
    },
    regions: [
      { regionId: 'kanto', kind: 'ENERGY', ownerTeamId: null, contestedByTeamId: null, contestedUntil: null, shieldCharges: 0, shieldExpiresAt: null, updatedAt: 0, revision: 0 },
    ],
    nextClash: { index: 0, atGameMs: 45_000 },
    clashes: [],
    result: null,
    lastSeq,
    recentEvents: [],
    leaders: { RAIJIN: [], FUJIN: [] },
    joinOpen: true,
    paymentsEnabled: true,
    paymentMode: 'mock',
    playUrl: '',
  };
}

function captureEvent(seq: number): GameEvent {
  return {
    matchId: 'm',
    seq,
    t: 1000,
    gameMs: 1000,
    type: 'ACTION_APPLIED',
    data: { participantId: 'p', nickname: 'n', teamId: 'FUJIN', actionType: 'ATTACK', regionId: 'kanto', code: 'CAPTURED' },
    patch: {
      regions: [{ regionId: 'kanto', kind: 'ENERGY', ownerTeamId: 'FUJIN', contestedByTeamId: null, contestedUntil: null, shieldCharges: 0, shieldExpiresAt: null, updatedAt: 1000, revision: 1 }],
    },
  };
}

describe('MatchStore', () => {
  it('applies in-order events and ignores duplicates', () => {
    const s = new MatchStore();
    s.applySnapshot(snap(5));
    expect(s.applyEvent(captureEvent(6), 10)).toBe('applied');
    expect(s.snapshot!.regions[0]!.ownerTeamId).toBe('FUJIN');
    expect(s.applyEvent(captureEvent(6), 10)).toBe('duplicate');
    expect(s.snapshot!.lastSeq).toBe(6);
  });
  it('reports gaps and other-match events', () => {
    const s = new MatchStore();
    expect(s.applyEvent(captureEvent(1), 0)).toBe('gap');
    s.applySnapshot(snap(5));
    expect(s.applyEvent(captureEvent(8), 0)).toBe('gap');
    expect(s.applyEvent({ ...captureEvent(6), matchId: 'other' }, 0)).toBe('gap');
    expect(s.applyClock({ matchId: 'm', status: 'LIVE', clockMs: 1, gameMs: 1, liveStartClock: 0, running: true, serverTime: 1, lastSeq: 9 })).toBe('gap');
  });
  it('ignores stale snapshots of the same match', () => {
    const s = new MatchStore();
    s.applySnapshot(snap(5));
    expect(s.applySnapshot(snap(3))).toBe('ignored');
    expect(s.applySnapshot({ ...snap(1), matchId: 'next' })).toBe('applied');
  });
});
