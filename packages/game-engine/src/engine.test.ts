import { describe, expect, it } from 'vitest';
import type { ActionType, GameConfig, MatchState, RegionId, TeamId } from '@sats-wars/shared';
import { DEFAULT_GAME_CONFIG, makeGameConfig } from '@sats-wars/shared';
import { type EngineCommand, createMatchState, reduce, replay } from './engine';
import { computeDamage, decideResult } from './rules';

/** Small harness that keeps state + command log, like the server does. */
class Harness {
  state: MatchState;
  log: EngineCommand[] = [];
  n = 0;
  constructor(public config: GameConfig = DEFAULT_GAME_CONFIG) {
    this.state = createMatchState('m1', config, 42);
  }
  run(cmd: EngineCommand) {
    this.log.push(cmd);
    const r = reduce(this.state, cmd);
    this.state = r.state;
    return r;
  }
  /** Open lobby at t=0 and start LIVE immediately (gameMs 0 == clock 0). */
  live() {
    this.run({ type: 'OPEN_LOBBY', t: 0 });
    this.run({ type: 'START_LIVE', t: 0 });
    return this;
  }
  join(id: string, teamId: TeamId, ap = 3) {
    return this.run({
      type: 'ADD_PARTICIPANT',
      t: this.state.clockMs,
      participantId: id,
      teamId,
      nickname: id,
      isBot: false,
      ap,
    });
  }
  /** Act at game time `gameMs` (LIVE started at clock 0). */
  act(id: string, actionType: ActionType, regionId: RegionId | null, gameMs?: number, cid?: string) {
    const t = gameMs ?? this.state.clockMs;
    const r = this.run({
      type: 'ACTION',
      t,
      participantId: id,
      clientActionId: cid ?? `c${++this.n}`,
      actionType,
      regionId,
    });
    if (r.outcome.kind !== 'action') throw new Error('expected action outcome');
    return r.outcome.result;
  }
  tick(t: number) {
    return this.run({ type: 'TICK', t });
  }
  region(id: RegionId) {
    return this.state.regions[id];
  }
}

function teamsWithPlayers(cfg?: GameConfig) {
  const h = new Harness(cfg).live();
  h.join('r1', 'RAIJIN', 20);
  h.join('r2', 'RAIJIN', 20);
  h.join('f1', 'FUJIN', 20);
  h.join('f2', 'FUJIN', 20);
  return h;
}

describe('lifecycle', () => {
  it('goes CREATED -> LOBBY -> LIVE automatically after lobbyMs', () => {
    const h = new Harness();
    h.run({ type: 'OPEN_LOBBY', t: 0 });
    expect(h.state.status).toBe('LOBBY');
    expect(h.state.gameMs).toBe(-30_000);
    h.tick(29_999);
    expect(h.state.status).toBe('LOBBY');
    h.tick(30_500);
    expect(h.state.status).toBe('LIVE');
    expect(h.state.liveStartClock).toBe(30_000);
    expect(h.state.gameMs).toBe(500);
  });

  it('waits for admin start when autoStartAfterLobby is false', () => {
    const h = new Harness(makeGameConfig({ autoStartAfterLobby: false }));
    h.run({ type: 'OPEN_LOBBY', t: 0 });
    h.tick(100_000);
    expect(h.state.status).toBe('LOBBY');
    h.run({ type: 'START_LIVE', t: 100_000 });
    expect(h.state.status).toBe('LIVE');
    expect(h.state.liveStartClock).toBe(100_000);
  });

  it('runs all 6 clashes then FINALIZING at 270s and FINISHED at 300s', () => {
    const h = new Harness().live();
    h.tick(269_999);
    expect(h.state.clashes).toHaveLength(5);
    expect(h.state.status).toBe('LIVE');
    h.tick(270_000);
    expect(h.state.clashes).toHaveLength(6);
    expect(h.state.status).toBe('FINALIZING');
    expect(h.state.result?.reason).toBe('DRAW'); // symmetric with no actions
    h.tick(299_999);
    expect(h.state.status).toBe('FINALIZING');
    h.tick(300_000);
    expect(h.state.status).toBe('FINISHED');
  });

  it('clash timing does not depend on tick granularity', () => {
    const a = new Harness().live();
    a.tick(300_000);
    const b = new Harness().live();
    for (let t = 0; t <= 300_000; t += 777) b.tick(t);
    b.tick(300_000);
    expect(b.state.clashes).toEqual(a.state.clashes);
    expect(b.state.seq).toBe(a.state.seq);
  });

  it('PAUSE freezes the clock and RESUME continues from the same point', () => {
    const h = new Harness().live();
    h.tick(40_000);
    h.run({ type: 'PAUSE', t: 40_000, reason: 'ADMIN' });
    expect(h.state.status).toBe('PAUSED');
    // Even if a later t arrives while paused, the game does not advance.
    h.tick(90_000);
    expect(h.state.gameMs).toBe(40_000);
    expect(h.state.clashes).toHaveLength(0);
    h.run({ type: 'RESUME', t: 40_000 });
    expect(h.state.status).toBe('LIVE');
    h.tick(45_000);
    expect(h.state.clashes).toHaveLength(1);
  });

  it('CANCEL ends the match with no winner', () => {
    const h = new Harness().live();
    h.run({ type: 'CANCEL', t: 1000, reason: 'ADMIN' });
    expect(h.state.status).toBe('CANCELLED');
    expect(h.state.result?.reason).toBe('CANCELLED');
    expect(h.state.result?.winnerTeamId).toBeNull();
  });

  it('rejects invalid lifecycle transitions without events', () => {
    const h = new Harness();
    const r = h.run({ type: 'RESUME', t: 0 });
    expect(r.outcome.kind).toBe('rejected');
    expect(r.events).toHaveLength(0);
  });
});

describe('ATTACK / DEFEND / CHARGE rules', () => {
  it('captures a neutral region in one attack', () => {
    const h = teamsWithPlayers();
    const r = h.act('r1', 'ATTACK', 'kanto', 1000);
    expect(r).toMatchObject({ ok: true, code: 'CAPTURED', apBefore: 20, apAfter: 19 });
    expect(h.region('kanto').ownerTeamId).toBe('RAIJIN');
  });

  it('breaks an enemy shield without progressing capture', () => {
    const h = teamsWithPlayers();
    h.act('r1', 'ATTACK', 'kanto', 1000);
    h.act('r1', 'DEFEND', 'kanto', 2000);
    expect(h.region('kanto').shieldCharges).toBe(1);
    const r = h.act('f1', 'ATTACK', 'kanto', 3000);
    expect(r.code).toBe('SHIELD_BROKEN');
    expect(h.region('kanto')).toMatchObject({
      ownerTeamId: 'RAIJIN',
      shieldCharges: 0,
      contestedByTeamId: null,
    });
  });

  it('starts a 25s contest on an unshielded enemy region; second attack captures', () => {
    const h = teamsWithPlayers();
    h.act('r1', 'ATTACK', 'kanto', 1000);
    expect(h.act('f1', 'ATTACK', 'kanto', 2000).code).toBe('CONTEST_STARTED');
    expect(h.region('kanto')).toMatchObject({ contestedByTeamId: 'FUJIN', contestedUntil: 27_000 });
    expect(h.act('f2', 'ATTACK', 'kanto', 26_999).code).toBe('CAPTURED');
    expect(h.region('kanto')).toMatchObject({ ownerTeamId: 'FUJIN', contestedByTeamId: null });
  });

  it('contest expires after 25s and the owner keeps the region', () => {
    const h = teamsWithPlayers();
    h.act('r1', 'ATTACK', 'kanto', 1000);
    h.act('f1', 'ATTACK', 'kanto', 2000);
    const tick = h.tick(27_000);
    expect(tick.events.map((e) => e.type)).toContain('CONTEST_EXPIRED');
    expect(h.region('kanto')).toMatchObject({ ownerTeamId: 'RAIJIN', contestedByTeamId: null });
    // After expiry a new attack only restarts the contest.
    expect(h.act('f2', 'ATTACK', 'kanto', 27_001).code).toBe('CONTEST_STARTED');
  });

  it('an action exactly at contestedUntil sees the expiry first', () => {
    const h = teamsWithPlayers();
    h.act('r1', 'ATTACK', 'kanto', 1000);
    h.act('f1', 'ATTACK', 'kanto', 2000);
    expect(h.act('f2', 'ATTACK', 'kanto', 27_000).code).toBe('CONTEST_STARTED');
  });

  it('DEFEND on a contested own region breaks the contest without adding a shield', () => {
    const h = teamsWithPlayers();
    h.act('r1', 'ATTACK', 'kanto', 1000);
    h.act('f1', 'ATTACK', 'kanto', 2000);
    expect(h.act('r2', 'DEFEND', 'kanto', 3000).code).toBe('CONTEST_BROKEN');
    expect(h.region('kanto')).toMatchObject({ contestedByTeamId: null, shieldCharges: 0 });
  });

  it('ATTACK on own contested region breaks the contest; on own calm region is invalid', () => {
    const h = teamsWithPlayers();
    h.act('r1', 'ATTACK', 'kanto', 1000);
    const invalid = h.act('r2', 'ATTACK', 'kanto', 1500);
    expect(invalid).toMatchObject({ ok: false, code: 'OWN_REGION_NOT_CONTESTED', apAfter: 20 });
    h.act('f1', 'ATTACK', 'kanto', 2000);
    expect(h.act('r2', 'ATTACK', 'kanto', 3000).code).toBe('CONTEST_BROKEN');
  });

  it('DEFEND is invalid on neutral / enemy regions and when a shield is active', () => {
    const h = teamsWithPlayers();
    expect(h.act('r1', 'DEFEND', 'kanto', 1000).code).toBe('NOT_OWN_REGION');
    h.act('f1', 'ATTACK', 'kanto', 1000);
    expect(h.act('r1', 'DEFEND', 'kanto', 1100).code).toBe('NOT_OWN_REGION');
    h.act('f1', 'DEFEND', 'kanto', 1200);
    const again = h.act('f2', 'DEFEND', 'kanto', 1300);
    expect(again).toMatchObject({ ok: false, code: 'SHIELD_ALREADY_ACTIVE', apAfter: 20 });
  });

  it('shield expires after 30s', () => {
    const h = teamsWithPlayers();
    h.act('r1', 'ATTACK', 'kanto', 1000);
    h.act('r1', 'DEFEND', 'kanto', 2000);
    h.tick(31_999);
    expect(h.region('kanto').shieldCharges).toBe(1);
    h.tick(32_000);
    expect(h.region('kanto').shieldCharges).toBe(0);
  });

  it('CHARGE adds 10 energy up to 60 and rejects when full without spending AP', () => {
    const h = teamsWithPlayers();
    for (let i = 0; i < 6; i++) expect(h.act('r1', 'CHARGE', null, 1000 + i).code).toBe('CHARGED');
    expect(h.state.teams.RAIJIN.energy).toBe(60);
    const r = h.act('r1', 'CHARGE', null, 2000);
    expect(r).toMatchObject({ ok: false, code: 'ENERGY_FULL', apBefore: 14, apAfter: 14 });
  });

  it('rejects ATTACK/DEFEND without region and unknown region', () => {
    const h = teamsWithPlayers();
    expect(h.act('r1', 'ATTACK', null, 1000).code).toBe('REGION_REQUIRED');
    expect(h.act('r1', 'ATTACK', 'atlantis' as RegionId, 1000).code).toBe('INVALID_REGION');
    expect(h.state.participants.r1!.apRemaining).toBe(20);
  });
});

describe('AP accounting and validation', () => {
  it('spends exactly 1 AP per successful action and rejects the 4th action', () => {
    const h = new Harness().live();
    h.join('p', 'RAIJIN', 3);
    expect(h.act('p', 'ATTACK', 'kanto', 1000).ok).toBe(true);
    expect(h.act('p', 'CHARGE', null, 1001).ok).toBe(true);
    expect(h.act('p', 'DEFEND', 'kanto', 1002).ok).toBe(true);
    const fourth = h.act('p', 'CHARGE', null, 1003);
    expect(fourth).toMatchObject({ ok: false, code: 'NO_AP', apAfter: 0 });
    expect(h.state.teams.RAIJIN.apRemaining).toBe(0);
    expect(h.state.teams.RAIJIN.actionCount).toBe(3);
  });

  it('rejects actions before LIVE, while PAUSED, and after close', () => {
    const h = new Harness();
    h.run({ type: 'OPEN_LOBBY', t: 0 });
    h.join('p', 'RAIJIN');
    expect(h.act('p', 'CHARGE', null, 1000).code).toBe('MATCH_NOT_LIVE');
    h.run({ type: 'START_LIVE', t: 1000 });
    h.run({ type: 'PAUSE', t: 2000, reason: 'x' });
    expect(h.act('p', 'CHARGE', null, 2000).code).toBe('MATCH_PAUSED');
    h.run({ type: 'RESUME', t: 2000 });
    expect(h.act('p', 'CHARGE', null, 271_000 + 1000).code).toBe('ACTIONS_CLOSED');
    expect(h.state.participants.p!.apRemaining).toBe(3);
  });

  it('rejects unknown participants', () => {
    const h = new Harness().live();
    expect(h.act('ghost', 'CHARGE', null, 10).code).toBe('UNKNOWN_PARTICIPANT');
  });

  it('is idempotent on clientActionId (no double spend)', () => {
    const h = teamsWithPlayers();
    const first = h.act('r1', 'ATTACK', 'kanto', 1000, 'same-id');
    const again = h.act('r1', 'ATTACK', 'kanto', 1200, 'same-id');
    expect(again).toMatchObject({ ...first, duplicate: true });
    expect(h.state.participants.r1!.apRemaining).toBe(19);
    // Same clientActionId from a different participant is a different action.
    expect(h.act('f1', 'ATTACK', 'kanto', 1300, 'same-id').code).toBe('CONTEST_STARTED');
  });

  it('serializes concurrent attacks on the same region deterministically', () => {
    const h = teamsWithPlayers();
    // Both teams hit neutral kanto in the same ms: whoever is processed first captures,
    // the second starts a contest. Order is the server receive order.
    expect(h.act('f1', 'ATTACK', 'kanto', 5000).code).toBe('CAPTURED');
    expect(h.act('r1', 'ATTACK', 'kanto', 5000).code).toBe('CONTEST_STARTED');
    expect(h.act('r2', 'ATTACK', 'kanto', 5000).code).toBe('CAPTURED');
    expect(h.region('kanto').ownerTeamId).toBe('RAIJIN');
  });

  it('participants are added idempotently and can join while paused', () => {
    const h = new Harness().live();
    h.run({ type: 'PAUSE', t: 0, reason: 'x' });
    h.join('p', 'FUJIN');
    h.join('p', 'FUJIN');
    expect(h.state.teams.FUJIN.participantCount).toBe(1);
    expect(h.state.teams.FUJIN.apRemaining).toBe(3);
  });

  it('cannot add participants after the match ends', () => {
    const h = new Harness().live();
    h.tick(300_000);
    const r = h.join('late', 'RAIJIN');
    expect(r.outcome.kind).toBe('rejected');
  });
});

describe('clash resolution', () => {
  it('computes symmetric damage from the same snapshot', () => {
    const cfg = DEFAULT_GAME_CONFIG;
    const a = {
      teamId: 'RAIJIN' as const,
      hpBefore: 100,
      energyBefore: 20,
      activeAttackRegions: 2,
      activeDefenseRegions: 1,
      activeEnergyRegions: 0,
    };
    const b = { ...a, teamId: 'FUJIN' as const };
    expect(computeDamage(a, b, cfg)).toEqual(computeDamage(b, a, cfg));
    // 10 + 3*2 + 4 (energy 20 -> +4) - 2*1 = 18
    expect(computeDamage(a, b, cfg).damage).toBe(18);
  });

  it('clamps damage to [2, 28]', () => {
    const cfg = DEFAULT_GAME_CONFIG;
    const base = {
      teamId: 'RAIJIN' as const,
      hpBefore: 100,
      energyBefore: 0,
      activeAttackRegions: 0,
      activeDefenseRegions: 0,
      activeEnergyRegions: 0,
    };
    const tank = { ...base, teamId: 'FUJIN' as const, activeDefenseRegions: 8 };
    expect(computeDamage(base, tank, cfg).damage).toBe(2);
    const glass = { ...base, energyBefore: 60, activeAttackRegions: 8 };
    expect(computeDamage(glass, base, cfg).damage).toBe(28);
  });

  it('energy bonus is +2 per 10 below 30, capped at +4, not consumed', () => {
    const h = teamsWithPlayers();
    h.act('r1', 'CHARGE', null, 1000);
    h.act('r1', 'CHARGE', null, 1001);
    h.tick(45_000);
    const c = h.state.clashes[0]!;
    expect(c.outcome.RAIJIN).toMatchObject({ damageDealt: 14, special: false, energyBonus: 4 });
    expect(c.outcome.FUJIN.damageDealt).toBe(10);
    expect(h.state.teams.RAIJIN.energy).toBe(20);
    expect(h.state.teams.FUJIN.hp).toBe(86);
    expect(h.state.teams.RAIJIN.hp).toBe(90);
  });

  it('triggers the special at >=30 energy: +10 damage, -30 energy', () => {
    const h = teamsWithPlayers();
    for (let i = 0; i < 4; i++) h.act('f1', 'CHARGE', null, 1000 + i);
    h.tick(45_000);
    const c = h.state.clashes[0]!;
    expect(c.outcome.FUJIN).toMatchObject({ special: true, damageDealt: 20, energyAfter: 10 });
    expect(h.state.teams.RAIJIN.hp).toBe(80);
  });

  it('applies region bonuses and suspends them while contested', () => {
    const h = teamsWithPlayers();
    h.act('r1', 'ATTACK', 'tohoku', 1000); // ATTACK region
    h.act('r1', 'ATTACK', 'kinki', 1000); // ATTACK region
    h.act('f1', 'ATTACK', 'hokkaido', 1000); // DEFENSE region
    h.act('r2', 'ATTACK', 'kanto', 1000); // ENERGY region
    // Contest kinki just before the clash: its bonus must not count.
    h.act('f2', 'ATTACK', 'kinki', 44_000);
    h.tick(45_000);
    const c = h.state.clashes[0]!;
    expect(c.snapshot.RAIJIN).toMatchObject({
      activeAttackRegions: 1,
      activeEnergyRegions: 1,
    });
    expect(c.snapshot.FUJIN.activeDefenseRegions).toBe(1);
    // RAIJIN: 10 + 3*1 - 2*1 = 11. FUJIN: 10.
    expect(c.outcome.RAIJIN.damageDealt).toBe(11);
    expect(c.outcome.FUJIN.damageDealt).toBe(10);
    // Energy region grants +5 after the clash.
    expect(h.state.teams.RAIJIN.energy).toBe(5);
    // After the contest expires the bonus resumes.
    h.tick(70_000);
    expect(h.region('kinki').contestedByTeamId).toBeNull();
    h.tick(90_000);
    expect(h.state.clashes[1]!.snapshot.RAIJIN.activeAttackRegions).toBe(2);
  });

  it('applies damage simultaneously; KO ends the match early with FINALIZING', () => {
    const cfg = makeGameConfig({ hpMax: 20 });
    const h = teamsWithPlayers(cfg);
    h.act('r1', 'ATTACK', 'tohoku', 1000);
    h.tick(45_000); // RAIJIN deals 13, FUJIN deals 10 -> 7 / 10
    expect(h.state.status).toBe('LIVE');
    h.tick(90_000); // RAIJIN deals 13 -> FUJIN 0; FUJIN deals 10 -> RAIJIN 0
    expect(h.state.teams.FUJIN.hp).toBe(0);
    expect(h.state.teams.RAIJIN.hp).toBe(0);
    expect(h.state.status).toBe('FINALIZING');
    // Double KO -> decided by owned regions (RAIJIN owns 1).
    expect(h.state.result).toMatchObject({ winnerTeamId: 'RAIJIN', reason: 'DOUBLE_KO' });
    h.tick(119_999);
    expect(h.state.status).toBe('FINALIZING');
    h.tick(120_000);
    expect(h.state.status).toBe('FINISHED');
    // No further clashes after KO.
    expect(h.state.clashes).toHaveLength(2);
  });

  it('single KO wins regardless of regions', () => {
    const cfg = makeGameConfig({ hpMax: 12 });
    const h = teamsWithPlayers(cfg);
    h.act('r1', 'ATTACK', 'tohoku', 1000); // RAIJIN deals 13, FUJIN 10
    h.act('f1', 'ATTACK', 'kanto', 1000); // ENERGY: no damage effect
    h.act('f1', 'ATTACK', 'chugoku', 1000); // ENERGY: no damage effect
    h.tick(45_000);
    expect(h.state.teams.RAIJIN.hp).toBe(2);
    expect(h.state.result).toMatchObject({ winnerTeamId: 'RAIJIN', reason: 'KO' });
  });

  it('time up: HP decides, then regions, else draw', () => {
    const h = new Harness().live();
    h.tick(270_000);
    expect(h.state.result?.reason).toBe('DRAW');

    const h2 = teamsWithPlayers();
    h2.act('f1', 'ATTACK', 'hokkaido', 1000); // DEFENSE region: reduces damage FUJIN takes
    h2.tick(270_000);
    expect(h2.state.result).toMatchObject({ winnerTeamId: 'FUJIN', reason: 'TIME_HP' });

    // Same HP, more regions: give each side a region of a kind that does not change damage
    const cfg = makeGameConfig({ attackRegionBonus: 0, defenseRegionReduction: 0, energyRegionGain: 0 });
    const h3 = teamsWithPlayers(cfg);
    h3.act('r1', 'ATTACK', 'kanto', 1000);
    h3.act('r1', 'ATTACK', 'chubu', 1000);
    h3.act('f1', 'ATTACK', 'kinki', 1000);
    h3.tick(270_000);
    expect(h3.state.result).toMatchObject({ winnerTeamId: 'RAIJIN', reason: 'TIME_REGIONS' });
  });

  it('actions at exactly a clash time apply after the clash', () => {
    const h = teamsWithPlayers();
    h.act('r1', 'CHARGE', null, 45_000);
    expect(h.state.clashes[0]!.snapshot.RAIJIN.energyBefore).toBe(0);
    expect(h.state.teams.RAIJIN.energy).toBe(10);
  });

  it('MVP is the top contributor per team', () => {
    const h = teamsWithPlayers();
    h.act('r1', 'ATTACK', 'kanto', 1000);
    h.act('r2', 'CHARGE', null, 1000);
    h.tick(270_000);
    expect(h.state.result?.mvp.RAIJIN?.participantId).toBe('r1');
    expect(h.state.result?.mvp.FUJIN).toBeNull();
  });
});

describe('determinism and replay', () => {
  it('replaying the command log reproduces state and events', () => {
    const h = teamsWithPlayers();
    h.act('r1', 'ATTACK', 'kanto', 1000);
    h.act('f1', 'ATTACK', 'kanto', 2000);
    h.act('f2', 'CHARGE', null, 3000);
    h.tick(50_000);
    h.act('r2', 'DEFEND', 'kanto', 51_000);
    h.tick(300_000);
    const commandsWithoutTicks: EngineCommand[] = h.log.filter((c) => c.type !== 'TICK');
    commandsWithoutTicks.push({ type: 'TICK', t: 300_000 });
    const { state } = replay('m1', h.config, 42, commandsWithoutTicks);
    expect(state).toEqual(h.state);
  });

  it('never mutates the input state', () => {
    const h = teamsWithPlayers();
    const before = structuredClone(h.state);
    reduce(h.state, {
      type: 'ACTION',
      t: 1000,
      participantId: 'r1',
      clientActionId: 'x1',
      actionType: 'ATTACK',
      regionId: 'kanto',
    });
    expect(h.state).toEqual(before);
  });

  it('event seq numbers are contiguous', () => {
    const h = teamsWithPlayers();
    const seqs: number[] = [];
    for (let t = 0; t <= 300_000; t += 5000) {
      const r = h.tick(t);
      seqs.push(...r.events.map((e) => e.seq));
    }
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1]! + 1);
  });

  it('decideResult is deterministic for a given state', () => {
    const h = teamsWithPlayers();
    h.tick(100_000);
    expect(decideResult(h.state, false)).toEqual(decideResult(h.state, false));
  });
});

describe('fairness: names/colors do not matter', () => {
  it('mirrored actions produce mirrored results', () => {
    const play = (a: TeamId, b: TeamId) => {
      const h = new Harness().live();
      h.join('x', a, 10);
      h.join('y', b, 10);
      h.act('x', 'ATTACK', 'tohoku', 1000);
      h.act('x', 'CHARGE', null, 1001);
      h.act('y', 'ATTACK', 'hokkaido', 1002);
      h.tick(300_000);
      return h.state;
    };
    const s1 = play('RAIJIN', 'FUJIN');
    const s2 = play('FUJIN', 'RAIJIN');
    expect(s1.teams.RAIJIN.hp).toBe(s2.teams.FUJIN.hp);
    expect(s1.teams.FUJIN.hp).toBe(s2.teams.RAIJIN.hp);
    expect(s1.result!.winnerTeamId).toBe('RAIJIN');
    expect(s2.result!.winnerTeamId).toBe('FUJIN');
  });
});
