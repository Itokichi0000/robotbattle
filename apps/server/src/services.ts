import type { AdminAuth } from './auth/admin';
import type { MonoClock, WallClock } from './clock';
import type { Repo } from './db/repo';
import type { DemoBots } from './demo/bots';
import type { Env } from './env';
import type { ActionService } from './match/actions';
import type { MatchManager } from './match/manager';
import type { PaymentAdapter } from './payments/adapter';
import type { PlayerService } from './payments/players';

export interface Services {
  env: Env;
  repo: Repo;
  manager: MatchManager;
  players: PlayerService;
  actions: ActionService;
  bots: DemoBots;
  adminAuth: AdminAuth;
  adapter: PaymentAdapter;
  mono: MonoClock;
  wall: WallClock;
  metrics?: { eventLoopLagMs(): number; tickLagMs(): number };
}
