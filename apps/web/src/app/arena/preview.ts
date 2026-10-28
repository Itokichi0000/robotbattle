import type { ClashRecord, TeamId } from '@sats-wars/shared';
import type { ArenaDirector } from '@sats-wars/three-game';

/**
 * Rehearsal preview (/arena?preview=1): plays synthetic cinematics locally so
 * operators, the MC and artists can check camera/VFX without a running match.
 * Never sends anything to the server and never changes game state.
 */
export function previewClash(
  index: number,
  opts: { special?: TeamId[]; ko?: TeamId[]; hp: Record<TeamId, number> },
): ClashRecord {
  const mk = (teamId: TeamId, special: boolean, dmg: number, hpAfter: number) => ({
    teamId,
    damageDealt: dmg,
    special,
    energyBonus: 0,
    hpAfter,
    energyAfter: 0,
  });
  const sR = opts.special?.includes('RAIJIN') ?? false;
  const sF = opts.special?.includes('FUJIN') ?? false;
  const dR = sR ? 20 : 12;
  const dF = sF ? 20 : 10;
  const hpR = opts.ko?.includes('RAIJIN') ? 0 : Math.max(1, opts.hp.RAIJIN - dF);
  const hpF = opts.ko?.includes('FUJIN') ? 0 : Math.max(1, opts.hp.FUJIN - dR);
  const snap = (teamId: TeamId) => ({
    teamId,
    hpBefore: opts.hp[teamId],
    energyBefore: 0,
    activeAttackRegions: 0,
    activeDefenseRegions: 0,
    activeEnergyRegions: 0,
  });
  return {
    clashIndex: index,
    atGameMs: 45_000 * (index + 1),
    snapshot: { RAIJIN: snap('RAIJIN'), FUJIN: snap('FUJIN') },
    outcome: { RAIJIN: mk('RAIJIN', sR, dR, hpR), FUJIN: mk('FUJIN', sF, dF, hpF) },
    ko: opts.ko ?? [],
    isFinal: !!opts.ko?.length,
  };
}

export const PREVIEW_HELP =
  'PREVIEW: 1 激突 / 2 雷神必殺 / 3 風神必殺 / 4 同時必殺 / 5 KO→勝利 / 6 登場 / 7 占領 / 0 リセット / [ ] 速度';

export function handlePreviewKey(
  key: string,
  director: ArenaDirector,
  counter: { n: number },
): boolean {
  const hp = director.displayHp;
  const i = counter.n++ % 6;
  switch (key) {
    case '1':
      director.play({ kind: 'clash', clash: previewClash(i, { hp }) });
      return true;
    case '2':
      director.play({ kind: 'clash', clash: previewClash(i, { hp, special: ['RAIJIN'] }) });
      return true;
    case '3':
      director.play({ kind: 'clash', clash: previewClash(i, { hp, special: ['FUJIN'] }) });
      return true;
    case '4':
      director.play({
        kind: 'clash',
        clash: previewClash(i, { hp, special: ['RAIJIN', 'FUJIN'] }),
      });
      return true;
    case '5':
      director.play({
        kind: 'clash',
        clash: previewClash(5, { hp, special: ['RAIJIN'], ko: ['FUJIN'] }),
      });
      director.play({ kind: 'result', winner: 'RAIJIN' });
      return true;
    case '6':
      director.play({ kind: 'intro' });
      return true;
    case '7':
      director.play({ kind: 'capture', regionId: 'kanto', teamId: 'RAIJIN' });
      director.play({ kind: 'charge', teamId: 'FUJIN' });
      return true;
    case '0':
      director.syncHp({ RAIJIN: 100, FUJIN: 100 });
      director.robots.RAIJIN = { clip: 'Idle', start: director.time, advance: 0 };
      director.robots.FUJIN = { clip: 'Idle', start: director.time, advance: 0 };
      director.camera = { preset: 'overview', since: director.time };
      return true;
    case '[':
      director.timeScale = Math.max(0.05, director.timeScale / 2);
      return true;
    case ']':
      director.timeScale = Math.min(1, director.timeScale * 2);
      return true;
    default:
      return false;
  }
}
