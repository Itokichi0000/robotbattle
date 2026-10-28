import { defineConfig } from 'vitest/config';

// Also runs the Blender asset-tool tests (tools/blender has no package of its own).
export default defineConfig({
  test: { root: '..', include: ['simulations/src/**/*.test.ts', 'blender/test/**/*.test.ts'] },
});
