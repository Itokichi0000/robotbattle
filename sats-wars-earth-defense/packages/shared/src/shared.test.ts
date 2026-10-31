import { describe, expect, it } from 'vitest';
import {
  ACTION_KINDS,
  bearingToDirection,
  bossHpFor,
  CITY_IDS,
  CITY_POINTS,
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

describe('japan', () => {
  it('keeps cities roughly where they are (north to south)', () => {
    const y = (id: (typeof CITY_IDS)[number]) => CITY_POINTS[id].y;
    expect(y('SAPPORO')).toBeGreaterThan(y('SENDAI'));
    expect(y('SENDAI')).toBeGreaterThan(y('TOKYO'));
    expect(y('TOKYO')).toBeGreaterThan(y('FUKUOKA'));
    expect(CITY_POINTS.FUKUOKA.x).toBeLessThan(CITY_POINTS.OSAKA.x);
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

  it('a Lightning action is the same size for everyone and bigger than a free tap', () => {
    for (const p of Object.values(PRESETS)) {
      for (const k of ACTION_KINDS)
        expect(p.paid.effect[k]).toBeGreaterThanOrEqual(p.free.effect[k] * 10);
      expect(p.paid.amountSats).toBe(21);
    }
  });

  it('announces city strikes at least 4 s ahead', () => {
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
