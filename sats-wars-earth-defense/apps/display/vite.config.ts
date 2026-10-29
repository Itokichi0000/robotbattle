import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the game server at /display/ (dev: Vite middleware; prod: dist/). One origin for all.
export default defineConfig({
  base: '/display/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
});
