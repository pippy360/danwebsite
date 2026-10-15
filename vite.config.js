import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works from any sub-path (e.g. GitHub Pages /danwebsite/).
  base: './',
  server: { host: true },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
});
