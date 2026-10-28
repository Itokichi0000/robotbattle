import { defineConfig } from '@playwright/test';

/**
 * three.js display test for the Blender-built robots.
 *   pnpm --filter @sats-wars/model-viewer e2e
 * Serves the repository root (serve.mjs) and opens dist/index.html in Chromium (SwiftShader).
 */
export default defineConfig({
  testDir: 'test',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results/model-viewer',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 720, height: 900 },
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'node serve.mjs',
    url: 'http://localhost:4173/tools/model-viewer/dist/index.html',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
