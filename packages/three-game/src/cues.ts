import type { GameEvent } from '@sats-wars/shared';
import type { ArenaDirector } from './director';

/**
 * Map a confirmed raid event to director cues. Shared by the venue screen and
 * the offline demo so both play identical reactions.
 */
export function cueFromEvent(director: ArenaDirector, e: GameEvent): void {
  switch (e.type) {
    case 'RAID_STATUS_CHANGED':
      if (e.data.to === 'LIVE' && (e.data.from === 'LOBBY_OPEN' || e.data.from === 'CREATED')) director.play({ kind: 'raidStart' });
      return;
    case 'PHASE_CHANGED':
      director.play({ kind: 'phase', phase: e.data.to });
      return;
    case 'PILOT_BOARDED':
      director.play({ kind: 'boarded', callsign: e.data.callsign, robot: e.data.robot });
      return;
    case 'ENEMY_TELEGRAPH':
      director.play({ kind: 'telegraph', enemyId: e.data.telegraph.enemyId, enemyKind: e.data.enemyKind, targets: e.data.telegraph.targets });
      return;
    case 'TASK_RESOLVED':
      director.play({ kind: 'task', role: e.data.role, robot: e.data.robot, success: e.data.success, effect: e.data.effect, callsign: e.data.callsign, assist: e.data.assist });
      return;
    case 'ATTACK_RESOLVED':
      director.play({ kind: 'attack', enemyId: e.data.enemyId, enemyKind: e.data.enemyKind, hits: e.data.hits, robotHit: e.data.robotHit, jam: e.data.kind === 'JAM' });
      return;
    case 'ENEMY_SPAWNED':
      director.play({ kind: 'enemySpawned', enemyId: e.data.enemy.id, enemyKind: e.data.enemy.kind });
      return;
    case 'ENEMY_DEFEATED':
      director.play({ kind: 'enemyDefeated', enemyId: e.data.enemyId, enemyKind: e.data.kind, callsign: e.data.callsign });
      return;
    case 'CITY_DESTROYED':
      director.play({ kind: 'cityDestroyed', cityId: e.data.cityId });
      return;
    case 'CITY_REBUILT':
      director.play({ kind: 'cityRebuilt', cityId: e.data.cityId, callsign: e.data.callsign });
      return;
    case 'SPECIAL_WINDOW_OPENED':
      director.play({ kind: 'specialOpen' });
      return;
    case 'SPECIAL_PROGRESS':
      director.play({ kind: 'specialProgress', role: e.data.role, callsign: e.data.callsign });
      return;
    case 'SPECIAL_RESOLVED':
      director.play({ kind: 'specialResolved', outcome: e.data.outcome, damage: e.data.damage, bossId: e.patch.bossId, cityHits: e.data.cityHits });
      return;
    case 'RAID_ENDED':
      director.play({ kind: 'raidEnded', result: e.data.result });
      return;
    default:
      return;
  }
}
