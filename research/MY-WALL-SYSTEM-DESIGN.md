# Fatline: My Wall as the first implementation

Direction from the October 18, 2026 conversation. This updates the earlier generic following-feed proposal. This document describes a proposed system; the Farcaster client and node installer are not implemented yet.

## The product

An owner-centered Farcaster client for the community forming around a person's casts. The owner publishes, sees the replies to their posts, and joins those conversations. Other people can reply from any compatible Farcaster client. Using this interface does not create a separate social network or require followers to move their accounts.

The reusable system consists of a protocol adapter, node setup scripts, a small wall-data service, an installable web application, and a configurable My Wall template. We develop these together, then use the same supported setup path to create the builder's first personal instance. The personal instance should require no manual exceptions or private developer-only setup steps.

The initial customization inputs are the owner FID, display preferences, language, node endpoint, and hosting configuration. The owner FID is public identity, not authorization to post. Signing authorization is an explicit separate step. No actual owner FID was supplied in this turn, so do not assume it from filesystem or browser account names.

## What “compute” means

Compute is the physical or rented computer running the server software. For this setup, that includes processor capacity, memory, disk, and internet connectivity. Provisioning means using a script to create and configure those resources.

Separate the three machines/roles:

| Role | What it runs | Requirements and limits |
| --- | --- | --- |
| Learner's laptop | Editor, terminal, installer; optionally the wall during development | A supported OS, internet, a browser and the toolchain we document. Exact supported versions and free-disk requirements must be measured with the implementation. It does not need 2 TB when the node is remote. |
| Node server | Snapchain, plus optionally the lightweight wall service | Current official requirements: 4 CPU cores, 16 GB RAM, 2 TB free storage, public IP and appropriate network ports. Budget additional headroom if other services share it; validate by running it. |
| Owner's or follower's phone | Wall interface in the browser or as an installed web app | A supported browser and internet connection. The phone does not store the full network or run Snapchain. Establish the tested browser/OS matrix before promising compatibility. |

Source: [Snapchain getting started](https://snapchain.farcaster.xyz/getting-started), checked October 18, 2026. The full-network snapshot is several hundred gigabytes and initial synchronization can take hours. These are node requirements, not a claim about measured requirements for our unbuilt wall service.

This Mac was inspected read-only: Apple M3, eight physical/logical CPU cores, 16 GiB RAM, arm64, macOS 26.6.2. Its internal disk reports 460 GiB total and about 15 GiB available. Node.js v22.12.0 and a Docker CLI are present; Docker engine availability and Snapchain ARM compatibility were not tested. The disk is insufficient for the documented full node. The Mac is suitable for developing the small interface while the node runs on a separately provisioned server. No files were deleted and no paid compute was provisioned.

A wall that displays only one person's conversations still depends on a full read node in the documented self-hosted setup. A small local index can retain just wall-relevant data; this does not reduce Snapchain's own full-state requirement. Do not promise a 15 GB personal-only Snapchain node.

One node can serve multiple wall instances, subject to load and capacity testing. A separate app instance does not inherently require a separate full-network copy. For the bounty tutorial's independent reproduction, the tester must still successfully create a node and client. Future users who connect an existing or shared node follow a distinct deployment path.

## The first wall

1. **My posts:** the owner's original casts, a composer, and links into each conversation.
2. **Conversations:** direct replies and nested replies, with the owner's responses preserved in their thread context. A reply beneath someone else's reply should not disappear from the owner's view.
3. **Reply inbox:** conversation activity ordered by recency, a read/unread marker, and a view of replies the owner has not answered. Define “answered” carefully; a heuristic must be labeled and manually overridable.
4. **Actions:** publish and reply using the owner's authorized app key; react and follow from a participant's profile. Keep include/exclude app filters so the opinionated product still meets the bounty.
5. **Public wall:** a shareable URL showing the owner's public posts and discussions. In the first version, visitors can view and open a cast in an existing client to respond. In-wall visitor authorization and posting can follow; they are a separate identity/signing flow.

Owner-only inbox markers and preferences are application data, not Farcaster protocol messages. Require an authenticated owner session before exposing those markers or allowing their modification. Browser-local state can be an initial limited option; cross-device synchronization requires an authenticated store. Public FID knowledge must never grant owner access.

The wall should make clear which app filters are active. Hiding a cast locally does not remove it from the protocol or from other clients. A public wall also needs a deliberate display policy; an owner-facing “unread” inbox and a visitor-facing page serve different purposes.

## Reading conversations

Use `castsByFid` to discover the owner's retained casts and `castsByParent` to retrieve replies to a cast. Direct-parent queries are not a complete recursive conversation query: traverse descendants with pagination, bounded concurrency, deduplication, and a local thread index. Event-driven updates plus periodic reconciliation can keep that index current. A large account requires measured performance rather than an unbounded request per historical cast on every page load.

Source: [Snapchain casts API](https://snapchain.farcaster.xyz/reference/httpapi/casts).

The initial backfill should report how much history it has loaded and distinguish incomplete results from an empty inbox. “All replies” means available retained protocol data successfully indexed, not a guarantee of recovering deleted or pruned historical posts. Handle deletes, ancestry gaps, app-attribution gaps and reconnects explicitly.

The composer signs on the owner's device with a delegated app key. Submission goes through the configured node and receives a pending state until confirmed by read-back. Custody import remains a local developer authorization tool for the bounty path, never a field sent to the cloud service or an agent conversation.

## Installation experience

The bounty requires a three-command quickstart: provision compute, start/sync the node, and create the client. A future single entry command can guide those same stages once provider credentials and prerequisites exist. It cannot eliminate resource costs, human authorization, or snapshot download time.

For the phone, deliver a Progressive Web App over HTTPS. The setup command produces the wall URL. The person opens it and explicitly adds/installs it to their home screen using their browser's supported flow. Do not promise that a terminal command silently installs a native app on an arbitrary phone.

Source: [MDN: Installing web apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing). Native-like installation and supported features vary by browser/OS. No push-notification or App Store distribution promise is part of the first milestone.

## Sequence and completion evidence

Build a small protocol proof, a configurable My Wall template, and an installer that composes them. Run the exact documented workflow to create the builder's personal instance, fix every manual exception, and then have another human repeat it independently. Package the tested procedure as an agent skill and teach the same sequence in Spanish.

The first proof should retrieve one account's casts, retrieve a direct reply and a nested reply, register an authorized app key for a disposable account with storage, publish a reply through the owned node, and read it back. Thereafter prove cross-device owner authorization, bounded thread indexing, restart recovery, and phone installation on a specified tested browser.

No prize requirement says a tester must be paid. A useful personal wall can give people a reason to participate voluntarily, but that is a product hypothesis to validate with actual users. The ongoing node-hosting cost remains even when development is open source and testers volunteer.
