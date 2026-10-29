// Screenshots of the pilot console for design review (SATS_WARS_CINEMATIC_UI_SPEC.md §10):
// hangar, battle states and the four station HUDs, from the offline demo, at the spec's sizes.
//
//   pnpm solo && pnpm ui:capture                     # all sizes, all scenes → ui-captures/
//   pnpm ui:capture --sizes 1440x900 --scenes battle # one size, battle states only
//   pnpm ui:capture --file path/to/sats-wars-solo.standalone.html --out before/
//
// Scenes: hangar (registration, station selected, READY), battle (normal, gunner sight, verdict,
// attack warning, final wave, debrief), roles (guardian / router / engineer: hangar, idle, live).
// The raid runs at ?speed=3 so a full raid fits in a few minutes (the hangar at ?speed=0.25, so
// the lobby stays open); the game logic is unchanged.
// Runs one browser at a time (software WebGL is slow; parallel pages time out).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const file = resolve(opt('file', 'apps/solo/dist/sats-wars-solo.standalone.html'));
const out = resolve(opt('out', 'ui-captures'));
const sizes = opt('sizes', '1920x1080,1440x900,390x844')
  .split(',')
  .map((s) => s.split('x').map(Number));
const scenes = opt('scenes', 'hangar,battle,roles').split(',');
const speed = opt('speed', '3');
mkdirSync(out, { recursive: true });

async function open(browser, w, h, pace = speed) {
  const page = await (
    await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  ).newPage();
  page.on('pageerror', (e) => console.log('  page error:', e.message));
  await page.goto(`file://${file}?speed=${pace}`);
  return page;
}

async function register(page) {
  await page.getByTestId('solo-quality-medium').click();
  await page.getByTestId('solo-auto-quality').uncheck();
  await page.getByTestId('solo-start').click();
  await page.getByTestId('hangar').waitFor({ timeout: 30_000 });
}

const waveStarted = (page) =>
  page.waitForFunction(
    () => /0[1-3]|FINAL/.test(document.querySelector('.hud-tm-wave')?.textContent ?? ''),
    null,
    { timeout: 240_000, polling: 1000 },
  );
const sortieReady = (page) =>
  page.waitForFunction(
    () => document.querySelector('[data-testid="sortie"]')?.disabled === false,
    null,
    { timeout: 120_000, polling: 500 },
  );

async function run(name, w, h, body, pace) {
  const browser = await chromium.launch();
  const page = await open(browser, w, h, pace);
  const shot = async (label) => {
    await page.screenshot({ path: `${out}/${w}x${h}-${name}-${label}.png`, timeout: 120_000 });
    console.log(`  ${w}x${h} ${name} ${label}`);
  };
  try {
    await body(page, shot);
  } catch (e) {
    console.log(`  ${w}x${h} ${name} FAILED: ${String(e.message).split('\n')[0]}`);
    await shot('failed').catch(() => {});
  }
  await browser.close();
}

for (const [w, h] of sizes) {
  if (scenes.includes('hangar'))
    await run(
      'hangar',
      w,
      h,
      async (page, shot) => {
        await shot('registration');
        await register(page);
        await page.getByTestId('seat-GUNNER').click();
        await page.waitForTimeout(1200);
        await shot('station');
        await page.getByTestId('board-confirm').click();
        await page.getByTestId('cockpit-wait').waitFor({ timeout: 20_000 });
        await shot('ready');
        // Slow pace: the 15 s lobby (60 s here) is still open on a slow renderer.
      },
      '0.25',
    );
  if (scenes.includes('battle'))
    await run('battle', w, h, async (page, shot) => {
      await register(page);
      await page.getByTestId('seat-GUNNER').click();
      await page.getByTestId('board-confirm').click();
      await page
        .getByTestId('launch-now')
        .click({ timeout: 8000 })
        .catch(() => {});
      await waveStarted(page);
      await sortieReady(page);
      await page.waitForTimeout(1500);
      await shot('normal');
      await page.getByTestId('sortie').click();
      await page.getByTestId('minigame').waitFor({ timeout: 30_000 });
      await shot('gunner-sight');
      await page
        .locator('[data-testid="gunner-reticle"][data-locked="1"]')
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
      await page
        .getByTestId('gunner-fire')
        .click({ timeout: 5000 })
        .catch(() => {});
      await page
        .getByTestId('task-result')
        .waitFor({ timeout: 30_000 })
        .then(() => shot('verdict'))
        .catch(() => console.log('  (no verdict: the shot was too late on this renderer)'));
      await page.locator('.hud-warn-main:not(.is-calm)').waitFor({ timeout: 180_000 });
      await shot('warning');
      await page.waitForFunction(
        () => /FINAL/.test(document.querySelector('.hud-tm-wave')?.textContent ?? ''),
        null,
        { timeout: 600_000, polling: 2000 },
      );
      await page.waitForTimeout(4000);
      await shot('final-wave');
      await page.getByTestId('result-card').waitFor({ timeout: 600_000 });
      await page.waitForTimeout(1500);
      await shot('debrief');
    });
  if (scenes.includes('roles'))
    for (const role of ['GUARDIAN', 'ROUTER', 'ENGINEER'])
      await run(role.toLowerCase(), w, h, async (page, shot) => {
        await register(page);
        await page.getByTestId(`seat-${role}`).click();
        await page.waitForTimeout(800);
        await shot('hangar');
        await page.getByTestId('board-confirm').click();
        await page
          .getByTestId('launch-now')
          .click({ timeout: 8000 })
          .catch(() => {});
        await waveStarted(page);
        await sortieReady(page);
        await page.waitForTimeout(1000);
        await shot('idle');
        await page.getByTestId('sortie').click();
        await page.getByTestId('minigame').waitFor({ timeout: 30_000 });
        await shot('live');
      });
}
console.log(`screenshots in ${out}`);
