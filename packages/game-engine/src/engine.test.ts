import { describe, expect, it } from 'vitest';
import type { Enemy, GameConfig, MatchState, PlayerAction, RegionId } from '@sats-wars/shared';
import { REGION_IDS, makeGameConfig } from '@sats-wars/shared';
import { type EngineCommand, createMatchState, reduce, replay } from './engine';
import { enemyStats, recommendAction, threats, waveSize } from './rules';

const C = makeGameConfig();
let clock = 0;

function started(cfg: GameConfig = C, seed = 7): MatchState {
  clock = 0;
  return reduce(createMatchState('m', cfg, seed), { type: 'START', t: 0 }).state;
}

/** Replace the aliens on the map (tests only: the reducer clones its input). */
function board(s: MatchState, enemies: Array<Partial<Enemy>>, incoming: MatchState['incoming'] = []): MatchState {
  s.enemies = enemies.map((e, i) => ({ id: 100 + i, kind: 'SCOUT', regionId: 'kanto', hp: 30, hpMax: 30, attack: 8, ...e }));
  s.incoming = incoming;
  s.nextEnemyId = 500;
  return s;
}

function act(s: MatchState, action: PlayerAction, extra: { regionId?: RegionId; enemyId?: number } = {}) {
  clock += 1000;
  return reduce(s, { type: 'ACT', t: clock, participantId: 'p1', nickname: 'たろう', action, ...extra });
}

describe('campaign start', () => {
  it('starts wave 1 with aliens already on the map and the next landing announced', () => {
    const s = started();
    expect(s.status).toBe('LIVE');
    expect(s.wave).toBe(1);
    expect(s.enemies.length).toBeGreaterThan(0);
    expect(s.incoming.length).toBe(1);
    expect(s.waveRemaining).toBe(waveSize(C, 1) - s.enemies.length - s.incoming.length);
  });

  it('nothing happens with time alone: aliens only move when players act', () => {
    const s = started();
    const r = reduce(s, { type: 'TICK', t: 3_600_000 });
    expect(r.events).toEqual([]);
    expect(r.state.enemies).toEqual(s.enemies);
    expect(r.state.regions).toEqual(s.regions);
  });
});

describe('player actions', () => {
  it('RAIJIN finishes one alien; the action counts toward the next alien turn and the combo', () => {
    const s = board(started(), [{ regionId: 'kanto', hp: 30 }, { regionId: 'kanto', hp: 70, attack: 15 }]);
    const r = act(s, 'RAIJIN', { regionId: 'kanto' });
    const res = r.outcome.kind === 'action' ? r.outcome.result : null;
    // Prefers the alien this hit can finish.
    expect(res).toMatchObject({ ok: true, action: 'RAIJIN', damage: 30, kills: 1 });
    expect(r.state.enemies.map((e) => e.id)).toEqual([101]);
    expect(r.state.actionsThisTurn).toBe(1);
    expect(r.state.combo).toBe(1);
    expect(r.state.stats).toMatchObject({ actions: 1, kills: 1 });
    expect(r.events[0]).toMatchObject({ type: 'PLAYER_ACTION', data: { nickname: 'たろう', action: 'RAIJIN', kills: 1 } });
  });

  it('RAIJIN on a named alien hits that one', () => {
    const s = board(started(), [{ regionId: 'kanto', hp: 30 }, { regionId: 'tohoku', hp: 70 }]);
    const r = act(s, 'RAIJIN', { enemyId: 101 });
    expect(r.state.enemies.find((e) => e.id === 101)!.hp).toBe(70 - C.raijinDamage);
  });

  it('FUJIN hits every alien in the region', () => {
    const s = board(started(), [
      { regionId: 'kinki', hp: 30 },
      { regionId: 'kinki', hp: 15 },
      { regionId: 'kanto', hp: 30 },
    ]);
    const r = act(s, 'FUJIN', { regionId: 'kinki' });
    expect(r.state.enemies.map((e) => [e.id, e.hp])).toEqual([
      [100, 10],
      [102, 30],
    ]);
  });

  it('invalid actions are free: nothing changes and no turn progress', () => {
    const s = board(started(), [{ regionId: 'kanto' }]);
    for (const [action, extra, code] of [
      ['RAIJIN', { regionId: 'kyushu' }, 'NO_TARGET'],
      ['FUJIN', { regionId: 'kyushu' }, 'NO_TARGET'],
      ['COMBO', { regionId: 'kanto' }, 'COMBO_NOT_READY'],
    ] as const) {
      const r = act(s, action, extra);
      expect(r.outcome).toMatchObject({ kind: 'action', result: { ok: false, code } });
      expect(r.events).toEqual([]);
      expect(r.state.actionsThisTurn).toBe(0);
    }
    const shielded = act(s, 'SHIELD', { regionId: 'kanto' }).state;
    expect(act(shielded, 'SHIELD', { regionId: 'kanto' }).outcome).toMatchObject({ result: { code: 'ALREADY_SHIELDED' } });
    const paused = reduce(s, { type: 'PAUSE', t: clock, reason: 'x' }).state;
    expect(act(paused, 'RAIJIN', { regionId: 'kanto' }).outcome).toMatchObject({ result: { code: 'PAUSED' } });
    expect(act(createMatchState('m', C), 'AUTO').outcome).toMatchObject({ result: { code: 'NOT_LIVE' } });
  });

  it('the combo wipes a region and repairs it, then the gauge starts over', () => {
    const s = board(started(), [
      { regionId: 'kanto', hp: 140 },
      { regionId: 'kanto', hp: 100 },
    ]);
    s.combo = C.comboGaugeMax;
    s.regions.kanto.cityHp = 30;
    const r = act(s, 'COMBO', { regionId: 'kanto' });
    expect(r.outcome).toMatchObject({ result: { ok: true, kills: 2 } });
    expect(r.state.regions.kanto.cityHp).toBe(30 + C.comboHeal);
    expect(r.state.combo).toBe(0);
    expect(r.state.stats.combos).toBe(1);
  });
});

describe('alien turn', () => {
  /** Hit a tough alien in `region` until the alien turn happens. */
  function finishTurn(s: MatchState, region: RegionId): ReturnType<typeof reduce> {
    for (let i = 0; i < 100; i++) {
      const r = act(s, 'RAIJIN', { regionId: region });
      if (r.outcome.kind !== 'action' || !r.outcome.result.ok) throw new Error('action failed');
      if (r.outcome.result.triggeredAlienTurn) return r;
      s = r.state;
    }
    throw new Error('no alien turn');
  }

  it('comes after actionsPerTurn actions and does exactly what was announced', () => {
    const s = board(started(), [
      { regionId: 'tohoku', attack: 12 },
      { regionId: 'tohoku', attack: 10 },
      { regionId: 'kyushu', attack: 8 },
    ], [{ kind: 'WALKER', regionId: 'chubu', spread: false }]);
    s.regions.kyushu.shield = 5;
    const promised = threats(s);
    expect(promised.tohoku).toMatchObject({ damageNext: 22, willFall: false });
    expect(promised.kyushu.damageNext).toBe(3);
    // Hit a far-away tank so the announced numbers are untouched.
    s.enemies.push({ id: 900, kind: 'MOTHERSHIP', regionId: 'hokkaido', hp: 5000, hpMax: 5000, attack: 0 });
    const last = finishTurn(s, 'hokkaido');
    const cur = last.state;
    const turn = last.events.find((e) => e.type === 'ALIEN_TURN')!;
    expect(turn).toBeDefined();
    expect(cur.regions.tohoku.cityHp).toBe(C.cityHpMax - 22);
    expect(cur.regions.kyushu.cityHp).toBe(C.cityHpMax - 3);
    expect(cur.regions.kyushu.shield).toBe(0);
    expect(cur.enemies.some((e) => e.kind === 'WALKER' && e.regionId === 'chubu')).toBe(true);
    expect(cur.actionsThisTurn).toBe(0);
    expect(cur.stats.alienTurns).toBe(1);
  });

  it('a region falls at 0, then spreads aliens into a standing neighbour; liberating it restores the city', () => {
    const s = board(started(), [{ regionId: 'hokkaido', attack: 200, hp: 30 }, { regionId: 'kyushu', hp: 5000, attack: 0 }]);
    const r = finishTurn(s, 'kyushu');
    expect(r.state.regions.hokkaido).toMatchObject({ fallen: true, cityHp: 0 });
    expect(r.events.find((e) => e.type === 'ALIEN_TURN')).toMatchObject({ data: { fell: ['hokkaido'] } });
    // Hokkaido's only neighbour is Tohoku.
    expect(r.state.incoming).toContainEqual({ kind: 'SCOUT', regionId: 'tohoku', spread: true });
    const lib = act(r.state, 'RAIJIN', { regionId: 'hokkaido' });
    expect(lib.outcome).toMatchObject({ result: { liberated: true } });
    expect(lib.state.regions.hokkaido).toMatchObject({ fallen: false, cityHp: C.liberateHp });
    expect(lib.state.stats.regionsLiberated).toBe(1);
  });

  it('Japan falls when every region is captured: the campaign ends with a record', () => {
    const s = board(
      started(),
      REGION_IDS.map((regionId) => ({ regionId, attack: 1000, hp: 1000 })),
    );
    s.wave = 4;
    const r = finishTurn(s, 'kanto');
    expect(r.state.status).toBe('FINISHED');
    expect(r.state.result).toMatchObject({ reason: 'JAPAN_FALLEN', reachedWave: 4, wavesCleared: 3 });
    expect(r.events.map((e) => e.type)).toContain('JAPAN_FALLEN');
    expect(act(r.state, 'AUTO').outcome).toMatchObject({ result: { ok: false, code: 'NOT_LIVE' } });
  });

});

describe('waves', () => {
  it('clearing the map ends the wave: cities are repaired and the next wave lands at once', () => {
    const s = board(started(), [{ regionId: 'kanto', hp: 10 }]);
    s.waveRemaining = 0;
    s.regions.kanto.cityHp = 40;
    const r = act(s, 'RAIJIN', { regionId: 'kanto' });
    const types = r.events.map((e) => e.type);
    expect(types).toEqual(['PLAYER_ACTION', 'WAVE_CLEARED', 'WAVE_STARTED', 'ALIENS_LANDED']);
    expect(r.state.wave).toBe(2);
    expect(r.state.regions.kanto.cityHp).toBe(40 + C.waveClearHeal);
    expect(r.state.enemies.length).toBeGreaterThan(0);
  });

  it('an empty map with aliens still to come brings the next landing forward', () => {
    const s = board(started(), [{ regionId: 'kanto', hp: 10 }], [{ kind: 'SCOUT', regionId: 'kinki', spread: false }]);
    s.waveRemaining = 2;
    const r = act(s, 'RAIJIN', { regionId: 'kanto' });
    expect(r.events.map((e) => e.type)).toEqual(['PLAYER_ACTION', 'ALIENS_LANDED']);
    expect(r.state.enemies.map((e) => e.regionId)).toEqual(['kinki']);
    expect(r.state.wave).toBe(1);
  });

  it('every 5th wave opens with a mothership; aliens get tougher each wave', () => {
    const s = board(started(), [{ regionId: 'kanto', hp: 10 }]);
    s.wave = 4;
    s.waveRemaining = 0;
    const r = act(s, 'RAIJIN', { regionId: 'kanto' });
    expect(r.state.wave).toBe(5);
    const all = [...r.state.enemies, ...r.state.incoming];
    expect(all.some((e) => e.kind === 'MOTHERSHIP')).toBe(true);
    expect(enemyStats(C, 'SCOUT', 5).hp).toBeGreaterThan(enemyStats(C, 'SCOUT', 1).hp);
  });
});

describe('おすすめ (AUTO)', () => {
  it('saves the region in most danger and prefers a kill', () => {
    const s = board(started(), [
      { regionId: 'kyushu', hp: 30, attack: 8 },
      { regionId: 'kanto', hp: 30, attack: 20 },
    ]);
    s.regions.kanto.cityHp = 30;
    expect(recommendAction(s)).toMatchObject({ action: 'RAIJIN', regionId: 'kanto' });
    const r = act(s, 'AUTO');
    expect(r.events[0]).toMatchObject({ data: { auto: true, action: 'RAIJIN', regionId: 'kanto' } });
  });

  it('raises a barrier when the region cannot be saved by attacking in time', () => {
    const s = board(started(), [{ regionId: 'kanto', hp: 900, attack: 40 }]);
    s.regions.kanto.cityHp = 30;
    expect(recommendAction(s)).toMatchObject({ action: 'SHIELD', regionId: 'kanto' });
  });

  it('fires the combo when it is ready and worth it', () => {
    const s = board(started(), [{ regionId: 'kinki' }, { regionId: 'kinki' }]);
    s.combo = C.comboGaugeMax;
    expect(recommendAction(s)).toMatchObject({ action: 'COMBO', regionId: 'kinki' });
  });
});

describe('determinism', () => {
  it('replaying the command log gives the same state; the input is never mutated', () => {
    const cmds: EngineCommand[] = [{ type: 'START', t: 0 }];
    let s = reduce(createMatchState('m', C, 42), cmds[0]!).state;
    const before = structuredClone(s);
    for (let i = 0; i < 60; i++) {
      const cmd: EngineCommand = { type: 'ACT', t: 1000 + i * 500, participantId: `p${i % 3}`, nickname: 'n', action: 'AUTO' };
      cmds.push(cmd);
      const r = reduce(s, cmd);
      if (i === 0) expect(s).toEqual(before);
      s = r.state;
    }
    expect(s.stats.alienTurns).toBeGreaterThan(3);
    expect(replay('m', C, 42, cmds).state).toEqual(s);
  });

  it('seq numbers are contiguous and every board event carries the full board', () => {
    let s = started();
    const seqs: number[] = [];
    for (let i = 0; i < 20; i++) {
      const r = act(s, 'AUTO');
      for (const e of r.events) {
        seqs.push(e.seq);
        if (e.type === 'PLAYER_ACTION' || e.type === 'ALIEN_TURN') expect(e.patch.regions).toHaveLength(8);
      }
      s = r.state;
    }
    expect(seqs).toEqual(seqs.map((_, i) => seqs[0]! + i));
  });
});
