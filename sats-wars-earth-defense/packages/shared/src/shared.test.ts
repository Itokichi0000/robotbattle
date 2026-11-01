import { describe, expect, it } from 'vitest';
import {
  boltDamageFor,
  boltTargetAt,
  bearingToDirection,
  bossHpFor,
  SQUAD_IDS,
  mothershipPoint,
  routeProgress,
  SQUADS,
  zoneAt,
  configHash,
  ENGINEER_COVERAGE,
  formatClock,
  MECH_PART_IDS,
  mechHitFor,
  PRESETS,
  ROLES,
  SEAT_IDS,
  SEATS,
  SHIELD_COVERAGE,
  shieldSeatFor,
  strikeNeedFor,
} from './index';
import { operatorCommandSchema, pilotActionReqSchema } from './schemas';

describe('seats', () => {
  it('has eight seats on one mech, two per role, numbered 1..8', () => {
    expect(SEAT_IDS).toHaveLength(8);
    expect(SEAT_IDS.map((s) => SEATS[s].no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const role of Object.values(ROLES)) {
      expect(role.seats).toHaveLength(2);
      for (const s of role.seats) expect(SEATS[s].role).toBe(role.id);
    }
  });

  it('shield sectors cover all four directions without overlap', () => {
    const all = [...SHIELD_COVERAGE.SHIELD_L, ...SHIELD_COVERAGE.SHIELD_R];
    expect(new Set(all).size).toBe(4);
    for (const d of all) expect(SHIELD_COVERAGE[shieldSeatFor(d)]).toContain(d);
  });

  it('engineer coverage repairs every part exactly once', () => {
    const all = [...ENGINEER_COVERAGE.ENGINEER_LEGS, ...ENGINEER_COVERAGE.ENGINEER_CORE];
    expect([...all].sort()).toEqual([...MECH_PART_IDS].sort());
  });

  it('maps bearings to sectors', () => {
    expect(bearingToDirection(0)).toBe('FRONT');
    expect(bearingToDirection(44)).toBe('FRONT');
    expect(bearingToDirection(90)).toBe('RIGHT');
    expect(bearingToDirection(-90)).toBe('LEFT');
    expect(bearingToDirection(180)).toBe('REAR');
    expect(bearingToDirection(-170)).toBe('REAR');
    expect(bearingToDirection(370)).toBe('FRONT');
  });
});

describe('space route (D-034)', () => {
  it('has two squads in each area, Mars first and Earth last', () => {
    const zones = SQUAD_IDS.map((id) => SQUADS[id].zone);
    expect(zones).toEqual(['MARS', 'MARS', 'MOON', 'MOON', 'EARTH', 'EARTH']);
    const xs = SQUAD_IDS.map((id) => SQUADS[id].at.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });
  it('flies the mothership from Mars to Earth over the battle, in thirds', () => {
    const at = (t: number, phase = 'BATTLE') =>
      routeProgress({ phase, t, phaseStartedAt: 1_000 }, 120_000);
    expect(at(1_000)).toBe(0);
    expect(at(61_000)).toBeCloseTo(0.5);
    expect(at(500_000)).toBe(1);
    expect(at(0, 'LOBBY')).toBe(0);
    expect(at(0, 'RESULTS')).toBe(1);
    expect(zoneAt(0.1)).toBe('MARS');
    expect(zoneAt(0.5)).toBe('MOON');
    expect(zoneAt(0.9)).toBe('EARTH');
    expect(mothershipPoint(0).x).toBeLessThan(mothershipPoint(1).x);
  });
});

describe('config', () => {
  it('hashes stably and differently per preset', () => {
    expect(configHash(PRESETS.STANDARD)).toBe(configHash(structuredClone(PRESETS.STANDARD)));
    expect(configHash(PRESETS.STANDARD)).not.toBe(configHash(PRESETS.SHORT));
  });

  it('runs STANDARD at 120 s and SHORT at 90 s of battle', () => {
    expect(PRESETS.STANDARD.timings.battleMs).toBe(120_000);
    expect(PRESETS.SHORT.timings.battleMs).toBe(90_000);
  });

  it('Lightning is a fixed 21 sats: THUNDER MODE multiplies play, the bolt dwarfs a tap', () => {
    for (const p of Object.values(PRESETS)) {
      expect(p.paid.amountSats).toBe(21);
      expect(p.paid.feverMultiplier).toBeGreaterThan(1);
      expect(p.paid.feverMs).toBeGreaterThanOrEqual(5_000);
      expect(boltDamageFor(p, 300)).toBeGreaterThanOrEqual(p.free.effect.ATTACK * 5);
      expect(boltDamageFor(p, 4_000)).toBe(Math.round(4_000 * p.paid.boltBossShare));
      // Every bolt a round allows, all on the weak point, still cannot finish the boss.
      for (const n of [1, 2, 3, 5, 10, 40]) {
        const hp = bossHpFor(p, n);
        const bolts = Math.min(p.paid.maxPerMatch, p.paid.perPilotPerMatch * n);
        expect(bolts * boltDamageFor(p, hp) * p.paid.boltHitMultiplier).toBeLessThan(hp);
      }
    }
  });

  it('moves the weak point the same way for the phone and the server, inside the field', () => {
    for (let ms = 0; ms < 8_000; ms += 250) {
      const a = boltTargetAt('pi-abc', ms);
      expect(a).toEqual(boltTargetAt('pi-abc', ms));
      expect(a.x).toBeGreaterThan(0.1);
      expect(a.x).toBeLessThan(0.9);
      expect(a.y).toBeGreaterThan(0.15);
      expect(a.y).toBeLessThan(0.7);
    }
    expect(boltTargetAt('pi-abc', 1_000)).not.toEqual(boltTargetAt('pi-xyz', 1_000));
  });

  it('announces squad strikes at least 4 s ahead', () => {
    for (const p of Object.values(PRESETS)) {
      expect(p.strikes.warnMs).toBeGreaterThanOrEqual(4_000);
      expect(p.mech.hitWarnMs).toBeGreaterThanOrEqual(2_000);
    }
  });

  it('grows the boss with the crowd, but slower than the crowd grows', () => {
    const c = PRESETS.STANDARD;
    expect(bossHpFor(c, 10)).toBeGreaterThan(bossHpFor(c, 1));
    expect(bossHpFor(c, 10)).toBeLessThan(bossHpFor(c, 1) * 10);
    expect(strikeNeedFor(c, 200)).toBe(c.strikes.needMax);
    expect(mechHitFor(c, 200)).toBe(Math.round(c.mech.hitDamage * c.mech.hitMaxScale));
  });
});

describe('formatClock', () => {
  it('formats and clamps', () => {
    expect(formatClock(138_000)).toBe('02:18');
    expect(formatClock(-5)).toBe('00:00');
    expect(formatClock(1)).toBe('00:01');
  });
});

describe('schemas', () => {
  it('accepts one of the three actions and nothing else', () => {
    const ok = { matchId: 'm1', clientActionId: 'abcdefgh1234', action: { kind: 'ATTACK' } };
    expect(pilotActionReqSchema.safeParse(ok).success).toBe(true);
    expect(pilotActionReqSchema.safeParse({ ...ok, hp: 9999 }).success).toBe(false);
    expect(pilotActionReqSchema.safeParse({ ...ok, action: { kind: 'NUKE' } }).success).toBe(false);
    expect(
      pilotActionReqSchema.safeParse({ ...ok, action: { kind: 'ATTACK', damage: 9999 } }).success,
    ).toBe(false);
  });

  it('never lets an operator pick the TEST preset', () => {
    expect(
      operatorCommandSchema.safeParse({ command: 'SET_PRESET', presetId: 'SHORT' }).success,
    ).toBe(true);
    expect(
      operatorCommandSchema.safeParse({ command: 'SET_PRESET', presetId: 'TEST' }).success,
    ).toBe(false);
  });
});
