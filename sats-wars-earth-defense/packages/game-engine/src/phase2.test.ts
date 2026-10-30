import { PRESETS } from '@swed/shared';
import type { GameConfig, MechPartId, PilotActionInput } from '@swed/shared';
import { describe, expect, it } from 'vitest';
import { nextRandom } from './rng';
import { generatePuzzle, routeConnects, solvePuzzle } from './router';
import { Sim } from './testkit';

/** Cities and core that cannot fall: tests about mechanics, not survival. */
function sturdy(patch: (c: GameConfig) => void = () => undefined): GameConfig {
  const c = structuredClone(PRESETS.TEST);
  c.cities.lostForDefeat = 99;
  c.core.max = 1_000_000;
  patch(c);
  return c;
}

const plan = (
  weapon: number,
  shield: number,
  mobility: number,
  repair: number,
  baseVersion: number,
): PilotActionInput => ({
  actionType: 'SET_POWER',
  payload: { distribution: { weapon, shield, mobility, repair }, baseVersion },
});

describe('router puzzle', () => {
  it('always generates a solvable puzzle that is not already solved', () => {
    const h = { rng: 12345 };
    for (let i = 0; i < 500; i++) {
      const p = generatePuzzle(h);
      expect(p.tiles).toHaveLength(9);
      expect(
        routeConnects(
          p,
          p.tiles.map((t) => t.rot),
        ),
      ).toBe(false);
      const sol = solvePuzzle(p);
      expect(sol).not.toBeNull();
      expect(routeConnects(p, sol!)).toBe(true);
    }
  });

  it('judges the rotations, not the claim: random rotations almost never connect', () => {
    const h = { rng: 99 };
    const p = generatePuzzle(h);
    let ok = 0;
    for (let i = 0; i < 200; i++) {
      const rots = p.tiles.map(() => Math.floor(nextRandom(h) * 4));
      if (routeConnects(p, rots)) ok += 1;
    }
    expect(ok).toBeLessThan(40);
  });
});

describe('POWER A — reactor plan', () => {
  it('needs a total of 100 within lane caps and the current version', () => {
    const sim = new Sim({ config: sturdy() });
    sim.join('POWER_CORE');
    sim.launch();
    const v = sim.state.distributionVersion;
    expect(sim.act('POWER_CORE', plan(50, 30, 10, 20, v)).reasonCode).toBe('BAD_DISTRIBUTION');
    expect(sim.act('POWER_CORE', plan(80, 10, 0, 10, v)).reasonCode).toBe('BAD_DISTRIBUTION');
    expect(sim.act('POWER_CORE', plan(50, 30, 5, 15, v + 7)).reasonCode).toBe('STALE_VERSION');
    expect(sim.act('POWER_CORE', plan(50, 30, 5, 15, v)).accepted).toBe(true);
    expect(sim.state.distribution).toEqual({ weapon: 50, shield: 30, mobility: 5, repair: 15 });
    expect(sim.state.distributionVersion).toBe(v + 1);
    // The second phone that drew from the old version is refused, not silently merged.
    expect(sim.act('POWER_CORE', plan(40, 40, 5, 15, v)).reasonCode).toBe('STALE_VERSION');
    expect(sim.of('power_routed').at(-1)).toMatchObject({ seatId: 'POWER_CORE', auto: false });
  });

  it('moves real energy: more weapon share means faster weapon regen and harder hits', () => {
    const regen = (weapon: number) => {
      const sim = new Sim({ config: sturdy() });
      sim.join('POWER_CORE');
      sim.launch();
      sim.state = { ...sim.state, energy: { weapon: 0, shield: 0, mobility: 0, repair: 0 } };
      const rest = 100 - weapon;
      sim.act(
        'POWER_CORE',
        plan(weapon, Math.min(70, rest), Math.max(0, rest - 70), 0, sim.state.distributionVersion),
      );
      sim.wait(2_000);
      return sim.state.energy.weapon;
    };
    expect(regen(70)).toBeGreaterThan(regen(30) * 2);
  });

  it('only counts as teamwork when the plan really changes, at most every few seconds', () => {
    const sim = new Sim({ config: sturdy() });
    sim.join('POWER_CORE');
    sim.join('GUNNER_L');
    sim.launch();
    sim.act('POWER_CORE', plan(40, 30, 10, 20, sim.state.distributionVersion));
    const first = sim.state.recentSuccesses.length;
    sim.act('POWER_CORE', plan(45, 25, 10, 20, sim.state.distributionVersion));
    expect(sim.state.recentSuccesses.length).toBe(first);
  });
});

describe('POWER B — circuit overloads', () => {
  it('cuts a lane on schedule, starves it, and the right rotations restore it', () => {
    const sim = new Sim({ config: sturdy() });
    sim.join('POWER_ROUTER');
    sim.launch();
    sim.wait(PRESETS.TEST.router.firstAtMs.WAVE_1! + 100);
    const over = sim.of('circuit_overload')[0];
    expect(over).toBeTruthy();
    const lane = over!.lane;
    const c = sim.state.circuits[lane];
    expect(c.broken && c.puzzle).toBeTruthy();
    const before = sim.state.energy[lane];
    sim.wait(2_000);
    // Starved: regen at a tenth of normal at most.
    expect(sim.state.energy[lane] - before).toBeLessThan(2);
    const wrong = c.puzzle!.tiles.map((t) => t.rot);
    expect(
      sim.act('POWER_ROUTER', { actionType: 'ROUTE_SUBMIT', payload: { lane, rotations: wrong } })
        .reasonCode,
    ).toBe('ROUTE_INCOMPLETE');
    const right = solvePuzzle(sim.state.circuits[lane].puzzle!)!;
    expect(
      sim.act('POWER_ROUTER', { actionType: 'ROUTE_SUBMIT', payload: { lane, rotations: right } })
        .accepted,
    ).toBe(true);
    expect(sim.state.circuits[lane].broken).toBe(false);
    expect(sim.of('circuit_restored').at(-1)).toMatchObject({ lane, auto: false });
    expect(
      sim.act('POWER_ROUTER', { actionType: 'ROUTE_SUBMIT', payload: { lane, rotations: right } })
        .reasonCode,
    ).toBe('CIRCUIT_OK');
  });

  it('AUTO SUPPORT re-routes an empty POWER B seat, slower than a person would', () => {
    const sim = new Sim({ config: sturdy(), autoSupport: true });
    sim.join('GUNNER_L');
    sim.launch();
    sim.wait(PRESETS.TEST.router.firstAtMs.WAVE_1! + 100);
    const lane = sim.of('circuit_overload')[0]!.lane;
    sim.wait(PRESETS.TEST.auto.routerFixMs - 500);
    expect(sim.state.circuits[lane].broken).toBe(true);
    sim.wait(1_000);
    expect(sim.state.circuits[lane].broken).toBe(false);
    expect(sim.of('circuit_restored').at(-1)).toMatchObject({ lane, auto: true });
  });
});

describe('ENGINEER — bolt jobs', () => {
  function damaged(part: MechPartId, hp = 40) {
    const sim = new Sim({ config: sturdy() });
    sim.join('ENGINEER_CORE');
    sim.join('ENGINEER_LEGS');
    sim.launch();
    sim.state = { ...sim.state, parts: { ...sim.state.parts, [part]: hp } };
    return sim;
  }

  it('refuses healthy parts and parts outside the seat section', () => {
    const sim = damaged('ARM_L');
    expect(
      sim.act('ENGINEER_CORE', { actionType: 'REPAIR_START', payload: { part: 'LEG_L' } })
        .reasonCode,
    ).toBe('NOT_YOUR_PART');
    expect(
      sim.act('ENGINEER_CORE', { actionType: 'REPAIR_START', payload: { part: 'CORE' } })
        .reasonCode,
    ).toBe('PART_OK');
  });

  it('opens a job with numbered bolts; the right order repairs, a wrong one does not', () => {
    const sim = damaged('ARM_L');
    expect(
      sim.act('ENGINEER_CORE', { actionType: 'REPAIR_START', payload: { part: 'ARM_L' } }).accepted,
    ).toBe(true);
    const job = sim.state.engineers.ENGINEER_CORE.job!;
    expect(job.bolts).toHaveLength(3);
    expect(new Set(job.bolts).size).toBe(3);
    const wrong = [...job.bolts].reverse();
    expect(
      sim.act('ENGINEER_CORE', {
        actionType: 'REPAIR_FINISH',
        payload: { part: 'ARM_L', order: wrong },
      }).reasonCode,
    ).toBe('WRONG_ORDER');
    expect(sim.state.parts.ARM_L).toBe(40);
    expect(
      sim.act('ENGINEER_CORE', {
        actionType: 'REPAIR_FINISH',
        payload: { part: 'ARM_L', order: job.bolts },
      }).accepted,
    ).toBe(true);
    expect(sim.state.parts.ARM_L).toBeGreaterThan(55);
    expect(sim.of('part_repaired').at(-1)).toMatchObject({
      part: 'ARM_L',
      seatId: 'ENGINEER_CORE',
      auto: false,
    });
    expect(
      sim.act('ENGINEER_CORE', { actionType: 'REPAIR_START', payload: { part: 'ARM_L' } })
        .reasonCode,
    ).toBe('COOLDOWN');
  });

  it('expires a job that is left too long', () => {
    const sim = damaged('LEG_R');
    sim.act('ENGINEER_LEGS', { actionType: 'REPAIR_START', payload: { part: 'LEG_R' } });
    const job = sim.state.engineers.ENGINEER_LEGS.job!;
    sim.wait(PRESETS.TEST.repair.jobMs + 200);
    expect(
      sim.act('ENGINEER_LEGS', {
        actionType: 'REPAIR_FINISH',
        payload: { part: 'LEG_R', order: job.bolts },
      }).reasonCode,
    ).toBe('NO_JOB');
  });

  it('wear gives engineers work: firing wears the gun arm', () => {
    const sim = new Sim({ config: sturdy() });
    sim.join('GUNNER_L');
    sim.launch();
    sim.wait(2_600);
    sim.act('GUNNER_L', { actionType: 'LOCK', payload: {} });
    sim.wait(1_500);
    sim.act('GUNNER_L', { actionType: 'FIRE', payload: {} });
    expect(sim.state.parts.ARM_L).toBeLessThan(100);
  });
});

describe('RAIJIN OVERDRIVE', () => {
  /** Puts the crew in the boss fight with SYNC and CAPACITOR at the threshold. */
  function charged(
    crew: Array<'GUNNER_L' | 'SHIELD_L' | 'POWER_CORE' | 'ENGINEER_CORE'>,
    autoSupport = true,
  ) {
    const sim = new Sim({ config: sturdy(), autoSupport });
    for (const seat of crew) sim.join(seat);
    sim.launch();
    const T = PRESETS.TEST.timings;
    sim.wait(T.wave1Ms + T.wave2Ms + 2_000);
    expect(sim.state.phase).toBe('BOSS');
    sim.state = { ...sim.state, teamSync: 90, teamCapacitor: 100, lastComboAt: sim.t };
    sim.wait(100);
    return sim;
  }

  it('becomes READY in the boss fight at SYNC ≥ 80 and CAPACITOR ≥ 100', () => {
    const sim = charged(['GUNNER_L']);
    expect(sim.state.overdrive.status).toBe('READY');
    expect(sim.of('overdrive_ready')).toHaveLength(1);
  });

  it('fires once when every role confirms within the window; AUTO SUPPORT stands in for empty roles', () => {
    const sim = charged(['GUNNER_L', 'SHIELD_L']);
    const bossHp = sim.state.enemies.find((e) => e.kind === 'NULL_CORE')!.hp;
    expect(sim.act('GUNNER_L', { actionType: 'SYNC_NOW', payload: {} }).accepted).toBe(true);
    const win = sim.of('overdrive_window')[0]!;
    expect(win.autoRoles.sort()).toEqual(['ENGINEER', 'POWER']);
    expect(sim.state.overdrive.status).toBe('CHARGING');
    sim.wait(PRESETS.TEST.overdrive.autoConfirmMs + 100);
    expect(sim.state.overdrive.confirmed.sort()).toEqual(['ENGINEER', 'GUNNER', 'POWER']);
    expect(sim.act('SHIELD_L', { actionType: 'SYNC_NOW', payload: {} }).accepted).toBe(true);
    const fired = sim.of('overdrive_fired');
    expect(fired).toHaveLength(1);
    expect(fired[0]!.autoRoles.sort()).toEqual(['ENGINEER', 'POWER']);
    const after = sim.state.enemies.find((e) => e.kind === 'NULL_CORE');
    expect(after ? after.hp : 0).toBe(Math.max(0, bossHp - PRESETS.TEST.overdrive.damage));
    expect(sim.state.teamCapacitor).toBe(0);
    expect(sim.state.overdrive.status).toBe('IDLE');
    expect(sim.act('GUNNER_L', { actionType: 'SYNC_NOW', payload: {} }).reasonCode).toBe(
      'OVERDRIVE_NOT_READY',
    );
  });

  it('fails when a crewed role does not confirm in time, keeping half the capacitor', () => {
    const sim = charged(['GUNNER_L', 'SHIELD_L']);
    sim.act('GUNNER_L', { actionType: 'SYNC_NOW', payload: {} });
    sim.wait(PRESETS.TEST.overdrive.windowMs + 200);
    const failed = sim.of('overdrive_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.missing).toEqual(['DEFENSE']);
    expect(sim.state.teamCapacitor).toBe(50);
    expect(sim.of('overdrive_fired')).toHaveLength(0);
  });

  it('is not available outside the boss fight', () => {
    const sim = new Sim({ config: sturdy() });
    sim.join('GUNNER_L');
    sim.launch();
    sim.state = { ...sim.state, teamSync: 100, teamCapacitor: 100 };
    sim.wait(200);
    expect(sim.act('GUNNER_L', { actionType: 'SYNC_NOW', payload: {} }).reasonCode).toBe(
      'OVERDRIVE_NOT_READY',
    );
  });
});

describe('shared energy pulses', () => {
  it('adds a fixed capacitor gain once per intent, only during combat', () => {
    const sim = new Sim({ config: sturdy() });
    sim.join('GUNNER_L');
    const early = sim.cmd({
      type: 'SATS_PULSE',
      t: sim.t,
      intentId: 'pi_1',
      seatId: 'GUNNER_L',
      virtual: true,
    });
    expect(early.outcome).toMatchObject({ ok: false, reasonCode: 'NOT_IN_COMBAT' });
    sim.launch();
    const c0 = sim.state.teamCapacitor;
    expect(
      sim.cmd({ type: 'SATS_PULSE', t: sim.t, intentId: 'pi_1', seatId: 'GUNNER_L', virtual: true })
        .outcome,
    ).toMatchObject({ ok: true });
    expect(sim.state.teamCapacitor).toBe(c0 + PRESETS.TEST.pulses.capacitorGain);
    // A duplicate webhook / retry never applies twice.
    expect(
      sim.cmd({ type: 'SATS_PULSE', t: sim.t, intentId: 'pi_1', seatId: 'GUNNER_L', virtual: true })
        .outcome,
    ).toMatchObject({ ok: false });
    expect(sim.state.teamCapacitor).toBe(c0 + PRESETS.TEST.pulses.capacitorGain);
    expect(sim.of('sats_pulse_settled')).toHaveLength(1);
    // The public event names the station, never the pilot or an amount.
    expect(JSON.stringify(sim.of('sats_pulse_settled')[0])).not.toMatch(/pilot|sats":/i);
  });
});

describe('demo bots', () => {
  it('a human taking a demo bot seat replaces the bot; bots never replace people', () => {
    const sim = new Sim();
    sim.cmd({
      type: 'SEAT_JOIN',
      t: 0,
      seatId: 'GUNNER_L',
      pilotId: 'bot:GUNNER_L',
      displayName: 'DEMO-BOT 1',
      bot: true,
    });
    expect(sim.state.seats.GUNNER_L.bot).toBe(true);
    const r = sim.join('GUNNER_L', 'human-1');
    expect(r.outcome).toEqual({ kind: 'seat', result: { ok: true, seatId: 'GUNNER_L' } });
    expect(sim.state.seats.GUNNER_L).toMatchObject({ pilotId: 'human-1', bot: false });
    expect(sim.of('seat_released').at(-1)?.reason).toBe('REPLACED');
    const back = sim.cmd({
      type: 'SEAT_JOIN',
      t: 0,
      seatId: 'GUNNER_L',
      pilotId: 'bot:GUNNER_L',
      displayName: 'DEMO-BOT 1',
      bot: true,
    });
    expect(back.outcome).toMatchObject({ result: { ok: false, reasonCode: 'SEAT_TAKEN' } });
  });
});
