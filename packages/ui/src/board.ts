import type { Direction, EnergySink, RegionId, RepairTarget, Role, TaskEffect, TaskResult, Weakpoint } from '@sats-wars/shared';
import { CITY_INFO, ENEMY_LABELS, REGION_IDS, SINK_LABELS, WEAKPOINT_LABELS } from '@sats-wars/shared';
import type { Board, TaskChoice } from '@sats-wars/game-engine';
import { liveEnemies, recommendGunnerTarget, recommendGuardianTarget, recommendRepair, recommendSink } from '@sats-wars/game-engine';
import type { RaidLike } from './view';

type Lx = (ja: string, en: string) => string;

/** Engine helper input built from a public snapshot (display/recommendation only). */
export function boardFrom(s: RaidLike, gameNow: number): Board {
  return {
    config: s.config,
    cities: Object.fromEntries(s.cities.map((c) => [c.cityId, c])) as Board['cities'],
    robots: { RAIJIN: s.robots[0]!, FUJIN: s.robots[1]! },
    enemies: s.enemies,
    telegraphs: s.telegraphs,
    bossId: s.bossId,
    reserveEnergy: s.reserveEnergy,
    jammedUntil: s.jammedUntil,
    gameMs: gameNow,
    phase: s.phase,
  };
}

export function cityName(id: RegionId, L: Lx): string {
  return L(CITY_INFO[id].cityJa, CITY_INFO[id].cityEn);
}

export interface ChoiceOption {
  key: string;
  label: string;
  hint?: string;
  choice: TaskChoice;
  danger?: boolean;
}

/**
 * What a pilot can aim at in this seat right now. The first option is the
 * engine's recommendation so a newcomer can just press 出撃.
 */
export function choiceOptions(role: Role, b: Board, L: Lx): ChoiceOption[] {
  switch (role) {
    case 'GUNNER': {
      const rec = recommendGunnerTarget(b);
      const out: ChoiceOption[] = [];
      const enemies = liveEnemies(b).sort((a, z) => (a.id === rec?.enemyId ? -1 : z.id === rec?.enemyId ? 1 : 0));
      for (const e of enemies.slice(0, 3)) {
        const wps: Weakpoint[] = e.kind === 'BOSS' ? ['CORE', 'ARM', 'LEG'] : ['CORE', 'LEG'];
        const ordered = rec && rec.enemyId === e.id ? [rec.weakpoint, ...wps.filter((w) => w !== rec.weakpoint)] : wps;
        for (const w of ordered) {
          out.push({
            key: `${e.id}-${w}`,
            label: `${ENEMY_LABELS[e.kind].icon} ${L(ENEMY_LABELS[e.kind].ja, ENEMY_LABELS[e.kind].en)}・${L(WEAKPOINT_LABELS[w].ja, WEAKPOINT_LABELS[w].en)}`,
            hint: L(WEAKPOINT_LABELS[w].hintJa, WEAKPOINT_LABELS[w].hintEn),
            choice: { enemyId: e.id, weakpoint: w },
            danger: e.ai === 'TELEGRAPH',
          });
        }
      }
      return out.slice(0, 6);
    }
    case 'GUARDIAN': {
      const rec = recommendGuardianTarget(b);
      const out: ChoiceOption[] = [];
      const seen = new Set<RegionId>();
      const tgs = [...b.telegraphs].sort((a, z) => a.resolvesAt - z.resolvesAt);
      const recKey = 'telegraphId' in rec ? `${rec.telegraphId}-${rec.cityId}` : `standby-${rec.cityId}`;
      for (const t of tgs) {
        for (const c of t.targets) {
          if (b.cities[c].destroyed) continue;
          const secs = Math.max(0, Math.ceil((t.resolvesAt - b.gameMs) / 1000));
          out.push({
            key: `${t.id}-${c}`,
            label: `🛡 ${cityName(c, L)}`,
            hint: L(`${secs}秒後に攻撃`, `attack in ${secs}s`),
            choice: { telegraphId: t.id, cityId: c },
            danger: true,
          });
          seen.add(c);
        }
      }
      const standby = REGION_IDS.filter((c) => !seen.has(c) && !b.cities[c].destroyed).sort((a, z) => b.cities[a].hp + b.cities[a].shield - (b.cities[z].hp + b.cities[z].shield));
      for (const c of standby.slice(0, 2)) {
        out.push({ key: `standby-${c}`, label: `🛡 ${cityName(c, L)}`, hint: L('先に守っておく', 'shield in advance'), choice: { cityId: c } });
      }
      const i = out.findIndex((o) => o.key === recKey);
      if (i > 0) out.unshift(...out.splice(i, 1));
      return out.slice(0, 6);
    }
    case 'ROUTER': {
      const rec = recommendSink(b);
      const sinks: EnergySink[] = [rec, ...(['RAIJIN', 'FUJIN', 'RESERVE'] as const).filter((s) => s !== rec)];
      return sinks.map((s) => ({
        key: s,
        label: `🔌 ${L(SINK_LABELS[s].ja, SINK_LABELS[s].en)}`,
        hint: L(SINK_LABELS[s].hintJa, SINK_LABELS[s].hintEn),
        choice: { sink: s },
      }));
    }
    case 'ENGINEER': {
      const rec = recommendRepair(b);
      const opts: RepairTarget[] = [rec];
      const push = (r: RepairTarget) => {
        if (!opts.some((o) => JSON.stringify(o) === JSON.stringify(r))) opts.push(r);
      };
      if (b.jammedUntil > b.gameMs) push({ type: 'UNJAM' });
      for (const r of ['RAIJIN', 'FUJIN'] as const) if (b.robots[r].health < 100) push({ type: 'ROBOT', robot: r });
      const hurt = REGION_IDS.filter((c) => b.cities[c].destroyed || b.cities[c].hp < b.config.cityMaxHp).sort((a, z) => b.cities[a].hp - b.cities[z].hp);
      for (const c of hurt.slice(0, 3)) push({ type: 'CITY', cityId: c });
      return opts.slice(0, 5).map((r) => ({ key: JSON.stringify(r), ...repairLabel(r, b, L), choice: { repair: r } }));
    }
  }
}

function repairLabel(r: RepairTarget, b: Board, L: Lx): { label: string; hint: string; danger?: boolean } {
  if (r.type === 'UNJAM') return { label: L('🔧 電力妨害を解除', '🔧 Clear the jam'), hint: L('電力接続が元に戻る', 'Routing back to normal'), danger: true };
  if (r.type === 'ROBOT') {
    const name = r.robot === 'RAIJIN' ? L('雷神', 'Raijin') : L('風神', 'Fujin');
    return { label: `🔧 ${name}`, hint: L(`機体 ${Math.round(b.robots[r.robot].health)}%`, `hull ${Math.round(b.robots[r.robot].health)}%`) };
  }
  const c = b.cities[r.cityId];
  return c.destroyed
    ? { label: `🏗 ${cityName(r.cityId, L)}`, hint: L('再建する', 'Rebuild'), danger: true }
    : { label: `🔧 ${cityName(r.cityId, L)}`, hint: L(`耐久 ${Math.round(c.hp)}`, `HP ${Math.round(c.hp)}`) };
}

export function successLabel(success: number, L: Lx): string {
  if (success >= 0.95) return L('パーフェクト！', 'PERFECT!');
  if (success >= 0.6) return L('グッド！', 'GOOD!');
  if (success > 0) return L('命中', 'HIT');
  return L('ミス…', 'MISS…');
}

/** One sentence saying what the pilot's action did, e.g. 「東京にシールド+45」. */
export function effectSentence(effect: TaskEffect | null, L: Lx): string {
  if (!effect) return L('効果なし。次は落ち着いて！', 'No effect. Steady next time!');
  switch (effect.kind) {
    case 'DAMAGE': {
      const name = L(ENEMY_LABELS[effect.enemyKind].ja, ENEMY_LABELS[effect.enemyKind].en);
      const wp = L(WEAKPOINT_LABELS[effect.weakpoint].ja, WEAKPOINT_LABELS[effect.weakpoint].en);
      const base = L(`雷神が${name}の${wp}に${Math.round(effect.amount)}ダメージ`, `Raijin hit the ${name} ${wp} for ${Math.round(effect.amount)}`);
      const note = effect.note === 'WEAKEN' ? L('（攻撃が弱まった）', ' (attacks weakened)') : effect.note === 'DELAY' ? L('（攻撃を遅らせた）', ' (attack delayed)') : '';
      return base + note + (effect.defeated ? L(' ― 撃破！', ' — destroyed!') : '');
    }
    case 'SHIELD':
      return L(`風神が${cityName(effect.cityId, L)}にシールド+${Math.round(effect.amount)}`, `Fujin shielded ${cityName(effect.cityId, L)} +${Math.round(effect.amount)}`);
    case 'ENERGY':
      return L(`${SINK_LABELS[effect.sink].ja}へエネルギー+${Math.round(effect.amount)}`, `+${Math.round(effect.amount)} energy to ${SINK_LABELS[effect.sink].en}`);
    case 'REPAIR': {
      const r = effect.repair;
      const what = r.type === 'UNJAM' ? L('電力妨害', 'the jam') : r.type === 'ROBOT' ? (r.robot === 'RAIJIN' ? L('雷神', 'Raijin') : L('風神', 'Fujin')) : cityName(r.cityId, L);
      return r.type === 'UNJAM' ? L('電力妨害を解除した', 'Jam cleared') : L(`${what}を${Math.round(effect.amount)}修理`, `Repaired ${what} by ${Math.round(effect.amount)}`);
    }
  }
}

export function resultSentence(r: TaskResult, L: Lx): string {
  return `${successLabel(r.success, L)} ${effectSentence(r.effect, L)}${r.syncGain > 0 ? L(`／SYNC+${r.syncGain}`, ` / SYNC +${r.syncGain}`) : ''}`;
}

export const DIRECTION_LABELS: Record<Direction, { icon: string; ja: string; en: string; key: string }> = {
  LEFT: { icon: '←', ja: '左', en: 'Left', key: 'ArrowLeft' },
  UP: { icon: '↑', ja: '上', en: 'Up', key: 'ArrowUp' },
  RIGHT: { icon: '→', ja: '右', en: 'Right', key: 'ArrowRight' },
};
