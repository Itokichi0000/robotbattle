import type { ArenaPreviewCue, RaidResult, RegionId } from '@sats-wars/shared';
import { REGION_IDS } from '@sats-wars/shared';
import type { ArenaDirector } from '@sats-wars/three-game';

/**
 * Rehearsal preview (/arena?preview=1): plays synthetic cues locally so
 * operators, the MC and artists can check camera/VFX without a running raid.
 * Never sends anything to the server and never changes game state.
 */
export const PREVIEW_HELP =
  'PREVIEW: 1 開幕 / 2 砲撃 / 3 シールド / 4 敵の予告 / 5 敵の攻撃 / 6 都市陥落 / 7 神雷風陣 / 8 成功 / 9 失敗 / 0 リセット';

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
