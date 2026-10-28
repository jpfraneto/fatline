# Vendored scripts

Served from fatline.ink itself, so no CDN can change what runs on the site. Pages import them by path.

| File | Source | sha384 |
|---|---|---|
| `miniapp-sdk-0.3.0.mjs` | `@farcaster/miniapp-sdk@0.3.0` from npm, bundled: `echo "export { sdk } from '@farcaster/miniapp-sdk';" > e.mjs && npx esbuild@0.24.2 e.mjs --bundle --format=esm --minify --target=es2020 --platform=browser` | `AmEBnDWZhdrFxJbDKDNVzvLQWhOyxIRHmXM+FnU4XG9Y6ftWo1qwAA7Ctmgasrw6` |
| `marked-12.0.2.esm.js` | `lib/marked.esm.js` from `npm pack marked@12.0.2` (tarball matches npm's sha512), source-map line removed | `O6f7ldSZHhbZnfu7PyQqJTAq1dTX+5UxuG+zkElhRqFClfIsm5QGBf0atTfdLf0D` |

To upgrade: rebuild the same way, new filename with the version, update the imports, this table.
