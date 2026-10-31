import { CITIES, PARTS, POWER_LANES, SEATS, shieldSeatFor } from '@swed/shared';
import type { PowerLane, PublicMatchState } from '@swed/shared';

/**
 * The match told as three acts (D-032). Each act has one goal people can read from across the
 * hall; the "now" line below says the single most useful thing to do this second.
 */
export const ACTS = {
  WAVE_1: {
    no: 1,
    ja: 'ドローン迎撃',
    en: 'INTERCEPT',
    goal: '敵ドローンを撃ち落とせ。違う役割の成功をつなぐと雷神ゲージがたまる',
  },
  WAVE_2: {
    no: 2,
    ja: '都市を守れ',
    en: 'DEFEND THE CITIES',
    goal: '予告された都市への攻撃を、防衛席の盾で防げ。3都市を失うと負け',
  },
  BOSS: {
    no: 3,
    ja: 'NULL CORE 撃破',
    en: 'DESTROY NULL CORE',
    goal: '雷神ゲージ満タンで必殺技。時間内にボスを倒せば勝利',
  },
} as const;

export type ActPhase = keyof typeof ACTS;

export function actOf(phase: string): (typeof ACTS)[ActPhase] | null {
  return phase in ACTS ? ACTS[phase as ActPhase] : null;
}

const LANE_JA: Record<PowerLane, string> = {
  weapon: '武器系',
  shield: 'シールド系',
  mobility: '機動系',
  repair: '修理系',
};

export type NowTone = 'danger' | 'bolt' | 'action' | 'calm';

/** The one instruction that matters most right now, in priority order. */
export function nowLine(s: PublicMatchState, mt: number): { text: string; tone: NowTone } {
  if (s.crisis) {
    return {
      text: '炉心停止！ 電力B が回路をつなぐ か、誰かが 21 sats で即時復旧',
      tone: 'danger',
    };
  }
  if (s.overdrive.status === 'READY' || s.overdrive.status === 'CHARGING') {
    return { text: '必殺技 準備完了 → 4つの役割が全員スマホの SYNC NOW を押す', tone: 'bolt' };
  }
  const th = [...s.threats].sort((a, b) => a.impactAt - b.impactAt)[0];
  if (th && th.impactAt - mt < 6_000) {
    const secs = Math.max(0, (th.impactAt - mt) / 1000).toFixed(1);
    const where =
      th.target.type === 'CITY'
        ? CITIES[th.target.cityId].nameJa
        : `機体の${PARTS[th.target.part].labelJa}`;
    return {
      text: `${where}に攻撃 ${secs}秒 → ${SEATS[shieldSeatFor(th.dir)].labelJa} が盾を出す`,
      tone: 'danger',
    };
  }
  const cut = POWER_LANES.find((l) => s.circuits[l].broken);
  if (cut) return { text: `${LANE_JA[cut]}の回路が切断 → 電力B がつなぎ直す`, tone: 'action' };
  const boss = s.boss ? s.enemies.find((e) => e.id === s.boss!.id) : undefined;
  if (boss && boss.weakUntil > mt) return { text: '弱点露出中 → 砲撃を集中！', tone: 'action' };
  const gauge = Math.round(Math.min(100, s.teamCapacitor));
  if (s.phase === 'BOSS') {
    return { text: `雷神ゲージ ${gauge}% → 満タンで必殺技。撃つ・守る・つなぐ`, tone: 'calm' };
  }
  if (s.phase === 'WAVE_1') {
    return { text: '砲撃で敵を撃墜。違う役割が続けて成功すると連携ボーナス', tone: 'calm' };
  }
  return { text: '攻撃予告に備える。電力A は盾にも電力を回す', tone: 'calm' };
}
