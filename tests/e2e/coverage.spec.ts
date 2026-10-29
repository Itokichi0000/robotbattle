import { type Page, expect, test } from '@playwright/test';
import { E2E_ADMIN_PASSWORD } from './playwright.config';
import {
  SERVER,
  admin,
  adminToken,
  freshLobby,
  guestPhone,
  mobile,
  playEngineer,
  playGuardian,
  playGunner,
  playRouter,
  snapshot,
} from './helpers';

test.describe.configure({ mode: 'serial' });

const overflow = (p: Page) =>
  p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('all four seats: each cockpit opens its minigame and gets the server’s verdict', async ({
  browser,
  request,
}) => {
  const token = await adminToken(request);
  await freshLobby(request, token);
  await admin(request, token, { command: 'SET_PASS_MODE', mode: 'FREE' });
  const seats = [
    ['GUNNER', 'ガンナー', playGunner],
    ['GUARDIAN', 'ガーディアン', playGuardian],
    ['ROUTER', 'ルーター', playRouter],
    ['ENGINEER', 'エンジニア', playEngineer],
  ] as const;
  const ctxs = await Promise.all(seats.map(() => browser.newContext(mobile)));
  const phones: Page[] = [];
  for (const [i, [role, name]] of seats.entries()) {
    const p = await guestPhone(ctxs[i]!, name);
    await p.getByTestId(`seat-${role}`).click();
    await expect(p.getByTestId('cockpit-wait')).toBeVisible();
    phones.push(p);
  }
  await admin(request, token, { command: 'START' });
  for (const [i, [role, , play]] of seats.entries()) {
    const p = phones[i]!;
    await expect(p.getByTestId('sortie')).toBeEnabled({ timeout: 15_000 });
    await p.getByTestId('sortie').click();
    await expect(p.getByTestId('minigame')).toBeVisible();
    await play(p);
    // Success or miss, the phone shows what the server decided (timeout submits too).
    await expect(p.getByTestId('task-result'), role).toBeVisible({ timeout: 20_000 });
  }
  await admin(request, token, { command: 'END' });
  await admin(request, token, { command: 'SET_PASS_MODE', mode: 'PAID' });
  await Promise.all(ctxs.map((c) => c.close()));
});

test('a phone that reloads or comes back from the wallet keeps its pilot and seat', async ({
  browser,
  request,
}) => {
  const token = await adminToken(request);
  await freshLobby(request, token);
  await admin(request, token, { command: 'SET_PASS_MODE', mode: 'FREE' });
  const ctx = await browser.newContext(mobile);
  const p = await guestPhone(ctx, 'リロード');
  await p.getByTestId('seat-ENGINEER').click();
  await admin(request, token, { command: 'START' });
  await expect(p.getByTestId('sortie')).toBeEnabled({ timeout: 15_000 });

  await p.reload();
  await expect(p.getByTestId('callsign')).toContainText('リロード');
  await expect(p.getByTestId('conn-pill')).toHaveAttribute('data-state', 'connected');
  await expect(p.getByTestId('sortie')).toBeEnabled();

  // Wallet app switch: leave for the Lightning page, come back to /play.
  await p.goto('/auth/lightning?next=/play');
  await p.goto('/play');
  await expect(p.getByTestId('callsign')).toContainText('リロード');
  await expect(p.getByTestId('sortie')).toBeEnabled();
  await p.getByTestId('sortie').click();
  await playEngineer(p);
  await expect(p.getByTestId('task-result')).toBeVisible({ timeout: 20_000 });

  await admin(request, token, { command: 'END' });
  await admin(request, token, { command: 'SET_PASS_MODE', mode: 'PAID' });
  await ctx.close();
});

test('venue screen falls back to 2D when WebGL is not available', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error -- narrowing the overloads is not the point here
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      if (type.startsWith('webgl')) return null;
      // @ts-expect-error -- forward to the real implementation
      return original.call(this, type, ...rest);
    };
  });
  const p = await ctx.newPage();
  await p.goto('/arena');
  await expect(p.getByTestId('arena-root')).toHaveAttribute('data-renderer', '2d');
  await expect(p.getByTestId('arena-2d')).toBeVisible();
  await ctx.close();
});

test('16:9 venue screen and 375×812 phone render without overflow; reduced motion is honoured', async ({
  browser,
}, info) => {
  const big = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const a = await big.newPage();
  await a.goto('/arena?mode=2d');
  await expect(a.getByTestId('arena-root')).toBeVisible();
  expect(await overflow(a)).toBeLessThanOrEqual(0);
  await a.screenshot({ path: info.outputPath('arena-1920x1080.png') });
  await big.close();

  const phone = await browser.newContext({ ...mobile, viewport: { width: 375, height: 812 } });
  const p = await phone.newPage();
  await p.goto('/play');
  await expect(p.getByTestId('onboarding')).toBeVisible();
  expect(await overflow(p)).toBeLessThanOrEqual(0);
  await p.screenshot({ path: info.outputPath('play-375x812.png'), fullPage: true });
  for (const path of ['/', '/passport', '/leaderboard', '/auth/lightning']) {
    await p.goto(path);
    await p.waitForLoadState('networkidle');
    expect(await overflow(p), path).toBeLessThanOrEqual(0);
  }
  await phone.close();

  const calm = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    reducedMotion: 'reduce',
  });
  const c = await calm.newPage();
  await c.goto('/arena?mode=2d');
  await expect(c.locator('html')).toHaveClass(/sw-reduced-motion/);
  await calm.close();
});

test('admin console: open, start, pause, resume, emergency stop, audit log', async ({
  browser,
  request,
}) => {
  const token = await adminToken(request);
  await freshLobby(request, token);
  const phoneCtx = await browser.newContext(mobile);
  await admin(request, token, { command: 'SET_PASS_MODE', mode: 'FREE' });
  const ph = await guestPhone(phoneCtx, '運営テスト');
  await ph.getByTestId('seat-GUARDIAN').click();

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on('dialog', (d) => void d.accept());
  await p.goto('/admin');
  await p.getByTestId('admin-password').fill(E2E_ADMIN_PASSWORD);
  await p.getByTestId('admin-login').click();
  await expect(p.getByTestId('kill-switches')).toBeVisible();

  await p.getByTestId('cmd-start').click();
  await expect.poll(async () => (await snapshot(request)).status).toBe('LIVE');
  await p.getByTestId('cmd-pause').click();
  await expect.poll(async () => (await snapshot(request)).status).toBe('PAUSED');
  await expect(p.getByTestId('cmd-pause')).toContainText('再開');
  await p.getByTestId('cmd-pause').click();
  await expect.poll(async () => (await snapshot(request)).status).toBe('LIVE');

  await p.getByTestId('cmd-emergency').click();
  await expect.poll(async () => (await snapshot(request)).status).toBe('PAUSED');
  const pub = await (await request.get(`${SERVER}/api/public/current-raid`)).json();
  expect(pub.snapshot.joinOpen).toBe(false);
  await expect(p.getByTestId('sw-payments')).toContainText('OFF');

  await p.getByTestId('tab-audit').click();
  for (const action of ['START', 'PAUSE', 'RESUME', 'EMERGENCY_STOP'])
    await expect(p.getByTestId('audit-tab')).toContainText(action);

  // Back to normal for the next tests.
  await admin(request, token, { command: 'SET_JOIN_STOPPED', stopped: false });
  await admin(request, token, { command: 'SET_PAYMENTS_ENABLED', enabled: true });
  await admin(request, token, { command: 'SET_AUTO_LOOP', enabled: true });
  await admin(request, token, { command: 'END' });
  await admin(request, token, { command: 'SET_PASS_MODE', mode: 'PAID' });
  await Promise.all([ctx.close(), phoneCtx.close()]);
});

test('demo seed: the success route fires 神雷風陣, the failure route loses Japan', async ({
  browser,
  request,
}) => {
  test.setTimeout(360_000);
  const token = await adminToken(request);
  const arenaCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const arena = await arenaCtx.newPage();
  await arena.goto('/arena?mode=2d');
  await expect(arena.getByTestId('arena-root')).toBeVisible();
  // Record every banner the venue screen shows (they come and go quickly at 10× speed).
  await arena.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __banners: string[] }).__banners = seen;
    new MutationObserver(() => {
      const t = document.querySelector('[data-testid="arena-banner"]')?.textContent ?? '';
      if (t && seen[seen.length - 1] !== t) seen.push(t);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  for (const route of ['success', 'failure'] as const) {
    const st = (await snapshot(request)).status;
    if (st === 'LIVE' || st === 'PAUSED') await admin(request, token, { command: 'END' });
    await admin(request, token, {
      command: 'DEMO_SCENARIO',
      scenario: 'earth-defense-opening',
      route,
    });
    const raidId = (await snapshot(request)).raidId;
    // The four scripted bots board, then the raid runs at 10× game speed.
    await expect
      .poll(
        async () =>
          (await (await request.get(`${SERVER}/api/public/current-raid`)).json()).snapshot.crew
            .length,
      )
      .toBeGreaterThanOrEqual(4);
    await admin(request, token, { command: 'START' });
    // Fast-forward to 6:35, watch the finale at normal speed (the venue
    // cinematics run in real time), then fast-forward to the end.
    await admin(request, token, { command: 'SET_TIME_SCALE', speed: 10 });
    await expect
      .poll(async () => (await snapshot(request)).gameMs, { timeout: 90_000 })
      .toBeGreaterThan(395_000);
    await admin(request, token, { command: 'SET_TIME_SCALE', speed: 1 });
    await expect
      .poll(
        async () =>
          (
            await arena.evaluate(() => (window as unknown as { __banners: string[] }).__banners)
          ).join(' / '),
        { timeout: 90_000 },
      )
      .toContain(route === 'success' ? '神雷風陣、発動！' : '神雷風陣 発動失敗');
    await admin(request, token, { command: 'SET_TIME_SCALE', speed: 10 });
    await expect
      .poll(async () => (await snapshot(request)).status, { timeout: 90_000 })
      .toBe('ENDED');
    const result = (await snapshot(request)).result!;
    expect(result.special).toBe(route === 'success' ? 'ACTIVATED' : 'FAILED');
    expect(result.outcome).toBe(route === 'success' ? 'SUCCEEDED' : 'FAILED');
    await admin(request, token, { command: 'SET_TIME_SCALE', speed: 1 });

    const r = await arenaCtx.newPage();
    await r.goto(`/results/${raidId}`);
    await expect(r.getByTestId('result-card')).toContainText(
      route === 'success' ? '神雷風陣 発動！' : '発動失敗',
    );
    await r.close();
  }
  await arenaCtx.close();
});

test('no Content-Security-Policy violations on the main pages', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI}`,
      ),
    );
  });
  const p = await ctx.newPage();
  for (const path of [
    '/',
    '/play',
    '/arena?mode=3d&models=blender',
    '/admin',
    '/passport',
    '/leaderboard',
    '/demo',
  ]) {
    await p.goto(path);
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(path.startsWith('/arena') ? 4000 : 500);
    const v = await p.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    expect(v, path).toEqual([]);
  }
  await ctx.close();
});
