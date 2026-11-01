import { boltTargetAt, bossHpFor, PRESETS, routeProgress, SQUADS, zoneAt } from '@swed/shared';
import type { GameConfig, MatchState } from '@swed/shared';
import { describe, expect, it } from 'vitest';
import {
  advanceTo,
  boltDamage,
  boltHits,
  createMatch,
  isRoundOver,
  jobsOf,
  playerCount,
  reduce,
  teamCounts,
  teamScale,
} from './engine';
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

describe('teams (D-035)', () => {
  it('puts newcomers in the smallest team, in the order 撃つ → 守る → 直す', () => {
    const s = battle(7);
    const roles = Object.values(s.players).map((p) => p.role);
    expect(roles).toEqual(['ATTACK', 'DEFEND', 'REPAIR', 'ATTACK', 'DEFEND', 'REPAIR', 'ATTACK']);
    expect(teamCounts(s)).toEqual({ ATTACK: 3, DEFEND: 2, REPAIR: 2 });
  });

  it('shares the job of a team nobody is in, so one or two people can play everything', () => {
    let s = battle(1);
    expect(jobsOf(s, 'p0')).toEqual(['ATTACK', 'DEFEND', 'REPAIR']);
    s = battle(2);
    expect(jobsOf(s, 'p0')).toEqual(['ATTACK', 'REPAIR']);
    expect(jobsOf(s, 'p1')).toEqual(['DEFEND', 'REPAIR']);
    s = battle(3);
    expect(jobsOf(s, 'p2')).toEqual(['REPAIR']);
  });

  it('a short-handed team counts for more (×1 to ×2), shooting never scales', () => {
    expect(teamScale(battle(1), 'DEFEND')).toBe(1);
    expect(teamScale(battle(3), 'DEFEND')).toBe(1);
    const four = battle(4);
    expect(teamScale(four, 'DEFEND')).toBeCloseTo(4 / 3);
    expect(teamScale(four, 'ATTACK')).toBe(1);
    const r = tap(four, four.t, 'DEFEND', 'p1');
    expect(r.state.shield).toBeCloseTo(T.free.effect.DEFEND * (4 / 3), 5);
  });

  it("refuses another team's job, but anyone may shoot", () => {
    const s = battle(3);
    s.mechHp = 50;
    expect(tap(s, s.t, 'REPAIR', 'p0').outcome).toMatchObject({
      result: { accepted: false, reasonCode: 'WRONG_TEAM' },
    });
    const r = tap(s, s.t, 'ATTACK', 'p2');
    expect(r.outcome).toMatchObject({ result: { accepted: true } });
    expect(tap(r.state, r.state.t, 'REPAIR', 'p2').outcome).toMatchObject({
      result: { reasonCode: 'COOLDOWN' },
    });
  });
});

describe('group launch (D-035)', () => {
  it('turns the share of players who swiped up into starting shield', () => {
    let s = createMatch({ matchId: 'm', seed: 3, config: T, autoStart: false });
    for (let i = 0; i < 4; i++)
      s = run(s, { type: 'PLAYER_JOIN', t: 0, pilotId: `p${i}`, displayName: `P${i}` }).state;
    expect(run(s, { type: 'LAUNCH_PUSH', t: 0, pilotId: 'p0' }).outcome).toMatchObject({
      result: { accepted: false, reasonCode: 'NOT_LAUNCHING' },
    });
    s = run(s, { type: 'START', t: 0 }).state;
    let r = run(s, { type: 'LAUNCH_PUSH', t: 10, pilotId: 'p0' });
    expect(r.events.find((e) => e.type === 'launch_push')).toMatchObject({
      launched: 1,
      players: 4,
    });
    r = run(r.state, { type: 'LAUNCH_PUSH', t: 20, pilotId: 'p0' });
    expect(r.events).toHaveLength(0); // once per player
    s = run(r.state, { type: 'LAUNCH_PUSH', t: 30, pilotId: 'p1' }).state;
    s = run(s, { type: 'SKIP_DEPLOY', t: 40 }).state;
    expect(s.shield).toBe(Math.round(T.launch.shieldAtFull / 2));
    expect(s.stats.launched).toBe(2);
  });
});

describe('Lightning (D-035)', () => {
  const pay = (s: MatchState, intentId = 'pi_1', pilotId: string | null = 'p0') =>
    run(s, { type: 'LIGHTNING', t: s.t, intentId, pilotId, virtual: true, settleMs: null });

  it('applies once per payment: THUNDER MODE for everyone and one bolt for the payer', () => {
    const s = battle(2);
    let r = pay(s);
    expect(r.outcome).toEqual({ kind: 'control', ok: true });
    expect(r.state.feverUntil).toBe(s.t + T.paid.feverMs);
    expect(r.state.bolts).toHaveLength(1);
    expect(r.events.find((e) => e.type === 'lightning')).toMatchObject({
      virtual: true,
      bot: false,
    });
    r = run(r.state, {
      type: 'LIGHTNING',
      t: r.state.t + 1,
      intentId: 'pi_1',
      pilotId: 'p0',
      virtual: true,
      settleMs: null,
    });
    expect(r.outcome).toEqual({ kind: 'control', ok: false });
    expect(r.state.stats.lightning).toBe(1);
  });

  it('THUNDER MODE multiplies every free action, for everyone, and then ends', () => {
    let s = pay(battle(2)).state;
    const hp = s.enemies[0]!.hp;
    const r = tap(s, s.t, 'ATTACK', 'p1');
    expect(hp - r.state.enemies[0]!.hp).toBe(T.free.effect.ATTACK * T.paid.feverMultiplier);
    const later = advanceTo(r.state, r.state.t + 300);
    expect(later.events.find((e) => e.type === 'action')).toMatchObject({ fever: true });
    s = advanceTo(later.state, s.t + T.paid.feverMs + 100).state;
    const hp2 = s.enemies[0]!.hp;
    s = tap(s, s.t, 'ATTACK', 'p1').state;
    expect(hp2 - s.enemies[0]!.hp).toBe(T.free.effect.ATTACK);
  });

  it('a bolt on the weak point is worth double; the server judges the tap', () => {
    const s = pay(battle(2)).state;
    const bolt = s.bolts[0]!;
    const hp = s.enemies[0]!.hp;
    const at = s.t + 900;
    const aim = boltTargetAt(bolt.id, at - bolt.startedAt);
    const hit = run(s, { type: 'BOLT_THROW', t: at, pilotId: 'p0', boltId: bolt.id, ...aim, at });
    expect(hit.events.find((e) => e.type === 'bolt_thrown')).toMatchObject({
      hit: true,
      auto: false,
    });
    expect(hp - hit.state.enemies[0]!.hp).toBe(boltDamage(s) * T.paid.boltHitMultiplier);
    expect(hit.state.bolts).toHaveLength(0);
    const miss = run(s, {
      type: 'BOLT_THROW',
      t: at,
      pilotId: 'p0',
      boltId: bolt.id,
      x: 0,
      y: 0,
      at,
    });
    expect(miss.events.find((e) => e.type === 'bolt_thrown')).toMatchObject({ hit: false });
    expect(hp - miss.state.enemies[0]!.hp).toBe(boltDamage(s));
    // Only the payer can throw it, and a claimed time far from the server's is not trusted.
    expect(
      run(s, { type: 'BOLT_THROW', t: at, pilotId: 'p1', boltId: bolt.id, ...aim, at }).outcome,
    ).toMatchObject({ result: { accepted: false, reasonCode: 'NO_BOLT' } });
    const lie = boltTargetAt(bolt.id, 100);
    expect(boltHits(T, bolt, lie.x, lie.y, bolt.startedAt + 100, bolt.startedAt + 6_000)).toBe(
      boltHits(T, bolt, lie.x, lie.y, bolt.startedAt + 6_000, bolt.startedAt + 6_000),
    );
  });

  it('throws an unthrown bolt for the payer when time runs out; bots throw their own', () => {
    let s = pay(battle(2)).state;
    let r = advanceTo(s, s.t + T.paid.boltWindowMs + 100);
    expect(r.events.find((e) => e.type === 'bolt_thrown')).toMatchObject({
      hit: false,
      auto: true,
    });
    s = pay(battle(2), 'demo-1', null).state;
    r = advanceTo(s, s.t + 1_600);
    expect(r.events.find((e) => e.type === 'bolt_thrown')).toMatchObject({ auto: true });
  });

  it('is refused once the battle is over (the server records it unapplied)', () => {
    const s = createMatch({ matchId: 'm', seed: 1, config: T, autoStart: false });
    expect(pay(s, 'pi_x', null).outcome).toEqual({ kind: 'control', ok: false });
  });

  it('a bolt is a visible share of the boss in any crowd', () => {
    for (const n of [1, 10, 60]) {
      const s = battle(n);
      expect(boltDamage(s) / s.enemies[0]!.maxHp).toBeGreaterThanOrEqual(0.024);
    }
  });
});

describe('strikes and claws', () => {
  it('announces a squad strike ahead and blocks it with enough shield', () => {
    let s = battle(1);
    const t0 = s.t;
    s = advanceTo(s, t0 + T.strikes.firstAtMs + 50).state;
    const th = s.threats.find((x) => x.target.type === 'SQUAD')!;
    expect(th.impactAt - th.warnAt).toBe(T.strikes.warnMs);
    s.shield = 100;
    const r = advanceTo(s, th.impactAt + 50);
    expect(r.events.some((e) => e.type === 'strike_blocked')).toBe(true);
    expect(Object.values(r.state.squads).every((c) => !c.lost)).toBe(true);
  });

  it('attacks the squads of the area the mothership is flying through (Mars → Moon → Earth)', () => {
    let s = battle(
      1,
      cfg((c) => (c.mech.hitFirstAtMs = 999_999)),
    );
    const t0 = s.t;
    const zoneOf = (id: string) => SQUADS[id as keyof typeof SQUADS].zone;
    const seen: Array<[string, string]> = [];
    for (let t = t0; t < t0 + T.timings.battleMs - 1_000; t += 500) {
      s.shield = 100; // keep every squad alive so each area's choice is visible
      s = advanceTo(s, t).state;
      const th = s.threats.find((x) => x.target.type === 'SQUAD');
      if (th && th.target.type === 'SQUAD' && !seen.some(([id]) => id === th.id)) {
        const zone = zoneAt(routeProgress(s, T.timings.battleMs, th.warnAt));
        seen.push([th.id, `${zone}:${zoneOf(th.target.squadId)}`]);
      }
    }
    expect(seen.length).toBeGreaterThanOrEqual(6);
    for (const [, pair] of seen) {
      const [zone, target] = pair.split(':');
      expect(target).toBe(zone);
    }
    expect(new Set(seen.map(([, p]) => p.split(':')[0]))).toEqual(
      new Set(['MARS', 'MOON', 'EARTH']),
    );
  });

  it('loses the squad without shield, and the match after enough squads', () => {
    let s = battle(
      1,
      cfg((c) => {
        c.strikes.everyMs = c.strikes.warnMs + 100;
        c.mech.hitFirstAtMs = 999_999;
      }),
    );
    s = advanceTo(s, s.t + 200_000).state;
    expect(s.result).toMatchObject({ outcome: 'DEFEAT', reason: 'SQUADS_LOST' });
    expect(Object.values(s.squads).filter((c) => c.lost)).toHaveLength(T.strikes.lostForDefeat);
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
      return JSON.stringify({ e: s.enemies, th: s.threats, c: s.squads, m: s.mechHp });
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
