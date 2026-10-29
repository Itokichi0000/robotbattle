import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import type { MatchSnapshotMsg } from '@swed/shared';
import { BASE, OPERATOR_PASSWORD } from './playwright.config';

/**
 * PHASE 1 acceptance: two phones in different roles drive one RAIJIN; the big screen and
 * the server agree. Every assertion about outcomes reads the server's public state.
 */

async function publicMatch(page: Page): Promise<MatchSnapshotMsg> {
  const res = await page.request.get(`${BASE}/api/public/match`);
  return (await res.json()) as MatchSnapshotMsg;
}

async function phone(browser: Browser, seat: RegExp): Promise<Page> {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  await p.goto('/pilot/');
  await p.getByRole('button', { name: /DEMO GUEST/ }).click();
  await expect(p.getByText('搭乗する席を選ぶ')).toBeVisible();
  await p.getByRole('button', { name: seat }).click();
  await expect(p.getByText('搭乗完了')).toBeVisible();
  await p.getByRole('button', { name: /READY/ }).click();
  await expect(p.getByText(/出撃待機中/)).toBeVisible();
  return p;
}

test('two phones, one mech: gunner damages on the server, shield blocks a telegraphed strike', async ({
  browser,
}) => {
  const operatorCtx = await browser.newContext();
  const login = await operatorCtx.request.post(`${BASE}/api/operator/login`, {
    data: { password: OPERATOR_PASSWORD },
    headers: { origin: BASE },
  });
  expect(login.ok()).toBe(true);
  const op = await operatorCtx.newPage();
  op.on('dialog', (d) => void d.accept());
  await op.goto('/operator/');
  await expect(op.getByText('MATCH CONTROL')).toBeVisible();
  await expect(op.getByText(/SANDBOX/)).toBeVisible();

  const display = await (
    await browser.newContext({ viewport: { width: 1280, height: 720 } })
  ).newPage();
  await display.goto('/display/?q=SAFE');
  await expect(display.locator('.stage canvas')).toBeVisible({ timeout: 60_000 });
  await expect(display.getByText('SCAN TO BECOME A PILOT')).toBeVisible();
  await expect(display.locator('img[src="/api/public/join.svg"]')).toBeVisible();

  const gunner = await phone(browser, /砲撃 左/);
  const guard = await phone(browser, /防衛 左/);

  // The big screen lights the two stations; the match moved from ATTRACT to LOBBY.
  await expect(display.locator('.seat-plate.on')).toHaveCount(2);
  let m = await publicMatch(op);
  expect(m.phase).toBe('LOBBY');
  expect(m.state.seats.GUNNER_L.ready && m.state.seats.SHIELD_L.ready).toBe(true);
  expect(JSON.stringify(m)).not.toMatch(/pilotId/);

  await op.getByRole('button', { name: /START/ }).click();
  await expect.poll(async () => (await publicMatch(op)).phase, { timeout: 20_000 }).toBe('WAVE_1');
  await expect(display.locator('.topbar')).toBeVisible();

  // GUNNER: LOCK → CHARGE → FIRE. The server applies the damage.
  await expect(gunner.getByText('TARGET LOCK')).toBeVisible();
  const lockBtn = gunner.getByRole('button', { name: /ロックオン/ });
  await expect(lockBtn).toBeEnabled();
  await expect
    .poll(
      async () => {
        const s = (await publicMatch(op)).state;
        return s.enemies.some((e) => e.arrivesAt <= s.t);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  await lockBtn.click();
  const fireBtn = gunner.getByRole('button', { name: /発射/ });
  await expect(fireBtn).toBeEnabled({ timeout: 15_000 });
  await fireBtn.click();
  await expect
    .poll(async () => (await publicMatch(op)).state.seats.GUNNER_L.stats.hits, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);
  await expect(gunner.locator('.sysline .msg.ok')).toBeVisible();

  // DEFENSE: wait for a strike in FRONT/LEFT, deploy inside the guard window.
  await expect
    .poll(
      async () => {
        const t = await guard
          .locator('.next-threat b')
          .textContent()
          .catch(() => null);
        const lead = t ? parseFloat(t) : null;
        if (lead !== null && lead < 1.3) {
          await guard
            .getByRole('button', { name: /シールド展開/ })
            .click({ timeout: 2_000 })
            .catch(() => undefined);
        }
        return (await publicMatch(op)).state.seats.SHIELD_L.stats.blocks;
      },
      { timeout: 60_000, intervals: [100] },
    )
    .toBeGreaterThanOrEqual(1);

  // Operator PAUSE reaches every phone; the match clock freezes.
  await op.getByRole('button', { name: /PAUSE/ }).click();
  await expect(gunner.getByText(/作戦一時停止中/)).toBeVisible();
  const t0 = (await publicMatch(op)).state.t;
  await gunner.waitForTimeout(1_500);
  expect((await publicMatch(op)).state.t).toBe(t0);
  await op.getByRole('button', { name: /RESUME/ }).click();
  await expect(gunner.getByText(/作戦一時停止中/)).toBeHidden();

  // A phone that reloads mid-fight keeps its seat (held for 60 s by the server).
  await gunner.reload();
  await expect(gunner.getByText('TARGET LOCK')).toBeVisible({ timeout: 20_000 });
  m = await publicMatch(op);
  expect(m.state.seats.GUNNER_L.occupied).toBe(true);
  expect(m.state.seats.GUNNER_L.connected).toBe(true);
});

test('pilot sign-in is free and never asks for keys; operator needs a password', async ({
  page,
}) => {
  await page.goto('/pilot/');
  await expect(page.getByText(/パイロット認証（無料）/)).toBeVisible();
  await expect(page.getByText(/秘密鍵・シードフレーズ/)).toBeVisible();
  await expect(page.locator('input')).toHaveCount(0);
  await page.goto('/operator/');
  await expect(page.getByLabel(/Operator password/)).toBeVisible();
  const bad = await page.request.post(`${BASE}/api/operator/login`, {
    data: { password: 'nope' },
    headers: { origin: BASE },
  });
  expect(bad.status()).toBe(401);
});
