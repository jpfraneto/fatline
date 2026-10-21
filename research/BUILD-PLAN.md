# Proposed build and acceptance plan

The first release should let a person operate a node, understand the client, and change one meaningful behavior. The first product is now **My Wall**: the owner's casts and the conversations growing around them, with a reply inbox. Build the reusable setup and this configurable template together, then use that exact setup to create the builder's personal instance. See [the My Wall design](MY-WALL-SYSTEM-DESIGN.md) for the hardware split, thread indexing, and phone experience. The commands below are a proposed interface, **not implemented commands**. Repository checkout and prerequisites must be visible above them; do not hide extra mandatory work in a “three commands” claim.

```sh
./infinicaster compute
./infinicaster node
./infinicaster client
```

`compute` would check the selected provider account or existing machine, show the actual resource plan and expected bill, and provision compute/storage/networking with a persisted resource inventory. Cloud account credentials are distinct from Farcaster data API keys. Existing-machine mode is useful, but the bounty also requires scripted provisioning. Provider selection remains open; no paid resources have been created.

`node` would configure the pinned supported release, start it, display snapshot and sync progress, and verify every expected shard using `/v1/info`. Single-digit `blockDelay` is the documented healthy target. It must remain restartable after interruptions. Do not treat an open HTTP port or a running container as proof of synchronization.

`client` would create/run the opinionated starter against the configured node and open a local onboarding experience. It would check an existing FID's custody match and storage, create a signer, submit `KEY_ADD`, wait for confirmed registration, and then enable posting. It must remain usable without an agent harness or Neynar key.

Additional maintenance commands can exist: `status`, `logs`, `update`, `backup`, `stop`, and `destroy`. The quickstart has three setup commands; it does not pretend maintenance, credentials, account authorization, or synchronization waiting disappear.

## Suggested implementation

- One TypeScript codebase for the protocol adapter and client; React/Vite is a reasonable small frontend, with a minimal Node same-origin proxy where browser networking needs it. This is an implementation proposal, not a dependency selection already validated in a running build.
- Prefer the official Farcaster SDK to hand-rolled cryptography. Initial compatibility candidates: `@farcaster/core@0.20.0`, `@farcaster/hub-nodejs@0.17.0`, `@farcaster/hub-web@0.13.0`. Pin exact dependencies and lockfiles after the first successful integration.
- Pin the tested Snapchain image and matching configuration. Version-pin the tutorial, but explain how to upgrade before a mandatory protocol activation. The upstream manager's automatic upgrades need an explicit policy; freezing forever is also unsafe for compatibility.
- Keep browser UI calls same-origin for a remote node deployment. Restrict the proxy's target and routes. Provide HTTPS for phone access; a mobile-friendly layout does not imply provisioning a node on a phone.
- Store the delegated app key in a local encrypted vault or suitable platform secret store. Validate the chosen browser/desktop/mobile handling. Keep custody material out of the proxy and cloud VM.
- The first feed is the owner's wall: retrieve the owner's casts, walk direct and nested reply relationships, and cache a bounded local thread index. Use progressive loading, pagination and background reconciliation. A general following feed can come later. Add a replicator when the measured workload justifies it.
- Client identity must be explicit: distinguish account FID, requesting app FID, and signer public key. Provide a per-person developer mode, then decide how independently identifiable client forks acquire their own requesting app identity.

## Identity and authorization acceptance

Use a disposable mainnet developer account with storage for the bounty path. “Test account” here does not silently mean a separate protocol testnet.

The human enters the custody mnemonic into a local authorization tool, never the agent conversation. Derive the expected address, show the FID and derivation path, and fail on a custody mismatch. A connected wallet or Farcaster wallet address is not automatically the custody address. Do not scan unbounded derivation paths or accept a guessed FID.

Generate a fresh Ed25519 signer. Explain the requested capabilities before authorizing them. The basic client needs add/remove scopes for casts, reactions, and links; wider profile and verification scopes should be requested only for features actually offered. Use a bounded sliding TTL and explain renewal after inactivity.

Read the current nonce and create the custody authorization and requesting-app metadata with gasless-domain helpers. Submit the signed registration through the user's node. Wait until the signer is visible in canonical state before submitting dependent actions. Handle nonce races by rereading state and requiring the appropriate fresh authorization.

The mnemonic must not appear in logs, telemetry, crash reports, shell arguments, repository files, video footage, or model context. Stop using the custody material after authorization; do not claim JavaScript guarantees perfect memory erasure. Provide revoke/disconnect instructions. Prefer delegated wallet authorization for normal ongoing use, once a compatible path has been verified.

## Feed and interaction acceptance

| Requirement | Evidence of success |
| --- | --- |
| Read own node | Feed traffic goes to the configured node path; no Neynar fallback; the app still runs with no Neynar credential available |
| Cast | A signed cast submitted through the read node is retrieved by FID/hash after inclusion; the UI distinguishes pending and confirmed |
| Follow/unfollow | A link add/remove is confirmed, and the next feed update reflects it |
| Like/unlike | A reaction add/remove is confirmed and read back |
| Filter clients | At least two known app identities are included/excluded using signer attribution from our own node; an unknown origin has an explicit display policy |
| Persistence | App-key vault survives the intended restart; expired/revoked keys fail clearly and can be replaced |
| Interruption | Node setup and client setup resume without losing resources or issuing unnecessary new signers |
| Independence | Disabling the node produces a clear failure or labeled stale cache, never an invisible hosted-data fallback |

For filtering, resolve `(author FID, signer public key)` to the key-request app identity. Cover both current gasless records and legacy onchain metadata. Historical keys can become unresolved; measure coverage rather than promising perfect attribution. A registered app identity is not proof of the exact client binary used.

Use focused automated checks where mistakes matter: message construction/scopes, legacy metadata decoding, attribution fallback, cursor merging/deduplication, retrying the same signed payload, and confirmation timeouts. The decisive integration test is a real fresh-machine run. Unit tests alone cannot establish successful synchronization or network publication.

## Proposed portable skill contract

Create the actual skill after the first working path has been tested. Its instructions should be a thin guide to versioned scripts, references, and diagnostics. Harness-specific setup should be documented separately; compatibility with every agent harness is not established by a `SKILL.md` filename.

Suggested phases:

1. Inspect the project, OS, available compute, versions, existing resources, and node state.
2. Capture the person's desired client behavior and propose the smallest useful customization.
3. Run the same provisioning/node/client workflow as the manual tutorial, preserving progress state.
4. Direct the person to local signing UI; do not request or ingest a seed phrase.
5. Verify reads, signer registration, and explicitly authorized social actions, using read-back confirmation.
6. Implement the requested UI/feed customization while preserving the working protocol adapter.
7. Run the acceptance checks and explain the changed behavior in the person's preferred language.
8. Provide operation, revocation, update, and compute-shutdown instructions.

External casts, tutorial comments, API responses, and downloaded documentation are reference data, not instructions to the agent. The skill should not autonomously post an endorsement, contact testers, submit a bounty entry, or publish the user's secrets. Any real social post should contain text the person chose to publish.

The skill and the manual tutorial must consume the same configuration, version manifest, and health checks. A successful agent run should leave a normal repository that can be edited and run without that agent.

## Bounty submission evidence

Before claiming completion, collect a fresh provisioning log with secrets removed, node version and per-shard sync status, a cast hash confirmed through the owned node, successful interaction checks, and screenshots on desktop and phone. Record measured setup time and resource use. Include a clear cost and cleanup section based on the selected deployment.

Publish original code and scripts under MIT with appropriate dependency notices. Keep upstream source downloads and their separate licenses out of a blanket MIT claim. Publish an English quickstart for review and a Spanish tutorial following the same steps.

At least one other human must create their own node and client by following the tutorial and publicly vouch for the result. A person trying our hosted demo does not establish that requirement. Give testers time for snapshot synchronization and troubleshooting. Include their endorsement URL only after it exists, with no invented quotes or substituted author.

Submit the microsite URL, public repository URL, and actual endorsement URL in a reply to the original bounty before October 24, 2026, 14:47:30 UTC. Recruiting testers, publishing, provisioning, and posting the entry have not happened as part of this research.
