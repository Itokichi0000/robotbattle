import { bossHpFor, PRESETS } from '@swed/shared';
import type { GameConfig, MatchState } from '@swed/shared';
import { describe, expect, it } from 'vitest';
import { advanceTo, createMatch, isRoundOver, playerCount, reduce } from './engine';
import type { EngineCommand } from './engine';
import { recommendAction } from './hints';
import { toPublicState } from './public';

const T = PRESETS.TEST;

function cfg(patch: (c: GameConfig) => void = () => {}): GameConfig {
  const c = structuredClone(T);
  patch(c);
  return c;
}

function run(s: MatchState, cmd: EngineCommand) {
  return reduce(s, cmd);
}

/** A match in BATTLE with `n` players (p0..p{n-1}) at t = 0 of the battle. */
function battle(n = 1, c = cfg()) {
  let s = createMatch({ matchId: 'm', seed: 7, config: c, autoStart: false });
  for (let i = 0; i < n; i++)
    s = run(s, { type: 'PLAYER_JOIN', t: 0, pilotId: `p${i}`, displayName: `P${i}` }).state;
  s = run(s, { type: 'START', t: 0 }).state;
  s = run(s, { type: 'SKIP_DEPLOY', t: 0 }).state;
  return s;
}

let key = 0;
function tap(s: MatchState, t: number, kind: 'ATTACK' | 'DEFEND' | 'REPAIR', pilotId = 'p0') {
  return run(s, { type: 'ACTION', t, pilotId, clientActionId: `k${key++}`, kind });
}

describe('lobby', () => {
  it('starts by itself after the first player joins', () => {
    const c = cfg((x) => (x.timings.lobbyAutoStartMs = 10_000));
    let s = createMatch({ matchId: 'm', seed: 1, config: c });
    s = advanceTo(s, 30_000).state;
    expect(s.phase).toBe('LOBBY');
    expect(s.autoStartAt).toBeNull();
    s = run(s, { type: 'PLAYER_JOIN', t: 30_000, pilotId: 'a', displayName: 'A' }).state;
    s = advanceTo(s, 30_100).state;
    expect(s.autoStartAt).toBe(40_050);
    s = advanceTo(s, 40_200).state;
    expect(s.phase).toBe('COUNTDOWN');
  });

  it('auto start can be switched off by staff', () => {
    const c = cfg((x) => (x.timings.lobbyAutoStartMs = 1_000));
    let s = createMatch({ matchId: 'm', seed: 1, config: c });
    s = run(s, { type: 'SET_AUTO_START', t: 0, enabled: false }).state;
    s = run(s, { type: 'PLAYER_JOIN', t: 0, pilotId: 'a', displayName: 'A' }).state;
    s = advanceTo(s, 10_000).state;
    expect(s.phase).toBe('LOBBY');
  });

  it('runs countdown → deployment → battle on the clock', () => {
    let s = createMatch({ matchId: 'm', seed: 1, config: T, autoStart: false });
    s = run(s, { type: 'START', t: 100 }).state;
    expect(s.phase).toBe('COUNTDOWN');
    s = advanceTo(s, 100 + T.timings.countdownMs + T.timings.deploymentMs + 50).state;
    expect(s.phase).toBe('BATTLE');
    expect(s.enemies).toHaveLength(1);
    expect(s.enemies[0]!.kind).toBe('NULL_CORE');
  });
});

describe('players', () => {
  it('counts everyone who scanned, no seats, no limit', () => {
    let s = createMatch({ matchId: 'm', seed: 1, config: T });
    for (let i = 0; i < 120; i++)
      s = run(s, { type: 'PLAYER_JOIN', t: 0, pilotId: `p${i}`, displayName: 'x' }).state;
    expect(playerCount(s)).toBe(120);
    expect(toPublicState(s).players).toBe(120);
  });

  it('keeps a dropped phone counted for a while, then not', () => {
    let s = battle(2);
    const t0 = s.t;
    s = run(s, { type: 'PLAYER_CONNECTION', t: t0, pilotId: 'p1', connected: false }).state;
    expect(playerCount(s)).toBe(2);
    s = advanceTo(s, t0 + T.timings.playerHoldMs + 100).state;
    expect(playerCount(s)).toBe(1);
  });

  it('sizes the boss by the crowd at launch, and grows it for latecomers', () => {
    let s = battle(3);
    const boss = s.enemies[0]!;
    expect(boss.maxHp).toBe(bossHpFor(T, 3));
    s = run(s, { type: 'PLAYER_JOIN', t: s.t, pilotId: 'late', displayName: 'L' }).state;
    expect(s.enemies[0]!.maxHp).toBe(bossHpFor(T, 4));
    expect(s.enemies[0]!.hp).toBe(s.enemies[0]!.maxHp);
  });

  it('never shows pilot ids to clients', () => {
    const s = battle(2);
    expect(JSON.stringify(toPublicState(s))).not.toContain('p1');
  });
});

describe('free actions', () => {
  it('ATTACK damages the boss, DEFEND fills the shield, REPAIR fixes armour', () => {
    let s = battle(1);
    const hp = s.enemies[0]!.hp;
    s = tap(s, s.t, 'ATTACK').state;
    expect(s.enemies[0]!.hp).toBe(hp - T.free.effect.ATTACK);
    s = tap(s, s.t + T.free.cooldownMs, 'DEFEND').state;
    expect(s.shield).toBe(T.free.effect.DEFEND);
    s.mechHp = 50;
    s = tap(s, s.t + T.free.cooldownMs, 'REPAIR').state;
    expect(s.mechHp).toBe(50 + T.free.effect.REPAIR);
  });

  it('has a per-person cooldown, so mashing does not multiply', () => {
    let s = battle(1);
    let r = tap(s, s.t, 'ATTACK');
    s = r.state;
    r = tap(s, s.t + 100, 'ATTACK');
    expect(r.outcome).toMatchObject({
      kind: 'action',
      result: { accepted: false, reasonCode: 'COOLDOWN' },
    });
    r = tap(r.state, s.t + T.free.cooldownMs, 'ATTACK');
    expect(r.outcome).toMatchObject({ kind: 'action', result: { accepted: true } });
  });

  it('is idempotent per clientActionId', () => {
    let s = battle(1);
    const cmd = {
      type: 'ACTION' as const,
      t: s.t,
      pilotId: 'p0',
      clientActionId: 'same-key',
      kind: 'ATTACK' as const,
    };
    s = run(s, cmd).state;
    const hp = s.enemies[0]!.hp;
    const again = run(s, { ...cmd, t: s.t + 5_000 });
    expect(again.state.enemies[0]!.hp).toBe(hp);
    expect(again.outcome).toMatchObject({ kind: 'action', result: { accepted: true } });
  });

  it('refuses outside the battle, while paused, and for strangers', () => {
    let s = createMatch({ matchId: 'm', seed: 1, config: T, autoStart: false });
    s = run(s, { type: 'PLAYER_JOIN', t: 0, pilotId: 'p0', displayName: 'x' }).state;
    expect(tap(s, 0, 'ATTACK').outcome).toMatchObject({ result: { reasonCode: 'NOT_IN_COMBAT' } });
    s = battle(1);
    expect(tap(s, s.t, 'ATTACK', 'nobody').outcome).toMatchObject({
      result: { reasonCode: 'NOT_JOINED' },
    });
    s = run(s, { type: 'PAUSE', t: s.t }).state;
    expect(tap(s, s.t, 'ATTACK').outcome).toMatchObject({ result: { reasonCode: 'PAUSED' } });
  });

  it('reaches screens as a few aggregated events, not one per tap', () => {
    let s = battle(30);
    const events = [];
    for (let i = 0; i < 30; i++) {
      const r = tap(s, s.t + 10, 'ATTACK', `p${i}`);
      s = r.state;
      events.push(...r.events);
    }
    const r = advanceTo(s, s.t + 400);
    events.push(...r.events);
    const actions = events.filter((e) => e.type === 'action');
    expect(actions.length).toBeLessThanOrEqual(2);
    expect(actions.reduce((a, e) => a + (e.type === 'action' ? e.count : 0), 0)).toBe(30);
  });
});

describe('Lightning actions', () => {
  it('apply once per payment intent, with the big effect', () => {
    let s = battle(1);
    const hp = s.enemies[0]!.hp;
    const pay = {
      type: 'PAID_ACTION' as const,
      t: s.t,
      intentId: 'pi_1',
      pilotId: 'p0',
      kind: 'ATTACK' as const,
      virtual: true,
      settleMs: null,
    };
    let r = run(s, pay);
    expect(r.outcome).toEqual({ kind: 'control', ok: true });
    const big = hp - r.state.enemies[0]!.hp;
    expect(big).toBeGreaterThanOrEqual(T.paid.effect.ATTACK);
    expect(big).toBeGreaterThan(T.free.effect.ATTACK * 5);
    r = run(r.state, { ...pay, t: r.state.t + 1 });
    expect(r.outcome).toEqual({ kind: 'control', ok: false });
    expect(r.state.stats.lightning).toBe(1);
    s = r.state;
    const ev = run(s, { ...pay, intentId: 'pi_2', kind: 'DEFEND', t: s.t }).events.find(
      (e) => e.type === 'action',
    );
    expect(ev).toMatchObject({ paid: true, virtual: true, count: 1, value: T.paid.effect.DEFEND });
  });

  it('are refused once the battle is over (the server records them unapplied)', () => {
    const s = createMatch({ matchId: 'm', seed: 1, config: T, autoStart: false });
    const r = run(s, {
      type: 'PAID_ACTION',
      t: 0,
      intentId: 'pi_x',
      pilotId: null,
      kind: 'ATTACK',
      virtual: true,
      settleMs: null,
    });
    expect(r.outcome).toEqual({ kind: 'control', ok: false });
  });

  it('a 21 sats attack is a visible share of the boss in any crowd', () => {
    for (const n of [1, 10, 60]) {
      const s = battle(n);
      const hp = s.enemies[0]!.hp;
      const r = run(s, {
        type: 'PAID_ACTION',
        t: s.t,
        intentId: `pi${n}`,
        pilotId: 'p0',
        kind: 'ATTACK',
        virtual: true,
        settleMs: null,
      });
      expect((hp - r.state.enemies[0]!.hp) / s.enemies[0]!.maxHp).toBeGreaterThanOrEqual(0.049);
    }
  });

  it('the match cap means money alone can never finish the boss', () => {
    const s = battle(40, cfg());
    const share = Math.max(T.paid.attackBossShare, T.paid.effect.ATTACK / s.enemies[0]!.maxHp);
    expect(share * T.paid.maxPerMatch).toBeLessThan(1);
  });
});

describe('strikes and claws', () => {
  it('announces a city strike ahead and blocks it with enough shield', () => {
    let s = battle(1);
    const t0 = s.t;
    s = advanceTo(s, t0 + T.strikes.firstAtMs + 50).state;
    const th = s.threats.find((x) => x.target.type === 'CITY')!;
    expect(th.impactAt - th.warnAt).toBe(T.strikes.warnMs);
    s.shield = 100;
    const r = advanceTo(s, th.impactAt + 50);
    expect(r.events.some((e) => e.type === 'strike_blocked')).toBe(true);
    expect(Object.values(r.state.cities).every((c) => !c.lost)).toBe(true);
  });

  it('loses the city without shield, and the match after enough cities', () => {
    let s = battle(
      1,
      cfg((c) => {
        c.strikes.everyMs = c.strikes.warnMs + 100;
        c.mech.hitFirstAtMs = 999_999;
      }),
    );
    s = advanceTo(s, s.t + 200_000).state;
    expect(s.result).toMatchObject({ outcome: 'DEFEAT', reason: 'CITIES_LOST' });
    expect(Object.values(s.cities).filter((c) => c.lost)).toHaveLength(T.strikes.lostForDefeat);
  });

  it('claws hurt RAIJIN; no repairs → MECH_DESTROYED', () => {
    let s = battle(
      1,
      cfg((c) => {
        c.strikes.firstAtMs = 999_999;
        c.mech.hitEveryMs = 3_500;
        c.timings.battleMs = 999_999;
      }),
    );
    s = advanceTo(s, s.t + 200_000).state;
    expect(s.result).toMatchObject({ outcome: 'DEFEAT', reason: 'MECH_DESTROYED' });
  });

  it('runs out of time without enough attacks', () => {
    let s = battle(
      1,
      cfg((c) => {
        c.strikes.firstAtMs = 999_999;
        c.mech.hitFirstAtMs = 999_999;
      }),
    );
    s = advanceTo(s, s.t + T.timings.battleMs + 100).state;
    expect(s.result).toMatchObject({ outcome: 'DEFEAT', reason: 'TIME_UP' });
  });
});

describe('victory and round flow', () => {
  it('destroying the boss wins, then results, then the round is over', () => {
    let s = battle(1);
    s.enemies[0]!.hp = 3;
    const r = tap(s, s.t, 'ATTACK');
    expect(r.state.result).toMatchObject({ outcome: 'VICTORY', reason: 'BOSS_DESTROYED' });
    expect(r.events.map((e) => e.type)).toContain('boss_destroyed');
    s = advanceTo(r.state, r.state.t + T.timings.victoryMs + T.timings.resultsMs + 200).state;
    expect(isRoundOver(s)).toBe(true);
  });

  it('pause stops the clock and the attacks', () => {
    let s = battle(1);
    s = run(s, { type: 'PAUSE', t: s.t }).state;
    const ends = s.phaseEndsAt;
    s = advanceTo(s, s.t + 60_000).state;
    expect(s.threats).toHaveLength(0);
    expect(s.phaseEndsAt).toBe(ends);
  });

  it('is deterministic for a seed', () => {
    const play = () => {
      let s = battle(3);
      const t0 = s.t;
      for (let t = t0; t < t0 + 30_000; t += 500) {
        s = advanceTo(s, t).state;
        s = tap(s, t, recommendAction(toPublicState(s)), `p${((t - t0) / 500) % 3}`).state;
      }
      return JSON.stringify({ e: s.enemies, th: s.threats, c: s.cities, m: s.mechHp });
    };
    key = 0;
    const a = play();
    key = 0;
    expect(play()).toBe(a);
  });
});

describe('recommendation', () => {
  it('says DEFEND when a strike is coming and the shield is short, else ATTACK', () => {
    let s = battle(1);
    expect(recommendAction(toPublicState(s))).toBe('ATTACK');
    s = advanceTo(s, s.t + T.strikes.firstAtMs + 50).state;
    expect(recommendAction(toPublicState(s))).toBe('DEFEND');
    s.shield = 100;
    expect(recommendAction(toPublicState(s))).toBe('ATTACK');
    s.mechHp = 40;
    expect(recommendAction(toPublicState(s))).toBe('REPAIR');
  });
});
