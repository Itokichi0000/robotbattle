import { parentPort, workerData } from 'node:worker_threads';
import { type RoleMix, simulateRaid } from '../simulate';

const job = workerData as { pilots: number; skill: number; mix: RoleMix; seeds: number[] };
parentPort!.postMessage(
  job.seeds.map((seed) =>
    simulateRaid({ pilots: job.pilots, skill: job.skill, mix: job.mix, seed }),
  ),
);
