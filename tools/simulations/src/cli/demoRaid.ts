/**
 * One simulated raid with a log (spec I2):
 *
 *   pnpm demo:raid --pilots 10 --success-rate 0.65 --seed 42
 *   pnpm demo:raid --pilots 30 --mix random --log raid.jsonl
 *
 * Bots play the real engine with the same solver as the server's demo bots.
 * Prints status lines every 30 s of game time and the story events; --log
 * writes them as JSON lines, --quiet prints only the result.
 */
import { writeFileSync } from 'node:fs';
import { configHash, DEFAULT_GAME_CONFIG } from '@sats-wars/shared';
import { type RoleMix, simulateRaid } from '../simulate';
import { num, parseArgs, str, outPath } from './args';
import { RaidLog } from './eventLog';

const MIXES: RoleMix[] = ['spread', 'random', 'gunners', 'no-support'];
const args = parseArgs(process.argv.slice(2));
if (args.has('help')) {
  console.log(
    'usage: pnpm demo:raid [--pilots 10] [--success-rate 0.65] [--seed 42] [--mix spread|random|gunners|no-support] [--log out.jsonl] [--quiet]',
  );
  process.exit(0);
}
const pilots = Math.max(1, Math.min(1000, Math.round(num(args, 'pilots', 10))));
const skill = Math.max(0, Math.min(1, num(args, 'success-rate', 0.65)));
const seed = Math.round(num(args, 'seed', 42));
const mix = str(args, 'mix', 'spread') as RoleMix;
if (!MIXES.includes(mix)) throw new Error(`--mix must be one of ${MIXES.join(', ')}`);

const log = new RaidLog(30_000);
const sim = simulateRaid({ pilots, skill, seed, mix, onEvents: (e, s) => log.onEvents(e, s) });

if (!args.has('quiet')) {
  console.log(
    `SATS WARS demo raid · ${pilots} bots (${mix}) · success rate ${skill} · seed ${seed} · config ${DEFAULT_GAME_CONFIG.version} #${configHash(DEFAULT_GAME_CONFIG)}`,
  );
  console.log(log.lines.join('\n'));
  console.log('');
}
console.log(
  JSON.stringify(
    {
      outcome: sim.outcome,
      reason: sim.reason,
      survivingCities: sim.survivingCities,
      clearSeconds: sim.clearSeconds,
      special: sim.special,
      specialAtSeconds: sim.specialAtSeconds,
      bossHpLeft: Math.round(sim.bossHpLeftRatio * 100) / 100,
      syncAverage: Math.round(sim.syncAverage),
      tasks: sim.tasks,
      effectiveActions: sim.successes,
      roleSkew: Math.round(sim.roleSkew * 100) / 100,
      assistActions: sim.assistActions,
      score: sim.score,
    },
    null,
    2,
  ),
);
const out = args.get('log');
if (typeof out === 'string') {
  writeFileSync(outPath(out), log.records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`log → ${out} (${log.records.length} lines)`);
}
