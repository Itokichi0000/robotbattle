#!/usr/bin/env node
// Production-mode launcher (run `pnpm build` first).
process.argv[2] = 'start';
await import('./dev.mjs');
