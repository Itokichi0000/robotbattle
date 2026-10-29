import { defineConfig, devices } from '@playwright/test';

/**
 * Phase 1 slice end to end, against the production build served statically by the game
 * server (run `pnpm build` first). Big screen at SAFE quality: CI has no GPU.
 */
const PORT = 4417;
export const BASE = `http://127.0.0.1:${PORT}`;
export const OPERATOR_PASSWORD = 'e2e-operator-password';

export default defineConfig({
  testDir: '.',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../../test-results/e2e',
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node apps/server/dist/index.mjs',
    cwd: '../..',
    url: `${BASE}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'development',
      WEB_MODE: 'static',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      PUBLIC_BASE_URL: BASE,
      OPERATOR_PASSWORD,
      DATABASE_PATH: ':memory:',
      MATCH_PRESET: 'TEST',
      MATCH_SEED: '42',
      LOG_LEVEL: 'warn',
    },
  },
});
