import type { GameEvent } from '@sats-wars/shared';
import type { ArenaDirector } from './director';

/**
 * Map a confirmed game event to director cues. Shared by the venue screen and
 * the offline solo mode so both play identical reactions.
 */
export function cueFromEvent(director: ArenaDirector, e: GameEvent): void {
  switch (e.type) {
    case 'MATCH_STATUS_CHANGED':
      if (e.data.to === 'LIVE' && e.data.from === 'CREATED') director.play({ kind: 'campaignStart' });
      return;
    case 'WAVE_STARTED':
      director.play({ kind: 'waveStart', wave: e.data.wave, boss: e.data.boss });
      return;
    case 'PLAYER_ACTION':
      director.play({
        kind: 'action',
        action: e.data.action,
        regionId: e.data.regionId,
        nickname: e.data.nickname,
        damage: e.data.damage,
        kills: e.data.kills,
        liberated: e.data.liberated,
      });
      return;
    case 'ALIEN_TURN':
      director.play({
        kind: 'alienTurn',
        attacks: e.data.attacks,
        fell: e.data.fell,
        landed: e.data.landed.map((x) => x.regionId),
      });
      return;
    case 'ALIENS_LANDED':
      director.play({ kind: 'landed', regions: e.data.landed.map((x) => x.regionId) });
      return;
    case 'WAVE_CLEARED':
      director.play({ kind: 'waveCleared', wave: e.data.wave });
      return;
    case 'JAPAN_FALLEN':
      director.play({ kind: 'japanFallen', reachedWave: e.data.result.reachedWave });
      return;
    default:
      return;
  }
}
