import type { GameEvent } from '@sats-wars/shared';
import type { ArenaDirector } from './director';

/**
 * Map a confirmed game event to director cues. Shared by the venue screen and
 * the offline solo mode so both play identical reactions.
 */
export function cueFromEvent(director: ArenaDirector, e: GameEvent, roundsTotal = 8): void {
  switch (e.type) {
    case 'MATCH_STATUS_CHANGED':
      if (e.data.to === 'LIVE' && e.data.from === 'CREATED') director.play({ kind: 'seasonStart' });
      return;
    case 'ROUND_STARTED': {
      const r = e.data.round;
      director.play({
        kind: 'roundStart',
        roundIndex: r.index,
        roundsTotal,
        regionId: r.regionId,
        hpMax: r.hpMax,
        hp: r.hp,
      });
      return;
    }
    case 'ZAP':
      director.play({
        kind: 'zap',
        teamId: e.data.teamId,
        nickname: e.data.nickname,
        damage: e.data.damage,
        special: e.data.special,
        pinch: e.data.pinch,
        ko: e.data.code === 'KO',
        hp: e.data.hp,
      });
      return;
    case 'ROUND_ENDED':
      director.play({
        kind: 'roundEnd',
        winner: e.data.summary.winnerTeamId,
        reason: e.data.summary.endReason,
        regionId: e.data.summary.regionId,
        finisher: e.data.finisher?.nickname ?? null,
      });
      return;
    case 'SEASON_ENDED':
      if (e.data.result.reason !== 'CANCELLED') {
        director.play({ kind: 'seasonEnd', winner: e.data.result.winnerTeamId, regionCounts: e.data.result.regionCounts });
      }
      return;
    default:
      return;
  }
}
