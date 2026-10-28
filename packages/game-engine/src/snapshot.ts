import type { GameEvent, MatchState } from '@sats-wars/shared';
import { REGION_IDS, isClockRunning } from '@sats-wars/shared';

/** Engine-owned part of the public snapshot. The server adds payment/URL fields. */
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
    phase: state.phase,
    phaseEndsAt: state.phaseEndsAt,
    roundOrder: state.roundOrder,
    roundIndex: state.roundIndex,
    round: state.round,
    rounds: state.rounds,
    regions: REGION_IDS.map((id) => state.regions[id]),
    teams: state.teams,
    result: state.result,
    lastSeq: state.seq,
    recentEvents,
  };
}
