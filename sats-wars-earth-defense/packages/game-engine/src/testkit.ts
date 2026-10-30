import { PRESETS } from '@swed/shared';
import type { GameConfig, MatchEvent, MatchState, PilotActionInput, SeatId } from '@swed/shared';
import { advanceTo, createMatch, reduce, type EngineCommand, type ReduceResult } from './engine';

/** Test harness: drives the pure engine like the server does, keeping every event. */
export class Sim {
  state: MatchState;
  events: MatchEvent[] = [];
  private n = 0;
  constructor(
    opts: { config?: GameConfig; autoSupport?: boolean; seed?: number; attract?: boolean } = {},
  ) {
    this.state = createMatch({
      matchId: 'm-test',
      seed: opts.seed ?? 42,
      config: opts.config ?? PRESETS.TEST,
      autoSupport: opts.autoSupport ?? false,
      attract: opts.attract ?? false,
    });
  }
  get t() {
    return this.state.t;
  }
  cmd(c: EngineCommand): ReduceResult {
    const r = reduce(this.state, c);
    this.state = r.state;
    this.events.push(...r.events);
    return r;
  }
  to(t: number) {
    const r = advanceTo(this.state, t);
    this.state = r.state;
    this.events.push(...r.events);
  }
  wait(ms: number) {
    this.to(this.state.t + ms);
  }
  join(seatId: SeatId, pilotId = `p-${seatId}`) {
    return this.cmd({
      type: 'SEAT_JOIN',
      t: this.t,
      seatId,
      pilotId,
      displayName: `PILOT-${seatId.slice(0, 4)}`,
    });
  }
  act(seatId: SeatId, action: PilotActionInput, pilotId = `p-${seatId}`, id?: string) {
    this.n += 1;
    const r = this.cmd({
      type: 'PILOT_ACTION',
      t: this.t,
      pilotId,
      seatId,
      clientActionId: id ?? `act-${String(this.n).padStart(6, '0')}`,
      action,
    });
    if (r.outcome.kind !== 'action') throw new Error('expected action outcome');
    return r.outcome.result;
  }
  /** START, then skip the deploy cinematic so combat begins now. */
  launch() {
    this.cmd({ type: 'START', t: this.t });
    this.cmd({ type: 'SKIP_DEPLOY', t: this.t });
  }
  of<T extends MatchEvent['type']>(type: T) {
    return this.events.filter((e): e is Extract<MatchEvent, { type: T }> => e.type === type);
  }
}
