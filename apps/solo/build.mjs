import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Paths below are relative to this app (the web build calls this script too).
const here = dirname(fileURLToPath(import.meta.url));
process.chdir(here);

/**
 * Builds ONE self-contained HTML file (no server, no external requests; system
 * fonts only, spec 1.5): the game engine, bots, 3D arena and UI are all inlined.
 * Output: dist/sats-wars-solo.html  (open it directly in a browser).
 */
const result = await build({
  absWorkingDir: here,
  entryPoints: ['src/main.tsx'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
// Shared cockpit styles first, then the demo layout.
const css =
  readFileSync('../../packages/ui/src/ui.css', 'utf8') +
  '\n' +
  readFileSync('src/styles.css', 'utf8');
const html = `<title>SATS WARS Earth Defense</title>
<meta name="description" content="SATS WARS — EARTH DEFENSE（雷神×風神の協力レイド）のオフライン体験版">
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
<div id="root"></div>
<script>${js}</script>
`;
mkdirSync('dist', { recursive: true });
writeFileSync('dist/sats-wars-solo.html', html);
// A standalone variant with a full document skeleton, for opening the file locally.
writeFileSync(
  'dist/sats-wars-solo.standalone.html',
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${html.replace('<div id="root"></div>', '</head><body style="margin:0"><div id="root"></div>')}</body></html>`,
);
// The web app serves the same offline demo at /demo (no wallet, no server: bots only).
mkdirSync('../web/public/demo', { recursive: true });
writeFileSync(
  '../web/public/demo/solo.html',
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${html.replace('<div id="root"></div>', '</head><body style="margin:0"><div id="root"></div>')}</body></html>`,
);
console.log(
  `dist/sats-wars-solo.html  ${(html.length / 1024).toFixed(0)} KB (+ apps/web/public/demo/solo.html)`,
);
