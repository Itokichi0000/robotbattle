import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { E2E_ADMIN_PASSWORD } from './playwright.config';
import { admin, adminToken, freshLobby, guestPhone, mobile, playRouter, snapshot } from './helpers';

/**
 * Automated accessibility audit (axe-core, WCAG 2.1 A/AA rules) of every
 * screen people use, in the states they meet them. Automated checks find
 * only part of the problems: screen-reader and real-device checks stay on
 * the manual list in docs/TEST_PLAN.md.
 */
test.describe.configure({ mode: 'serial' });

async function audit(page: Page, label: string) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // The WebGL canvas is decorative; the HUD around it carries the information.
    .exclude('canvas')
    .analyze();
  const summary = r.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary, label).toEqual([]);
}

test('public pages', async ({ browser }) => {
  const ctx = await browser.newContext(mobile);
  const p = await ctx.newPage();
  for (const path of [
    '/',
    '/play',
    '/passport',
    '/leaderboard',
    '/auth/lightning',
    '/pilot/create',
    '/demo',
  ]) {
    await p.goto(path);
    await p.waitForLoadState('networkidle');
    await audit(p, path);
  }
  await ctx.close();
});

test('phone flow: pass gate, seat select, cockpit, minigame, result', async ({
  browser,
  request,
}) => {
  const token = await adminToken(request);
  await freshLobby(request, token);
  const ctx = await browser.newContext(mobile);
  const p = await guestPhone(ctx, 'アクセス');
  await expect(p.getByTestId('pass-gate')).toBeVisible();
  await audit(p, 'pass gate');
  await admin(request, token, { command: 'SET_PASS_MODE', mode: 'FREE' });
  await p.reload();
  await expect(p.getByTestId('seat-ROUTER')).toBeVisible();
  await audit(p, 'seat select');
  await p.getByTestId('seat-ROUTER').click();
  await expect(p.getByTestId('cockpit-wait')).toBeVisible();
  await audit(p, 'cockpit (waiting)');
  await admin(request, token, { command: 'START' });
  await expect(p.getByTestId('sortie')).toBeEnabled({ timeout: 15_000 });
  await p.getByTestId('sortie').click();
  await expect(p.getByTestId('minigame')).toBeVisible();
  await audit(p, 'router minigame');
  await playRouter(p);
  await expect(p.getByTestId('task-result')).toBeVisible({ timeout: 20_000 });
  await audit(p, 'mission result');
  await admin(request, token, { command: 'END' });
  await expect(p.getByTestId('result-card')).toBeVisible();
  await audit(p, 'raid result card');
  const raidId = (await snapshot(request)).raidId;
  await p.goto(`/results/${raidId}`);
  await expect(p.getByTestId('result-card')).toBeVisible();
  await audit(p, 'results page');
  await admin(request, token, { command: 'SET_PASS_MODE', mode: 'PAID' });
  await ctx.close();
});

test('venue screen and admin console', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  await p.goto('/arena?mode=2d');
  await expect(p.getByTestId('arena-root')).toBeVisible();
  await audit(p, 'arena 2D');
  await p.goto('/arena?mode=3d');
  await expect(p.getByTestId('arena-root')).toBeVisible();
  await p.waitForTimeout(3000);
  await audit(p, 'arena 3D HUD');
  await p.goto('/admin');
  await audit(p, 'admin login');
  await p.getByTestId('admin-password').fill(E2E_ADMIN_PASSWORD);
  await p.getByTestId('admin-login').click();
  await expect(p.getByTestId('kill-switches')).toBeVisible();
  await audit(p, 'admin monitor');
  for (const tab of ['pilots', 'audit']) {
    await p.getByTestId(`tab-${tab}`).click();
    await expect(p.getByTestId(`${tab}-tab`)).toBeVisible();
    await audit(p, `admin ${tab}`);
  }
  await ctx.close();
});
