import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * Screenshots of the viewer (needs `node serve.mjs` running and `node build.mjs` done):
 *   node capture.mjs --source procedural --out ../../assets/models/reference
 *   node capture.mjs --source glb --dir /some/dir/ --out /tmp/shots
 * Writes <robot>_<source>_<view>.png for front / side / back / 45.
 */
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const source = arg('source', 'glb');
const out = resolve(arg('out', 'shots'));
const robots = arg('robot', 'raijin,fujin').split(',');
const views = arg('views', 'front,side,back,45').split(',');
const dir = arg('dir', null);
const light = arg('light', 'studio');
const base = arg('base', 'http://localhost:4173/tools/model-viewer/dist/index.html');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
for (const robot of robots) {
  const q = new URLSearchParams({ robot, source, ui: '0', t: '0', clip: 'Idle', light, view: views[0] });
  if (dir) q.set('dir', dir);
  await page.goto(`${base}?${q}`);
  await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 120_000 });
  const err = await page.evaluate(() => window.__viewer.error);
  if (err) throw new Error(err);
  for (const v of views) {
    await page.evaluate((name) => {
      window.__viewer.setView(name);
      window.__viewer.render();
    }, v);
    const file = resolve(out, `${robot}_${source}_${v}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
}
await browser.close();
