import type { GameEvent, MatchState } from '@sats-wars/shared';
import { REGION_IDS, isClockRunning } from '@sats-wars/shared';

/** Engine-owned part of the public snapshot. The server adds payment/URL/presence fields. */
export function snapshotCore(state: MatchState, recentEvents: GameEvent[], serverTime: number) {
  return {
    matchId: state.matchId,
    configVersion: state.config.version,
    config: state.config,
    status: state.status,
    pausedFrom: state.pausedFrom,
    pauseReason: state.pauseReason,
    clockMs: state.clockMs,
    gameMs: state.gameMs,
    liveStartClock: state.liveStartClock,
    running: isClockRunning(state.status),
    serverTime,
    wave: state.wave,
    waveRemaining: state.waveRemaining,
    actionsThisTurn: state.actionsThisTurn,
    combo: state.combo,
    regions: REGION_IDS.map((id) => state.regions[id]),
    enemies: state.enemies,
    incoming: state.incoming,
    stats: state.stats,
    result: state.result,
    lastSeq: state.seq,
    recentEvents,
  };
}
