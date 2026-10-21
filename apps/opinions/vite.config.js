import { defineConfig } from 'vite';

// In development the app runs on Vite and the API on the indexer. In production the indexer
// serves the built app itself, so both share one origin.
export default defineConfig({
  server: {
    proxy: { '/api': process.env.INDEXER_URL ?? 'http://localhost:8787' },
  },
});
