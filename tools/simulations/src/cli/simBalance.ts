/**
 * Balance statistics (spec I2):
 *
 *   pnpm sim:balance --runs 1000 --pilots 2,10,30,50
 *   pnpm sim:balance --runs 200 --pilots 9 --mix random --skill 0.5 --json out.json
 *
 * For each crew size: clear rate, how and when raids end, SYNC, 神雷風陣
 * outcomes, role-distribution skew and the effective actions (successful
 * minigames) a raid took. Same engine and bot solver as the demo bots.
 * `pnpm simulate` writes the fuller docs/BALANCE_REPORT.md.
 */
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { configHash, DEFAULT_GAME_CONFIG } from '@sats-wars/shared';
import { aggregate, type RaidSim, type RoleMix, simulateRaid } from '../simulate';
import { num, parseArgs, str, outPath } from './args';

interface Job {
  pilots: number;
  skill: number;
  mix: RoleMix;
  seeds: number[];
}

/** Spread the seeds over worker threads (the engine is CPU bound and pure). */
async function runAll(job: Job, threads: number): Promise<RaidSim[]> {
  if (threads <= 1 || job.seeds.length < 8)
    return job.seeds.map((seed) => simulateRaid({ ...job, seed }));
  const size = Math.ceil(job.seeds.length / threads);
  const parts = Array.from({ length: threads }, (_, i) =>
    job.seeds.slice(i * size, (i + 1) * size),
  ).filter((x) => x.length);
  const results = await Promise.all(
    parts.map(
      (seeds) =>
        new Promise<RaidSim[]>((ok, fail) => {
          const w = new Worker(new URL('./simWorker.mjs', import.meta.url), {
            workerData: { ...job, seeds },
          });
          w.once('message', ok);
          w.once('error', fail);
        }),
    ),
  );
  return results.flat();
}

const args = parseArgs(process.argv.slice(2));
const runs = Math.max(1, Math.round(num(args, 'runs', 200)));
const crews = str(args, 'pilots', '2,10,30,50')
  .split(',')
  .map((x) => Math.max(1, Math.round(Number(x))))
  .filter(Number.isFinite);
const skill = Math.max(0, Math.min(1, num(args, 'skill', 0.65)));
const mix = str(args, 'mix', 'spread') as RoleMix;
const seed0 = Math.round(num(args, 'seed', 1));

const threads = Math.max(1, Math.round(num(args, 'threads', availableParallelism())));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const p = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

await main();

async function main() {
  console.log(
    `sim:balance · ${runs} runs per crew · skill ${skill} · mix ${mix} · config ${DEFAULT_GAME_CONFIG.version} #${configHash(DEFAULT_GAME_CONFIG)}`,
  );
  console.log(
    '| crew | clear | Japan fell | timeout | clear time p50/p90 | cities left | SYNC avg | special ok/fb/fail | effective actions (wins) | role skew | assist |',
  );
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  const summary: Record<string, unknown>[] = [];
  const started = Date.now();
  for (const pilots of crews) {
    const seeds = Array.from({ length: runs }, (_, i) => seed0 + i * 7919 + pilots * 31);
    const sims = await runAll({ pilots, skill, mix, seeds }, threads);
    const a = aggregate(sims);
    const clears = sims.filter((s) => s.clearSeconds !== null).map((s) => s.clearSeconds!);
    const winActions = sims.filter((s) => s.outcome === 'SUCCEEDED').map((s) => s.successes);
    const skew = mean(sims.map((s) => s.roleSkew));
    console.log(
      `| ${pilots} | ${pct(a.winRate)} | ${pct(a.citiesLostRate)} | ${pct(a.timeoutRate)} | ${clears.length ? `${p(clears, 0.5)}s / ${p(clears, 0.9)}s` : '—'} | ${a.survivingMean.toFixed(1)} | ${Math.round(a.syncMean)} | ${pct(a.specialActivated)}/${pct(a.specialFallback)}/${pct(a.specialFailed)} | ${winActions.length ? `${Math.round(mean(winActions))} (p10 ${p(winActions, 0.1)})` : '—'} | ${skew.toFixed(2)} | ${Math.round(a.assistMean)} |`,
    );
    summary.push({
      pilots,
      runs,
      skill,
      mix,
      ...a,
      clearP50: p(clears, 0.5),
      clearP90: p(clears, 0.9),
      effectiveActionsWinMean: mean(winActions),
      roleSkewMean: skew,
    });
  }
  console.log(`\n(${((Date.now() - started) / 1000).toFixed(1)} s, ${threads} threads)`);
  const out = args.get('json');
  if (typeof out === 'string') {
    writeFileSync(outPath(out), JSON.stringify(summary, null, 2) + '\n');
    console.log(`json → ${out}`);
  }
}
