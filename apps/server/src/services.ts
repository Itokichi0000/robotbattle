import type { AdminAuth } from './auth/admin';
import type { LnurlAuthService } from './auth/lnurl';
import type { SessionService } from './auth/sessions';
import type { MonoClock, WallClock } from './clock';
import type { Repo } from './db/repo';
import type { DemoBots } from './demo/bots';
import type { Env } from './env';
import type { PaymentAdapter } from './payments/adapter';
import type { PassService } from './payments/passes';
import type { PilotService } from './pilots/service';
import type { RaidManager } from './raid/manager';
import type { PilotActionService } from './raid/pilotActions';
import type { ReplayService } from './raid/replay';
import type { BackupService } from './ops/backup';

export interface Services {
  env: Env;
  repo: Repo;
  manager: RaidManager;
  sessions: SessionService;
  pilots: PilotService;
  passes: PassService;
  actions: PilotActionService;
  lnurl: LnurlAuthService;
  bots: DemoBots;
  replays: ReplayService;
  backups: BackupService;
  adminAuth: AdminAuth;
  adapter: PaymentAdapter;
  mono: MonoClock;
  wall: WallClock;
  metrics?: { eventLoopLagMs(): number; tickLagMs(): number };
}
