# Fatline for iPhone

A Farcaster client that reads straight from a node and signs on the phone. No hosted API.

- **Feed:** the newest casts of everyone you follow, asked of the node one account at a time (32 at once), then kept live from the node's own event stream (both shards, every 2.5 s).
- **Snapchain or Hypersnap:** the lemniscate at the top. The node is always named, and a node that isn't ours says so. Settings can pin one node.
- **Cast:** the phone makes its own Ed25519 key (Keychain, this device only). @fatline's hatchery signs the key request, and you approve it in the Farcaster app on the same phone. After that, casts, replies, likes and recasts are signed here and sent to the node you are reading.
- **Fatlines:** every egg the genesis hatchery knows (`/names`), each node asked directly whether it is awake and in step.
- **You (your face in the bar):** your profile, your egg's warm days, your casts. Tap any face or name for that person's page (follow, their Fatline). The pen on the far right writes.
- **For you, Latest, Around:** the same as the web client. Reply, recast, quote and like under every cast. A reply opens below their cast, joined to your face by a thread; a quote puts their cast inside what you write. A reply in Around says which cast of yours it answers, above its words. Likes and recasts are bubbles of their own (a spark from your finger, a current round the edge, then it pops). New casts never move what you are reading: they wait behind the pill.
- **Feel:** haptics throughout, the native swipe back, double-tap to like, long-press for reply, copy and share, a "new" pill when casts arrive while you scroll, tap a tab again to go back to the top.

```sh
cd apps/ios && xcodegen generate
xcodebuild -scheme Fatline -destination 'generic/platform=iOS' -derivedDataPath build-dev -allowProvisioningUpdates build
xcrun devicectl device install app --device <id> build-dev/Build/Products/Debug-iphoneos/Fatline.app
```

Message encoding is checked against `@farcaster/core` byte for byte: `swiftc -O Fatline/Protocol/*.swift Tests/main.swift -o /tmp/t && /tmp/t`.
Icon: `gpt-image-2.5-sunburst` through the Bankr gateway, 2026-10-25 (candidates in `art/`).

Tested: build, the stream, the constellation and the profile in the Simulator, install and launch on an iPhone 15 (iOS 26.5); the node decodes a phone-signed message and refuses it only for its unregistered key. **Untested:** approving a key in the Farcaster app, and a real cast from the phone.
