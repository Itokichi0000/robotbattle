// Plays one D-033 crowd round against a running sandbox server and captures screenshots for
// docs/05_qa_results.md: the big-screen lobby / battle / Lightning moment / result, a phone in
// the lobby, on the three buttons and on the 21 sats sheet, and the operator panel.
//
//   OPERATOR_PASSWORD=... pnpm exec tsx tools/perf/capture-d033.ts [baseUrl] [outDir]
//
// Software WebGL (CI containers) runs a few FPS: captures check composition and state, not FPS.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, devices, type Page } from '@playwright/test';
import type { PublicMatchState } from '../../packages/shared/src/index';

const base = process.argv[2] ?? 'http://localhost:4400';
const out = path.resolve(process.argv[3] ?? 'docs/qa/d033');
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

const displayBrowser = await chromium.launch({ args: gpuArgs });
const browser = await chromium.launch();

const opCtx = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1100 } });
const login = await opCtx.request.post('/api/operator/login', {
  data: { password },
  headers: { origin: base },
});
if (!login.ok()) throw new Error(`operator login failed: ${login.status()}`);
const op = await opCtx.newPage();
op.on('dialog', (d) => void d.accept());
await op.goto('/operator/');
await op.waitForSelector('text=今の状態 NOW');

async function state(): Promise<PublicMatchState> {
  const r = await op.request.get('/api/public/match');
  return ((await r.json()) as { state: PublicMatchState }).state;
}
async function until(what: string, ok: (s: PublicMatchState) => boolean, ms = 180_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await state();
    if (ok(s)) return s;
    await sleep(400);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const opButton = (name: RegExp) => op.getByRole('button', { name }).first();
async function pause(on: boolean) {
  const s = await state();
  if (s.phase !== 'BATTLE' || s.paused === on) return;
  await opButton(on ? /PAUSE/ : /RESUME/).click();
  await until(on ? 'pause' : 'resume', (x) => x.paused === on, 10_000);
}

// Start clean: a fresh lobby, no auto start (we launch by hand once the phone is in).
await opButton(/RESET/).click();
await sleep(1_500);

const display = await (
  await displayBrowser.newContext({ viewport: { width: 1280, height: 720 }, baseURL: base })
).newPage();
display.on('pageerror', (e) => log('display error', e.message.slice(0, 200)));
await display.goto('/display/?q=BALANCED&capture=1');
await display.waitForSelector('.stage canvas', { timeout: 90_000 });

async function bigShot(name: string) {
  const s = await state();
  const live = s.phase === 'BATTLE' && !s.paused;
  if (live) await pause(true);
  await sleep(1_200);
  await display.screenshot({ path: path.join(out, name), ...SHOT });
  if (live) await pause(false);
  log('shot', name);
}
async function phoneShot(p: Page, name: string) {
  await p.screenshot({ path: path.join(out, name) });
  log('shot', name);
}

// One human phone, DEMO GUEST sign-in.
const pctx = await browser.newContext({ ...devices['iPhone 13'], baseURL: base });
const phone = await pctx.newPage();
phone.on('pageerror', (e) => log('phone error', e.message.slice(0, 200)));
await phone.goto('/pilot/?capture=1');
await phone.getByRole('button', { name: /DEMO GUEST/ }).click();
await phone.waitForSelector('text=参加しました');

// Demo bots fill the crowd. Auto settle stays off: the VIRTUAL 21 sats is settled from the
// operator's sats table, which is what staff do at the booth.
const bots = op.getByLabel(/DEMO BOTS/);
if (!(await bots.isChecked())) await bots.check();
await until('bots', (s) => s.players >= 5, 20_000);
await sleep(1_000);
await phoneShot(phone, '10_phone_lobby.png');
await bigShot('01_display_lobby.png');
await op.screenshot({ path: path.join(out, '30_operator_lobby.png'), fullPage: true });

// Auto start may already have launched it during the slow big-screen shot.
if ((await state()).phase === 'LOBBY') await opButton(/START/).click();
await until('battle', (s) => s.phase === 'BATTLE', 60_000);
await sleep(3_000);

// Wait for a city warning so the threat call is on screen.
await until('city threat', (s) => s.threats.some((t) => t.target.type === 'CITY'), 40_000);
await sleep(1_500);
await bigShot('02_display_battle_threat.png');

// The phone presses the lit button a few times, then opens the 21 sats sheet.
for (let i = 0; i < 4; i++) {
  await phone
    .locator('.act.rec .act-free')
    .click()
    .catch(() => undefined);
  await sleep(800);
}
await phoneShot(phone, '11_phone_battle.png');
// Phone shots are quick (no WebGL on the phone), so these run live: the paid button is off
// while the fight is paused.
await phone.locator('.act.rec .act-paid').click();
await sleep(600);
await phoneShot(phone, '12_phone_paysheet_confirm.png');
await phone
  .getByRole('button', { name: /送る|支払う|確定|進む|OK/ })
  .first()
  .click();
await sleep(1_200);
await phoneShot(phone, '13_phone_paysheet_pending.png');

// Staff settle the VIRTUAL intent; the big screen shows the Lightning moment.
await op.getByRole('button', { name: 'SETTLE' }).first().click();
await until('lightning', (s) => s.stats.virtual + s.stats.lightning > 0, 15_000);
await sleep(500);
await bigShot('03_display_lightning_moment.png');
await phoneShot(phone, '14_phone_paid_done.png');
await phone
  .getByRole('button', { name: '閉じる' })
  .click()
  .catch(() => undefined);
await op.screenshot({ path: path.join(out, '31_operator_battle.png'), fullPage: true });

// Keep pressing the lit button until the round ends.
const end = Date.now() + 200_000;
while (Date.now() < end) {
  const s = await state();
  if (s.phase !== 'BATTLE') break;
  await phone
    .locator('.act.rec .act-free')
    .click({ timeout: 2_000 })
    .catch(() => undefined);
  await sleep(750);
}
const fin = await until('results', (s) => s.phase === 'RESULTS', 60_000);
log('result', fin.result?.outcome, fin.result?.reason, 'boss', fin.boss?.hp, '/', fin.boss?.maxHp);
await sleep(2_000);
await bigShot('04_display_results.png');
await phoneShot(phone, '15_phone_debrief.png');

await bots.uncheck();
await displayBrowser.close();
await browser.close();
log('done', out);
