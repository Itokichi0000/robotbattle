import { describe, expect, it } from 'vitest';
import type { BoardPatch, GameEvent } from './events';
import type { PublicRaidSnapshot } from './protocol';
import { DEFAULT_GAME_CONFIG } from './config';
import { REGION_IDS } from './regions';
import { RaidStore } from './store';

const stats = {
  tasks: 0,
  successes: 0,
  enemiesDefeated: 0,
  cityDamageTaken: 0,
  shieldAbsorbed: 0,
  energyRouted: 0,
  repairs: 0,
  syncSum: 0,
  syncSamples: 0,
  syncPeak: 0,
  assistActions: 0,
  peakPilots: 0,
};

function board(over: Partial<BoardPatch> = {}): BoardPatch {
  return {
    status: 'LIVE',
    phase: 'WAVE_1',
    pausedFrom: null,
    liveStartClock: 0,
    cities: REGION_IDS.map((cityId) => ({
      cityId,
      hp: 100,
      shield: 0,
      destroyed: false,
      rebuildReadyAt: 0,
    })),
    robots: [
      { robotId: 'RAIJIN', health: 100, energy: 20, componentDamaged: false },
      { robotId: 'FUJIN', health: 100, energy: 20, componentDamaged: false },
    ],
    reserveEnergy: 0,
    jammedUntil: 0,
    enemies: [],
    telegraphs: [],
    bossId: null,
    sync: 0,
    special: {
      status: 'LOCKED',
      opensAt: 390_000,
      closesAt: 420_000,
      contributors: {},
      resolvedAt: null,
    },
    stats,
    result: null,
    ...over,
  };
}

function snap(lastSeq = 0): PublicRaidSnapshot {
  return {
    raidId: 'r',
    configVersion: 'v',
    configHash: 'h',
    config: DEFAULT_GAME_CONFIG,
    pauseReason: null,
    clockMs: 0,
    gameMs: 0,
    running: true,
    serverTime: 0,
    ...board(),
    crew: [],
    lastSeq,
    recentEvents: [],
    lobbyEndsAt: null,
    joinOpen: true,
    passMode: 'FREE',
    ticketPriceSats: 21,
    paymentsEnabled: true,
    paymentMode: 'mock',
    playUrl: '',
    eventId: 'local',
    broadcast: null,
    namesHidden: false,
    demoMode: true,
    bestScore: null,
  };
}

function ev(seq: number, over: Partial<BoardPatch> = {}, raidId = 'r'): GameEvent {
  return {
    raidId,
    seq,
    t: 1000 * seq,
    gameMs: 1000 * seq,
    type: 'SYNC_CHANGED',
    data: { sync: 8, delta: 8, reason: 'COOP' },
    patch: board({ sync: 8, ...over }),
  };
}

describe('RaidStore', () => {
  it('applies contiguous events as server post-state and ignores duplicates', () => {
    const s = new RaidStore();
    s.applySnapshot(snap(0));
    expect(s.applyEvent(ev(1), 0)).toBe('applied');
    expect(s.snapshot!.sync).toBe(8);
    expect(s.applyEvent(ev(1), 0)).toBe('duplicate');
    expect(s.applyEvent(ev(3), 0)).toBe('gap');
    expect(s.applyEvent(ev(2, {}, 'other'), 0)).toBe('gap');
  });

  it('keeps the crew unless the event carries it, and re-anchors the clock', () => {
    const s = new RaidStore();
    s.applySnapshot({
      ...snap(0),
      crew: [{ pilotId: 'p', callsign: 'A', role: 'GUNNER', robot: 'RAIJIN', isBot: false }],
    });
    s.applyEvent(ev(1), 5000);
    expect(s.snapshot!.crew).toHaveLength(1);
    expect(s.snapshot!.gameMs).toBe(1000);
    expect(s.snapshot!.serverTime).toBe(5000);
    s.applyEvent(ev(2, { crew: [] }), 6000);
    expect(s.snapshot!.crew).toHaveLength(0);
  });

  it('older snapshots of the same raid are ignored; clock ticks ahead mean a gap', () => {
    const s = new RaidStore();
    s.applySnapshot(snap(5));
    expect(s.applySnapshot(snap(3))).toBe('ignored');
    expect(
      s.applyClock({
        raidId: 'r',
        status: 'LIVE',
        clockMs: 1,
        gameMs: 1,
        liveStartClock: 0,
        running: true,
        serverTime: 1,
        lastSeq: 9,
      }),
    ).toBe('gap');
  });
});
