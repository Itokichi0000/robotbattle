import type { RegionId, TeamId } from '@sats-wars/shared';
import { REGION_IDS } from '@sats-wars/shared';
import type { ArenaDirector } from '@sats-wars/three-game';

/**
 * Rehearsal preview (/arena?preview=1): plays synthetic cues locally so
 * operators, the MC and artists can check camera/VFX without a running
 * season. Never sends anything to the server and never changes game state.
 */
export const PREVIEW_HELP =
  'PREVIEW: 1 ラウンド開始 / 2 雷神パンチ連打 / 3 風神パンチ連打 / 4 雷神必殺 / 5 KO / 6 時間切れ引分 / 7 全国制覇 / 8 開幕 / 0 リセット / [ ] 速度';

interface PreviewState {
  n: number;
  hpMax: number;
  hp: Record<TeamId, number>;
  region: RegionId;
}

export function newPreviewState(): PreviewState {
  return { n: 0, hpMax: 200, hp: { RAIJIN: 200, FUJIN: 200 }, region: 'kanto' };
}

function punch(director: ArenaDirector, st: PreviewState, teamId: TeamId, special = false): void {
  const foe: TeamId = teamId === 'RAIJIN' ? 'FUJIN' : 'RAIJIN';
  const pinch = st.hp[teamId] <= st.hpMax * 0.3;
  const damage = Math.round((special ? 60 : 10) * (pinch ? 1.5 : 1));
  st.hp = { ...st.hp, [foe]: Math.max(0, st.hp[foe] - damage) };
  director.play({ kind: 'zap', teamId, nickname: special ? 'プレビュー' : `ゲスト${(st.n % 9) + 1}`, damage, special, pinch, ko: st.hp[foe] === 0, hp: st.hp });
}

export function handlePreviewKey(key: string, director: ArenaDirector, st: PreviewState): boolean {
  st.n++;
  switch (key) {
    case '1':
      st.region = REGION_IDS[st.n % REGION_IDS.length]!;
      st.hp = { RAIJIN: st.hpMax, FUJIN: st.hpMax };
      director.play({ kind: 'roundStart', roundIndex: st.n % 8, roundsTotal: 8, regionId: st.region, hpMax: st.hpMax, hp: st.hp });
      return true;
    case '2':
    case '3': {
      const t: TeamId = key === '2' ? 'RAIJIN' : 'FUJIN';
      for (let i = 0; i < 5; i++) setTimeout(() => punch(director, st, t), i * 180);
      return true;
    }
    case '4':
      punch(director, st, 'RAIJIN', true);
      return true;
    case '5': {
      st.hp = { ...st.hp, FUJIN: 0 };
      director.play({ kind: 'zap', teamId: 'RAIJIN', nickname: 'プレビュー', damage: 10, special: false, pinch: false, ko: true, hp: st.hp });
      director.play({ kind: 'roundEnd', winner: 'RAIJIN', reason: 'KO', regionId: st.region, finisher: 'プレビュー' });
      return true;
    }
    case '6':
      director.play({ kind: 'roundEnd', winner: null, reason: 'DRAW', regionId: st.region, finisher: null });
      return true;
    case '7':
      director.play({ kind: 'seasonEnd', winner: 'FUJIN', regionCounts: { RAIJIN: 3, FUJIN: 5 } });
      return true;
    case '8':
      director.play({ kind: 'seasonStart' });
      return true;
    case '0':
      st.hp = { RAIJIN: st.hpMax, FUJIN: st.hpMax };
      director.enterRound(st.hp, st.hpMax);
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
