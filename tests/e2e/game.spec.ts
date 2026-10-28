import {
  type APIRequestContext,
  type BrowserContext,
  type Page,
  expect,
  test,
} from '@playwright/test';
import { E2E_ADMIN_PASSWORD } from './playwright.config';

const SERVER = 'http://localhost:4000';

async function adminToken(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${SERVER}/api/admin/login`, {
    data: { password: E2E_ADMIN_PASSWORD },
  });
  return (await r.json()).token;
}
async function admin(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>,
  mustSucceed = true,
) {
  const r = await request.post(`${SERVER}/api/admin/command`, {
    data: body,
    headers: { authorization: `Bearer ${token}` },
  });
  if (mustSucceed) expect(r.ok(), await r.text()).toBeTruthy();
  return r;
}
async function snapshot(request: APIRequestContext) {
  return (await (await request.get(`${SERVER}/api/public/current-raid`)).json()).snapshot as {
    raidId: string;
    status: string;
  };
}
const mobile = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
};

/** A phone that becomes a guest pilot. */
async function guestPhone(ctx: BrowserContext, callsign: string): Promise<Page> {
  const p = await ctx.newPage();
  await p.goto('/play');
  await expect(p.getByTestId('onboarding')).toBeVisible();
  await p.getByTestId('callsign-input').fill(callsign);
  await p.getByTestId('guest-login').click();
  await expect(p.getByTestId('callsign')).toContainText(callsign);
  return p;
}

/** Play the Guardian minigame well: press the attack's direction while the gauge is green. */
async function playGuardian(p: Page) {
  await expect(p.getByTestId('minigame')).toBeVisible();
  await expect(p.locator('.swc-gauge-fill.is-green')).toBeVisible({ timeout: 8_000 });
  await p.locator('.swc-dir.is-threat').click();
}

test.describe.configure({ mode: 'serial' });

test('venue raid: paid + sponsored pass, two seats, mission result, name on the big screen, results', async ({
  browser,
  request,
}) => {
  const token = await adminToken(request);
  if ((await snapshot(request)).status === 'CREATED')
    await admin(request, token, { command: 'OPEN_LOBBY' });

  const arenaCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const arena = await arenaCtx.newPage();
  await arena.goto('/arena?mode=2d');
  await expect(arena.getByTestId('arena-lobby')).toBeVisible();
  await expect(arena.getByTestId('join-card')).toContainText('21 sats');

  // Pilot A pays the 21-sat raid pass (mock payment, re-verified by the server).
  const ctxA = await browser.newContext(mobile);
  const a = await guestPhone(ctxA, 'タロウ');
  await expect(a.getByTestId('pass-gate')).toBeVisible();
  await a.getByTestId('buy-pass').click();
  await expect(a.getByTestId('invoice')).toContainText('テストモード');
  await a.getByTestId('mock-pay').click();
  await a.getByTestId('seat-GUARDIAN').click();
  await expect(a.getByTestId('cockpit-wait')).toBeVisible();
  // Opt in to showing the callsign on the big screen.
  await a.getByText('⚙ 設定').click();
  await a.getByTestId('show-name').check();

  // Pilot B uses a sponsored pass code from the staff.
  const codes = (
    await (
      await request.post(`${SERVER}/api/admin/sponsored-passes`, {
        data: { count: 1 },
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()
  ).codes as string[];
  const ctxB = await browser.newContext(mobile);
  const b = await guestPhone(ctxB, 'ハナコ');
  await b.getByText('スポンサーパスのコードを持っている').click();
  await b.getByTestId('sponsored-code').fill(codes[0]!);
  await b.getByRole('button', { name: '使う' }).first().click();
  await b.getByTestId('seat-GUNNER').click();
  await expect(b.getByTestId('cockpit-wait')).toBeVisible();

  await admin(request, token, { command: 'START' });
  await expect(arena.getByTestId('raid-header')).toBeVisible();

  // A flies a Guardian mission; the server scores the raw input.
  await expect(a.getByTestId('sortie')).toBeEnabled();
  await a.getByTestId('sortie').click();
  await playGuardian(a);
  await expect(a.getByTestId('task-result')).toContainText('シールド');
  await expect(arena.getByTestId('action-popups')).toContainText('タロウ');

  // The same pass is good for the whole raid: no second payment, cooldown instead.
  await expect(a.getByTestId('sortie')).toContainText('次の出撃まで');

  await admin(request, token, { command: 'END' });
  await expect(a.getByTestId('result-card')).toBeVisible();
  await expect(arena.getByTestId('arena-results')).toBeVisible();
  const raidId = (await snapshot(request)).raidId;

  const r = await arenaCtx.newPage();
  await r.goto(`/results/${raidId}`);
  await expect(r.getByTestId('result-card')).toBeVisible();
  await expect(r.getByTestId('score-total')).toBeVisible();

  // Next raid: the pass was for one raid only.
  await admin(request, token, { command: 'NEXT_RAID' });
  await admin(request, token, { command: 'OPEN_LOBBY' }, false);
  await a.reload();
  await expect(a.getByTestId('pass-gate')).toBeVisible();
  await Promise.all([ctxA.close(), ctxB.close(), arenaCtx.close()]);
});

test('Lightning login (LNURL-auth, mock wallet) brings a guest history along and opens the passport', async ({
  browser,
}) => {
  const ctx = await browser.newContext(mobile);
  const p = await guestPhone(ctx, 'ゲスト三郎');
  await p.goto('/auth/lightning?next=/passport');
  await p.getByTestId('mock-wallet-approve').click();
  await expect(p.getByTestId('merge-offer')).toContainText('ゲスト三郎');
  await p.getByTestId('merge-yes').click();
  await expect(p).toHaveURL(/\/passport$/);
  await expect(p.getByTestId('license')).toContainText('Lightning');
  await ctx.close();
});

test('phone UI: 320px wide without horizontal scroll, English toggle', async ({ browser }) => {
  const ctx = await browser.newContext({ ...mobile, viewport: { width: 320, height: 640 } });
  const p = await ctx.newPage();
  await p.goto('/play');
  await expect(p.getByTestId('onboarding')).toBeVisible();
  const overflow = () =>
    p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await p.getByRole('button', { name: 'Switch to English' }).click();
  await expect(p.getByTestId('guest-login')).toContainText('Board as guest');
  await p.getByTestId('guest-login').click();
  await expect(p.getByTestId('pass-gate')).toBeVisible();
  await expect(p.getByTestId('pass-gate')).toContainText('Raid pass');
  expect(await overflow()).toBeLessThanOrEqual(0);
  await p.getByTestId('training').getByRole('tab').nth(2).click();
  await expect(p.getByTestId('training').locator('.swc-router-svg')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await ctx.close();
});

test('arena 3D renderer starts, landing loads, admin kill switches work', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  await p.goto('/arena?mode=3d');
  await expect(p.getByTestId('arena-root')).toBeVisible();
  if ((await p.getByTestId('arena-root').getAttribute('data-renderer')) === 'webgl')
    await expect(p.locator('canvas')).toBeVisible({ timeout: 30_000 });
  await expect(p.getByTestId('join-card')).toBeVisible();
  await p.goto('/');
  await expect(p.getByTestId('cta-play')).toBeVisible();
  await expect(p.getByTestId('landing-live')).toBeVisible();

  await p.goto('/admin');
  await p.getByTestId('admin-password').fill(E2E_ADMIN_PASSWORD);
  await p.getByTestId('admin-login').click();
  await expect(p.getByTestId('kill-switches')).toBeVisible();
  await expect(p.getByTestId('sw-payments')).toContainText('ON');
  await p.getByTestId('sw-payments').click();
  await expect(p.getByTestId('sw-payments')).toContainText('OFF');
  // New phones now see that passes are paused (sponsored codes still work).
  const phoneCtx = await browser.newContext(mobile);
  const ph = await guestPhone(phoneCtx, 'ジロウ');
  await expect(ph.getByTestId('payments-paused')).toBeVisible();
  await p.getByTestId('sw-payments').click();
  await expect(p.getByTestId('sw-payments')).toContainText('ON');
  await p.getByTestId('tab-audit').click();
  await expect(p.getByTestId('audit-tab')).toContainText('SET_PAYMENTS_ENABLED');
  await Promise.all([phoneCtx.close(), ctx.close()]);
});
