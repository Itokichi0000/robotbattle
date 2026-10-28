import { describe, expect, it } from 'vitest';
import type { GameConfig, GameEvent, RaidState, Role, TaskInput } from '@sats-wars/shared';
import { DEFAULT_GAME_CONFIG, REGION_IDS, makeGameConfig } from '@sats-wars/shared';
import {
  type EngineCommand,
  type ReduceResult,
  type TaskChoice,
  createRaidState,
  reduce,
  replay,
} from './engine';
import { mulberry32 } from './random';
import { evaluateTask, reticleAt, routerParams, shortestHops, solveTask } from './tasks';

const S = 1000;

class Sim {
  state: RaidState;
  events: GameEvent[] = [];
  log: EngineCommand[] = [];
  t = 0;
  constructor(
    public config: GameConfig = DEFAULT_GAME_CONFIG,
    seed = 7,
  ) {
    this.state = createRaidState('r1', config, seed);
  }
  run(cmd: EngineCommand): ReduceResult {
    const r = reduce(this.state, cmd);
    this.state = r.state;
    this.events.push(...r.events);
    this.log.push(cmd);
    return r;
  }
  /** Advance to game second `sec` (assumes the raid started at t = 0 and was never paused). */
  to(sec: number) {
    this.t = Math.max(this.t, sec * S);
    return this.run({ type: 'TICK', t: this.t });
  }
  wait(ms: number) {
    this.t += ms;
    return this.run({ type: 'TICK', t: this.t });
  }
  board(pilotId: string, role: Role, isBot = false) {
    return this.run({
      type: 'BOARD',
      t: this.t,
      pilotId,
      callsign: pilotId.toUpperCase(),
      role,
      isBot,
    });
  }
  start() {
    this.run({ type: 'OPEN_LOBBY', t: this.t });
    return this.run({ type: 'START', t: this.t });
  }
  request(pilotId: string, choice: TaskChoice = {}) {
    const r = this.run({ type: 'REQUEST_TASK', t: this.t, pilotId, choice });
    if (r.outcome.kind !== 'task') throw new Error('no task outcome');
    return r.outcome;
  }
  submit(pilotId: string, taskId: string, input: TaskInput) {
    const r = this.run({ type: 'SUBMIT_TASK', t: this.t, pilotId, taskId, input });
    if (r.outcome.kind !== 'submit') throw new Error('no submit outcome');
    return r.outcome.result;
  }
  /** Request + play the minigame with the given skill + submit. */
  play(pilotId: string, choice: TaskChoice = {}, skill = 1) {
    const o = this.request(pilotId, choice);
    if (o.code !== 'OK' || !o.task) return { code: o.code, result: null };
    const rand = mulberry32(this.events.length + 1);
    const input = solveTask(o.task.params, skill, rand, 700, choice.sink);
    const needed =
      'stopAtMs' in input ? input.stopAtMs : 'releaseAtMs' in input ? input.releaseAtMs : 1500;
    this.wait(needed);
    return { code: 'OK', result: this.submit(pilotId, o.task.taskId, input) };
  }
  of<T extends GameEvent['type']>(type: T) {
    return this.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
  }
}

describe('raid timeline', () => {
  it('lobby → intro → waves → final; the boss enters at 4:30; timeout at 8:00 fails', () => {
    const sim = new Sim();
    sim.board('a', 'GUNNER');
    sim.board('b', 'GUARDIAN');
    expect(sim.state.status).toBe('CREATED');
    sim.start();
    expect(sim.state).toMatchObject({ status: 'LIVE', phase: 'INTRO_TRAINING' });
    sim.to(61);
    expect(sim.state.phase).toBe('WAVE_1');
    sim.to(151);
    expect(sim.state.phase).toBe('WAVE_2');
    sim.to(271);
    expect(sim.state.phase).toBe('WAVE_3');
    expect(sim.state.bossId).not.toBeNull();
    expect(sim.of('ENEMY_SPAWNED').find((e) => e.data.enemy.kind === 'BOSS')!.gameMs).toBe(270 * S);
    sim.to(391);
    expect(sim.state.phase).toBe('FINAL_WAVE');
    sim.to(480);
    // Nobody did anything: either cities fell or time ran out — both are failures.
    expect(sim.state.status).toBe('ENDED');
    expect(sim.state.result!.outcome).toBe('FAILED');
    expect(['TIMEOUT', 'CITIES_LOST']).toContain(sim.state.result!.reason);
  });

  it('enemies telegraph target, kind and time before resolving; training hits only scratch', () => {
    const sim = new Sim();
    sim.board('a', 'GUNNER');
    sim.start();
    sim.to(30);
    const tg = sim.of('ENEMY_TELEGRAPH')[0]!;
    expect(tg.data.telegraph.targets).toEqual(['kanto']);
    const lead = tg.data.telegraph.resolvesAt - tg.data.telegraph.startsAt;
    expect(lead).toBeGreaterThanOrEqual(8 * S);
    const hit = sim.of('ATTACK_RESOLVED')[0]!;
    expect(hit.gameMs).toBe(tg.data.telegraph.resolvesAt);
    expect(hit.data.hits[0]!.damage).toBeLessThanOrEqual(
      Math.ceil(DEFAULT_GAME_CONFIG.scout.damage * DEFAULT_GAME_CONFIG.trainingDamageRatio),
    );
  });

  it('pause freezes the raid clock and the enemies', () => {
    const sim = new Sim();
    sim.board('a', 'GUNNER');
    sim.start();
    sim.to(20);
    const enemies = JSON.stringify(sim.state.enemies);
    sim.run({ type: 'PAUSE', t: sim.t, reason: 'test' });
    sim.wait(120 * S);
    expect(sim.state.gameMs).toBe(20 * S);
    expect(JSON.stringify(sim.state.enemies)).toBe(enemies);
    sim.run({ type: 'RESUME', t: sim.t });
    sim.wait(1000);
    expect(sim.state.gameMs).toBe(21 * S);
  });

  it('boarding closes after the cutoff; a raid has a pilot limit', () => {
    const sim = new Sim(makeGameConfig({ maxPilots: 2 }));
    sim.board('a', 'GUNNER');
    sim.board('b', 'ROUTER');
    expect(sim.board('c', 'ENGINEER').outcome).toMatchObject({ kind: 'board', code: 'RAID_FULL' });
    const sim2 = new Sim();
    sim2.start();
    sim2.to(239);
    expect(sim2.board('late', 'GUNNER').outcome).toMatchObject({ code: 'OK' });
    sim2.to(241);
    expect(sim2.board('later', 'GUNNER').outcome).toMatchObject({ code: 'JOIN_CLOSED' });
  });

  it('seats map to robots: gunner → Raijin, guardian → Fujin, support seats balance', () => {
    const sim = new Sim();
    expect(sim.board('g', 'GUNNER').outcome).toMatchObject({ pilot: { robot: 'RAIJIN' } });
    expect(sim.board('d', 'GUARDIAN').outcome).toMatchObject({ pilot: { robot: 'FUJIN' } });
    expect(sim.board('r1', 'ROUTER').outcome).toMatchObject({ pilot: { robot: 'RAIJIN' } });
    expect(sim.board('r2', 'ENGINEER').outcome).toMatchObject({ pilot: { robot: 'FUJIN' } });
  });
});

describe('cockpit seats', () => {
  it('GUNNER: server scores the stop time; damage, cooldown, expiry and bad input', () => {
    const sim = new Sim(makeGameConfig({ scout: { ...DEFAULT_GAME_CONFIG.scout, hp: 200 } }));
    sim.board('a', 'GUNNER');
    sim.start();
    sim.to(8);
    const { result } = sim.play('a', {}, 1);
    expect(result).toMatchObject({ ok: true, success: 1, effect: { kind: 'DAMAGE' } });
    expect(result!.effect!.kind === 'DAMAGE' && result!.effect!.amount).toBeGreaterThan(30);
    expect(sim.request('a').code).toBe('COOLDOWN');
    sim.wait(10 * S);
    const o = sim.request('a');
    expect(o.code).toBe('OK');
    expect(sim.request('a').code).toBe('TASK_OPEN');
    // Claiming a stop time later than really elapsed is rejected (task closed, no damage).
    expect(sim.submit('a', o.task!.taskId, { role: 'GUNNER', stopAtMs: 9000 }).code).toBe(
      'INVALID_INPUT',
    );
    expect(sim.submit('a', o.task!.taskId, { role: 'GUNNER', stopAtMs: 100 }).code).toBe('NO_TASK');
    sim.wait(10 * S);
    const o2 = sim.request('a');
    sim.wait(14 * S);
    expect(sim.submit('a', o2.task!.taskId, { role: 'GUNNER', stopAtMs: 1000 }).code).toBe(
      'EXPIRED',
    );
  });

  it('GUNNER weak points: ARM weakens, LEG delays the telegraph once', () => {
    const sim = new Sim(makeGameConfig({ scout: { ...DEFAULT_GAME_CONFIG.scout, hp: 200 } }));
    sim.board('a', 'GUNNER');
    sim.board('b', 'GUNNER');
    sim.start();
    sim.to(8);
    const tg = sim.state.telegraphs[0]!;
    const enemyId = tg.enemyId;
    const { result } = sim.play('a', { enemyId, weakpoint: 'LEG' }, 1);
    expect(result!.effect).toMatchObject({ kind: 'DAMAGE', weakpoint: 'LEG', note: 'DELAY' });
    expect(sim.state.telegraphs[0]!.resolvesAt).toBe(tg.resolvesAt + 3 * S);
    const r2 = sim.play('b', { enemyId, weakpoint: 'ARM' }, 1).result!;
    if (r2.effect?.kind === 'DAMAGE' && !r2.effect.defeated) {
      expect(sim.state.enemies.find((e) => e.id === enemyId)!.weaken).toBeGreaterThan(0);
    }
  });

  it('GUARDIAN: a shield on the threatened city absorbs the attack; wrong direction fails', () => {
    const sim = new Sim();
    sim.board('d', 'GUARDIAN');
    sim.board('d2', 'GUARDIAN');
    sim.start();
    sim.to(8);
    const tg = sim.state.telegraphs[0]!;
    const o = sim.request('d2');
    expect(o.task!.target).toMatchObject({ kind: 'TELEGRAPH', telegraphId: tg.id });
    const p = o.task!.params;
    if (p.role !== 'GUARDIAN') throw new Error();
    sim.wait(1000);
    const wrong = p.direction === 'LEFT' ? 'RIGHT' : 'LEFT';
    expect(
      sim.submit('d2', o.task!.taskId, { role: 'GUARDIAN', direction: wrong, releaseAtMs: 900 }),
    ).toMatchObject({ ok: true, success: 0, effect: null });
    const { result } = sim.play('d', {}, 1);
    expect(result).toMatchObject({ success: 1, effect: { kind: 'SHIELD', cityId: 'kanto' } });
    sim.to(tg.resolvesAt / S + 0.1);
    const hit = sim.of('ATTACK_RESOLVED').at(-1)!;
    expect(hit.data.hits[0]!.absorbed).toBeGreaterThan(0);
    expect(hit.data.hits[0]!.damage).toBe(0);
  });

  it('ROUTER: the shortest route delivers full energy; a blocked node delivers none', () => {
    const p = routerParams(mulberry32(3), 'NORMAL', 'RESERVE', false);
    if (p.role !== 'ROUTER') throw new Error();
    const reserve = p.nodes.find((n) => n.sink === 'RESERVE')!;
    expect(shortestHops(p, reserve.id)).toBe(2);
    const good = solveTask(p, 1, mulberry32(1), 700, 'RESERVE');
    expect(evaluateTask(p, good, 5000, 12000)).toEqual({
      valid: true,
      success: 1,
      sink: 'RESERVE',
    });
    const blocked = p.nodes.find((n) => n.kind === 'BLOCKED')!;
    const out = p.edges.find(([a, b]) => a === blocked.id && p.nodes[b]!.kind === 'SINK');
    if (out)
      expect(
        evaluateTask(p, { role: 'ROUTER', path: [0, blocked.id, out[1]] }, 5000, 12000),
      ).toMatchObject({ success: 0 });
    expect(evaluateTask(p, { role: 'ROUTER', path: [0, reserve.id] }, 5000, 12000)).toMatchObject({
      valid: false,
    });

    const sim = new Sim();
    sim.board('r', 'ROUTER');
    sim.start();
    sim.to(8);
    const { result } = sim.play('r', { sink: 'RESERVE' }, 1);
    expect(result).toMatchObject({ success: 1, effect: { kind: 'ENERGY', sink: 'RESERVE' } });
    expect(sim.state.reserveEnergy).toBeGreaterThan(0);
  });

  it('ENGINEER: exact order repairs; destroyed cities can be rebuilt with a good run', () => {
    const cfg = makeGameConfig({
      cityMaxHp: 10,
      minimumSurvivingCities: 1,
      trainingDamageRatio: 1,
    });
    const sim = new Sim(cfg);
    sim.board('e', 'ENGINEER');
    sim.start();
    sim.to(40);
    expect(sim.state.cities.kanto.destroyed).toBe(true);
    const { result } = sim.play('e', { repair: { type: 'CITY', cityId: 'kanto' } }, 1);
    expect(result).toMatchObject({
      success: 1,
      effect: { kind: 'REPAIR', amount: cfg.cityRebuildHp },
    });
    expect(sim.state.cities.kanto).toMatchObject({ destroyed: false, hp: cfg.cityRebuildHp });
    expect(sim.of('CITY_REBUILT')).toHaveLength(1);
  });

  it('seat changes have a cooldown during the raid and drop the open task', () => {
    const sim = new Sim();
    sim.board('a', 'GUNNER');
    sim.start();
    sim.to(8);
    sim.request('a');
    expect(
      sim.run({ type: 'CHANGE_ROLE', t: sim.t, pilotId: 'a', role: 'ROUTER' }).outcome,
    ).toMatchObject({ code: 'OK' });
    expect(sim.state.pilots.a!.task).toBeNull();
    expect(
      sim.run({ type: 'CHANGE_ROLE', t: sim.t, pilotId: 'a', role: 'GUNNER' }).outcome,
    ).toMatchObject({ code: 'ROLE_COOLDOWN' });
    sim.wait(20 * S);
    expect(
      sim.run({ type: 'CHANGE_ROLE', t: sim.t, pilotId: 'a', role: 'GUNNER' }).outcome,
    ).toMatchObject({ code: 'OK' });
  });
});

describe('cooperation', () => {
  it('a crowd piling onto one seat is normalised: 9 gunners do not hit 3× harder than 3', () => {
    const totalDamage = (n: number) => {
      const sim = new Sim(
        makeGameConfig({ difficultyMaxScale: 1, difficultyMinScale: 1, bossBaseHp: 100_000 }),
      );
      for (let i = 0; i < n; i++) sim.board(`g${i}`, 'GUNNER');
      sim.start();
      sim.to(272);
      const bossId = sim.state.bossId!;
      const before = sim.state.enemies.find((e) => e.id === bossId)!.hp;
      // Four sustained rounds of everyone firing at the boss.
      for (let round = 0; round < 4; round++) {
        for (let i = 0; i < n; i++) sim.play(`g${i}`, { enemyId: bossId, weakpoint: 'CORE' }, 1);
        sim.wait(11 * S);
      }
      return before - sim.state.enemies.find((e) => e.id === bossId)!.hp;
    };
    const three = totalDamage(3);
    const nine = totalDamage(9);
    expect(nine).toBeGreaterThan(three);
    expect(nine).toBeLessThan(three * 1.6);
  });

  it('SYNC: different seats in one window add 8 / +7 / +10; one pilot counts once', () => {
    const sim = new Sim(makeGameConfig({ assistBelowPilots: 0 }));
    for (const [id, role] of [
      ['g', 'GUNNER'],
      ['d', 'GUARDIAN'],
      ['r', 'ROUTER'],
      ['e', 'ENGINEER'],
    ] as const)
      sim.board(id, role);
    sim.start();
    sim.to(80);
    sim.wait(Math.ceil(sim.state.gameMs / 20000) * 20000 - sim.state.gameMs + 10);
    const gains: number[] = [];
    for (const id of ['g', 'd', 'r', 'e']) gains.push(sim.play(id, {}, 1).result!.syncGain);
    expect(gains).toEqual([0, 8, 7, 10]);
    expect(sim.state.sync).toBe(25);
  });

  it('SYNC decays without cooperation', () => {
    const sim = new Sim();
    sim.board('g', 'GUNNER');
    sim.board('d', 'GUARDIAN');
    sim.start();
    sim.to(61);
    sim.play('g');
    sim.play('d');
    const s = sim.state.sync;
    expect(s).toBe(8);
    sim.to(100);
    expect(sim.state.sync).toBeLessThan(s);
  });

  it('assist AI acts only when very few pilots are aboard, and marks the result', () => {
    const solo = new Sim();
    solo.board('a', 'GUNNER');
    solo.start();
    solo.to(150);
    expect(solo.state.stats.assistActions).toBeGreaterThan(0);
    expect(solo.of('TASK_RESOLVED').some((e) => e.data.assist)).toBe(true);
    const crowd = new Sim();
    for (let i = 0; i < 6; i++) crowd.board(`p${i}`, 'GUNNER');
    crowd.start();
    for (let s = 10; s < 150; s += 10) {
      crowd.to(s);
      for (let i = 0; i < 6; i++) crowd.play(`p${i}`, {}, 0.5);
    }
    expect(crowd.state.stats.assistActions).toBe(0);
  });
});

describe('神雷風陣 and outcomes', () => {
  function finalSetup() {
    const sim = new Sim(makeGameConfig({ difficultyMinScale: 1, difficultyMaxScale: 1 }));
    for (const [id, role] of [
      ['g', 'GUNNER'],
      ['d', 'GUARDIAN'],
      ['r', 'ROUTER'],
      ['e', 'ENGINEER'],
    ] as const)
      sim.board(id, role);
    sim.start();
    sim.to(389);
    return sim;
  }

  it('activates once with 3 distinct pilots, SYNC ≥ 75 and reserve ≥ 80', () => {
    const sim = finalSetup();
    if (sim.state.status !== 'LIVE') return; // cities fell without defenders; covered elsewhere
    sim.state.sync = 90;
    sim.state.reserveEnergy = 85;
    sim.to(391);
    expect(sim.state.special.status).toBe('OPEN');
    const bossHp = sim.state.enemies.find((e) => e.id === sim.state.bossId)!.hp;
    sim.play('g', { enemyId: sim.state.bossId!, weakpoint: 'CORE' });
    sim.play('d');
    expect(sim.state.special.status).toBe('OPEN');
    sim.play('r', { sink: 'RAIJIN' });
    expect(sim.state.special.status).toBe('ACTIVATED');
    const resolved = sim.of('SPECIAL_RESOLVED');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.data.damage).toBe(DEFAULT_GAME_CONFIG.special.damage);
    const after = sim.state.enemies.find((e) => e.id === sim.state.bossId)?.hp ?? 0;
    expect(bossHp - after).toBeGreaterThanOrEqual(DEFAULT_GAME_CONFIG.special.damage);
  });

  it('partial cooperation gives the weaker fallback; none fires NULL BEAM on every city', () => {
    const sim = finalSetup();
    if (sim.state.status !== 'LIVE') return;
    sim.state.sync = 10;
    sim.to(391);
    sim.play('g', { enemyId: sim.state.bossId!, weakpoint: 'CORE' });
    sim.play('d');
    sim.to(421);
    expect(sim.state.special.status).toBe('FALLBACK');

    const none = finalSetup();
    if (none.state.status !== 'LIVE') return;
    none.state.sync = 0;
    none.to(421);
    expect(none.state.special.status).toBe('FAILED');
    const beam = none.of('SPECIAL_RESOLVED')[0]!;
    expect(beam.data.cityHits.length).toBeGreaterThan(0);
  });

  it('losing too many cities ends the raid at once', () => {
    const sim = new Sim(makeGameConfig({ cityMaxHp: 5, trainingDamageRatio: 1 }));
    sim.board('a', 'GUNNER');
    sim.start();
    sim.to(480);
    expect(sim.state.result).toMatchObject({ outcome: 'FAILED', reason: 'CITIES_LOST' });
    expect(sim.state.result!.survivingCities).toBeLessThan(4);
  });

  it('defeating NULL CORE wins with a 1000-point scale score and role MVPs', () => {
    const sim = new Sim(
      makeGameConfig({ bossBaseHp: 60, difficultyMinScale: 1, difficultyMaxScale: 1 }),
    );
    sim.board('g', 'GUNNER');
    sim.board('d', 'GUARDIAN');
    sim.start();
    sim.to(272);
    let guard = 0;
    while (sim.state.status === 'LIVE' && guard++ < 20) {
      sim.play('g', { enemyId: sim.state.bossId!, weakpoint: 'CORE' });
      sim.play('d');
      sim.wait(10 * S);
    }
    const r = sim.state.result!;
    expect(r).toMatchObject({ outcome: 'SUCCEEDED', reason: 'BOSS_DEFEATED' });
    expect(sim.state.phase).toBe('SUCCEEDED');
    expect(r.score.bossDefeat).toBe(200);
    expect(r.score.total).toBeLessThanOrEqual(1000);
    expect(r.score.total).toBe(
      r.score.citySurvival + r.score.speed + r.score.coordination + r.score.bossDefeat,
    );
    expect(r.mvps.GUNNER?.pilotId).toBe('g');
    expect(r.clearTimeMs).toBe(r.endedAtGameMs);
  });
});

describe('determinism', () => {
  it('replaying the command log reproduces the raid and its events exactly', () => {
    const sim = new Sim(DEFAULT_GAME_CONFIG, 99);
    for (const [id, role] of [
      ['g', 'GUNNER'],
      ['d', 'GUARDIAN'],
      ['r', 'ROUTER'],
    ] as const)
      sim.board(id, role);
    sim.start();
    for (let s = 5; s < 300; s += 7) {
      sim.to(s);
      for (const id of ['g', 'd', 'r']) sim.play(id, {}, 0.7);
    }
    const again = replay('r1', DEFAULT_GAME_CONFIG, 99, sim.log);
    expect(again.state).toEqual(sim.state);
    expect(again.events).toEqual(sim.events);
    const seqs = sim.events.map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it('reticle math is shared with the UI', () => {
    const p = {
      role: 'GUNNER' as const,
      periodMs: 2000,
      phase: 0,
      ringCenter: 0.5,
      ringWidth: 0.1,
    };
    expect(reticleAt(p, 500)).toBeCloseTo(0.5);
    expect(evaluateTask(p, { role: 'GUNNER', stopAtMs: 500 }, 600, 12000)).toEqual({
      valid: true,
      success: 1,
    });
    expect(REGION_IDS).toHaveLength(8);
  });
});

describe('router puzzle layout', () => {
  it('keeps every node far enough apart to tap on a phone (all seeds, jammed or not)', () => {
    // The phone draws the puzzle 280×168 px with 16 px node circles: keep ≥ 40 px between centres.
    for (let seed = 1; seed <= 300; seed++) {
      for (const jammed of [false, true]) {
        const p = routerParams(mulberry32(seed), 'NORMAL', 'RESERVE', jammed);
        if (p.role !== 'ROUTER') throw new Error('router');
        for (const a of p.nodes)
          for (const b of p.nodes) {
            if (a.id >= b.id) continue;
            expect(Math.hypot((a.x - b.x) * 280, (a.y - b.y) * 168)).toBeGreaterThanOrEqual(40);
          }
      }
    }
  });
});
