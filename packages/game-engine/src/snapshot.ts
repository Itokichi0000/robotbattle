import type { GameEvent, RaidState } from '@sats-wars/shared';
import { REGION_IDS, isClockRunning } from '@sats-wars/shared';
import { crewOf } from './engine';

/**
 * Engine-owned part of the public snapshot (no tasks: a pilot's minigame
 * parameters are sent only to that pilot). The server adds payment, URL,
 * presence and moderation fields.
 */
export function snapshotCore(state: RaidState, recentEvents: GameEvent[], serverTime: number) {
  return {
    raidId: state.raidId,
    configVersion: state.config.version,
    configHash: state.configHash,
    config: state.config,
    status: state.status,
    phase: state.phase,
    pausedFrom: state.pausedFrom,
    pauseReason: state.pauseReason,
    clockMs: state.clockMs,
    gameMs: state.gameMs,
    liveStartClock: state.liveStartClock,
    running: isClockRunning(state.status),
    serverTime,
    cities: REGION_IDS.map((id) => state.cities[id]),
    robots: [state.robots.RAIJIN, state.robots.FUJIN],
    reserveEnergy: state.reserveEnergy,
    jammedUntil: state.jammedUntil,
    enemies: state.enemies,
    telegraphs: state.telegraphs,
    bossId: state.bossId,
    sync: state.sync,
    special: state.special,
    stats: state.stats,
    result: state.result,
    crew: crewOf(state),
    lastSeq: state.seq,
    recentEvents,
  };
}
