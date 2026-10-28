import { describe, expect, it } from 'vitest';
import type { GameEvent } from './events';
import type { PublicMatchSnapshot } from './protocol';
import { DEFAULT_GAME_CONFIG } from './config';
import { REGION_IDS } from './regions';
import { MatchStore } from './store';

const team = (teamId: 'RAIJIN' | 'FUJIN') => ({
  teamId,
  robotId: teamId === 'RAIJIN' ? ('raijin' as const) : ('fujin' as const),
  regionsWon: 0,
  zapsTotal: 0,
  specialsTotal: 0,
  kos: 0,
});

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
    phase: 'ROUND',
    phaseEndsAt: 60_000,
    roundOrder: [...REGION_IDS],
    roundIndex: 0,
    round: null,
    rounds: [],
    regions: REGION_IDS.map((regionId) => ({ regionId, ownerTeamId: null, roundIndex: null })),
    teams: { RAIJIN: team('RAIJIN'), FUJIN: team('FUJIN') },
    result: null,
    lastSeq,
    recentEvents: [],
    supporters: { RAIJIN: 0, FUJIN: 0 },
    paymentsEnabled: true,
    paymentMode: 'mock',
    playUrl: '',
  };
}

function zap(seq: number): GameEvent {
  return {
    matchId: 'm',
    seq,
    t: 1000,
    gameMs: 1000,
    type: 'ZAP',
    data: { participantId: 'p', nickname: 'n', teamId: 'FUJIN', code: 'HIT', damage: 10, special: false, pinch: false, hp: { RAIJIN: 190, FUJIN: 200 } },
    patch: { teams: [{ ...team('FUJIN'), zapsTotal: 1 }] },
  };
}

describe('MatchStore', () => {
  it('applies in-order events and ignores duplicates', () => {
    const s = new MatchStore();
    s.applySnapshot(snap(5));
    expect(s.applyEvent(zap(6), 10)).toBe('applied');
    expect(s.snapshot!.teams.FUJIN.zapsTotal).toBe(1);
    expect(s.applyEvent(zap(6), 10)).toBe('duplicate');
    expect(s.snapshot!.lastSeq).toBe(6);
  });
  it('reports gaps and other-match events', () => {
    const s = new MatchStore();
    expect(s.applyEvent(zap(1), 0)).toBe('gap');
    s.applySnapshot(snap(5));
    expect(s.applyEvent(zap(8), 0)).toBe('gap');
    expect(s.applyEvent({ ...zap(6), matchId: 'other' }, 0)).toBe('gap');
    expect(
      s.applyClock({ matchId: 'm', status: 'LIVE', clockMs: 1, gameMs: 1, liveStartClock: 0, running: true, serverTime: 1, lastSeq: 9 }),
    ).toBe('gap');
  });
  it('ignores stale snapshots of the same match and tracks presence', () => {
    const s = new MatchStore();
    s.applySnapshot(snap(5));
    expect(s.applySnapshot(snap(3))).toBe('ignored');
    s.applyPresence({ RAIJIN: 3, FUJIN: 4 });
    expect(s.snapshot!.supporters.FUJIN).toBe(4);
    expect(s.applySnapshot({ ...snap(1), matchId: 'next' })).toBe('applied');
  });
});
