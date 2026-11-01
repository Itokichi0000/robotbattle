// Plays one crowd round (D-033, space setting D-034) against a running sandbox server and captures screenshots for
// docs/05_qa_results.md: the big-screen lobby / battle / Lightning moment / result, a phone in
// the lobby, on the three buttons and on the 21 sats sheet, and the operator panel.
//
//   OPERATOR_PASSWORD=... pnpm exec tsx tools/perf/capture-crowd.ts [baseUrl] [outDir]
//
// Software WebGL (CI containers) runs a few FPS: captures check composition and state, not FPS.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, devices, type Page } from '@playwright/test';
import { routeProgress } from '../../packages/shared/src/index';
import type { PublicMatchState } from '../../packages/shared/src/index';

const base = process.argv[2] ?? 'http://localhost:4400';
const out = path.resolve(process.argv[3] ?? 'docs/qa/crowd');
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
const HOLDABLE = ['COUNTDOWN', 'DEPLOYMENT', 'BATTLE'];
async function pause(on: boolean) {
  const s = await state();
  if (!HOLDABLE.includes(s.phase) || s.paused === on) return;
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
  const live = HOLDABLE.includes(s.phase) && !s.paused;
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

// The group launch: the phone swipes up (the button does the same), bots follow.
await until('launch', (s) => s.phase === 'COUNTDOWN' || s.phase === 'DEPLOYMENT', 60_000);
await phone.getByRole('button', { name: /発進ボタン/ }).click();
await sleep(1_500);
await phoneShot(phone, '11_phone_launch.png');
await until('deployment', (s) => s.phase === 'DEPLOYMENT' || s.phase === 'BATTLE', 30_000);
if ((await state()).phase === 'DEPLOYMENT') await bigShot('02_display_launch.png');
await until('battle', (s) => s.phase === 'BATTLE', 60_000);
await sleep(2_000);

/** The phone plays its team's screen: hit whatever target is on the field. */
async function playFor(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = phone.locator('.arena .tgt:not(.boom)').first();
    if (await t.count()) await t.dispatchEvent('pointerdown').catch(() => undefined);
    await sleep(750);
  }
}

// Wait for a squad warning so the threat call is on screen.
await playFor(2_000);
await until('squad threat', (s) => s.threats.some((t) => t.target.type === 'SQUAD'), 40_000);
await sleep(1_000);
await bigShot('03_display_battle_threat.png');
await phoneShot(phone, '12_phone_battle.png');

// The phone calls the thunder: the confirm sheet, the VIRTUAL invoice.
await phone.getByRole('button', { name: /21 sats で雷を呼ぶ/ }).click();
await sleep(600);
await phoneShot(phone, '13_phone_thunder_sheet.png');
await phone.getByRole('button', { name: /sats を送る/ }).click();
await sleep(1_200);
await phoneShot(phone, '14_phone_thunder_pending.png');

// Staff settle the VIRTUAL intent: THUNDER MODE on the big screen, the bolt on the phone.
await op.getByRole('button', { name: 'SETTLE' }).first().click();
await until('lightning', (s) => s.feverUntil > s.t, 15_000);
await phone.waitForSelector('text=雷を落とせ！', { timeout: 10_000 });
await phoneShot(phone, '15_phone_bolt_aim.png');
await bigShot('04_display_thunder_mode.png');
await phone.locator('.bolt-core').click({ force: true });
await until('bolt', (s) => s.stats.bolts > 0, 15_000);
await sleep(300);
await phoneShot(phone, '16_phone_bolt_result.png');
await bigShot('05_display_bolt.png');
await playFor(2_500);
await phoneShot(phone, '17_phone_thunder_play.png');
await op.screenshot({ path: path.join(out, '31_operator_battle.png'), fullPage: true });

// The bots carry on alone from here, so the fight lasts long enough to fly past the Moon
// toward Earth (D-034). One shot as the mothership enters each later area, if the round is
// still on by then.
const progress = (s: PublicMatchState) => routeProgress(s, s.hints.battleMs);
for (const [name, from] of [
  ['06_display_moon_sector.png', 0.34],
  ['07_display_earth_orbit.png', 0.675],
] as const) {
  const s = await until(name, (x) => x.phase !== 'BATTLE' || progress(x) >= from, 200_000);
  if (s.phase !== 'BATTLE') break;
  await bigShot(name);
}
const fin = await until('results', (s) => s.phase === 'RESULTS', 200_000);
log('result', fin.result?.outcome, fin.result?.reason, 'boss', fin.boss?.hp, '/', fin.boss?.maxHp);
await sleep(2_000);
await bigShot('08_display_results.png');
await phoneShot(phone, '18_phone_debrief.png');

await bots.uncheck();
await displayBrowser.close();
await browser.close();
log('done', out);
