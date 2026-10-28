import type { GameEvent } from '@sats-wars/shared';
import type { ArenaDirector } from './director';

/**
 * Map a confirmed game event to director cues. Shared by the venue screen and
 * the offline solo mode so both play identical cinematics.
 */
export function cueFromEvent(director: ArenaDirector, e: GameEvent): void {
  switch (e.type) {
    case 'ACTION_APPLIED': {
      const { code, regionId, teamId } = e.data;
      if (code === 'CHARGED') director.play({ kind: 'charge', teamId });
      else if (regionId && (code === 'CAPTURED' || code === 'CONTEST_BROKEN'))
        director.play({ kind: 'capture', regionId, teamId });
      else if (regionId && (code === 'CONTEST_STARTED' || code === 'SHIELD_BROKEN'))
        director.play({ kind: 'contest', regionId, teamId });
      else if (regionId && code === 'SHIELD_PLACED')
        director.play({ kind: 'shield', regionId, teamId });
      return;
    }
    case 'CLASH_RESOLVED':
      director.play({ kind: 'clash', clash: e.data.clash });
      return;
    case 'MATCH_STATUS_CHANGED':
      if (e.data.to === 'LIVE' && e.data.from === 'LOBBY') director.play({ kind: 'intro' });
      if (e.data.to === 'FINALIZING') director.play({ kind: 'final' });
      return;
    case 'MATCH_RESULT':
      if (e.data.result.reason !== 'CANCELLED')
        director.play({ kind: 'result', winner: e.data.result.winnerTeamId });
      return;
    default:
      return;
  }
}
