import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * Bundles the viewer into dist/index.html (single file). It fetches the GLBs at run time,
 * so serve the repository root (node serve.mjs) and open
 *   http://localhost:4173/tools/model-viewer/dist/index.html
 */
const result = await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = `
  html, body { margin: 0; height: 100%; background: #070D1A; color: #EFF5FF; overflow: hidden;
    font: 13px/1.4 system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif; }
  canvas { display: block; }
  #ui { position: fixed; top: 12px; left: 12px; width: 250px; padding: 12px 14px; border-radius: 10px;
    background: rgba(7, 13, 26, 0.82); border: 1px solid rgba(239, 245, 255, 0.15); }
  #ui h1 { font-size: 14px; margin: 0 0 8px; letter-spacing: 0.08em; }
  #ui h1 span { color: #25C8D7; font-weight: 400; }
  #ui label { display: flex; justify-content: space-between; align-items: center; margin: 4px 0; gap: 8px; }
  #ui select { background: #0B1426; color: inherit; border: 1px solid #2B3B5C; border-radius: 6px; padding: 2px 4px; }
  #ui pre { margin: 10px 0 0; font: 11px/1.45 ui-monospace, monospace; white-space: pre-wrap; color: #B9C7D6; }
  @media (max-width: 600px) { #ui { width: auto; right: 12px; } }`;
const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SATS WARS Model Viewer</title>
<style>${css}</style></head>
<body><script>${js}</script></body></html>
`;
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log(`dist/index.html  ${(html.length / 1024).toFixed(0)} KB`);
