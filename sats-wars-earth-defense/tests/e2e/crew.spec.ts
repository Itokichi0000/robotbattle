import {
  devices,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import type { MatchSnapshotMsg } from '@swed/shared';
import { solvePuzzle } from '../../packages/game-engine/src/router';
import { signedCallback } from '../../apps/server/src/testWallet';
import { BASE, OPERATOR_PASSWORD } from './playwright.config';

/**
 * PHASE 2–4 acceptance on the production build:
 *  - a pilot signs in with an LNURL-auth wallet (the test wallet signs like LUD-04 wallets),
 *    opts in to a callsign, and the same wallet on a second phone takes over the seat;
 *  - a VIRTUAL shared-energy pulse is requested on the phone, settled by staff, applied once;
 *  - eight seats (three people + five labelled demo bots) fly a whole sortie to the debrief,
 *    with POWER A, POWER B and ENGINEER driven from real phone screens.
 * Outcomes are always read from the server's public state.
 */

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
  await expect(page.getByText('MATCH CONTROL')).toBeVisible();
  return { ctx, page };
}

async function resetMatch(op: Page): Promise<void> {
  // Specs share one server: no demo bots or seats left over from an earlier test.
  await expect(op.locator('.payments')).toBeVisible(); // operator status has arrived
  if (await op.getByLabel(/DEMO BOTS/).isChecked()) await op.getByLabel(/DEMO BOTS/).uncheck();
  await op.getByRole('button', { name: /^RESET$/ }).click();
  await expect.poll(async () => (await publicMatch(op)).state.humans, { timeout: 15_000 }).toBe(0);
  await expect
    .poll(async () => (await publicMatch(op)).phase, { timeout: 15_000 })
    .toMatch(/ATTRACT|LOBBY/);
}

async function newPhone(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  await p.goto('/pilot/');
  return p;
}

async function boardAsGuest(browser: Browser, seat: RegExp): Promise<Page> {
  const p = await newPhone(browser);
  await p.getByRole('button', { name: /DEMO GUEST/ }).click();
  await board(p, seat);
  return p;
}

async function board(p: Page, seat: RegExp): Promise<void> {
  await expect(p.getByText('搭乗する席を選ぶ')).toBeVisible();
  await p.getByRole('button', { name: seat }).click();
  await expect(p.getByText('搭乗完了')).toBeVisible();
  await p.getByRole('button', { name: /READY/ }).click();
  await expect(p.getByText(/出撃待機中/)).toBeVisible();
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

test('LNURL-auth pilot, callsign opt-in, one wallet one phone, VIRTUAL pulse applied once', async ({
  browser,
}) => {
  const { page: op } = await operator(browser);
  await resetMatch(op);

  const display = await (
    await browser.newContext({ viewport: { width: 1280, height: 720 } })
  ).newPage();
  await display.goto('/display/?q=SAFE');
  await expect(display.locator('.stage canvas')).toBeVisible({ timeout: 60_000 });

  // Sign-in is free and separate from payments; the wallet signs, the phone moves on.
  const seed = 'e2e wallet alpha';
  const a = await newPhone(browser);
  await expect(a.getByText(/パイロット認証（無料）/)).toBeVisible();
  await walletApproves(a, seed);
  await expect(a.getByText('搭乗する席を選ぶ')).toBeVisible({ timeout: 20_000 });
  await expect(a.locator('.who')).toHaveText(/^PILOT-[0-9A-Z]+$/);

  // A forged login (someone else's key on this k1) is refused by the server.
  const forged = await a.request.get(
    `${BASE}/api/auth/lnurl?tag=login&k1=${'00'.repeat(32)}&key=02${'11'.repeat(32)}&sig=3006020101020101`,
  );
  expect((await forged.json()).status).toBe('ERROR');

  // Callsign is opt-in: shown on the big screen only when the pilot asks for it.
  await a.getByRole('button', { name: /コールサインを設定/ }).click();
  await a.getByLabel(/コールサイン（2〜12文字/).fill('RAIJIN_FAN');
  await a.getByLabel(/大画面に表示する/).check();
  await a.getByRole('button', { name: '保存' }).click();
  await expect(a.getByRole('button', { name: '保存しました' })).toBeVisible();
  await board(a, /砲撃 右/);
  await expect
    .poll(async () => (await publicMatch(op)).state.seats.GUNNER_R.displayName)
    .toBe('RAIJIN_FAN');

  await op.getByRole('button', { name: /START/ }).click();
  await expect.poll(async () => (await publicMatch(op)).phase, { timeout: 20_000 }).toBe('WAVE_1');
  await expect(display.locator('.strip').getByText('RAIJIN_FAN')).toBeVisible();

  // Shared energy pulse: its own sheet, VIRTUAL in sandbox, fixed amount, never required.
  const before = (await publicMatch(op)).state.teamCapacitor;
  await a.getByRole('button', { name: '共有エネルギー' }).click();
  const sheet = a.getByRole('dialog', { name: '共有エネルギー' });
  await expect(sheet.getByText(/VIRTUAL（架空・無料のテスト）/)).toBeVisible();
  await expect(sheet.getByText('21 sats')).toBeVisible();
  await expect(sheet.getByText(/支払わなくても最後まで遊べます/)).toBeVisible();
  await sheet.getByRole('button', { name: /VIRTUAL パルスを申請/ }).click();
  await expect(sheet.getByText(/テスト用の架空の請求書/)).toBeVisible();

  // Staff settle it in the console; the server applies +20 exactly once.
  const settle = op.locator('.payments').getByRole('button', { name: 'SETTLE' });
  await expect(settle).toBeVisible({ timeout: 10_000 });
  await settle.click();
  await expect(sheet.getByText(/を炉心へ送りました/)).toBeVisible({ timeout: 15_000 });
  const after = await publicMatch(op);
  expect(after.state.stats.pulses).toBe(1);
  expect(after.state.teamCapacitor).toBeGreaterThanOrEqual(Math.min(100, before + 20) - 1);
  await expect(op.locator('.payments').getByRole('button', { name: 'SETTLE' })).toHaveCount(0);
  await a.getByRole('button', { name: '閉じる' }).click();

  // The same wallet signs in on another phone: that phone takes the seat, this one steps down.
  const b = await newPhone(browser);
  await walletApproves(b, seed);
  await expect(b.getByText('TARGET LOCK')).toBeVisible({ timeout: 20_000 });
  await expect(a.getByText(/別の端末からログインしたため/)).toBeVisible({ timeout: 20_000 });
  const m = await publicMatch(op);
  expect(m.state.seats.GUNNER_R.occupied).toBe(true);
  expect(m.state.humans).toBe(1);
  expect(JSON.stringify(m)).not.toMatch(/linking|pilotId|02[0-9a-f]{64}/);
});

const LANE_JA = {
  weapon: '武器系',
  shield: 'シールド系',
  mobility: '機動系',
  repair: '修理系',
} as const;

/** Drives POWER B's puzzle on the phone: taps each tile into the solver's rotation. */
async function solveRouterOnPhone(router: Page, op: Page): Promise<boolean> {
  const s = (await publicMatch(op)).state;
  const lane = (['weapon', 'shield', 'mobility', 'repair'] as const).find(
    (l) => s.circuits[l].broken,
  );
  if (!lane) return false;
  const puzzle = s.circuits[lane].puzzle!;
  const target = solvePuzzle(puzzle);
  if (!target) return false;
  await router.getByRole('tab', { name: new RegExp(LANE_JA[lane]) }).click();
  for (let i = 0; i < 9; i++) {
    const turns = (((target[i]! - puzzle.tiles[i]!.rot) % 4) + 4) % 4;
    for (let k = 0; k < turns; k++)
      await router.getByRole('button', { name: `タイル ${i + 1} を回す` }).click();
  }
  await expect(router.getByText('接続OK')).toBeVisible();
  await router.getByRole('button', { name: /接続する/ }).click();
  return true;
}

test('eight seats, one sortie: people and labelled demo bots fly to the debrief', async ({
  browser,
}) => {
  test.setTimeout(480_000);
  const { page: op } = await operator(browser);
  await resetMatch(op);

  const display = await (
    await browser.newContext({ viewport: { width: 1280, height: 720 } })
  ).newPage();
  await display.goto('/display/?q=SAFE');
  await expect(display.locator('.stage canvas')).toBeVisible({ timeout: 60_000 });

  const power = await boardAsGuest(browser, /電力 A/);
  const router = await boardAsGuest(browser, /電力 B/);
  const engineer = await boardAsGuest(browser, /整備 A/);

  // Demo bots take the five empty seats and are labelled as bots everywhere.
  await op.getByLabel(/DEMO BOTS/).check();
  await expect.poll(async () => (await publicMatch(op)).state.humans, { timeout: 15_000 }).toBe(8);
  const lobby = (await publicMatch(op)).state;
  expect(lobby.seats.GUNNER_L.bot).toBe(true);
  expect(lobby.seats.POWER_CORE.bot).toBe(false);
  // The big screen names the bots as bots (lobby plate or, if the 12 s auto start already
  // launched the sortie, the C1–C4 strip).
  await expect(display.getByText('DEMO-BOT 1').first()).toBeVisible();

  if ((await publicMatch(op)).phase === 'LOBBY')
    await op.getByRole('button', { name: /START/ }).click();
  await expect.poll(async () => (await publicMatch(op)).phase, { timeout: 30_000 }).toBe('WAVE_1');

  // POWER A: a one-tap plan goes to the server against the current version.
  await expect(power.getByText('REACTOR OUTPUT 100%')).toBeVisible();
  const v0 = (await publicMatch(op)).state.distributionVersion;
  await power.getByRole('button', { name: /攻撃重視/ }).click();
  await expect.poll(async () => (await publicMatch(op)).state.distribution.weapon).toBe(55);
  expect((await publicMatch(op)).state.distributionVersion).toBeGreaterThan(v0);

  // POWER B and ENGINEER: answer the first overload and the first damage on their section.
  let routed = false;
  let repaired = false;
  await expect
    .poll(
      async () => {
        const s = (await publicMatch(op)).state;
        if (
          !routed &&
          (['weapon', 'shield', 'mobility', 'repair'] as const).some((l) => s.circuits[l].broken)
        ) {
          routed = await solveRouterOnPhone(router, op).catch(() => false);
        }
        if (
          !repaired &&
          s.engineers.ENGINEER_LEGS.job === null &&
          (s.parts.LEG_L < 100 || s.parts.LEG_R < 100) &&
          s.t >= s.engineers.ENGINEER_LEGS.cooldownUntil
        ) {
          const btn = engineer.getByRole('button', { name: /修理実行/ });
          if (await btn.isEnabled().catch(() => false)) {
            await btn.click().catch(() => undefined);
            for (const n of [1, 2, 3])
              await engineer
                .getByRole('button', { name: `ボルト ${n}` })
                .click({ timeout: 3_000 })
                .catch(() => undefined);
          }
        }
        const after = (await publicMatch(op)).state;
        repaired = after.seats.ENGINEER_LEGS.stats.repairs >= 1;
        return after.seats.POWER_ROUTER.stats.routes >= 1 && repaired;
      },
      { timeout: 200_000, intervals: [1_000] },
    )
    .toBe(true);

  // The whole sortie runs on: bosses, combos, overdrive calls, to a server-decided outcome.
  let sawOverdrive = false;
  await expect
    .poll(
      async () => {
        const m = await publicMatch(op);
        if (m.state.overdrive.status !== 'IDLE' && !sawOverdrive) {
          sawOverdrive = true;
          await expect(display.locator('.od-banner'))
            .toBeVisible({ timeout: 5_000 })
            .catch(() => undefined);
          await expect(power.locator('.od-call'))
            .toBeVisible({ timeout: 5_000 })
            .catch(() => undefined);
        }
        return m.phase;
      },
      { timeout: 300_000, intervals: [1_000] },
    )
    .toMatch(/VICTORY|DEFEAT|RESULTS/);
  const end = (await publicMatch(op)).state;
  expect(end.result).not.toBeNull();
  expect(end.stats.combos).toBeGreaterThan(0);
  expect(end.stats.repairs).toBeGreaterThan(0);
  expect(end.stats.routesFixed).toBeGreaterThan(0);
  expect(end.stats.pulses).toBe(0);
  await expect(power.getByText(/VICTORY|DEFEAT|勝利|敗北|撃退|防衛失敗/).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(display.locator('.results')).toBeVisible({ timeout: 40_000 });

  await op.getByLabel(/DEMO BOTS/).uncheck();
  await expect.poll(async () => (await publicMatch(op)).state.humans, { timeout: 15_000 }).toBe(3);
});
