import type { GameEvent, LeaderEntry, MatchState, TeamId } from '@sats-wars/shared';
import { isClockRunning } from '@sats-wars/shared';
import { contributionScore, rankParticipants } from './rules';

export function nextClashInfo(state: MatchState): { index: number; atGameMs: number } | null {
  if (
    state.status !== 'LIVE' &&
    state.status !== 'LOBBY' &&
    state.status !== 'PAUSED' &&
    state.status !== 'CREATED'
  )
    return null;
  if (state.status === 'PAUSED' && state.pausedFrom !== 'LIVE' && state.pausedFrom !== 'LOBBY')
    return null;
  const at = state.config.clashTimesMs[state.nextClashIndex];
  return at === undefined ? null : { index: state.nextClashIndex, atGameMs: at };
}

export function leaders(
  state: MatchState,
  teamId: TeamId,
  limit = 3,
  nicknameOf: (participantId: string, nickname: string) => string = (_id, n) => n,
): LeaderEntry[] {
  const members = Object.values(state.participants).filter((p) => p.teamId === teamId);
  return rankParticipants(members)
    .filter((p) => contributionScore(p.contribution) > 0)
    .slice(0, limit)
    .map((p) => ({
      participantId: p.participantId,
      nickname: nicknameOf(p.participantId, p.nickname),
      score: contributionScore(p.contribution),
      isBot: p.isBot,
    }));
}

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
    teams: state.teams,
    regions: state.regionOrder.map((id) => state.regions[id]),
    nextClash: nextClashInfo(state),
    clashes: state.clashes,
    result: state.result,
    lastSeq: state.seq,
    recentEvents,
  };
}
