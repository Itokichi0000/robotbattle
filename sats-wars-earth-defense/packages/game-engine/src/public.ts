import { CITY_IDS } from '@swed/shared';
import type { MatchState, PublicMatchState } from '@swed/shared';
import { bossOf, countedPlayers, paidEffect } from './engine';

/** What every client may see. No pilot ids, no RNG, no idempotency log. */
export function toPublicState(s: MatchState): PublicMatchState {
  const counted = countedPlayers(s);
  const bots = counted.filter((p) => p.bot).length;
  const boss = bossOf(s);
  const c = s.config;
  return {
    matchId: s.matchId,
    matchNumber: s.matchNumber,
    presetId: s.presetId,
    configHash: s.configHash,
    version: s.version,
    t: s.t,
    phase: s.phase,
    phaseStartedAt: s.phaseStartedAt,
    phaseEndsAt: s.phaseEndsAt,
    paused: s.paused,
    autoStartAt: s.autoStartAt,
    players: counted.length,
    humans: counted.length - bots,
    bots,
    playersAtLaunch: s.playersAtLaunch,
    mechHp: Math.round(s.mechHp),
    mechMax: c.mech.max,
    shield: Math.round(s.shield),
    shieldMax: c.shield.max,
    boss: boss ? { id: boss.id, hp: Math.round(boss.hp), maxHp: boss.maxHp } : null,
    enemies: s.enemies.map((e) => ({ ...e, orbit: { ...e.orbit } })),
    threats: s.threats.map((th) => ({ ...th, target: { ...th.target } })),
    cities: Object.fromEntries(
      CITY_IDS.map((id) => [id, { ...s.cities[id] }]),
    ) as PublicMatchState['cities'],
    stats: structuredClone(s.stats),
    result: s.result,
    hints: {
      free: { ...c.free.effect },
      paid: {
        ATTACK: paidEffect(s, 'ATTACK'),
        DEFEND: paidEffect(s, 'DEFEND'),
        REPAIR: paidEffect(s, 'REPAIR'),
      },
      freeCooldownMs: c.free.cooldownMs,
      shieldDecayPerSec: c.shield.decayPerSec,
      paidAmountSats: c.paid.amountSats,
      paidPerPilot: c.paid.perPilotPerMatch,
      citiesLostForDefeat: c.strikes.lostForDefeat,
      battleMs: c.timings.battleMs,
    },
  };
}
