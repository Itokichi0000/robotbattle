import { type APIRequestContext, type BrowserContext, type Page, expect, test } from '@playwright/test';
import { E2E_ADMIN_PASSWORD } from './playwright.config';

const SERVER = 'http://localhost:4000';

async function adminToken(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${SERVER}/api/admin/login`, { data: { password: E2E_ADMIN_PASSWORD } });
  return (await r.json()).token;
}
async function admin(request: APIRequestContext, token: string, body: Record<string, unknown>) {
  const r = await request.post(`${SERVER}/api/admin/command`, { data: body, headers: { authorization: `Bearer ${token}` } });
  expect(r.ok(), await r.text()).toBeTruthy();
}
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

async function phone(ctx: BrowserContext, team: 'RAIJIN' | 'FUJIN'): Promise<Page> {
  const p = await ctx.newPage();
  await p.goto('/play');
  await expect(p.getByTestId('team-pick')).toBeVisible();
  await p.getByTestId(`pick-${team}`).click();
  await expect(p.getByTestId('controller')).toBeVisible();
  return p;
}

test.describe.configure({ mode: 'serial' });

test('venue flow: pick a team, top up once, punch, name on the big screen', async ({ browser, request }) => {
  const token = await adminToken(request);
  // Fresh season so the first round starts a few seconds from now.
  const cur = (await (await request.get(`${SERVER}/api/public/current-match`)).json()).snapshot;
  if (cur.status === 'LIVE' || cur.status === 'PAUSED') await admin(request, token, { command: 'CANCEL' });
  await admin(request, token, { command: 'NEXT_MATCH' });

  // Admin console.
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const adminPage = await adminCtx.newPage();
  await adminPage.goto('/admin');
  await adminPage.getByTestId('admin-password').fill(E2E_ADMIN_PASSWORD);
  await adminPage.getByTestId('admin-login').click();
  await expect(adminPage.getByTestId('admin-status')).toContainText('LIVE');

  // Venue screen (2D renderer for DOM assertions). How-to + QR are always there.
  const arenaCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const arena = await arenaCtx.newPage();
  await arena.goto('/arena?mode=2d');
  await expect(arena.getByTestId('arena-2d')).toBeVisible();
  await expect(arena.getByTestId('arena-qr')).toContainText('タップでパンチ');

  // Three phones.
  const ctxs = await Promise.all([browser.newContext(mobile), browser.newContext(mobile), browser.newContext(mobile)]);
  const p1 = await phone(ctxs[0]!, 'RAIJIN');
  const p2 = await phone(ctxs[1]!, 'FUJIN');
  const p3 = await phone(ctxs[2]!, 'RAIJIN');
  await expect(p1.getByTestId('credit')).toContainText('0');

  // p1: top up 210 sats once (mock invoice).
  await p1.getByTestId('open-topup').click();
  await p1.getByTestId('topup-210').click();
  await expect(p1.getByTestId('invoice')).toContainText('210 sats');
  await p1.getByTestId('mock-pay').click();
  await expect(p1.getByTestId('topup-done')).toBeVisible();
  await expect(p1.getByTestId('credit')).toContainText('210');

  // p3: a code handed out at the venue.
  const passes = await request.post(`${SERVER}/api/admin/passes`, {
    data: { count: 1, amountSats: 105 },
    headers: { authorization: `Bearer ${token}` },
  });
  const code = (await passes.json()).codes[0] as string;
  await p3.getByTestId('open-topup').click();
  await p3.getByTestId('code-input').fill(code);
  await p3.getByTestId('redeem').click();
  await expect(p3.getByTestId('topup-done')).toContainText('+105');
  await expect(p3.getByTestId('credit')).toContainText('105');

  // Wait for the round to start, then punch.
  await expect(p1.getByTestId('punch-button')).toBeEnabled({ timeout: 30_000 });
  const nickname = (await p1.getByTestId('controller').locator('span.truncate').textContent())!.trim();
  const t0 = Date.now();
  await p1.getByTestId('punch-button').click();
  await expect(arena.getByTestId('zap-pops-RAIJIN')).toContainText(nickname);
  console.log(`[e2e] phone punch -> name on venue screen: ${Date.now() - t0} ms`);
  await expect(p1.getByTestId('punch-flash')).toContainText('命中');
  await expect(p1.getByTestId('credit')).toContainText('189');
  await expect(arena.getByTestId('gauge-FUJIN')).toContainText('/200');

  // p2 has no credit: the button opens the top-up sheet instead of charging.
  await p2.getByTestId('punch-button').click();
  await expect(p2.getByTestId('topup')).toBeVisible();
  await p2.getByRole('button', { name: '閉じる' }).click();

  // Free cheer shows up on the big screen.
  await p2.getByRole('button', { name: '🔥 で応援' }).click();
  await expect(arena.getByTestId('cheers')).toContainText('🔥');

  // Pause reaches phones and the venue screen; nothing is charged while paused.
  await admin(request, token, { command: 'PAUSE' });
  await expect(arena.getByText('一時停止中').first()).toBeVisible();
  await expect(p1.getByTestId('punch-button')).toBeDisabled();
  await admin(request, token, { command: 'RESUME' });
  await expect(p1.getByTestId('punch-button')).toBeEnabled();

  for (const c of [...ctxs, arenaCtx, adminCtx]) await c.close();
});

test('phone UI: English toggle and 320px width without horizontal scroll', async ({ browser }) => {
  const ctx = await browser.newContext({ ...mobile, viewport: { width: 320, height: 640 } });
  const p = await ctx.newPage();
  await p.goto('/play');
  await expect(p.getByTestId('team-pick')).toBeVisible();
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await p.getByRole('button', { name: 'Switch to English' }).click();
  await expect(p.getByText('Pick your robot!')).toBeVisible();
  await p.getByTestId('pick-FUJIN').click();
  await expect(p.getByTestId('punch-button')).toBeVisible();
  const overflow2 = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow2).toBeLessThanOrEqual(0);
  await ctx.close();
});

test('arena 3D renderer starts (WebGL) and landing page loads', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  await p.goto('/arena');
  await expect(p.getByTestId('arena-root')).toBeVisible();
  const renderer = await p.getByTestId('arena-root').getAttribute('data-renderer');
  if (renderer === 'webgl') await expect(p.locator('canvas')).toBeVisible({ timeout: 30_000 });
  await expect(p.getByTestId('region-strip')).toBeVisible();
  await p.goto('/');
  await expect(p.getByTestId('cta-play')).toBeVisible();
  await expect(p.getByTestId('landing-live')).toBeVisible();
  await ctx.close();
});
