// One screenshot of a page after it settles: node tools/perf/shot.mjs <url> <out.png> [waitMs] [WxH]
// Software WebGL (CI containers) renders a few FPS, hence the generous timeouts.
import { chromium } from '@playwright/test';

const [url, out, wait = '8000', size = '1920x1080'] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 300)));
await page.goto(url);
await new Promise((r) => setTimeout(r, Number(wait)));
await page.screenshot({ path: out, timeout: 240_000 });
await browser.close();
console.log('saved', out);
