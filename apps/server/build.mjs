import { build } from 'esbuild';

// Bundle workspace packages into one file; keep npm dependencies external.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  alias: {
    '@sats-wars/shared': '../../packages/shared/src/index.ts',
    '@sats-wars/game-engine': '../../packages/game-engine/src/index.ts',
  },
  logLevel: 'info',
});
