import { PRESETS } from '@swed/shared';
import type { GameConfig, PilotActionInput } from '@swed/shared';
import { describe, expect, it } from 'vitest';
import { solvePuzzle } from './router';
import { Sim } from './testkit';

/**
 * Teamwork made visible and the GRID PULSE moment: LINK CHAIN, PERFECT SHOT, REACTOR BLACKOUT
 * (re-route, AUTO SUPPORT, failure) and the Lightning pulse that ends it.
 */

function sturdy(patch: (c: GameConfig) => void = () => undefined): GameConfig {
  const c = structuredClone(PRESETS.TEST);
  c.cities.lostForDefeat = 99;
  c.core.max = 1_000_000;
  c.router.firstAtMs = { WAVE_1: null, WAVE_2: null, BOSS: null };
  c.crisis.atMs = { WAVE_1: null, WAVE_2: null, BOSS: null };
  patch(c);
  return c;
}

const plan = (w: number, s: number, m: number, r: number, v: number): PilotActionInput => ({
  actionType: 'SET_POWER',
  payload: { distribution: { weapon: w, shield: s, mobility: m, repair: r }, baseVersion: v },
});

/** Locks the recommended enemy as soon as one is targetable; returns the lock time. */
function lockWhenReady(sim: Sim): number {
  for (let i = 0; i < 200; i++) {
    const r = sim.act('GUNNER_L', { actionType: 'LOCK', payload: {} });
    if (r.accepted) return sim.t;
    sim.wait(100);
  }
  throw new Error('no target arrived');
}

describe('LINK CHAIN', () => {
  it('opens on one system, extends only with a different one, and pays SYNC per link', () => {
    const sim = new Sim({ config: sturdy() });
    sim.join('POWER_CORE');
    sim.join('GUNNER_L');
    sim.join('ENGINEER_LEGS');
    sim.launch();
    // Weapon share unchanged, so only the LINK changes the next shot.
    sim.act('POWER_CORE', plan(35, 20, 15, 30, sim.state.distributionVersion));
    expect(sim.state.link?.roles).toEqual(['POWER']);
    lockWhenReady(sim);
    sim.wait(2_000);
    expect(sim.act('GUNNER_L', { actionType: 'FIRE', payload: {} }).accepted).toBe(true);
    const shot = sim.of('weapon_fired').at(-1)!;
    expect(shot.link).toBe(2);
    const c2 = sim.of('team_combo').at(-1)!;
    expect(c2).toMatchObject({ link: 2, gain: 6, roles: ['POWER', 'GUNNER'], seatId: 'GUNNER_L' });

    // Engineer extends it to 3 (+4 more SYNC, +4 repair for the two systems already in).
    sim.state.parts.LEG_L = 40;
    expect(
      sim.act('ENGINEER_LEGS', { actionType: 'REPAIR_START', payload: { part: 'LEG_L' } }).accepted,
    ).toBe(true);
    const bolts = sim.state.engineers.ENGINEER_LEGS.job!.bolts;
    expect(
      sim.act('ENGINEER_LEGS', {
        actionType: 'REPAIR_FINISH',
        payload: { part: 'LEG_L', order: bolts },
      }).accepted,
    ).toBe(true);
    expect(sim.of('team_combo').at(-1)).toMatchObject({ link: 3, gain: 4 });
    expect(sim.state.link?.roles).toEqual(['POWER', 'GUNNER', 'ENGINEER']);
    const repaired = sim.of('part_repaired').at(-1)!;
    const plain = Math.round(PRESETS.TEST.repair.amount * (0.6 + 0.3 * 2));
    expect(repaired.hp).toBe(40 + plain + PRESETS.TEST.sync.linkRepairPerRole * 2);

    // The same system again does not extend it.
    const combos = sim.of('team_combo').length;
    sim.wait(3_500);
    sim.act('GUNNER_L', { actionType: 'FIRE', payload: {} });
    expect(sim.of('team_combo').length).toBe(combos);
  });

  it('expires when no other system follows in time', () => {
    const sim = new Sim({ config: sturdy() });
    sim.join('POWER_CORE');
    sim.launch();
    sim.act('POWER_CORE', plan(55, 25, 5, 15, sim.state.distributionVersion));
    expect(sim.state.link).not.toBeNull();
    sim.wait(PRESETS.TEST.sync.windowMs + 100);
    sim.act('POWER_CORE', plan(35, 30, 15, 20, sim.state.distributionVersion));
    expect(sim.state.link?.roles).toEqual(['POWER']);
    expect(sim.of('team_combo')).toHaveLength(0);
  });

  it('a link shot hits harder than the same shot alone', () => {
    const damage = (withLink: boolean) => {
      const sim = new Sim({ config: sturdy() });
      sim.join('POWER_CORE');
      sim.join('GUNNER_L');
      sim.launch();
      if (withLink) sim.act('POWER_CORE', plan(35, 20, 15, 30, sim.state.distributionVersion));
      lockWhenReady(sim);
      sim.wait(2_000);
      sim.act('GUNNER_L', { actionType: 'FIRE', payload: {} });
      return sim.of('weapon_fired').at(-1)!.damage;
    };
    expect(damage(true) / damage(false)).toBeCloseTo(1 + PRESETS.TEST.sync.linkDamagePerRole, 1);
  });
});

describe('PERFECT SHOT', () => {
  it('rewards releasing the moment the charge completes, judged on the server clock', () => {
    const shot = (lateMs: number) => {
      const sim = new Sim({ config: sturdy() });
      sim.join('GUNNER_L');
      sim.launch();
      lockWhenReady(sim);
      sim.to(sim.state.gunners.GUNNER_L.readyAt + lateMs);
      sim.act('GUNNER_L', { actionType: 'FIRE', payload: {} });
      return sim.of('weapon_fired').at(-1)!;
    };
    const perfect = shot(100);
    const late = shot(PRESETS.TEST.weapons.perfectMs + 300);
    expect(perfect.perfect).toBe(true);
    expect(late.perfect).toBe(false);
    expect(perfect.damage / late.damage).toBeCloseTo(PRESETS.TEST.weapons.perfectMultiplier, 1);
  });
});

describe('REACTOR BLACKOUT', () => {
  const blackout = (patch: (c: GameConfig) => void = () => undefined) =>
    sturdy((c) => {
      c.crisis.atMs.WAVE_1 = 3_000;
      patch(c);
    });

  it('drops regen to reserve; POWER B re-routes it and the crew earns an OVERCHARGE', () => {
    const sim = new Sim({ config: blackout() });
    sim.join('POWER_ROUTER');
    sim.launch();
    sim.wait(3_100);
    const c = sim.state.crisis!;
    expect(c.kind).toBe('BLACKOUT');
    expect(c.autoAt).toBeNull(); // a person flies POWER B: no AUTO rescue
    const sum = () => Object.values(sim.state.energy).reduce((a, b) => a + b, 0);
    const e0 = sum();
    sim.wait(1_000);
    // Reserve power only: some regen, never more than regenFactor of the full rate.
    const gained = sum() - e0;
    const cfg = PRESETS.TEST;
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeLessThanOrEqual(cfg.energy.regenPerSec * cfg.crisis.regenFactor + 1e-6);
    expect(
      sim.act('POWER_ROUTER', {
        actionType: 'BLACKOUT_ROUTE',
        payload: { rotations: c.puzzle.tiles.map((t) => t.rot) },
      }).reasonCode,
    ).toBe('ROUTE_INCOMPLETE');
    const ok = sim.act('POWER_ROUTER', {
      actionType: 'BLACKOUT_ROUTE',
      payload: { rotations: solvePuzzle(c.puzzle)! },
    });
    expect(ok.accepted).toBe(true);
    expect(sim.state.crisis).toBeNull();
    expect(sim.of('crisis_resolved').at(-1)).toMatchObject({ by: 'ROUTE', seatId: 'POWER_ROUTER' });
    expect(sim.state.overchargeUntil).toBe(sim.t + PRESETS.TEST.overcharge.ms);
    expect(sim.state.stats.blackoutsByRoute).toBe(1);
    // Only once per wave.
    sim.wait(5_000);
    expect(sim.state.crisis).toBeNull();
  });

  it('AUTO SUPPORT restores an unflown POWER B later, without the OVERCHARGE', () => {
    const sim = new Sim({ config: blackout(), autoSupport: true });
    sim.join('GUNNER_L');
    sim.launch();
    sim.wait(3_100);
    expect(sim.state.crisis?.autoAt).toBe(
      sim.state.crisis!.startedAt + PRESETS.TEST.crisis.autoFixMs,
    );
    sim.wait(PRESETS.TEST.crisis.autoFixMs);
    expect(sim.state.crisis).toBeNull();
    expect(sim.of('crisis_resolved').at(-1)).toMatchObject({ by: 'AUTO', overchargeUntil: null });
  });

  it('left unresolved, it costs core HP and drains every lane', () => {
    const sim = new Sim({ config: blackout() });
    sim.join('POWER_ROUTER');
    sim.launch();
    sim.wait(3_100);
    sim.to(sim.state.crisis!.endsAt - 50);
    const core = sim.state.coreHp;
    sim.wait(100);
    expect(sim.of('crisis_failed')).toEqual([
      expect.objectContaining({ damage: PRESETS.TEST.crisis.failDamage }),
    ]);
    expect(core - sim.state.coreHp).toBeGreaterThanOrEqual(PRESETS.TEST.crisis.failDamage);
    // Drained to zero (regen resumes from nothing right after).
    for (const v of Object.values(sim.state.energy)) expect(v).toBeLessThan(1);
    expect(sim.state.stats.blackoutsFailed).toBe(1);
  });

  it('a GRID PULSE ends it at once, with the confirmed settle time for the big screen', () => {
    const sim = new Sim({ config: blackout() });
    sim.join('POWER_ROUTER');
    sim.join('GUNNER_L');
    sim.launch();
    sim.wait(3_100);
    sim.cmd({
      type: 'SATS_PULSE',
      t: sim.t,
      intentId: 'pi_live',
      seatId: 'GUNNER_L',
      virtual: false,
      settleMs: 1_840,
    });
    expect(sim.state.crisis).toBeNull();
    expect(sim.of('sats_pulse_settled').at(-1)).toMatchObject({ crisis: true, settleMs: 1_840 });
    expect(sim.of('crisis_resolved').at(-1)).toMatchObject({ by: 'PULSE', seatId: 'GUNNER_L' });
    expect(sim.state.stats.blackoutsByPulse).toBe(1);
    // A VIRTUAL pulse never shows a settle time (no money moved).
    sim.cmd({
      type: 'SATS_PULSE',
      t: sim.t,
      intentId: 'pi_virtual',
      seatId: null,
      virtual: true,
      settleMs: 999,
    });
    expect(sim.of('sats_pulse_settled').at(-1)).toMatchObject({ crisis: false, settleMs: null });
  });

  it('overcharge really speeds up energy', () => {
    const regen = (overcharged: boolean) => {
      const sim = new Sim({ config: sturdy() });
      sim.join('GUNNER_L');
      sim.launch();
      sim.state.energy = { weapon: 0, shield: 0, mobility: 0, repair: 0 };
      if (overcharged) sim.state.overchargeUntil = sim.t + 60_000;
      sim.wait(1_000);
      return sim.state.energy.shield;
    };
    expect(regen(true) / regen(false)).toBeCloseTo(PRESETS.TEST.overcharge.regenFactor, 1);
  });
});
