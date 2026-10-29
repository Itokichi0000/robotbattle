import { PRESETS } from '@swed/shared';
import type { GameConfig, MatchEvent, MatchState, PilotActionInput, SeatId } from '@swed/shared';
import { describe, expect, it } from 'vitest';
import {
  advanceTo,
  createMatch,
  isRoundOver,
  reduce,
  type EngineCommand,
  type ReduceResult,
} from './engine';
import { recommendTarget } from './hints';
import { toPublicState } from './public';

/* ------------------------------------------------------------- harness */

class Sim {
  state: MatchState;
  events: MatchEvent[] = [];
  private n = 0;
  constructor(
    opts: { config?: GameConfig; autoSupport?: boolean; seed?: number; attract?: boolean } = {},
  ) {
    this.state = createMatch({
      matchId: 'm-test',
      seed: opts.seed ?? 42,
      config: opts.config ?? PRESETS.TEST,
      autoSupport: opts.autoSupport ?? false,
      attract: opts.attract ?? false,
    });
  }
  get t() {
    return this.state.t;
  }
  cmd(c: EngineCommand): ReduceResult {
    const r = reduce(this.state, c);
    this.state = r.state;
    this.events.push(...r.events);
    return r;
  }
  to(t: number) {
    const r = advanceTo(this.state, t);
    this.state = r.state;
    this.events.push(...r.events);
  }
  wait(ms: number) {
    this.to(this.state.t + ms);
  }
  join(seatId: SeatId, pilotId = `p-${seatId}`) {
    return this.cmd({
      type: 'SEAT_JOIN',
      t: this.t,
      seatId,
      pilotId,
      displayName: `PILOT-${seatId.slice(0, 4)}`,
    });
  }
  act(seatId: SeatId, action: PilotActionInput, pilotId = `p-${seatId}`, id?: string) {
    this.n += 1;
    const r = this.cmd({
      type: 'PILOT_ACTION',
      t: this.t,
      pilotId,
      seatId,
      clientActionId: id ?? `act-${String(this.n).padStart(6, '0')}`,
      action,
    });
    if (r.outcome.kind !== 'action') throw new Error('expected action outcome');
    return r.outcome.result;
  }
  /** START, then skip the deploy cinematic so combat begins now. */
  launch() {
    this.cmd({ type: 'START', t: this.t });
    this.cmd({ type: 'SKIP_DEPLOY', t: this.t });
  }
  of<T extends MatchEvent['type']>(type: T) {
    return this.events.filter((e): e is Extract<MatchEvent, { type: T }> => e.type === type);
  }
}

/** Cities and core that cannot fall, for tests about the clock rather than the fight. */
function sturdy(): GameConfig {
  const c = structuredClone(PRESETS.TEST);
  c.cities.lostForDefeat = 99;
  c.core.max = 1_000_000;
  return c;
}

const CITY_HP = PRESETS.TEST.cities.hp;
const LOCK: PilotActionInput = { actionType: 'LOCK', payload: {} };
const FIRE: PilotActionInput = { actionType: 'FIRE', payload: {} };
const shield = (dir: 'FRONT' | 'LEFT' | 'RIGHT' | 'REAR'): PilotActionInput => ({
  actionType: 'DEPLOY_SHIELD',
  payload: { dir },
});

/* --------------------------------------------------------------- tests */

describe('match setup', () => {
  it('starts in LOBBY with eight empty seats and full integrity', () => {
    const s = new Sim().state;
    expect(s.phase).toBe('LOBBY');
    expect(Object.values(s.seats).every((x) => x.pilotId === null)).toBe(true);
    expect(s.coreHp).toBe(1000);
    expect(Object.values(s.parts).every((hp) => hp === 100)).toBe(true);
  });

  it('moves from ATTRACT to LOBBY when the first pilot boards', () => {
    const sim = new Sim({ attract: true });
    expect(sim.state.phase).toBe('ATTRACT');
    sim.join('GUNNER_L');
    expect(sim.state.phase).toBe('LOBBY');
    expect(sim.of('seat_assigned')).toHaveLength(1);
  });
});

describe('seats', () => {
  it('rejects seats that are not open yet, taken seats, and seat swaps in combat', () => {
    const sim = new Sim();
    const closed = sim.join('POWER_CORE');
    expect(closed.outcome).toEqual({
      kind: 'seat',
      result: { ok: false, reasonCode: 'SEAT_NOT_OPEN' },
    });
    sim.join('GUNNER_L', 'alice');
    const taken = sim.join('GUNNER_L', 'bob');
    expect(taken.outcome).toEqual({
      kind: 'seat',
      result: { ok: false, reasonCode: 'SEAT_TAKEN' },
    });
    // Lobby: a pilot may move.
    const moved = sim.join('SHIELD_L', 'alice');
    expect(moved.outcome).toEqual({ kind: 'seat', result: { ok: true, seatId: 'SHIELD_L' } });
    expect(sim.state.seats.GUNNER_L.pilotId).toBeNull();
    sim.launch();
    const swap = sim.join('GUNNER_R', 'alice');
    expect(swap.outcome).toEqual({
      kind: 'seat',
      result: { ok: false, reasonCode: 'SEAT_LOCKED' },
    });
    // ...but an empty seat may be taken mid-match by a newcomer (late join).
    const late = sim.join('GUNNER_R', 'carol');
    expect(late.outcome).toEqual({ kind: 'seat', result: { ok: true, seatId: 'GUNNER_R' } });
  });

  it('holds a disconnected seat for seatHoldMs, then releases it', () => {
    const sim = new Sim();
    sim.join('SHIELD_R', 'dana');
    sim.launch();
    sim.cmd({ type: 'SEAT_CONNECTION', t: sim.t, pilotId: 'dana', connected: false });
    sim.wait(30_000);
    expect(sim.state.seats.SHIELD_R.pilotId).toBe('dana');
    // Reconnect before the hold ends keeps the seat.
    sim.join('SHIELD_R', 'dana');
    expect(sim.state.seats.SHIELD_R.connected).toBe(true);
    sim.cmd({ type: 'SEAT_CONNECTION', t: sim.t, pilotId: 'dana', connected: false });
    sim.wait(60_100);
    expect(sim.state.seats.SHIELD_R.pilotId).toBeNull();
    expect(sim.of('seat_released').at(-1)?.reason).toBe('TIMEOUT');
  });
});

describe('phase flow', () => {
  it('runs COUNTDOWN → DEPLOYMENT → WAVE_1 → WAVE_2 → BOSS on the server clock', () => {
    const sim = new Sim({ config: sturdy() });
    sim.join('GUNNER_L');
    sim.cmd({ type: 'START', t: 0 });
    const T = PRESETS.TEST.timings;
    sim.to(T.countdownMs);
    expect(sim.state.phase).toBe('DEPLOYMENT');
    sim.to(T.countdownMs + T.deploymentMs);
    expect(sim.state.phase).toBe('WAVE_1');
    sim.to(T.countdownMs + T.deploymentMs + T.wave1Ms);
    expect(sim.state.phase).toBe('WAVE_2');
    sim.to(T.countdownMs + T.deploymentMs + T.wave1Ms + T.wave2Ms + 1_500);
    expect(sim.state.phase).toBe('BOSS');
    expect(sim.state.enemies.some((e) => e.kind === 'NULL_CORE')).toBe(true);
  });

  it('refuses pilot actions outside combat (deploy cinematic) and while paused', () => {
    const sim = new Sim();
    sim.join('GUNNER_L');
    sim.cmd({ type: 'START', t: 0 });
    expect(sim.act('GUNNER_L', LOCK).reasonCode).toBe('NOT_IN_COMBAT');
    sim.cmd({ type: 'SKIP_DEPLOY', t: sim.t });
    sim.cmd({ type: 'PAUSE', t: sim.t });
    expect(sim.act('GUNNER_L', LOCK).reasonCode).toBe('PAUSED');
    sim.cmd({ type: 'RESUME', t: sim.t });
    sim.wait(3_000);
    expect(sim.act('GUNNER_L', LOCK).accepted).toBe(true);
  });

  it('ends in DEFEAT/TIME_UP when nobody fights, then plays RESULTS and signals round over', () => {
    const sim = new Sim();
    sim.launch();
    const T = PRESETS.TEST.timings;
    sim.wait(T.wave1Ms + T.wave2Ms + T.bossMs + 100);
    expect(sim.state.phase === 'DEFEAT' || sim.state.phase === 'RESULTS').toBe(true);
    expect(sim.state.result?.outcome).toBe('DEFEAT');
    sim.wait(T.defeatMs + T.resultsMs + 100);
    expect(isRoundOver(sim.state)).toBe(true);
  });
});

describe('gunner', () => {
  it('LOCK → CHARGE → FIRE lowers the enemy HP on the server, then cools down', () => {
    const sim = new Sim();
    sim.join('GUNNER_L');
    sim.launch();
    sim.wait(2_600); // first drones have arrived
    expect(sim.act('GUNNER_L', LOCK).accepted).toBe(true);
    const targetId = sim.state.gunners.GUNNER_L.targetId!;
    const before = sim.state.enemies.find((e) => e.id === targetId)!.hp;
    expect(sim.act('GUNNER_L', FIRE).reasonCode).toBe('CHARGING');
    sim.wait(1_500);
    expect(sim.of('weapon_charged')).toHaveLength(1);
    expect(sim.act('GUNNER_L', FIRE).accepted).toBe(true);
    const fired = sim.of('weapon_fired')[0]!;
    expect(fired.damage).toBeGreaterThan(0);
    const after = sim.state.enemies.find((e) => e.id === targetId)?.hp ?? 0;
    expect(after).toBe(Math.max(0, before - fired.damage));
    // Whatever is locked next, the cannon must cool down first.
    if (!sim.state.gunners.GUNNER_L.targetId) sim.act('GUNNER_L', LOCK);
    expect(sim.act('GUNNER_L', FIRE).reasonCode).toBe('COOLDOWN');
  });

  it("GUNNER_R's lock exposes a weak point that boosts every gun", () => {
    const sim = new Sim();
    sim.join('GUNNER_L');
    sim.join('GUNNER_R');
    sim.launch();
    sim.wait(2_600);
    const target = recommendTarget(sim.state.enemies, sim.state.threats, sim.t)!;
    // Give the target armour so it survives both shots.
    sim.state = {
      ...sim.state,
      enemies: sim.state.enemies.map((e) =>
        e.id === target.id ? { ...e, hp: 900, maxHp: 900 } : e,
      ),
    };
    sim.act('GUNNER_L', { actionType: 'LOCK', payload: { targetId: target.id } });
    sim.wait(1_500);
    sim.act('GUNNER_L', FIRE);
    const plain = sim.of('weapon_fired')[0]!;
    expect(plain.weak).toBe(false);
    sim.act('GUNNER_R', { actionType: 'LOCK', payload: { targetId: target.id } });
    expect(sim.of('target_locked').at(-1)?.weakPoint).toBe(true);
    sim.wait(3_100);
    expect(sim.act('GUNNER_L', FIRE).accepted).toBe(true);
    const boosted = sim.of('weapon_fired').at(-1)!;
    expect(boosted.weak).toBe(true);
    expect(boosted.damage).toBeGreaterThan(plain.damage);
  });

  it('is idempotent per clientActionId and only obeys the seat owner', () => {
    const sim = new Sim();
    sim.join('GUNNER_L', 'alice');
    sim.join('SHIELD_L', 'bob');
    sim.launch();
    sim.wait(2_600);
    sim.act('GUNNER_L', LOCK, 'alice');
    sim.wait(1_500);
    const first = sim.act('GUNNER_L', FIRE, 'alice', 'retry-key-0001');
    const shots = sim.of('weapon_fired').length;
    const again = sim.act('GUNNER_L', FIRE, 'alice', 'retry-key-0001');
    expect(first.accepted).toBe(true);
    expect(again.accepted).toBe(true);
    expect(sim.of('weapon_fired').length).toBe(shots); // no second shot
    expect(sim.act('GUNNER_L', FIRE, 'bob').reasonCode).toBe('NOT_YOUR_SEAT');
    expect(sim.act('SHIELD_L', FIRE, 'bob').reasonCode).toBe('WRONG_ROLE');
  });

  it('refuses to fire without weapon energy', () => {
    const sim = new Sim();
    sim.join('GUNNER_L');
    sim.launch();
    sim.wait(2_600);
    sim.act('GUNNER_L', LOCK);
    sim.wait(1_500);
    sim.state = { ...sim.state, energy: { ...sim.state.energy, weapon: 3 } };
    expect(sim.act('GUNNER_L', FIRE).reasonCode).toBe('NO_ENERGY');
  });
});

describe('shields', () => {
  /** WAVE_1 scripts a FRONT attack on TOKYO (SHIELD_L) and a RIGHT attack on OSAKA (SHIELD_R). */
  function firstThreat(sim: Sim) {
    for (let i = 0; i < 200 && sim.state.threats.length === 0; i++) sim.wait(100);
    const th = sim.state.threats[0];
    if (!th) throw new Error('no threat');
    return th;
  }

  it('telegraphs at least 4 s ahead; a timely shield blocks it and spares the city', () => {
    const sim = new Sim();
    sim.join('SHIELD_L');
    sim.launch();
    const th = firstThreat(sim);
    expect(th.dir).toBe('FRONT');
    expect(th.target).toEqual({ type: 'CITY', cityId: 'TOKYO' });
    expect(th.impactAt - th.warnAt).toBeGreaterThanOrEqual(4_000);
    sim.to(th.impactAt - 800);
    expect(sim.act('SHIELD_L', shield('FRONT')).accepted).toBe(true);
    sim.to(th.impactAt + 100);
    const blocked = sim.of('threat_blocked')[0]!;
    expect(blocked).toMatchObject({
      threatId: th.id,
      seatId: 'SHIELD_L',
      perfect: true,
      auto: false,
    });
    expect(sim.state.cities.TOKYO.hp).toBe(CITY_HP);
    expect(sim.of('incoming_hit')).toHaveLength(0);
  });

  it('an unguarded strike damages the city and core', () => {
    const sim = new Sim();
    sim.join('GUNNER_L');
    sim.launch();
    const th = firstThreat(sim);
    sim.to(th.impactAt + 100);
    expect(sim.of('incoming_hit')).toHaveLength(1);
    expect(sim.state.cities.TOKYO.hp).toBeLessThan(CITY_HP);
    expect(sim.state.coreHp).toBeLessThan(1000);
  });

  it('a shield aimed the wrong way, or outside the seat sector, does not help', () => {
    const sim = new Sim();
    sim.join('SHIELD_L');
    sim.launch();
    const th = firstThreat(sim);
    expect(sim.act('SHIELD_L', shield('RIGHT')).reasonCode).toBe('BAD_DIRECTION');
    sim.to(th.impactAt - 800);
    sim.act('SHIELD_L', shield('LEFT'));
    expect(sim.act('SHIELD_L', shield('FRONT')).reasonCode).toBe('COOLDOWN');
    sim.to(th.impactAt + 100);
    expect(sim.of('threat_blocked')).toHaveLength(0);
    expect(sim.of('incoming_hit')).toHaveLength(1);
  });

  it('killing the attacker before impact intercepts the strike', () => {
    const sim = new Sim();
    sim.join('GUNNER_L');
    sim.launch();
    const th = firstThreat(sim);
    const src = sim.state.enemies.find((e) => e.id === th.sourceId)!;
    sim.act('GUNNER_L', { actionType: 'LOCK', payload: { targetId: src.id } });
    for (let i = 0; i < 6 && sim.state.enemies.some((e) => e.id === src.id); i++) {
      sim.wait(3_050);
      sim.act('GUNNER_L', FIRE);
    }
    expect(sim.t).toBeLessThan(th.impactAt);
    expect(sim.of('threat_intercepted').map((x) => x.threatId)).toContain(th.id);
    sim.to(th.impactAt + 100);
    expect(sim.state.cities.TOKYO.hp).toBe(CITY_HP);
  });

  it('AUTO SUPPORT half-blocks for an empty shield seat, and says so', () => {
    const sim = new Sim({ autoSupport: true });
    sim.join('GUNNER_L');
    sim.launch();
    const th = firstThreat(sim);
    sim.to(th.impactAt + 100);
    const blocked = sim.of('threat_blocked')[0]!;
    expect(blocked.auto).toBe(true);
    expect(blocked.ratio).toBe(0.5);
    expect(sim.state.cities.TOKYO.hp).toBe(CITY_HP - Math.round(th.damage * 0.5));
  });
});

describe('cooperation', () => {
  it('a gun hit and a shield block within the window form a TEAM SYNC combo', () => {
    const sim = new Sim();
    sim.join('GUNNER_L');
    sim.join('SHIELD_L');
    sim.launch();
    let th = sim.state.threats[0];
    while (!th) {
      sim.wait(100);
      th = sim.state.threats[0];
    }
    sim.to(th.impactAt - 2_500);
    const other = sim.state.enemies.find((e) => e.id !== th!.sourceId && e.arrivesAt <= sim.t)!;
    sim.act('GUNNER_L', { actionType: 'LOCK', payload: { targetId: other.id } });
    sim.wait(1_450);
    expect(sim.act('GUNNER_L', FIRE).accepted).toBe(true);
    sim.to(th.impactAt - 600);
    sim.act('SHIELD_L', shield('FRONT'));
    sim.to(th.impactAt + 50);
    const combo = sim.of('team_combo')[0];
    expect(combo?.roles.sort()).toEqual(['DEFENSE', 'GUNNER']);
    expect(sim.state.teamSync).toBeGreaterThan(0);
    expect(sim.state.teamCapacitor).toBeGreaterThan(0);
  });
});

describe('victory', () => {
  it('destroying NULL CORE wins, clears the swarm and rolls to RESULTS', () => {
    const sim = new Sim({ config: sturdy() });
    sim.join('GUNNER_L');
    sim.launch();
    const T = PRESETS.TEST.timings;
    sim.wait(T.wave1Ms + T.wave2Ms + 6_000);
    const boss = sim.state.enemies.find((e) => e.kind === 'NULL_CORE')!;
    expect(boss).toBeTruthy();
    sim.state = {
      ...sim.state,
      enemies: sim.state.enemies.map((e) => (e.id === boss.id ? { ...e, hp: 5 } : e)),
      energy: { ...sim.state.energy, weapon: 100 },
    };
    sim.act('GUNNER_L', { actionType: 'LOCK', payload: { targetId: boss.id } });
    sim.wait(3_100);
    expect(sim.act('GUNNER_L', FIRE).accepted).toBe(true);
    expect(sim.state.result).toMatchObject({ outcome: 'VICTORY', reason: 'BOSS_DESTROYED' });
    expect(sim.state.phase).toBe('VICTORY');
    expect(sim.state.enemies).toHaveLength(0);
    sim.wait(T.victoryMs + 10);
    expect(sim.state.phase).toBe('RESULTS');
  });
});

describe('determinism', () => {
  function script(seed: number) {
    const sim = new Sim({ seed, autoSupport: true });
    sim.join('GUNNER_L');
    sim.join('SHIELD_L');
    sim.launch();
    for (let i = 0; i < 60; i++) {
      sim.wait(997);
      sim.act('GUNNER_L', i % 3 === 0 ? LOCK : FIRE);
      if (i % 5 === 0) sim.act('SHIELD_L', shield(i % 10 === 0 ? 'FRONT' : 'LEFT'));
    }
    return sim;
  }

  it('replays the same command log to the same state and events', () => {
    const a = script(7);
    const b = script(7);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    const c = script(8);
    expect(JSON.stringify(c.state)).not.toBe(JSON.stringify(a.state));
  });

  it('gives the same result whether the server ticks every 50 ms or irregularly', () => {
    const steady = new Sim();
    const jitter = new Sim();
    for (const sim of [steady, jitter]) sim.launch();
    for (let t = 50; t <= 30_000; t += 50) steady.to(t);
    let t = 0;
    let k = 0;
    while (t < 30_000) {
      t = Math.min(30_000, t + 13 + ((k++ * 37) % 140));
      jitter.to(t);
    }
    expect(JSON.stringify(jitter.state.enemies)).toBe(JSON.stringify(steady.state.enemies));
    expect(jitter.state.coreHp).toBe(steady.state.coreHp);
    expect(jitter.events.map((e) => e.type)).toEqual(steady.events.map((e) => e.type));
  });

  it('keeps event seq strictly increasing', () => {
    const sim = script(3);
    const seqs = sim.events.map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1]! + 1);
  });
});

describe('public state', () => {
  it('never exposes pilot ids or the RNG', () => {
    const sim = new Sim();
    sim.join('GUNNER_L', 'secret-pilot-uuid');
    const pub = toPublicState(sim.state);
    const json = JSON.stringify(pub);
    expect(json).not.toContain('secret-pilot-uuid');
    expect(json).not.toContain('"rng"');
    expect(json).not.toContain('actionLog');
    expect(pub.seats.GUNNER_L).toMatchObject({ occupied: true, auto: false, open: true });
    expect(pub.seats.POWER_CORE).toMatchObject({ occupied: false, open: false });
  });

  it('reports the total combat clock across waves', () => {
    const sim = new Sim();
    sim.launch();
    const pub = toPublicState(sim.state);
    const T = PRESETS.TEST.timings;
    expect(pub.combatEndsAt).toBe(sim.t + T.wave1Ms + T.wave2Ms + T.bossMs);
  });
});
