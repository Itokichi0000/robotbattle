// Plays the Phase 1 vertical slice against a running server and captures screenshots:
// big screen (1920×1080) + two phones (390×844) + operator. Used for docs/05_qa_results.md.
//
//   OPERATOR_PASSWORD=... node tools/perf/capture-phase1.mjs [baseUrl] [outDir]
//
// WebGL runs on whatever the browser has (in CI containers: SwiftShader, a few FPS), so
// captures check composition and state, not frame rate.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, devices } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:4400';
const out = path.resolve(process.argv[3] ?? 'docs/qa/phase1');
const password = process.env.OPERATOR_PASSWORD;
if (!password) {
  console.error('Set OPERATOR_PASSWORD to the server operator password.');
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const quality = process.env.DISPLAY_QUALITY ?? 'BALANCED';
const gpuArgs = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required',
];
// The big screen gets its own browser process so software WebGL does not starve the phones.
const displayBrowser = await chromium.launch({ args: gpuArgs });
const browser = await chromium.launch({ args: gpuArgs });
const SHOT = { timeout: 240_000 };

async function operatorApi() {
  const ctx = await browser.newContext({ baseURL: base });
  const res = await ctx.request.post('/api/operator/login', {
    data: { password },
    headers: { origin: base },
  });
  if (!res.ok()) throw new Error(`operator login failed: ${res.status()}`);
  const page = await ctx.newPage();
  await page.goto('/operator/');
  await page.waitForSelector('text=MATCH CONTROL');
  return { ctx, page };
}

/** Freezes the server clock while the slow software renderer takes the shot. */
async function frozenShot(name) {
  const phase = await display.evaluate(() => window.__sw?.store.getState().snap?.phase);
  const live = ['COUNTDOWN', 'DEPLOYMENT', 'WAVE_1', 'WAVE_2', 'BOSS'].includes(phase);
  if (live) await click(op, /PAUSE/);
  await sleep(1_500);
  await display.screenshot({ path: path.join(out, name), ...SHOT });
  if (live) await click(op, /RESUME/);
}

async function click(page, text) {
  await page.getByRole('button', { name: text }).first().click();
}

// 1280×720 keeps software rendering tolerable; the HUD is laid out at 1920×1080 and scales.
const display = await (
  await displayBrowser.newContext({ viewport: { width: 1280, height: 720 }, baseURL: base })
).newPage();
display.on(
  'console',
  (m) => m.type() === 'error' && log('display console:', m.text().slice(0, 200)),
);
await display.goto(`/display/?q=${quality}&capture=1`);
await display.waitForSelector('.stage canvas', { timeout: 60_000 });
await sleep(6_000);
await display.screenshot({ path: path.join(out, '01_display_attract.png'), ...SHOT });
log('attract captured');

const { page: op } = await operatorApi();
op.on('dialog', (d) => void d.accept());

const phones = [];
for (const [name, seatLabel] of [
  ['gunner', /砲撃 左/],
  ['guard', /防衛 左/],
]) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], baseURL: base });
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && log(`${name} console:`, m.text().slice(0, 200)));
  await p.goto('/pilot/');
  await p.getByRole('button', { name: /DEMO GUEST/ }).click();
  await p.waitForSelector('text=搭乗する席を選ぶ');
  if (name === 'gunner')
    await p.screenshot({ path: path.join(out, '10_phone_seat_select.png'), fullPage: true });
  await p.getByRole('button', { name: seatLabel }).click();
  await p.waitForSelector('text=搭乗完了');
  await p.getByRole('button', { name: /READY/ }).click();
  await p.waitForSelector('text=出撃待機中');
  phones.push({ name, p });
}
await phones[0].p.screenshot({ path: path.join(out, '11_phone_ready_room.png') });
await sleep(4_000);
await display.screenshot({ path: path.join(out, '02_display_lobby_hangar.png'), ...SHOT });
await op.screenshot({ path: path.join(out, '30_operator_lobby.png'), fullPage: true });
log('lobby captured');

await click(op, /START/);
await sleep(4_200);
await frozenShot('03_display_deploy_launch.png');
await sleep(3_000);
await frozenShot('04_display_deploy_landing.png');
log('deployment captured');
await display.waitForFunction(() => window.__sw?.store.getState().snap?.phase === 'WAVE_1', null, {
  timeout: 30_000,
});
await sleep(3_500);

const [gunner, guard] = phones.map((x) => x.p);
// Gunner: LOCK → CHARGE → FIRE.
await gunner.getByRole('button', { name: /ロックオン/ }).click();
await sleep(2_000);
await gunner.screenshot({ path: path.join(out, '12_phone_gunner_charged.png') });
await gunner.getByRole('button', { name: /発射/ }).click();
await sleep(400);
await frozenShot('05_display_battle_fire.png');
log('fire captured');

// Both phones keep playing like attentive pilots: the gunner cycles LOCK/FIRE, the guard
// deploys inside the guard window. Captures happen at milestones along the way.
const phaseOf = () => display.evaluate(() => window.__sw?.store.getState().snap?.phase);
let shotIncoming = false;
let shotBlock = false;
let shotWide = false;
let shotBoss = false;
let lastGunnerTap = 0;
const deadline = Date.now() + 330_000;
while (Date.now() < deadline) {
  const phase = await phaseOf();
  if (phase === 'VICTORY' || phase === 'DEFEAT' || phase === 'RESULTS') break;
  const lead = await guard.evaluate(() => {
    const st = document.querySelector('.next-threat b')?.textContent;
    return st ? parseFloat(st) : null;
  });
  const deployBtn = guard.getByRole('button', { name: /シールド展開|DEPLOY SHIELD/ });
  if (lead !== null && lead < 1.0 && (await deployBtn.isEnabled().catch(() => false))) {
    await deployBtn.click().catch(() => undefined);
    if (!shotBlock) {
      await sleep(250);
      await guard.screenshot({ path: path.join(out, '13_phone_defense_deployed.png') });
      // Let the strike land on the shield, then freeze and capture the block.
      await sleep(Math.max(0, lead * 1000 - 250) + 200);
      await frozenShot('06_display_shield_block.png');
      shotBlock = true;
    }
  } else if (lead !== null && lead < 3.2 && lead > 1.8 && !shotIncoming) {
    await guard.screenshot({ path: path.join(out, '14_phone_defense_incoming.png') });
    shotIncoming = true;
  }
  if (Date.now() - lastGunnerTap > 1_200) {
    lastGunnerTap = Date.now();
    await gunner
      .getByRole('button', { name: /ロックオン|発射/ })
      .first()
      .click({ timeout: 500 })
      .catch(() => undefined);
  }
  if (!shotWide && phase === 'WAVE_2') {
    await frozenShot('07_display_battle_wide.png');
    await op.screenshot({ path: path.join(out, '31_operator_battle.png'), fullPage: true });
    shotWide = true;
  }
  if (!shotBoss && phase === 'BOSS') {
    const bossUp = await display.evaluate(() => {
      const s = window.__sw.store.getState().snap.state;
      return !!s.boss && s.enemies.some((e) => e.kind === 'NULL_CORE' && e.arrivesAt + 3500 < s.t);
    });
    if (bossUp) {
      await frozenShot('08_display_boss.png');
      await gunner.screenshot({ path: path.join(out, '15_phone_gunner_boss.png') });
      shotBoss = true;
    }
  }
  await sleep(120);
}
log('battle loop done', { shotIncoming, shotBlock, shotWide, shotBoss });
if (!['VICTORY', 'DEFEAT', 'RESULTS'].includes(await phaseOf())) {
  await click(op, /END/).catch(() => undefined);
}
await display
  .waitForFunction(
    () => ['VICTORY', 'DEFEAT', 'RESULTS'].includes(window.__sw?.store.getState().snap?.phase),
    null,
    { timeout: 60_000 },
  )
  .catch(() => undefined);
await sleep(2_500);
await display.screenshot({ path: path.join(out, '09a_display_finish.png'), ...SHOT });
await display
  .waitForFunction(() => window.__sw?.store.getState().snap?.phase === 'RESULTS', null, {
    timeout: 60_000,
  })
  .catch(() => undefined);
await sleep(2_000);
await display.screenshot({ path: path.join(out, '09b_display_results.png'), ...SHOT });
await gunner.screenshot({ path: path.join(out, '16_phone_debrief.png') });

const stats = await display.evaluate(() => {
  const s = window.__sw.store.getState().snap.state;
  return {
    phase: s.phase,
    stats: s.stats,
    core: s.coreHp,
    sync: s.teamSync,
    seats: Object.fromEntries(Object.entries(s.seats).map(([k, v]) => [k, v.stats])),
  };
});
console.log(JSON.stringify(stats, null, 2));
await browser.close();
await displayBrowser.close();
log('done →', out);
