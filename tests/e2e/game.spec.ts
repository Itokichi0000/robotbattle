import {
  type APIRequestContext,
  type BrowserContext,
  type Page,
  expect,
  test,
} from '@playwright/test';
import { E2E_ADMIN_PASSWORD } from './playwright.config';

const SERVER = 'http://localhost:4000';
const TEAM_COLOR: Record<string, string> = { RAIJIN: '#F7931A', FUJIN: '#25C8D7' };

async function adminToken(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${SERVER}/api/admin/login`, {
    data: { password: E2E_ADMIN_PASSWORD },
  });
  return (await r.json()).token;
}
async function admin(request: APIRequestContext, token: string, body: Record<string, unknown>) {
  const r = await request.post(`${SERVER}/api/admin/command`, {
    data: body,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
}
async function phone(ctx: BrowserContext): Promise<Page> {
  const p = await ctx.newPage();
  await p.goto('/play');
  await expect(p.getByTestId('join')).toBeVisible();
  return p;
}
async function joinWithMockPay(p: Page, nickname: string): Promise<string> {
  await p.getByTestId('nickname').fill(nickname);
  await p.getByTestId('join').click();
  const team = (await p.getByTestId('team').textContent()) ?? '';
  await p.getByTestId('issue-invoice').click();
  await expect(p.getByTestId('invoice')).toContainText('テスト');
  await p.getByTestId('mock-pay').click();
  await expect(p.getByTestId('ap')).toBeVisible();
  return team.includes('雷神') ? 'RAIJIN' : 'FUJIN';
}
/** Opens the region row if needed, picks the action and confirms. Returns the confirm time. */
async function act(p: Page, type: 'attack' | 'defend', region: string): Promise<number> {
  const toggle = p.getByTestId(`region-${region}`).locator('button').first();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await p.getByTestId(`${type}-${region}`).click();
  const t = Date.now();
  await p.getByTestId('confirm').click();
  return t;
}

test.describe.configure({ mode: 'serial' });

test('full demo match flow: admin, 3 phones, arena sync, AP limits', async ({
  browser,
  request,
}) => {
  const token = await adminToken(request);

  // Admin UI login + open lobby.
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const adminPage = await adminCtx.newPage();
  await adminPage.goto('/admin');
  await adminPage.getByTestId('admin-password').fill(E2E_ADMIN_PASSWORD);
  await adminPage.getByTestId('admin-login').click();
  await adminPage.getByTestId('cmd-open-lobby').click();
  await expect(adminPage.getByTestId('admin-status')).toContainText('LOBBY');

  // Arena (2D renderer for DOM assertions).
  const arenaCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const arena = await arenaCtx.newPage();
  await arena.goto('/arena?mode=2d');
  await expect(arena.getByTestId('arena-2d')).toBeVisible();
  await expect(arena.getByTestId('arena-qr')).toBeVisible();

  // Three phones: two pay (mock), one uses a sponsored pass.
  const mobile = {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  };
  const ctxs = await Promise.all([
    browser.newContext(mobile),
    browser.newContext(mobile),
    browser.newContext(mobile),
  ]);
  const [p1, p2, p3] = await Promise.all(ctxs.map(phone));
  const team1 = await joinWithMockPay(p1!, 'たろう');
  const team2 = await joinWithMockPay(p2!, 'Hanako');
  const passRes = await request.post(`${SERVER}/api/admin/passes`, {
    data: { count: 1 },
    headers: { authorization: `Bearer ${token}` },
  });
  const [code] = (await passRes.json()).codes as string[];
  await p3!.getByTestId('nickname').fill('KidPass');
  await p3!.getByTestId('join').click();
  await p3!.getByTestId('use-pass').click();
  await p3!.getByTestId('pass-code').fill(code!);
  await p3!.getByTestId('redeem').click();
  await expect(p3!.getByTestId('waiting')).toBeVisible();
  expect(team1).not.toBe(team2); // auto-balancing alternates teams

  // Start via admin UI.
  await adminPage.getByTestId('cmd-start').click();
  await expect(p1!.getByTestId('next-clash')).toBeVisible();

  // p1 captures Kanto; measure phone→arena latency.
  const t0 = await act(p1!, 'attack', 'kanto');
  await expect(p1!.getByTestId('last-result')).toContainText('占領成功');
  // Frame-accurate polling (expect() backs off up to 1s, which would inflate the number).
  await arena.waitForFunction(
    (color) =>
      document.querySelector('[data-testid=map-region-kanto] path')?.getAttribute('fill') === color,
    TEAM_COLOR[team1]!,
    { polling: 'raf', timeout: 10_000 },
  );
  const latency = Date.now() - t0;
  console.log(`[e2e] phone confirm -> arena map update: ${latency} ms`);
  expect(latency).toBeLessThan(1500);
  // Other phones see the same state.
  await expect(p2!.getByTestId('region-kanto')).toContainText(team2 === team1 ? '味方' : '敵');

  // Spend remaining AP: shield + charge, then everything is disabled and the API rejects a 4th action.
  await act(p1!, 'defend', 'kanto');
  await expect(p1!.getByTestId('last-result')).toContainText('シールド設置');
  await p1!.getByTestId('charge').click();
  await p1!.getByTestId('confirm').click();
  await expect(p1!.getByTestId('last-result')).toContainText('充電');
  await expect(p1!.getByTestId('ap')).toHaveCount(1);
  await expect(p1!.getByTestId('charge')).toBeDisabled();
  const session = JSON.parse(
    (await p1!.evaluate(() => localStorage.getItem('sw.session'))) ?? '{}',
  );
  const fourth = await request.post(`${SERVER}/api/actions`, {
    data: { clientActionId: 'e2e-fourth-action', type: 'CHARGE' },
    headers: { authorization: `Bearer ${session.token}` },
  });
  expect((await fourth.json()).result).toMatchObject({ ok: false, code: 'NO_AP' });

  // Enemy attack on the shielded region only breaks the shield.
  const enemyPhone = team2 !== team1 ? p2! : p3!;
  await act(enemyPhone, 'attack', 'kanto');
  await expect(enemyPhone.getByTestId('last-result')).toContainText('シールドを破壊');

  // Reload keeps the session (reconnect).
  await p1!.reload();
  await expect(p1!.getByTestId('ap')).toBeVisible();

  // Pause / resume reach phones and arena.
  await admin(request, token, { command: 'PAUSE' });
  await expect(p2!.getByText('一時停止中です')).toBeVisible();
  await expect(arena.getByText('一時停止中').first()).toBeVisible();
  await admin(request, token, { command: 'RESUME' });
  await expect(p2!.getByText('一時停止中です')).toHaveCount(0);

  // Cancel and roll to the next match: phones return to the join screen.
  await admin(request, token, { command: 'CANCEL' });
  await expect(arena.getByText('試合中止').first()).toBeVisible();
  await admin(request, token, { command: 'NEXT_MATCH' });
  await expect(p1!.getByTestId('join').or(p1!.getByText('まもなく参加受付'))).toBeVisible();

  for (const c of [...ctxs, arenaCtx, adminCtx]) await c.close();
});

test('phone UI: English toggle, 320px width, spectate', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const p = await ctx.newPage();
  await p.goto('/play');
  await expect(p.getByText('遊び方')).toBeVisible();
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await p.getByRole('button', { name: 'Switch to English' }).click();
  await expect(p.getByText('How to play')).toBeVisible();
  await p.getByTestId('spectate').click();
  await expect(p.getByTestId('spectate-view')).toBeVisible();
  await ctx.close();
});

test('arena 3D renderer starts (WebGL) and landing page loads', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('/arena');
  await expect(p.getByTestId('arena-root')).toBeVisible();
  const renderer = await p.getByTestId('arena-root').getAttribute('data-renderer');
  if (renderer === 'webgl') await expect(p.locator('canvas')).toBeVisible({ timeout: 30_000 });
  await p.goto('/');
  await expect(p.getByTestId('landing-live')).toBeVisible();
  expect(errors).toEqual([]);
  await ctx.close();
});
