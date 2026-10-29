import { type APIRequestContext, type BrowserContext, type Page, expect } from '@playwright/test';
import { E2E_ADMIN_PASSWORD } from './playwright.config';

export const SERVER = 'http://localhost:4000';

export async function adminToken(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${SERVER}/api/admin/login`, {
    data: { password: E2E_ADMIN_PASSWORD },
  });
  return (await r.json()).token;
}

export async function admin(
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

export interface Snap {
  raidId: string;
  status: string;
  gameMs: number;
  result: { outcome: string; special: string; reason: string } | null;
}

export async function snapshot(request: APIRequestContext): Promise<Snap> {
  return (await (await request.get(`${SERVER}/api/public/current-raid`)).json()).snapshot as Snap;
}

/** End whatever runs and leave a fresh raid with boarding open. */
export async function freshLobby(request: APIRequestContext, token: string): Promise<Snap> {
  const st = (await snapshot(request)).status;
  if (st === 'LIVE' || st === 'PAUSED') await admin(request, token, { command: 'END' });
  await admin(request, token, { command: 'NEXT_RAID' });
  if ((await snapshot(request)).status === 'CREATED')
    await admin(request, token, { command: 'OPEN_LOBBY' });
  return snapshot(request);
}

export const mobile = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
};

/** A phone that becomes a guest pilot. */
export async function guestPhone(ctx: BrowserContext, callsign: string): Promise<Page> {
  const p = await ctx.newPage();
  await p.goto('/play');
  await expect(p.getByTestId('onboarding')).toBeVisible();
  await p.getByTestId('callsign-input').fill(callsign);
  await p.getByTestId('guest-login').click();
  await expect(p.getByTestId('callsign')).toContainText(callsign);
  return p;
}

/**
 * Board a station from the hangar: choose it in the station list, then
 * confirm (the hangar separates choosing from boarding).
 */
export async function boardAs(p: Page, role: 'GUNNER' | 'GUARDIAN' | 'ROUTER' | 'ENGINEER') {
  await p.getByTestId(`seat-${role}`).click();
  await p.getByTestId('board-confirm').click();
}

/**
 * Wait inside the page (every animation frame) until `ready` matches, then act.
 * The timing windows are a few hundred ms; polling from the test runner would
 * react too late on a busy machine.
 */
async function whenInPage(p: Page, ready: string, act: 'click' | 'space', target?: string) {
  await p.evaluate(
    ({ ready, act, target }) =>
      new Promise<void>((resolve) => {
        const loop = () => {
          if (!document.querySelector(ready)) return void requestAnimationFrame(loop);
          if (act === 'click') (document.querySelector(target!) as HTMLElement).click();
          else window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
          resolve();
        };
        loop();
      }),
    { ready, act, target },
  );
}

/** Play the Guardian minigame well: press the attack's direction while the gauge is green. */
export async function playGuardian(p: Page) {
  await expect(p.getByTestId('minigame')).toBeVisible();
  await whenInPage(
    p,
    '[data-testid="guardian-gauge"][data-window="1"]',
    'click',
    'button[data-threat="1"]',
  );
}

/** Gunner: fire with the keyboard (Space, the no-touch alternative) when the reticle is in the ring. */
export async function playGunner(p: Page) {
  await expect(p.getByTestId('gunner-fire')).toBeVisible();
  await whenInPage(p, '[data-testid="gunner-reticle"][data-locked="1"]', 'space');
}

/** Router: walk the graph toward a destination (prefers a reachable sink). */
export async function playRouter(p: Page) {
  await expect(p.getByTestId('router-board')).toBeVisible();
  for (let i = 0; i < 12; i++) {
    if (await p.getByTestId('task-result').isVisible()) return;
    const sink = p.locator('[data-kind="sink"][data-next="1"]');
    const next = (await sink.count())
      ? sink.first()
      : p.locator('[data-testid^="router-node-"][data-next="1"]').first();
    if (!(await next.count())) return; // dead end: the timer will submit
    await next.click();
  }
}

/** Engineer: press the switches in the shown order with letter keys. */
export async function playEngineer(p: Page) {
  const order = await p
    .getByTestId('engineer-order')
    .locator('.hud-procedure-sw')
    .allTextContents();
  expect(order.length).toBeGreaterThan(0);
  for (const letter of order) await p.keyboard.press(letter.trim().toLowerCase());
}
