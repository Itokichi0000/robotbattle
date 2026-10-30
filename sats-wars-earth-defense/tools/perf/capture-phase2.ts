// Plays a Phase 2–4 sortie against a running sandbox server and captures screenshots for
// docs/05_qa_results.md: LNURL-auth sign-in (test wallet), all four phone consoles, the
// VIRTUAL energy pulse, demo bots, OVERDRIVE on the big screen, and the operator panels.
//
//   OPERATOR_PASSWORD=... pnpm exec tsx tools/perf/capture-phase2.ts [baseUrl] [outDir]
//
// Software WebGL (CI containers) runs a few FPS: captures check composition and state.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, devices, type Page } from '@playwright/test';
import { signedCallback } from '../../apps/server/src/testWallet';
import { solvePuzzle } from '../../packages/game-engine/src/router';
import type { PowerLane, PublicMatchState } from '../../packages/shared/src/index';

const base = process.argv[2] ?? 'http://localhost:4400';
const out = path.resolve(process.argv[3] ?? 'docs/qa/phase2');
const password = process.env.OPERATOR_PASSWORD;
if (!password) {
  console.error('Set OPERATOR_PASSWORD to the server operator password.');
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const gpuArgs = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];
const SHOT = { timeout: 240_000 };
const LANES: PowerLane[] = ['weapon', 'shield', 'mobility', 'repair'];
const LANE_JA: Record<PowerLane, string> = {
  weapon: '武器系',
  shield: 'シールド系',
  mobility: '機動系',
  repair: '修理系',
};

const displayBrowser = await chromium.launch({ args: gpuArgs });
const browser = await chromium.launch({ args: gpuArgs });

const opCtx = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1100 } });
const login = await opCtx.request.post('/api/operator/login', {
  data: { password },
  headers: { origin: base },
});
if (!login.ok()) throw new Error(`operator login failed: ${login.status()}`);
const op = await opCtx.newPage();
op.on('dialog', (d) => void d.accept());
await op.goto('/operator/');
await op.waitForSelector('text=MATCH CONTROL');
// Start clean: no demo bots left over from an earlier run, an empty mech.
if (await op.getByLabel(/DEMO BOTS/).isChecked()) await op.getByLabel(/DEMO BOTS/).uncheck();
await op.getByRole('button', { name: /^RESET$/ }).click();
await sleep(1_500);

async function state(): Promise<PublicMatchState> {
  const r = await op.request.get('/api/public/match');
  return ((await r.json()) as { state: PublicMatchState }).state;
}

const display = await (
  await displayBrowser.newContext({ viewport: { width: 1280, height: 720 }, baseURL: base })
).newPage();
await display.goto('/display/?q=BALANCED&capture=1');
await display.waitForSelector('.stage canvas', { timeout: 60_000 });

async function frozenShot(name: string) {
  const s = await state();
  const live = ['COUNTDOWN', 'DEPLOYMENT', 'WAVE_1', 'WAVE_2', 'BOSS'].includes(s.phase);
  if (live && !s.paused) await op.getByRole('button', { name: /PAUSE/ }).click();
  await sleep(1_500);
  await display.screenshot({ path: path.join(out, name), ...SHOT });
  if (live && !s.paused) await op.getByRole('button', { name: /RESUME/ }).click();
}

async function phone(): Promise<Page> {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], baseURL: base });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => log('phone error', e.message.slice(0, 200)));
  await p.goto('/pilot/');
  return p;
}

async function board(p: Page, seat: RegExp) {
  await p.waitForSelector('text=搭乗する席を選ぶ');
  await p.getByRole('button', { name: seat }).click();
  await p.waitForSelector('text=搭乗完了');
  await p.getByRole('button', { name: /READY/ }).click();
  await p.waitForSelector('text=出撃待機中');
}

// LNURL-auth: the gunner signs in with the test wallet (the server verifies the signature).
const gunner = await phone();
await gunner.screenshot({ path: path.join(out, '10_phone_join.png') });
await gunner.getByRole('button', { name: /Lightningウォレットで認証/ }).click();
await gunner.getByRole('button', { name: /別の端末で読む/ }).click();
await sleep(500);
await gunner.screenshot({ path: path.join(out, '11_phone_lnurl_pending.png'), fullPage: true });
const href = await gunner
  .getByRole('link', { name: /ウォレットを開いて承認/ })
  .getAttribute('href');
const cb = await gunner.request.get(signedCallback(href!, `capture wallet ${Date.now()}`));
log('wallet callback', await cb.json());
await gunner.waitForSelector('text=搭乗する席を選ぶ', { timeout: 20_000 });
await gunner.getByRole('button', { name: /コールサインを設定/ }).click();
await gunner.getByLabel(/コールサイン（2〜12文字/).fill('RAIJIN_FAN');
await gunner.getByLabel(/大画面に表示する/).check();
await gunner.getByRole('button', { name: '保存' }).click();
await sleep(600);
await gunner.screenshot({
  path: path.join(out, '12_phone_seat_select_callsign.png'),
  fullPage: true,
});
await board(gunner, /砲撃 右/);

const guest = async (seat: RegExp) => {
  const p = await phone();
  await p.getByRole('button', { name: /DEMO GUEST/ }).click();
  await board(p, seat);
  return p;
};
const power = await guest(/電力 A/);
const router = await guest(/電力 B/);
const engineer = await guest(/整備 A/);

await op.getByLabel(/DEMO BOTS/).check();
await sleep(4_000);
await display.screenshot({ path: path.join(out, '01_display_lobby_bots.png'), ...SHOT });
await op.screenshot({ path: path.join(out, '30_operator_lobby.png'), fullPage: true });
log('lobby captured');

if ((await state()).phase === 'LOBBY') await op.getByRole('button', { name: /START/ }).click();
while ((await state()).phase !== 'WAVE_1') await sleep(500);
await sleep(2_000);

// POWER A: one-tap plan.
await power.getByRole('button', { name: /攻撃重視/ }).click();
await sleep(300);
await frozenShot('02_display_power_routed.png');
await power.getByRole('button', { name: '武器系 を5%上げる' }).click();
await power.getByRole('button', { name: '機動系 を5%下げる' }).click();
await power.screenshot({ path: path.join(out, '13_phone_power_a.png') });
log('power captured');

let shotRouter = false;
let shotRouterSolved = false;
let shotEngineer = false;
let shotPulse = false;
let shotOdReady = false;
let shotOdFired = false;
let shotBoss = false;
let lastOverdrives = 0;
const deadline = Date.now() + 360_000;
while (Date.now() < deadline) {
  const s = await state();
  if (['VICTORY', 'DEFEAT', 'RESULTS'].includes(s.phase)) break;
  const cut = LANES.find((l) => s.circuits[l].broken);
  if (cut && !shotRouterSolved) {
    const puzzle = s.circuits[cut].puzzle!;
    await router.getByRole('tab', { name: new RegExp(LANE_JA[cut]) }).click();
    if (!shotRouter) {
      await router.screenshot({ path: path.join(out, '14_phone_router_overload.png') });
      await frozenShot('03_display_overload.png');
      shotRouter = true;
    }
    const target = solvePuzzle(puzzle);
    if (target) {
      for (let i = 0; i < 9; i++) {
        const turns = (((target[i]! - puzzle.tiles[i]!.rot) % 4) + 4) % 4;
        for (let k = 0; k < turns; k++)
          await router.getByRole('button', { name: `タイル ${i + 1} を回す` }).click();
      }
      await router.screenshot({ path: path.join(out, '15_phone_router_connected.png') });
      await router.getByRole('button', { name: /接続する/ }).click();
      shotRouterSolved = true;
      log('router solved');
    }
  }
  const eng = s.engineers.ENGINEER_LEGS;
  if (
    !shotEngineer &&
    !eng.job &&
    (s.parts.LEG_L < 95 || s.parts.LEG_R < 95) &&
    s.t >= eng.cooldownUntil
  ) {
    await engineer.screenshot({ path: path.join(out, '16_phone_engineer_scan.png') });
    await engineer
      .getByRole('button', { name: /修理実行/ })
      .click()
      .catch(() => undefined);
    await sleep(400);
    await engineer
      .getByRole('button', { name: 'ボルト 1' })
      .click()
      .catch(() => undefined);
    await engineer.screenshot({ path: path.join(out, '17_phone_engineer_bolts.png') });
    await engineer
      .getByRole('button', { name: 'ボルト 2' })
      .click()
      .catch(() => undefined);
    await engineer
      .getByRole('button', { name: 'ボルト 3' })
      .click()
      .catch(() => undefined);
    await sleep(300);
    await frozenShot('04_display_repair.png');
    shotEngineer = true;
    log('repair captured');
  }
  // A pulse is only offered while CHARGE has room (it is refused when full).
  if (!shotPulse && s.teamCapacitor <= s.hints.overdriveCapacitorMin - 30) {
    await gunner.getByRole('button', { name: '共有エネルギー' }).click();
    await sleep(800);
    await gunner.screenshot({ path: path.join(out, '18_phone_pulse_terms.png') });
    await gunner.getByRole('button', { name: /VIRTUAL パルスを申請/ }).click();
    await sleep(1_000);
    await gunner.screenshot({ path: path.join(out, '19_phone_pulse_virtual_invoice.png') });
    await op.screenshot({
      path: path.join(out, '31_operator_payments_pending.png'),
      fullPage: true,
    });
    await op.locator('.payments').getByRole('button', { name: 'SETTLE' }).click();
    await sleep(700);
    await frozenShot('05_display_sats_pulse.png');
    await sleep(1_500);
    await gunner.screenshot({ path: path.join(out, '20_phone_pulse_applied.png') });
    await gunner.getByRole('button', { name: '閉じる' }).click();
    shotPulse = true;
    log('pulse captured');
  }
  if (
    !shotBoss &&
    s.phase === 'BOSS' &&
    s.boss &&
    s.enemies.some((e) => e.kind === 'NULL_CORE' && e.arrivesAt + 3_500 < s.t)
  ) {
    await frozenShot('06_display_boss.png');
    shotBoss = true;
  }
  if (!shotOdReady && s.overdrive.status !== 'IDLE') {
    await frozenShot('07_display_overdrive_ready.png');
    await power.screenshot({ path: path.join(out, '21_phone_overdrive_call.png') });
    await power
      .getByRole('button', { name: /SYNC NOW/ })
      .click()
      .catch(() => undefined);
    shotOdReady = true;
    log('overdrive ready captured');
  }
  if (!shotOdFired && s.stats.overdrives > lastOverdrives) {
    await frozenShot('08_display_overdrive_fired.png');
    // Capture mode runs effects 12× slower: the beam leaves the core ~1 s (fx time) after
    // the convergence starts. Hold the server paused while it plays out.
    await op.getByRole('button', { name: /PAUSE/ }).click();
    await sleep(12_500);
    await display.screenshot({ path: path.join(out, '08b_display_overdrive_beam.png'), ...SHOT });
    await op.getByRole('button', { name: /RESUME/ }).click();
    shotOdFired = true;
    log('overdrive fired captured');
  }
  lastOverdrives = s.stats.overdrives;
  await sleep(250);
}
log({ shotRouter, shotRouterSolved, shotEngineer, shotPulse, shotBoss, shotOdReady, shotOdFired });
while (!['RESULTS'].includes((await state()).phase)) await sleep(1_000);
await sleep(3_000);
await display.screenshot({ path: path.join(out, '09_display_results.png'), ...SHOT });
await power.screenshot({ path: path.join(out, '22_phone_debrief.png') });
await op.screenshot({ path: path.join(out, '32_operator_after.png'), fullPage: true });
const s = await state();
console.log(JSON.stringify({ result: s.result, stats: s.stats }, null, 2));
await op.getByLabel(/DEMO BOTS/).uncheck();
await browser.close();
await displayBrowser.close();
log('done →', out);
