import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dbDir = mkdtempSync(join(tmpdir(), 'satswars-e2e-'));
export const E2E_ADMIN_PASSWORD = 'e2e-admin-password-123';

/**
 * E2E: starts the game server (mock payments, fresh DB) and the web app.
 * Run: pnpm e2e   (uses the Chromium installed for @playwright/test)
 */
export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: [
    {
      command: 'pnpm --filter @sats-wars/server dev',
      url: 'http://localhost:4000/health',
      cwd: '../..',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: '4000',
        ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
        DATABASE_PATH: join(dbDir, 'e2e.db'),
        PAYMENT_MODE: 'mock',
        LOG_LEVEL: 'warn',
        PUBLIC_PLAY_URL: 'http://localhost:3000/play',
        // Paid passes (mock payments) + guest and Lightning (mock wallet) login.
        PASS_MODE: 'PAID',
        // Rehearsal tools (demo seed, time scale) for the scripted-branch test.
        DEMO_MODE: 'true',
        AUTH_MODE: 'both',
        SERVER_PUBLIC_URL: 'http://localhost:4000',
      },
    },
    {
      command: 'pnpm --filter @sats-wars/web dev',
      url: 'http://localhost:3000',
      cwd: '../..',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NEXT_TELEMETRY_DISABLED: '1' },
    },
  ],
});
