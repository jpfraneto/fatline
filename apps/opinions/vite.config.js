import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// In development the app runs on Vite and the API on the indexer. In production the indexer
// serves the built app itself, so both share one origin.
export default defineConfig({
  server: {
    // The instruction manual lives in apps/site/manual.js (fatline.ink serves the same file).
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../site', import.meta.url))] },
    proxy: { '/api': process.env.INDEXER_URL ?? 'http://localhost:8787' },
  },
});
