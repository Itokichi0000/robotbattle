/**
 * Demo seed `earth-defense-opening` (spec I1), headless:
 *
 *   pnpm demo:seed                       # both routes, timeline + check
 *   pnpm demo:seed --route success --log seed.jsonl
 *
 * Plays the scripted showcase through the real engine and checks that each
 * route ends as designed (success: 神雷風陣 activates and NULL CORE falls;
 * failure: the special fails and the defence fails). Exit code 1 otherwise.
 * To play it live with people: DEMO_MODE=true, /admin → デモシナリオ.
 */
import { writeFileSync } from 'node:fs';
import {
  EARTH_DEFENSE_OPENING,
  runScenarioHeadless,
  type ScenarioRoute,
} from '@sats-wars/game-engine';
import { fmtClock, parseArgs, str, outPath } from './args';
import { RaidLog } from './eventLog';

const args = parseArgs(process.argv.slice(2));
const scenario = EARTH_DEFENSE_OPENING;
const which = str(args, 'route', 'both');
const routes: ScenarioRoute[] =
  which === 'both' ? ['success', 'failure'] : [which as ScenarioRoute];
if (!routes.every((r) => r === 'success' || r === 'failure'))
  throw new Error('--route must be success, failure or both');

let ok = true;
const records: Array<Record<string, unknown>> = [];
for (const route of routes) {
  const log = new RaidLog(60_000);
  const { state, driver } = runScenarioHeadless(scenario, route, (e, s) => log.onEvents(e, s));
  const r = state.result!;
  const expected =
    route === 'success'
      ? r.outcome === 'SUCCEEDED' && r.special === 'ACTIVATED'
      : r.outcome === 'FAILED' && r.special === 'FAILED';
  ok &&= expected;
  console.log(`\n=== ${scenario.id} · ${route} route · seed ${scenario.seed} ===`);
  console.log(`${scenario.titleJa} / ${scenario.titleEn}`);
  console.log('\nScripted moments:');
  for (const [i, beat] of scenario.beats.entries()) {
    if (beat.finale && route === 'failure') continue;
    const done = driver.log.find((l) => l.beat === i && l.what.startsWith('REQUEST'));
    const missed = driver.log.find((l) => l.beat === i && l.what.startsWith('MISSED'));
    console.log(
      `  ${fmtClock(beat.atSeconds * 1000).padStart(5)}  ${done ? '✓' : missed ? '✗' : '·'} ${scenario.bots[beat.bot]!.callsign}: ${beat.noteJa}`,
    );
  }
  if (route === 'failure')
    console.log(
      `  ${fmtClock(scenario.failureIdleFromSeconds * 1000).padStart(5)}  · 以降、指定ミッションを誰も操作しない (crew idle)`,
    );
  console.log('\nRaid log:');
  console.log(log.lines.join('\n'));
  console.log(
    `\nResult: ${r.outcome} (${r.reason}) · 神雷風陣 ${r.special} · cities ${r.survivingCities}/8 · ${expected ? 'as designed ✓' : 'NOT as designed ✗'}`,
  );
  records.push(...log.records.map((x) => ({ route, ...x })));
}
const out = args.get('log');
if (typeof out === 'string') {
  writeFileSync(outPath(out), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`log → ${out}`);
}
process.exit(ok ? 0 : 1);
