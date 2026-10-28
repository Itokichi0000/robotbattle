import type { RegionId } from '@sats-wars/shared';
import { REGION_IDS } from '@sats-wars/shared';
import type { ArenaDirector } from '@sats-wars/three-game';

/**
 * Rehearsal preview (/arena?preview=1): plays synthetic cues locally so
 * operators, the MC and artists can check camera/VFX without a running
 * campaign. Never sends anything to the server and never changes game state.
 */
export const PREVIEW_HELP =
  'PREVIEW: 1 ウェーブ開始 / 2 雷神連打 / 3 風神連打 / 4 合体技 / 5 敵ターン / 6 奪還 / 7 クリア / 8 日本陥落 / 9 開幕 / 0 リセット / [ ] 速度';

interface PreviewState {
  n: number;
  wave: number;
  region: RegionId;
}

export function newPreviewState(): PreviewState {
  return { n: 0, wave: 1, region: 'kanto' };
}

const pick = (st: PreviewState): RegionId => REGION_IDS[st.n % REGION_IDS.length]!;

export function handlePreviewKey(key: string, director: ArenaDirector, st: PreviewState): boolean {
  st.n++;
  const name = `ゲスト${(st.n % 9) + 1}`;
  switch (key) {
    case '1':
      st.wave++;
      director.play({ kind: 'waveStart', wave: st.wave, boss: st.wave % 5 === 0 });
      return true;
    case '2':
    case '3': {
      const action = key === '2' ? 'RAIJIN' : 'FUJIN';
      st.region = pick(st);
      for (let i = 0; i < 5; i++) {
        setTimeout(
          () => director.play({ kind: 'action', action, regionId: st.region, nickname: name, damage: 30, kills: i === 4 ? 1 : 0, liberated: false }),
          i * 180,
        );
      }
      return true;
    }
    case '4':
      director.play({ kind: 'action', action: 'COMBO', regionId: pick(st), nickname: 'プレビュー', damage: 150, kills: 3, liberated: false });
      return true;
    case '5': {
      const a = pick(st);
      const b = REGION_IDS[(st.n + 3) % REGION_IDS.length]!;
      director.play({
        kind: 'alienTurn',
        attacks: [
          { regionId: a, damage: 40, absorbed: 0, cityHpAfter: 0, fell: true },
          { regionId: b, damage: 20, absorbed: 20, cityHpAfter: 70, fell: false },
        ],
        fell: [a],
        landed: [REGION_IDS[(st.n + 5) % REGION_IDS.length]!],
      });
      return true;
    }
    case '6':
      director.play({ kind: 'action', action: 'RAIJIN', regionId: pick(st), nickname: 'プレビュー', damage: 45, kills: 1, liberated: true });
      return true;
    case '7':
      director.play({ kind: 'waveCleared', wave: st.wave });
      return true;
    case '8':
      director.play({ kind: 'japanFallen', reachedWave: st.wave });
      return true;
    case '9':
      director.play({ kind: 'campaignStart' });
      return true;
    case '0':
      director.reset();
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
