import type { GameEvent, RaidState } from '@sats-wars/shared';
import { REGION_IDS } from '@sats-wars/shared';
import { fmtClock } from './args';

/**
 * Raid log for the demo CLIs (spec I2): status lines every `everyMs` of game
 * time ("server tick": phase, SYNC, reserve, boss HP, cities) plus the events
 * that tell the story (warnings, city damage, SYNC, specials, the result).
 */
export class RaidLog {
  readonly lines: string[] = [];
  readonly records: Array<Record<string, unknown>> = [];
  private nextStatusAt = 0;

  constructor(private everyMs = 30_000) {}

  onEvents(events: GameEvent[], s: RaidState): void {
    while (s.status === 'LIVE' && s.gameMs >= this.nextStatusAt) {
      this.status(s, this.nextStatusAt);
      this.nextStatusAt += this.everyMs;
    }
    for (const e of events) {
      const line = describe(e, s);
      if (line) this.push(s.gameMs, e.type, line, e.data as Record<string, unknown>);
    }
  }

  status(s: RaidState, atMs = s.gameMs): void {
    const boss = s.enemies.find((e) => e.id === s.bossId);
    const standing = REGION_IDS.filter((id) => !s.cities[id].destroyed).length;
    const cityHp = REGION_IDS.reduce((a, id) => a + s.cities[id].hp, 0);
    this.push(
      atMs,
      'TICK',
      `TICK   phase=${s.phase} SYNC=${s.sync} reserve=${s.reserveEnergy} boss=${boss ? `${boss.hp}/${boss.hpMax}` : '—'} cities=${standing}/8 (hp ${cityHp})`,
      {
        phase: s.phase,
        sync: s.sync,
        reserve: s.reserveEnergy,
        bossHp: boss?.hp ?? null,
        citiesStanding: standing,
        cityHpTotal: cityHp,
      },
    );
  }

  private push(atMs: number, type: string, line: string, data: Record<string, unknown>): void {
    this.lines.push(`${fmtClock(atMs).padStart(5)}  ${line}`);
    this.records.push({ atMs, type, ...data });
  }
}

function describe(e: GameEvent, s: RaidState): string | null {
  switch (e.type) {
    case 'PHASE_CHANGED':
      return `PHASE  ${e.data.from} → ${e.data.to}`;
    case 'ENEMY_SPAWNED':
      return `SPAWN  ${e.data.enemy.kind}${e.data.enemy.training ? ' (training)' : ''} hp ${e.data.enemy.hp}`;
    case 'ENEMY_TELEGRAPH': {
      const t = e.data.telegraph;
      return `WARN   ⚠ ${e.data.enemyKind} ${t.kind} → ${t.targets.join(', ')} in ${Math.round((t.resolvesAt - t.startsAt) / 1000)}s`;
    }
    case 'ATTACK_RESOLVED':
      return `HIT    ${e.data.kind}: ${e.data.hits
        .map((h) => `${h.cityId} -${h.damage}${h.absorbed ? ` (shield ${h.absorbed})` : ''}`)
        .join(', ')}${e.data.robotHit ? ` · ${e.data.robotHit} hit` : ''}`;
    case 'CITY_DESTROYED':
      return `FALL   ${e.data.cityId} destroyed`;
    case 'CITY_REBUILT':
      return `BUILD  ${e.data.cityId} rebuilt by ${e.data.callsign}`;
    case 'ENEMY_DEFEATED':
      return `DOWN   ${e.data.kind}${e.data.callsign ? ` by ${e.data.callsign}` : ''}`;
    case 'SPECIAL_WINDOW_OPENED':
      return `CHANCE 神雷風陣 window open (SYNC ${s.sync}, reserve ${s.reserveEnergy})`;
    case 'SPECIAL_PROGRESS':
      return `JOIN   ${e.data.role} ${e.data.callsign}`;
    case 'SPECIAL_RESOLVED':
      return `SPECIAL ${e.data.outcome} damage ${e.data.damage}`;
    case 'RAID_ENDED': {
      const r = e.data.result;
      return `END    ${r.outcome} (${r.reason}) cities ${r.survivingCities}/8 score ${r.score.total} SYNC avg ${Math.round(r.syncAverage)}`;
    }
    default:
      return null;
  }
}
