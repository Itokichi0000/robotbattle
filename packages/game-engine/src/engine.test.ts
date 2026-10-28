import { describe, expect, it } from 'vitest';
import type { GameConfig, MatchState, TeamId } from '@sats-wars/shared';
import { DEFAULT_GAME_CONFIG, REGION_IDS, makeGameConfig } from '@sats-wars/shared';
import { type EngineCommand, createMatchState, reduce, replay } from './engine';
import { averageZapDamage, carryOverHp, nextRoundHp, punchesToKo, punchesToSpecial, zapOutcome } from './rules';

const C = DEFAULT_GAME_CONFIG;
const OPEN = C.openingMs; // round 1 starts here
const ROUND_END = (startedAt: number) => startedAt + C.roundMaxMs;

class Harness {
  state: MatchState;
  log: EngineCommand[] = [];
  constructor(public config: GameConfig = C) {
    this.state = createMatchState('m1', config, 42);
  }
  run(cmd: EngineCommand) {
    this.log.push(cmd);
    const r = reduce(this.state, cmd);
    this.state = r.state;
    return r;
  }
  start() {
    this.run({ type: 'START', t: 0 });
    return this;
  }
  tick(t: number) {
    return this.run({ type: 'TICK', t });
  }
  zap(teamId: TeamId, t: number, who = teamId === 'RAIJIN' ? 'r1' : 'f1') {
    const r = this.run({ type: 'ZAP', t, participantId: who, nickname: who, teamId });
    if (r.outcome.kind !== 'zap') throw new Error('expected zap');
    return r.outcome.result;
  }
  /** Advance until the next round has started; returns its start time. */
  nextRound(): number {
    const idx = this.state.round ? this.state.round.index + 1 : 0;
    if (this.state.phase === 'ROUND' && this.state.round) this.tick(this.state.round.endsAt);
    this.tick(this.state.phaseEndsAt!);
    if (this.state.round?.index !== idx) throw new Error('round did not start');
    return this.state.round.startedAt;
  }
  /** n punches spread 10ms apart starting at t. */
  zaps(teamId: TeamId, n: number, t: number) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(this.zap(teamId, t + i * 10));
    return out;
  }
}

describe('season lifecycle', () => {
  it('opens, runs rounds and ends the season', () => {
    const h = new Harness().start();
    expect(h.state).toMatchObject({ status: 'LIVE', phase: 'OPENING', phaseEndsAt: OPEN });
    h.tick(OPEN - 1);
    expect(h.state.round).toBeNull();
    h.tick(OPEN);
    expect(h.state).toMatchObject({ phase: 'ROUND', roundIndex: 0 });
    expect(h.state.round).toMatchObject({ hpMax: C.hpInitial, hp: { RAIJIN: 200, FUJIN: 200 } });
    // Nobody punches: time-up draw, region stays unpainted.
    h.tick(ROUND_END(OPEN));
    expect(h.state.phase).toBe('ROUND_END');
    expect(h.state.rounds[0]).toMatchObject({ endReason: 'DRAW', winnerTeamId: null });
    expect(Object.values(h.state.regions).every((r) => r.ownerTeamId === null)).toBe(true);
    h.tick(ROUND_END(OPEN) + C.roundEndMs);
    expect(h.state).toMatchObject({ phase: 'ROUND', roundIndex: 1 });
    // Fast-forward the rest of the season.
    h.tick(10_000_000);
    expect(h.state.status).toBe('FINISHED');
    expect(h.state.rounds).toHaveLength(8);
    expect(h.state.result).toMatchObject({ winnerTeamId: null, reason: 'DRAW' });
  });

  it('plays every region once in a seeded random order', () => {
    const a = createMatchState('a', C, 7).roundOrder;
    expect([...a].sort()).toEqual([...REGION_IDS].sort());
    expect(createMatchState('b', C, 7).roundOrder).toEqual(a);
    expect(createMatchState('c', C, 8).roundOrder).not.toEqual(a);
  });

  it('rejects punches before start, between rounds and while paused (no effect)', () => {
    const h = new Harness();
    expect(h.zap('RAIJIN', 0).code).toBe('NOT_LIVE');
    h.start();
    expect(h.zap('RAIJIN', 100).code).toBe('ROUND_NOT_ACTIVE');
    h.tick(OPEN);
    h.run({ type: 'PAUSE', t: OPEN + 100, reason: 'x' });
    const p = h.zap('RAIJIN', OPEN + 200);
    expect(p).toMatchObject({ ok: false, code: 'PAUSED' });
    expect(h.state.round!.hp.FUJIN).toBe(200);
  });

  it('PAUSE freezes the round timer and RESUME continues', () => {
    const h = new Harness().start();
    h.tick(OPEN + 10_000);
    h.run({ type: 'PAUSE', t: OPEN + 10_000, reason: 'ADMIN' });
    h.tick(OPEN + 500_000);
    expect(h.state.gameMs).toBe(OPEN + 10_000);
    expect(h.state.phase).toBe('ROUND');
    h.run({ type: 'RESUME', t: OPEN + 10_000 });
    h.tick(ROUND_END(OPEN));
    expect(h.state.phase).toBe('ROUND_END');
  });

  it('CANCEL ends the season without a winner', () => {
    const h = new Harness().start();
    h.run({ type: 'CANCEL', t: 1000, reason: 'ADMIN' });
    expect(h.state.status).toBe('CANCELLED');
    expect(h.state.result).toMatchObject({ winnerTeamId: null, reason: 'CANCELLED' });
    expect(h.zap('RAIJIN', 2000).code).toBe('NOT_LIVE');
  });
});

describe('punches', () => {
  it('each punch deals 10; every 10th of a team is a 60-damage special', () => {
    const h = new Harness().start();
    h.tick(OPEN);
    const r = h.zaps('RAIJIN', 10, OPEN + 100);
    expect(r.slice(0, 9).every((z) => z.code === 'HIT' && z.damage === 10)).toBe(true);
    expect(r[9]).toMatchObject({ code: 'SPECIAL', damage: 60, special: true });
    expect(h.state.round!.hp.FUJIN).toBe(200 - 90 - 60);
    expect(h.state.round!.gauge.RAIJIN).toBe(0);
    expect(h.state.teams.RAIJIN).toMatchObject({ zapsTotal: 10, specialsTotal: 1 });
    // The other team's gauge is independent; FUJIN is now at 25% HP, so its punch is boosted.
    expect(h.zap('FUJIN', OPEN + 1000)).toMatchObject({ damage: 15, pinch: true, special: false });
  });

  it('a robot in a pinch (≤30% HP) hits 1.5× harder', () => {
    const h = new Harness().start();
    h.tick(OPEN);
    h.zaps('FUJIN', 9, OPEN + 100); // RAIJIN 200 -> 110
    h.zap('FUJIN', OPEN + 200); // special: 110 -> 50 (25%)
    expect(h.state.round!.hp.RAIJIN).toBe(50);
    expect(h.zap('RAIJIN', OPEN + 300)).toMatchObject({ damage: 15, pinch: true });
    expect(h.zap('FUJIN', OPEN + 400)).toMatchObject({ damage: 10, pinch: false });
  });

  it('KO ends the round, paints the region and records the finisher', () => {
    const h = new Harness().start();
    h.tick(OPEN);
    const region = h.state.round!.regionId;
    const all = h.zaps('RAIJIN', 20, OPEN + 100); // 9×10+60 = 150, then 50 more needed
    const ko = all.find((z) => z.code === 'KO')!;
    expect(ko).toBeDefined();
    expect(all.indexOf(ko)).toBe(14); // 150 + 5×10 = 200 on the 15th punch
    expect(h.state.phase).toBe('ROUND_END');
    expect(h.state.regions[region]).toMatchObject({ ownerTeamId: 'RAIJIN', roundIndex: 0 });
    expect(h.state.rounds[0]).toMatchObject({ endReason: 'KO', winnerTeamId: 'RAIJIN', finisher: { participantId: 'r1' } });
    expect(h.state.teams.RAIJIN).toMatchObject({ regionsWon: 1, kos: 1 });
    // Punches after the KO are rejected and cost nothing.
    expect(all.slice(15).every((z) => z.code === 'ROUND_NOT_ACTIVE')).toBe(true);
  });

  it('time-up: more HP wins; equal HP is a draw', () => {
    const h = new Harness().start();
    h.tick(OPEN);
    h.zap('FUJIN', OPEN + 100);
    h.tick(ROUND_END(OPEN));
    expect(h.state.rounds[0]).toMatchObject({ endReason: 'TIME', winnerTeamId: 'FUJIN' });
    expect(h.state.teams.FUJIN.kos).toBe(0);
  });

  it('a punch exactly at the time limit arrives too late', () => {
    const h = new Harness().start();
    h.tick(OPEN);
    expect(h.zap('RAIJIN', ROUND_END(OPEN)).code).toBe('ROUND_NOT_ACTIVE');
  });
});

describe('adaptive HP', () => {
  const prev = (hpMax: number, zR: number, zF: number, durationMs: number) => ({
    index: 0,
    regionId: 'kanto' as const,
    hpMax,
    winnerTeamId: null,
    endReason: 'TIME' as const,
    durationMs,
    zaps: { RAIJIN: zR, FUJIN: zF },
    finisher: null,
  });

  it('starts at hpInitial and shrinks when nobody plays', () => {
    expect(nextRoundHp(C, undefined)).toBe(200);
    // Shrinks by at most hpMaxChangeFactor (×3) per round, floored at hpMin.
    expect(nextRoundHp(C, prev(900, 0, 0, 60_000))).toBe(300);
    expect(nextRoundHp(C, prev(200, 0, 0, 60_000))).toBe(C.hpMin);
  });

  it('grows for a busy crowd, at most ×3 per round and never above the cap', () => {
    // 40 punches/s for 5 s: target would be huge; limited to 3× of 200.
    expect(nextRoundHp(C, prev(200, 200, 30, 5_000))).toBe(600);
    expect(nextRoundHp(C, prev(60_000, 20_000, 0, 10_000))).toBe(C.hpCap);
  });

  it('the next season starts from half the adapted HP, never below hpInitial', () => {
    expect(carryOverHp(C, undefined)).toBe(C.hpInitial);
    // 50 punches/s → target 26 250, limited to 3× 6 000 = 18 000 → halved.
    expect(carryOverHp(C, prev(6_000, 1_500, 900, 30_000))).toBe(9_000);
    expect(carryOverHp(C, prev(200, 3, 1, 60_000))).toBe(C.hpInitial);
  });

  it('targets about targetRoundSec of punching for the busier team', () => {
    // 1 punch/s → 35 s × 15 avg damage = 525 → limited to 2× 300 = 600 → 530 after rounding? No: 525 → 530.
    const hp = nextRoundHp(C, prev(300, 60, 10, 60_000));
    expect(hp).toBe(Math.round((1 * C.targetRoundSec * averageZapDamage(C)) / 10) * 10);
  });

  it('round 2 uses the adapted HP for both robots', () => {
    const h = new Harness().start();
    h.tick(OPEN);
    h.zaps('RAIJIN', 15, OPEN + 100); // KO at ~OPEN+240
    h.tick(OPEN + 1000 + C.roundEndMs);
    const r = h.state.round!;
    expect(r.index).toBe(1);
    expect(r.hp.RAIJIN).toBe(r.hp.FUJIN);
    expect(r.hpMax).toBe(C.hpInitial * C.hpMaxChangeFactor); // very fast KO → grows by the max factor
  });

  it('zapOutcome is symmetric and pure', () => {
    expect(zapOutcome(C, 200, 200, 1)).toEqual({ damage: 10, special: false, pinch: false });
    expect(zapOutcome(C, 60, 200, 10)).toEqual({ damage: 90, special: true, pinch: true });
  });
});

describe('season result', () => {
  it('the team with more regions conquers Japan', () => {
    const h = new Harness(makeGameConfig({ roundsPerSeason: 3 })).start();
    const t1 = h.nextRound();
    h.zaps('RAIJIN', 15, t1 + 100); // KO
    const t2 = h.nextRound();
    h.zaps('FUJIN', 40, t2 + 100); // HP doubled to 400; still enough for a KO
    expect(h.state.rounds[1]).toMatchObject({ winnerTeamId: 'FUJIN', endReason: 'KO' });
    const t3 = h.nextRound();
    h.zaps('RAIJIN', 60, t3 + 100);
    h.tick(10_000_000);
    expect(h.state.status).toBe('FINISHED');
    expect(h.state.result).toMatchObject({ winnerTeamId: 'RAIJIN', reason: 'REGIONS', regionCounts: { RAIJIN: 2, FUJIN: 1 } });
  });
});

describe('determinism and fairness', () => {
  it('replaying the command log reproduces the state', () => {
    const h = new Harness().start();
    h.tick(OPEN);
    h.zaps('RAIJIN', 7, OPEN + 100);
    h.zaps('FUJIN', 12, OPEN + 2000);
    h.tick(200_000);
    h.zap('FUJIN', 200_100);
    h.tick(1_000_000);
    const cmds: EngineCommand[] = h.log.filter((c) => c.type !== 'TICK');
    cmds.push({ type: 'TICK', t: 1_000_000 });
    expect(replay('m1', h.config, 42, cmds).state).toEqual(h.state);
  });

  it('tick granularity does not change outcomes', () => {
    const a = new Harness().start();
    a.tick(1_000_000);
    const b = new Harness().start();
    for (let t = 0; t <= 1_000_000; t += 333) b.tick(t);
    b.tick(1_000_000);
    expect(b.state.rounds).toEqual(a.state.rounds);
    expect(b.state.seq).toBe(a.state.seq);
  });

  it('never mutates the input state and keeps seq contiguous', () => {
    const h = new Harness().start();
    h.tick(OPEN);
    const before = structuredClone(h.state);
    reduce(h.state, { type: 'ZAP', t: OPEN + 5, participantId: 'x', nickname: 'x', teamId: 'RAIJIN' });
    expect(h.state).toEqual(before);
    const seqs = [...h.zaps('FUJIN', 30, OPEN + 10).map((z) => z.eventSeq).filter(Boolean)] as number[];
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!);
  });

  it('mirrored punches produce mirrored results (names/colors do not matter)', () => {
    const play = (a: TeamId, b: TeamId) => {
      const h = new Harness().start();
      h.tick(OPEN);
      h.zaps(a, 14, OPEN + 100);
      h.zaps(b, 9, OPEN + 1000);
      h.tick(1_000_000);
      return h.state;
    };
    const s1 = play('RAIJIN', 'FUJIN');
    const s2 = play('FUJIN', 'RAIJIN');
    expect(s1.rounds[0]!.winnerTeamId).toBe('RAIJIN');
    expect(s2.rounds[0]!.winnerTeamId).toBe('FUJIN');
    expect(s1.teams.RAIJIN.zapsTotal).toBe(s2.teams.FUJIN.zapsTotal);
  });

  it('punchesToKo counts specials and pinch exactly like the engine', () => {
    const c = DEFAULT_GAME_CONFIG;
    const round = { hpMax: 200, hp: { RAIJIN: 200, FUJIN: 200 }, gauge: { RAIJIN: 0, FUJIN: 0 } };
    // 9 × 10 + 60 + 5 × 10 = 200
    expect(punchesToKo(c, round, 'RAIJIN')).toBe(15);
    // A robot in a pinch (≤30%) hits 1.5×: 15 per punch, special 90.
    expect(punchesToKo(c, { ...round, hp: { RAIJIN: 50, FUJIN: 100 } }, 'RAIJIN')).toBe(7);
    expect(punchesToKo(c, { ...round, gauge: { RAIJIN: 9, FUJIN: 0 }, hp: { RAIJIN: 200, FUJIN: 60 } }, 'RAIJIN')).toBe(1);
    expect(punchesToSpecial(c, 7)).toBe(3);
  });
});
