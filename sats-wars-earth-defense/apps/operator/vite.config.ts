import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the game server at /operator/ (dev: Vite middleware; prod: dist/). One origin for all.
export default defineConfig({
  base: '/operator/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
});
