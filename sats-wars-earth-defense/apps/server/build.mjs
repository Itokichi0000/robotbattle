// Bundles the server (and the TypeScript workspace packages it imports) into one ESM file.
// Third-party packages stay external and load from node_modules at runtime.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  plugins: [
    {
      name: 'external-deps',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith('@swed/')) return undefined;
          if (args.path.startsWith('node:')) return { path: args.path, external: true };
          return { path: args.path, external: true };
        });
      },
    },
  ],
});
