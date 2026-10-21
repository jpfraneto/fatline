# Opinions without noise

A quiet feed. **Voices** shows long-form opinions published onchain. **My people** shows only the people you add: their casts (no replies) and their verified voices. A switch at the top picks Farcaster or Hypersnap, and a line below it says which node you are reading from.

It is plain JavaScript with Vite and viem. The indexer serves the built app from `dist/`.

```sh
npm ci
npm run dev        # expects the indexer on :8787 (override with INDEXER_URL)
npm run build
```

Your list of people, language, and network are kept in the browser's local storage. Publishing uses the browser wallet (`window.ethereum`) and switches it to the configured chain.
