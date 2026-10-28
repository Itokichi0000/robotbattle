import type { GameConfig, MatchState, PlayerAction, RegionId } from '@sats-wars/shared';
import { REGION_IDS, makeGameConfig } from '@sats-wars/shared';
import { createMatchState, mulberry32, reduce } from '@sats-wars/game-engine';

/**
 * EARTH DEFENSE campaign simulator. Time does not exist in the rules (aliens
 * move every `actionsPerTurn` actions), so the result depends only on how
 * good the choices are, not on how many people play. A crowd is modelled as
 * a mix: a share of actions use the "おすすめ" button, the rest are a casual
 * tap on a random alien/region.
 */
export interface CampaignOptions {
  seed: number;
  config?: Partial<GameConfig>;
  /** Share of actions taken with the おすすめ (AUTO) button, 0..1. */
  autoShare: number;
  /** Safety cap. */
  maxActions?: number;
}

export interface CampaignSim {
  reachedWave: number;
  wavesCleared: number;
  actions: number;
  alienTurns: number;
  regionsLost: number;
  regionsLiberated: number;
  combos: number;
  kills: number;
  sats: number;
  /** Ended by Japan falling (false = hit the action cap). */
  fell: boolean;
}

function casual(s: MatchState, rnd: () => number): { action: PlayerAction; regionId?: RegionId } {
  const withAliens = REGION_IDS.filter((id) => s.enemies.some((e) => e.regionId === id));
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  if (s.combo >= s.config.comboGaugeMax && withAliens.length && rnd() < 0.5) return { action: 'COMBO', regionId: pick(withAliens) };
  const r = rnd();
  if (r < 0.15) {
    const standing = REGION_IDS.filter((id) => !s.regions[id].fallen && s.regions[id].shield === 0);
    if (standing.length) return { action: 'SHIELD', regionId: pick(standing) };
  }
  if (!withAliens.length) return { action: 'AUTO' };
  return { action: r < 0.6 ? 'RAIJIN' : 'FUJIN', regionId: pick(withAliens) };
}

export function simulateCampaign(o: CampaignOptions): CampaignSim {
  const cfg = makeGameConfig(o.config ?? {});
  const rnd = mulberry32((o.seed * 2654435761) >>> 0);
  let s = reduce(createMatchState('sim', cfg, o.seed), { type: 'START', t: 0 }).state;
  const cap = o.maxActions ?? 20_000;
  let t = 0;
  while (s.status === 'LIVE' && s.stats.actions < cap) {
    t += 1000;
    const choice = rnd() < o.autoShare ? { action: 'AUTO' as const } : casual(s, rnd);
    let r = reduce(s, { type: 'ACT', t, participantId: 'x', nickname: 'sim', ...choice });
    // A refused casual tap is free; the person then just presses おすすめ.
    if (r.outcome.kind === 'action' && !r.outcome.result.ok) {
      r = reduce(s, { type: 'ACT', t, participantId: 'x', nickname: 'sim', action: 'AUTO' });
    }
    s = r.state;
  }
  return {
    reachedWave: s.wave,
    wavesCleared: Math.max(0, s.wave - 1),
    actions: s.stats.actions,
    alienTurns: s.stats.alienTurns,
    regionsLost: s.stats.regionsLost,
    regionsLiberated: s.stats.regionsLiberated,
    combos: s.stats.combos,
    kills: s.stats.kills,
    sats: s.stats.actions * cfg.actionCostSats,
    fell: s.status === 'FINISHED',
  };
}

export interface Aggregate {
  n: number;
  waveMean: number;
  waveP10: number;
  waveP50: number;
  waveP90: number;
  actionsMean: number;
  actionsP50: number;
  satsMean: number;
  regionsLostMean: number;
  liberatedMean: number;
  combosMean: number;
  fellShare: number;
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? NaN;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

export function aggregate(sims: CampaignSim[]): Aggregate {
  const waves = sims.map((x) => x.reachedWave);
  const actions = sims.map((x) => x.actions);
  return {
    n: sims.length,
    waveMean: mean(waves),
    waveP10: quantile(waves, 0.1),
    waveP50: quantile(waves, 0.5),
    waveP90: quantile(waves, 0.9),
    actionsMean: mean(actions),
    actionsP50: quantile(actions, 0.5),
    satsMean: mean(sims.map((x) => x.sats)),
    regionsLostMean: mean(sims.map((x) => x.regionsLost)),
    liberatedMean: mean(sims.map((x) => x.regionsLiberated)),
    combosMean: mean(sims.map((x) => x.combos)),
    fellShare: sims.filter((x) => x.fell).length / Math.max(1, sims.length),
  };
}
