import {
  devices,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import type { MatchSnapshotMsg } from '@swed/shared';
import { signedCallback } from '../../apps/server/src/testWallet';
import { BASE, OPERATOR_PASSWORD } from './playwright.config';

/**
 * D-033 acceptance on the production build:
 *  - a pilot signs in with an LNURL-auth wallet (the test wallet signs like LUD-04 wallets)
 *    and is in the crowd at once; the same wallet on a second phone takes over;
 *  - the 21 sats button opens a confirm sheet; a VIRTUAL intent settled by staff is applied
 *    once as the big version of that action;
 *  - one phone plus labelled demo bots play a whole round to the result.
 * Outcomes are always read from the server's public state.
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

async function operator(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const login = await ctx.request.post(`${BASE}/api/operator/login`, {
    data: { password: OPERATOR_PASSWORD },
    headers: { origin: BASE },
  });
  expect(login.ok()).toBe(true);
  const page = await ctx.newPage();
  page.on('dialog', (d) => void d.accept());
  await page.goto('/operator/');
  await expect(page.getByText('今の状態 NOW')).toBeVisible();
  return { ctx, page };
}

async function resetMatch(op: Page): Promise<void> {
  // Specs share one server: no demo bots or players left over from an earlier test.
  await expect(op.locator('.payments')).toBeVisible(); // operator status has arrived
  if (await op.getByLabel(/DEMO BOTS/).isChecked()) await op.getByLabel(/DEMO BOTS/).uncheck();
  await op.getByRole('button', { name: /RESET/ }).click();
  await expect.poll(async () => (await publicMatch(op)).state.humans, { timeout: 15_000 }).toBe(0);
  await expect.poll(async () => (await publicMatch(op)).phase, { timeout: 15_000 }).toBe('LOBBY');
}

async function newPhone(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  await p.goto('/pilot/');
  return p;
}

/** Plays the LNURL-auth wallet: reads the phone's lightning: link, signs, calls back. */
async function walletApproves(p: Page, seed: string): Promise<void> {
  await p.getByRole('button', { name: /Lightningウォレットで認証/ }).click();
  const link = p.getByRole('link', { name: /ウォレットを開いて承認/ });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href'))!;
  expect(href).toMatch(/^lightning:LNURL1[0-9A-Z]+$/);
  const res = await p.request.get(signedCallback(href, seed));
  expect(await res.json()).toEqual({ status: 'OK' });
}

test('LNURL-auth pilot, one wallet one phone, a VIRTUAL 21 sats action applied once', async ({
  browser,
}) => {
  const { page: op } = await operator(browser);
  await resetMatch(op);

  // Sign-in is free and separate from payments; the wallet signs, the phone is in the crowd.
  const seed = 'e2e wallet alpha';
  const a = await newPhone(browser);
  await expect(a.getByText(/パイロット認証（無料）/)).toBeVisible();
  await walletApproves(a, seed);
  await expect(a.getByText('参加しました')).toBeVisible({ timeout: 20_000 });
  await expect(a.locator('.joined b')).toHaveText(/^PILOT-[0-9A-Z]+$/);

  // A forged login (someone else's key on this k1) is refused by the server.
  const forged = await a.request.get(
    `${BASE}/api/auth/lnurl?tag=login&k1=${'00'.repeat(32)}&key=02${'11'.repeat(32)}&sig=3006020101020101`,
  );
  expect((await forged.json()).status).toBe('ERROR');

  await op.getByRole('button', { name: /START/ }).click();
  await expect.poll(async () => (await publicMatch(op)).phase, { timeout: 20_000 }).toBe('BATTLE');

  // The 21 sats button opens a sheet first: never a payment on one tap.
  const hp0 = (await publicMatch(op)).state.boss!.hp;
  await a.getByRole('button', { name: /21 sats で大きく撃つ/ }).click();
  const sheet = a.getByRole('dialog', { name: /21 sats で大きく撃つ/ });
  await expect(sheet.getByText(/VIRTUAL（架空・無料のテスト）/)).toBeVisible();
  await expect(sheet.getByText(/払わなくても無料タップで一緒に戦えます/)).toBeVisible();
  expect((await publicMatch(op)).state.stats.paid.ATTACK).toBe(0);
  await sheet.getByRole('button', { name: /sats を送る（VIRTUAL/ }).click();
  await expect(sheet.getByText(/テスト用の架空の請求書/)).toBeVisible();

  // Staff settle it in the console; the server applies the big attack exactly once.
  const settle = op.locator('.payments').getByRole('button', { name: 'SETTLE' });
  await expect(settle).toBeVisible({ timeout: 10_000 });
  await settle.click();
  await expect(sheet.getByText(/着金！/)).toBeVisible({ timeout: 15_000 });
  const after = await publicMatch(op);
  expect(after.state.stats.virtual).toBe(1);
  expect(after.state.stats.paid.ATTACK).toBe(1);
  expect(after.state.boss!.hp).toBeLessThanOrEqual(hp0 - after.state.hints.paid.ATTACK);
  await expect(op.locator('.payments').getByRole('button', { name: 'SETTLE' })).toHaveCount(0);
  await a.getByRole('button', { name: '閉じる' }).click();
  await expect(a.locator('.mine')).toContainText('あと 2 回');

  // The same wallet signs in on another phone: that phone takes over, this one steps down.
  const b = await newPhone(browser);
  await walletApproves(b, seed);
  await expect(b.locator('.act-free').first()).toBeVisible({ timeout: 20_000 });
  await expect(a.getByText(/別の端末からログインしたため/)).toBeVisible({ timeout: 20_000 });
  const m = await publicMatch(op);
  expect(m.state.humans).toBe(1);
  expect(JSON.stringify(m)).not.toMatch(/linking|pilotId|02[0-9a-f]{64}/);
});

test('one phone and labelled demo bots play a whole round to the result', async ({ browser }) => {
  test.setTimeout(420_000);
  const { page: op } = await operator(browser);
  await resetMatch(op);

  const display = await (
    await browser.newContext({ viewport: { width: 1280, height: 720 } })
  ).newPage();
  await display.goto('/display/?q=SAFE');
  await expect(display.locator('.stage canvas')).toBeVisible({ timeout: 60_000 });

  const p = await newPhone(browser);
  await p.getByRole('button', { name: /DEMO GUEST/ }).click();
  await expect(p.getByText('参加しました')).toBeVisible();

  // Demo bots join the crowd and are labelled as bots.
  await op.getByLabel(/DEMO BOTS/).check();
  await expect.poll(async () => (await publicMatch(op)).state.bots, { timeout: 15_000 }).toBe(6);
  expect((await publicMatch(op)).state.humans).toBe(1);
  await expect(display.getByText(/DEMO-BOT 6/)).toBeVisible();

  await op.getByRole('button', { name: /START/ }).click();
  await expect.poll(async () => (await publicMatch(op)).phase, { timeout: 30_000 }).toBe('BATTLE');
  await expect(display.locator('.bossbar')).toBeVisible();

  // The person presses whatever is lit until the round ends; the bots do the same.
  await expect
    .poll(
      async () => {
        await p
          .locator('.act.rec .act-free')
          .click({ timeout: 1_000 })
          .catch(() => undefined);
        return (await publicMatch(op)).phase;
      },
      { timeout: 200_000, intervals: [750] },
    )
    .toMatch(/VICTORY|DEFEAT|RESULTS/);

  const end = (await publicMatch(op)).state;
  expect(end.result).not.toBeNull();
  const f = end.stats.free;
  expect(f.ATTACK + f.DEFEND + f.REPAIR).toBeGreaterThan(100);
  await expect(p.locator('.verdict')).toHaveText(/VICTORY|DEFEAT/, { timeout: 20_000 });
  await expect(display.getByText(/次はあなたも/)).toBeVisible({ timeout: 20_000 });
  // Public state never names who did what (or who paid).
  expect(JSON.stringify(end)).not.toMatch(/pilotId/);
  await op.getByLabel(/DEMO BOTS/).uncheck();
});
