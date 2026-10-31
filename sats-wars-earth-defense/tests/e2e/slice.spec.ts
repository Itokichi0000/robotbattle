import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import type { MatchSnapshotMsg } from '@swed/shared';
import { BASE, OPERATOR_PASSWORD } from './playwright.config';

/**
 * D-033 acceptance: two phones scan in (no seats), press the three buttons, and the big
 * screen and the server agree. Every assertion about outcomes reads the server's public state.
 */

// The browser is shared by every spec: close the phones a test opened, or they stay in the
// crowd (RESET keeps connected players) and the next test starts with extra people.
test.afterEach(async ({ browser }) => {
  for (const c of browser.contexts()) await c.close();
});

async function publicMatch(page: Page): Promise<MatchSnapshotMsg> {
  const res = await page.request.get(`${BASE}/api/public/match`);
  return (await res.json()) as MatchSnapshotMsg;
}

async function phone(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  await p.goto('/pilot/');
  await p.getByRole('button', { name: /DEMO GUEST/ }).click();
  // Scanning is joining: straight into the crowd, no seat to pick.
  await expect(p.getByText('参加しました')).toBeVisible();
  await expect(p.getByText(/ボタンは3つだけ/)).toBeVisible();
  return p;
}

/** The free button for an action (the big one on the left of each row). */
const freeButton = (p: Page, name: '撃つ' | '守る' | '直す') =>
  p.locator('.act-free').filter({ has: p.locator('.act-name', { hasText: name }) });

test('two phones, one mech: free taps change the server state, the big screen follows', async ({
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
  await expect(op.getByText('今の状態 NOW')).toBeVisible();
  await expect(op.getByText('SANDBOX（架空のお金・テスト）')).toBeVisible();
  // Specs share one server: start from an empty lobby whatever ran before (bots off too).
  await expect(op.locator('.payments')).toBeVisible(); // operator status has arrived
  if (await op.getByLabel(/DEMO BOTS/).isChecked()) await op.getByLabel(/DEMO BOTS/).uncheck();
  await op.getByRole('button', { name: /RESET/ }).click();
  await expect.poll(async () => (await publicMatch(op)).state.humans, { timeout: 15_000 }).toBe(0);

  const display = await (
    await browser.newContext({ viewport: { width: 1280, height: 720 } })
  ).newPage();
  await display.goto('/display/?q=SAFE');
  await expect(display.locator('.stage canvas')).toBeVisible({ timeout: 60_000 });
  await expect(display.getByText('SCAN TO JOIN')).toBeVisible();
  await expect(display.locator('img[src="/api/public/join.svg"]')).toBeVisible();
  await expect(display.getByText(/ボタンは3つだけ/)).toBeVisible();

  const a = await phone(browser);
  const b = await phone(browser);

  let m = await publicMatch(op);
  expect(m.phase).toBe('LOBBY');
  expect(m.state.humans).toBe(2);
  await expect(display.locator('.pilots-count')).toContainText('02');
  expect(JSON.stringify(m)).not.toMatch(/pilotId/);

  await op.getByRole('button', { name: /START/ }).click();
  await expect.poll(async () => (await publicMatch(op)).phase, { timeout: 20_000 }).toBe('BATTLE');
  await expect(display.locator('.topbar')).toBeVisible();
  await expect(display.locator('.bossbar')).toBeVisible();

  // ATTACK: one free tap takes boss HP down on the server.
  const hp0 = (await publicMatch(op)).state.boss!.hp;
  await freeButton(a, '撃つ').click();
  await expect
    .poll(async () => (await publicMatch(op)).state.boss!.hp, { timeout: 10_000 })
    .toBeLessThan(hp0);
  await expect(a.locator('.mine')).toContainText('撃つ 1');

  // DEFEND and REPAIR reach the server too (counted per button for the whole crowd).
  await freeButton(b, '守る').click();
  await b.waitForTimeout(800); // the free cooldown
  await freeButton(b, '直す').click();
  await expect
    .poll(async () => {
      const f = (await publicMatch(op)).state.stats.free;
      return f.DEFEND >= 1 && f.REPAIR >= 1;
    })
    .toBe(true);

  // The phone always shows what to press now, and the same button is lit.
  await expect(a.locator('.now-call')).toBeVisible();
  await expect(a.locator('.act.rec')).toHaveCount(1);

  // Operator PAUSE reaches every phone; the match clock freezes.
  await op.getByRole('button', { name: /PAUSE/ }).click();
  await expect(a.getByText(/作戦一時停止中/)).toBeVisible();
  const t0 = (await publicMatch(op)).state.t;
  await a.waitForTimeout(1_500);
  expect((await publicMatch(op)).state.t).toBe(t0);
  await op.getByRole('button', { name: /RESUME/ }).click();
  await expect(a.getByText(/作戦一時停止中/)).toBeHidden();

  // A phone that reloads mid-fight is still in the crowd (held by the server).
  await a.reload();
  await expect(freeButton(a, '撃つ')).toBeVisible({ timeout: 20_000 });
  m = await publicMatch(op);
  expect(m.state.humans).toBe(2);
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
