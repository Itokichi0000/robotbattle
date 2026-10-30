import type { GameConfig, SeatId } from '@swed/shared';
import { botDecide, type BotMemory } from './bots';
import { advanceTo, createMatch, reduce } from './engine';
import { toPublicState } from './public';

export interface SimOptions {
  autoSupport?: boolean;
  /** Bot reaction quality 0..1 (1 = attentive human). */
  skill?: number;
}

/**
 * Plays one whole match with bot pilots in the given seats (headless, deterministic).
 * Bots look and act every 250 ms, like an attentive human.
 */
export function playMatch(config: GameConfig, crew: SeatId[], seed: number, opts: SimOptions = {}) {
  let s = createMatch({
    matchId: `sim-${seed}`,
    seed,
    config,
    autoSupport: opts.autoSupport ?? true,
  });
  const memory = new Map<SeatId, BotMemory>(crew.map((seat) => [seat, {}]));
  for (const seat of crew) {
    s = reduce(s, {
      type: 'SEAT_JOIN',
      t: 0,
      seatId: seat,
      pilotId: `bot-${seat}`,
      displayName: seat,
    }).state;
  }
  s = reduce(s, { type: 'START', t: 0 }).state;
  s = reduce(s, { type: 'SKIP_DEPLOY', t: 0 }).state;
  let n = 0;
  for (let t = 250; t < 400_000 && !s.result; t += 250) {
    s = advanceTo(s, t).state;
    const pub = toPublicState(s);
    for (const seat of crew) {
      const action = botDecide(pub, seat, t, opts.skill ?? 1, memory.get(seat));
      if (!action) continue;
      s = reduce(s, {
        type: 'PILOT_ACTION',
        t,
        pilotId: `bot-${seat}`,
        seatId: seat,
        clientActionId: `b${seed}-${n++}`,
        action,
      }).state;
    }
  }
  return s;
}
