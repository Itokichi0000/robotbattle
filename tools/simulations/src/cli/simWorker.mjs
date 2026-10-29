// Worker bootstrap for sim:balance: register tsx (extensionless TS imports)
// inside the thread, then run the TypeScript job.
import { register } from 'tsx/esm/api';

register();
await import('./simWorkerJob.ts');
