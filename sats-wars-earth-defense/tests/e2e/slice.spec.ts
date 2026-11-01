import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import type { MatchSnapshotMsg } from '@swed/shared';
import { BASE, OPERATOR_PASSWORD } from './playwright.config';

/**
 * D-035 acceptance: two phones scan in (no seats) and land in teams; each plays its team's
 * screen (drones, missiles, sparks) and the big screen and the server agree. Every assertion
 * about outcomes reads the server's public state.
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
  // Scanning is joining: straight into a team, no seat to pick.
  await expect(p.getByText('参加しました')).toBeVisible();
  await expect(p.locator('.my-team')).toBeVisible();
  return p;
}

/**
 * Hits one target on the phone's field. Targets move every frame, so the test fires the
 * pointerdown on the element itself rather than waiting for it to hold still.
 */
async function hit(p: Page, kind: 'drone' | 'missile' | 'spark', timeout = 30_000) {
  const t = p.locator(`.arena .tgt.${kind}:not(.boom)`).first();
  await t.waitFor({ timeout });
  await t.dispatchEvent('pointerdown');
}

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
  await expect(display.getByText(/3つの班で雷神を動かす/)).toBeVisible();

  const a = await phone(browser);
  const b = await phone(browser);

  let m = await publicMatch(op);
  expect(m.phase).toBe('LOBBY');
  expect(m.state.humans).toBe(2);
  // First in is a gunner, second a guard; the empty engineer job is shared.
  expect(m.state.teams).toEqual({ ATTACK: 1, DEFEND: 1, REPAIR: 0 });
  await expect(a.locator('.my-team')).toContainText('砲撃班');
  await expect(b.locator('.my-team')).toContainText('防衛班');
  await expect(display.locator('.pilots-count')).toContainText('02');
  expect(JSON.stringify(m)).not.toMatch(/pilotId/);

  await op.getByRole('button', { name: /START/ }).click();
  await expect.poll(async () => (await publicMatch(op)).phase, { timeout: 20_000 }).toBe('BATTLE');
  await expect(display.locator('.topbar')).toBeVisible();
  await expect(display.locator('.bossbar')).toBeVisible();

  // GUNNER: shooting a drone on the phone takes the mothership's HP down on the server.
  const hp0 = (await publicMatch(op)).state.boss!.hp;
  await hit(a, 'drone');
  await expect
    .poll(async () => (await publicMatch(op)).state.boss!.hp, { timeout: 10_000 })
    .toBeLessThan(hp0);
  await expect(a.locator('.mine b')).toHaveText('1');
  await expect(a.locator('.job-call')).toContainText('砲撃班');

  // GUARD: when a strike is announced, missiles fall on the guard's phone; knocking one away
  // fills the shield.
  await expect(b.locator('.job-call')).toContainText('ミサイル', { timeout: 30_000 });
  await hit(b, 'missile');
  await expect
    .poll(async () => (await publicMatch(op)).state.stats.free.DEFEND, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(1);
  // ENGINEER's job is shared (nobody is an engineer): once RAIJIN is clawed, sparks appear on
  // the phones. The guard keeps knocking missiles away meanwhile, or the squads fall first.
  await expect
    .poll(
      async () => {
        for (const [p, kinds] of [
          [b, ['missile', 'spark']],
          [a, ['spark']],
        ] as const) {
          for (const k of kinds) {
            const t = p.locator(`.arena .tgt.${k}:not(.boom)`).first();
            if (await t.count()) await t.dispatchEvent('pointerdown').catch(() => undefined);
          }
        }
        return (await publicMatch(op)).state.stats.free.REPAIR;
      },
      { timeout: 90_000, intervals: [600] },
    )
    .toBeGreaterThanOrEqual(1);
  await expect(display.locator('.actbar.teams')).toBeVisible();

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
  await expect(a.locator('.arena')).toBeVisible({ timeout: 20_000 });
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
