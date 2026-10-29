import type { ArenaPreviewCue, RaidResult, RegionId, Telegraph } from '@sats-wars/shared';
import { REGION_IDS } from '@sats-wars/shared';
import type { ArenaDirector } from '@sats-wars/three-game';

/**
 * Rehearsal preview (/arena?preview=1): plays synthetic cues locally so
 * operators, the MC and artists can check camera/VFX without a running raid.
 * Never sends anything to the server and never changes game state.
 */
export const PREVIEW_HELP =
  'PREVIEW: 1 開幕 / 2 砲撃 / 3 シールド / 4 敵の予告 / 5 敵の攻撃 / 6 都市陥落 / 7 神雷風陣 / 8 成功 / 9 失敗 / B 雷神×NULL CORE 通し / 0 リセット';

interface PreviewState {
  n: number;
}

export function newPreviewState(): PreviewState {
  return { n: 0 };
}

const pick = (st: PreviewState): RegionId => REGION_IDS[st.n % REGION_IDS.length]!;

const fakeResult = (won: boolean): RaidResult => ({
  outcome: won ? ('SUCCEEDED' as const) : ('FAILED' as const),
  reason: won ? ('BOSS_DEFEATED' as const) : ('CITIES_LOST' as const),
  endedAtGameMs: 400_000,
  clearTimeMs: won ? 400_000 : null,
  survivingCities: won ? 6 : 3,
  cityHpTotal: 400,
  syncAverage: 60,
  syncPeak: 90,
  special: won ? ('ACTIVATED' as const) : ('FAILED' as const),
  score: {
    citySurvival: 300,
    speed: 40,
    coordination: 120,
    bossDefeat: won ? 200 : 0,
    total: won ? 660 : 420,
  },
  mvps: {},
  pilots: 9,
  bots: 0,
  assisted: false,
  configHash: 'preview',
  stats: {
    tasks: 0,
    successes: 0,
    enemiesDefeated: 0,
    cityDamageTaken: 0,
    shieldAbsorbed: 0,
    energyRouted: 0,
    repairs: 0,
    syncSum: 0,
    syncSamples: 0,
    syncPeak: 90,
    assistActions: 0,
    peakPilots: 9,
  },
});

export function handlePreviewKey(key: string, director: ArenaDirector, st: PreviewState): boolean {
  st.n++;
  const name = `PILOT-${String(10000 + st.n).slice(1)}`;
  const city = pick(st);
  switch (key) {
    case '1':
      director.play({ kind: 'raidStart' });
      return true;
    case '2':
      director.play({
        kind: 'task',
        role: 'GUNNER',
        robot: 'RAIJIN',
        success: 1,
        callsign: name,
        assist: false,
        effect: {
          kind: 'DAMAGE',
          enemyId: 1,
          enemyKind: 'SCOUT',
          weakpoint: 'CORE',
          amount: 36,
          defeated: false,
          note: null,
        },
      });
      return true;
    case '3':
      director.play({
        kind: 'task',
        role: 'GUARDIAN',
        robot: 'FUJIN',
        success: 1,
        callsign: name,
        assist: false,
        effect: { kind: 'SHIELD', cityId: city, amount: 45 },
      });
      return true;
    case '4':
      director.play({ kind: 'telegraph', enemyId: 1, enemyKind: 'SIEGE', targets: [city] });
      return true;
    case '5':
      director.play({
        kind: 'attack',
        enemyId: 1,
        enemyKind: 'SIEGE',
        robotHit: null,
        jam: false,
        hits: [{ cityId: city, damage: 36, absorbed: 10, hpAfter: 64, destroyed: false }],
      });
      return true;
    case '6':
      director.play({ kind: 'cityDestroyed', cityId: city });
      return true;
    case '7':
      director.play({ kind: 'specialOpen' });
      setTimeout(
        () =>
          director.play({
            kind: 'specialResolved',
            outcome: 'ACTIVATED',
            damage: 250,
            bossId: null,
            cityHits: [],
          }),
        1500,
      );
      return true;
    case '8':
    case '9':
      director.play({ kind: 'raidEnded', result: fakeResult(key === '8') });
      return true;
    case '0':
      director.reset();
      return true;
    default:
      return false;
  }
}

/** Operator rehearsal cue pushed from /admin (DEMO): same effects as the preview keys. */
export function playArenaCue(cue: ArenaPreviewCue, director: ArenaDirector): void {
  const special = (outcome: 'ACTIVATED' | 'FALLBACK' | 'FAILED') => {
    director.play({ kind: 'specialOpen' });
    setTimeout(
      () =>
        director.play({
          kind: 'specialResolved',
          outcome,
          damage: outcome === 'ACTIVATED' ? 250 : outcome === 'FALLBACK' ? 90 : 0,
          bossId: null,
          cityHits: [],
        }),
      1500,
    );
  };
  switch (cue) {
    case 'RAID_START':
      return director.play({ kind: 'raidStart' });
    case 'BOSS_ENTRANCE':
      return director.play({ kind: 'enemySpawned', enemyId: -1, enemyKind: 'BOSS' });
    case 'SPECIAL_ACTIVATED':
      return special('ACTIVATED');
    case 'SPECIAL_FALLBACK':
      return special('FALLBACK');
    case 'SPECIAL_FAILED':
      return special('FAILED');
    case 'VICTORY':
    case 'DEFEAT':
      return director.play({ kind: 'raidEnded', result: fakeResult(cue === 'VICTORY') });
  }
}

/**
 * The battle in one take (key B): NULL CORE locks on to two cities, Raijin's
 * cannon hits its eye and then its arm, NULL CORE answers — one city shielded,
 * one hit, a beam into Raijin — and the gods finish with 神雷風陣. Timed in
 * director seconds (follows ?speed). The warning is shown through
 * `setTelegraphs` (display only); returns a cancel function.
 */
export function playBossSlice(
  director: ArenaDirector,
  bossId: number,
  setTelegraphs: (t: Telegraph[]) => void,
): () => void {
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const at = (seconds: number, fn: () => void) =>
    timers.push(setTimeout(fn, (seconds * 1000) / Math.max(0.05, director.timeScale)));
  const targets: RegionId[] = ['kanto', 'kinki'];
  const hit = (weakpoint: 'CORE' | 'ARM', amount: number) =>
    director.play({
      kind: 'task',
      role: 'GUNNER',
      robot: 'RAIJIN',
      success: 1,
      callsign: 'PILOT-0001',
      assist: false,
      effect: {
        kind: 'DAMAGE',
        enemyId: bossId,
        enemyKind: 'BOSS',
        weakpoint,
        amount,
        defeated: false,
        note: null,
      },
    });
  at(0, () => {
    director.play({ kind: 'telegraph', enemyId: bossId, enemyKind: 'BOSS', targets });
    setTelegraphs([
      {
        id: -1,
        enemyId: bossId,
        kind: 'NULL_BEAM',
        targets,
        direction: 'UP',
        startsAt: 0,
        resolvesAt: 0,
        damage: 30,
        delayed: false,
      },
    ]);
  });
  at(2.2, () => hit('CORE', 48));
  at(3.6, () => hit('ARM', 30));
  at(5.2, () => {
    setTelegraphs([]);
    director.play({
      kind: 'attack',
      enemyId: bossId,
      enemyKind: 'BOSS',
      robotHit: 'RAIJIN',
      jam: false,
      hits: [
        { cityId: 'kanto', damage: 0, absorbed: 30, hpAfter: 100, destroyed: false },
        { cityId: 'kinki', damage: 30, absorbed: 0, hpAfter: 70, destroyed: false },
      ],
    });
  });
  at(7.6, () => director.play({ kind: 'specialOpen' }));
  at(9.1, () =>
    director.play({
      kind: 'specialResolved',
      outcome: 'ACTIVATED',
      damage: 250,
      bossId,
      cityHits: [],
    }),
  );
  return () => {
    for (const t of timers) clearTimeout(t);
    setTelegraphs([]);
  };
}
