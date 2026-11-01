import { SQUAD_IDS } from '@swed/shared';
import type { MatchState, PublicMatchState } from '@swed/shared';
import { boltDamage, bossOf, countedPlayers, teamCounts, teamScale } from './engine';

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
    squads: Object.fromEntries(
      SQUAD_IDS.map((id) => [id, { ...s.squads[id] }]),
    ) as PublicMatchState['squads'],
    teams: teamCounts(s),
    launched: s.launched.filter((id) => s.players[id]).length,
    feverUntil: s.feverUntil,
    bolts: s.bolts.map((b) => ({ id: b.id, startedAt: b.startedAt, expiresAt: b.expiresAt })),
    stats: structuredClone(s.stats),
    result: s.result,
    hints: {
      free: { ...c.free.effect },
      teamScale: {
        ATTACK: 1,
        DEFEND: Math.round(teamScale(s, 'DEFEND') * 100) / 100,
        REPAIR: Math.round(teamScale(s, 'REPAIR') * 100) / 100,
      },
      feverMs: c.paid.feverMs,
      feverMultiplier: c.paid.feverMultiplier,
      bolt: boltDamage(s),
      boltHitMultiplier: c.paid.boltHitMultiplier,
      boltRadius: c.paid.boltRadius,
      launchShield: c.launch.shieldAtFull,
      freeCooldownMs: c.free.cooldownMs,
      shieldDecayPerSec: c.shield.decayPerSec,
      paidAmountSats: c.paid.amountSats,
      paidPerPilot: c.paid.perPilotPerMatch,
      squadsLostForDefeat: c.strikes.lostForDefeat,
      battleMs: c.timings.battleMs,
    },
  };
}
