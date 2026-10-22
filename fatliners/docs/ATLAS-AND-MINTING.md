# Memory Atlas and minting model

## The Memory Atlas

Every Fatliner has an Atlas that explains why it looks the way it does. It's built by `src/atlas.mjs` and has two views.

**Public view** (the default, safe to publish):
```jsonc
{
  "schema": "fatliners.atlas/1",
  "subject": "fid:18350",               // or "synthetic:syn-returner"
  "synthetic": false,
  "token": { "id": null, "originalFid": 18350, "mintedBy": null, "note": "not minted" },
  "snapshot": {
    "at": 1792627200000,                // ms: nothing after this moment shaped the face
    "commitment": "0x…",                // sha256 over the message set per network (see below)
    "networks": { "farcaster": { "count": 320, "root": "0x…" }, "hypersnap": null },
    "ageSource": "onchain registration" // or "oldest message the node still holds (a lower bound)"
  },
  "versions": { "features": "fatliners.features/1", "dna": "fatliners.dna/1", "renderer": "fatliners.render/1" },
  "seed": "0x…",
  "dimensions": {
    "roots": { "trait": "kintsugi", "rings": 4, "reading": "It went silent for long stretches, and came back. Every return left a seam of gold. …",
               "signals": { "age": "2–4 years", "activeMonths": "most", "returns": "a few" } },
    "orbit": { … }, "voice": { … }, "pulse": { … }, "bloom": { … }
  },
  "palette": { "glaze": "butter", "harmony": "kin" }
}
```
- Signals are **bands** ("about a third", "2–4 years"), never exact counts.
- No message hashes, no text, no channel names or ids, no FIDs of people they talk to. `test/privacy.test.mjs` checks this.
- `networks` gives counts and a hash root per network. `null` means "not seen on that network in this snapshot", not "doesn't exist there".

**Owner view** (`generate(h, { view: 'owner' })`) adds the exact feature numbers. It's for the person whose history it is, for example behind a wallet sign-in in the Fatline client. It's never published by default.

**The raw history snapshot is never published.**

### Verifying an origin
1. Take the FID and `snapshot.at` from the Atlas or the token's onchain origin.
2. From any node that still holds the messages, list that FID's merged casts, reactions and links up to `snapshot.at`, per network. Then run `rowsToHistory` → `commitment()`.
3. It must equal the onchain `origin.commitment`. Then `generate()` reproduces the exact SVG.

Caveat: Snapchain prunes old messages under storage limits. The longer after minting, the less likely a node still holds everything. The fix is to keep each minted snapshot's message-hash list (not content) in the archive, or pinned with the art. **Not built.**

## Minting model (contract written and tested, NOT deployed)

`contracts/src/Fatliners.sol`, Foundry tests in `contracts/test/` (10 passing).

| Identity | Where | Changes? |
| --- | --- | --- |
| The FID whose history made the being | `origin(id).fid`, `tokenOfFid[fid]` | Never |
| The wallet authorized to mint | `origin(id).minter` | Never |
| The wallet that owns it now | `ownerOf(id)` | With each transfer |

- **Exactly 777.** `MAX_SUPPLY = 777`. Token ids 1..777 in mint order.
- **One birth per FID, forever.** Selling a being doesn't let its FID mint again.
- **Eligibility is attested.** An attester key signs an EIP-712 `Mint(fid, minter, snapshotAt, commitment, renderer, deadline)`. The signature is bound to the caller and to the commitment, so it can't be replayed by someone else or used to swap in a different history.
- The attester service (not built) must check:
  - The minter is the FID's custody address, or an address it has verified.
  - The commitment is recomputed from the network itself, not taken from the user.
- **Free.** `mint` isn't payable. The contract holds no money and has no token economy.
- **Admin is small and can go away:** it can rotate the attester and set the metadata URI until `freezeMetadata()`, and `setAdmin(address(0))` renounces it.

### Open decisions (owner)
1. **Chain.** Base (where the launchpad lives) or Optimism, where the FID registry is. On Optimism, custody could be checked onchain instead of attested.
2. **Where the art lives.**
   - Options: IPFS (baseURI + freeze), or fully onchain SVG (port `render.mjs` to Solidity, or store each SVG with SSTORE2).
   - Size: a full SVG is ~20–30 KB. Storing it onchain costs ~5–7M gas per being.
3. **Snapshot time.** At mint (each being frozen at its own moment) or one shared date for all 777.
4. **Who may mint.** First 777 verified FIDs, an allowlist, or something else.
5. **Calibration.** Thresholds must be tuned on real FIDs before any mint (see DNA-MAPPING.md §5).

Nothing is deployed. Deploying, minting or any onchain action needs the owner's explicit yes.

## The living layer and Fatline

- **Permanent PFP:** the SVG from the minted snapshot. It never changes.
- **Living representation:**
  - The same DNA with `living: true`.
  - Later, a second "current" snapshot can drive the living line only, while the face stays.
  - Not built: a live re-derivation over time.
- **Network signal states:**
  - One arc per network around the node, coloured per network, dashed when that node is behind.
  - The preview has toggles. The Fatline client could feed real states from its node health checks.
- **In the Fatline archive client:** a Fatliner can be the avatar of the FID that owns it. The client would read `tokenOfFid` and `ownerOf`, and render the SVG locally from DNA. Not integrated, since `apps/` belongs to other sessions.
