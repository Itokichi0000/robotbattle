import { CITY_IDS, isSeatOpen, SEAT_IDS } from '@swed/shared';
import type { MatchState, PublicMatchState, PublicSeat, SeatId } from '@swed/shared';
import { bossOf, humansAboard } from './engine';

/** What every client may see. No pilot ids, no RNG, no idempotency log. */
export function toPublicState(s: MatchState): PublicMatchState {
  const seats = Object.fromEntries(
    SEAT_IDS.map((id): [SeatId, PublicSeat] => {
      const seat = s.seats[id];
      const occupied = seat.pilotId !== null;
      return [
        id,
        {
          seatId: id,
          occupied,
          displayName: seat.displayName,
          connected: seat.connected,
          ready: seat.ready,
          auto: !occupied && s.autoSupport,
          open: isSeatOpen(s.config, id),
          stats: { ...seat.stats },
        },
      ];
    }),
  ) as Record<SeatId, PublicSeat>;
  const T = s.config.timings;
  let combatEndsAt: number | null = null;
  if (s.phaseEndsAt !== null) {
    if (s.phase === 'WAVE_1') combatEndsAt = s.phaseEndsAt + T.wave2Ms + T.bossMs;
    else if (s.phase === 'WAVE_2') combatEndsAt = s.phaseEndsAt + T.bossMs;
    else if (s.phase === 'BOSS') combatEndsAt = s.phaseEndsAt;
  }
  const boss = bossOf(s);
  const strip = <T extends { chargedNotified: boolean }>({ chargedNotified: _c, ...rest }: T) =>
    rest;
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
    combatEndsAt,
    paused: s.paused,
    autoSupport: s.autoSupport,
    seats,
    humans: humansAboard(s),
    coreHp: s.coreHp,
    coreMax: s.config.core.max,
    boss: boss ? { id: boss.id, hp: boss.hp, maxHp: boss.maxHp } : null,
    enemies: s.enemies.map((e) => ({
      id: e.id,
      kind: e.kind,
      hp: e.hp,
      maxHp: e.maxHp,
      orbit: e.orbit,
      spawnedAt: e.spawnedAt,
      arrivesAt: e.arrivesAt,
      weakUntil: e.weakUntil,
    })),
    threats: s.threats.map((th) => ({ ...th })),
    cities: Object.fromEntries(
      CITY_IDS.map((id) => [id, { ...s.cities[id] }]),
    ) as PublicMatchState['cities'],
    parts: { ...s.parts },
    distribution: { ...s.distribution },
    energy: {
      weapon: Math.round(s.energy.weapon),
      shield: Math.round(s.energy.shield),
      mobility: Math.round(s.energy.mobility),
      repair: Math.round(s.energy.repair),
    },
    gunners: { GUNNER_L: strip(s.gunners.GUNNER_L), GUNNER_R: strip(s.gunners.GUNNER_R) },
    shields: { SHIELD_L: { ...s.shields.SHIELD_L }, SHIELD_R: { ...s.shields.SHIELD_R } },
    teamSync: Math.round(s.teamSync),
    teamCapacitor: Math.round(s.teamCapacitor),
    stats: { ...s.stats },
    result: s.result,
    hints: {
      weaponCost: s.config.weapons.energyCost,
      shieldCost: s.config.shields.energyCost,
      repairCost: s.config.repair.energyCost,
      weaponCooldownMs: s.config.weapons.cooldownMs,
      shieldCooldownMs: s.config.shields.cooldownMs,
      shieldActiveMs: s.config.shields.activeMs,
      shieldPerfectMs: s.config.shields.perfectMs,
      threatWarnMs: s.config.timings.threatWarnMs,
      laneMax: s.config.energy.laneMax,
      citiesLostForDefeat: s.config.cities.lostForDefeat,
      overdriveSyncMin: s.config.overdrive.syncMin,
      overdriveCapacitorMin: s.config.overdrive.capacitorMin,
    },
  };
}
