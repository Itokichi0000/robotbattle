import type { GameConfig, SeatId } from '@swed/shared';
import { botDecide } from './bots';
import { advanceTo, createMatch, reduce } from './engine';
import { toPublicState } from './public';

/**
 * Plays one whole match with bot pilots in the given seats (headless, deterministic).
 * Bots look and act every 250 ms, like an attentive human.
 */
export function playMatch(config: GameConfig, crew: SeatId[], seed: number, autoSupport = true) {
  let s = createMatch({ matchId: `sim-${seed}`, seed, config, autoSupport });
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
      const action = botDecide(pub, seat, t);
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
