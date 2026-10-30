import Foundation
import Observation

/// What the Around tab shows: the flow, newest first, kept on disk, the top read again on its own.
@Observable @MainActor
final class AroundModel {
    static let liveSeconds: UInt64 = 45

    private(set) var items: [AroundItem] = []
    var fresh: Set<String> = []
    private(set) var ended = false
    private(set) var busy = false
    private(set) var loaded = false // read from the node this session (not only from disk)
    var failed: String?
    private(set) var fid: UInt64?
    private(set) var net: Net?

    private var reader: AroundReader?
    private var cursor: AroundCursor?

    private struct Saved: Codable { let fid: UInt64; let net: Net; let items: [AroundItem]; let at: Date }

    init() {
        if let s = Disk.load(Saved.self, "around.json") { fid = s.fid; net = s.net; items = s.items }
    }

    func save() {
        guard let fid, let net else { return }
        Disk.save(Saved(fid: fid, net: net, items: Array(items.prefix(120)), at: Date()), "around.json")
    }

    /// Faces wanted to draw what is shown.
    var faces: [UInt64] { items.prefix(200).flatMap { [$0.fid] + ($0.cast?.mentions ?? []) } }

    /// The people who were around you in the last week (replied, said your name, liked, recast): For you's "near".
    func near(within seconds: TimeInterval = 7 * 86400) -> Set<UInt64> {
        let since = Farcaster.timestamp(Date().addingTimeInterval(-seconds))
        return Set(items.filter { $0.kind != .follow && $0.at >= since }.map(\.fid))
    }

    /// Reads the top again with a fresh reading and starts paging from it. What was on screen stays until it answers.
    func refresh(_ store: Store) async {
        guard let hub = store.hub else { return }
        let fid = store.me, net = store.net
        if fid != self.fid || net != self.net { items = []; fresh = [] }
        self.fid = fid; self.net = net
        busy = true; defer { busy = false }
        let r = AroundReader(hub: hub, fid: fid)
        do {
            let (page, next) = try await r.page(after: nil)
            guard store.me == fid, store.net == net else { return }
            let known = Set(items.map(\.key))
            if !items.isEmpty { fresh.formUnion(page.map(\.key).filter { !known.contains($0) }) }
            reader = r; cursor = next; ended = next == nil; failed = nil
            items = page
            loaded = true
            save()
            await store.ensureProfiles(faces)
        } catch {
            failed = error.localizedDescription
        }
    }

    /// The next stretch back in time (scrolling down).
    func more(_ store: Store) async {
        guard !busy, !ended, failed == nil, let reader, reader.fid == store.me else {
            if reader == nil, !busy { await refresh(store) }
            return
        }
        busy = true; defer { busy = false }
        do {
            for _ in 0..<4 {
                let (page, next) = try await reader.page(after: cursor)
                let known = Set(items.map(\.key))
                items += page.filter { !known.contains($0.key) }
                cursor = next
                if next == nil { ended = true; break }
                if !page.isEmpty { break }
            }
            await store.ensureProfiles(faces)
        } catch {
            failed = error.localizedDescription
        }
    }

    /// New things arrive at the top on their own: the top read with a fresh reading, merged in its place.
    func poll(_ store: Store) async {
        guard !busy, let hub = store.hub, store.me == fid, store.net == net else { return }
        guard let (page, _) = try? await AroundReader(hub: hub, fid: store.me).page(after: nil), store.me == fid else { return }
        let known = Set(items.map(\.key))
        let add = page.filter { !known.contains($0.key) }
        guard !add.isEmpty else { return }
        fresh.formUnion(add.map(\.key))
        items = (items + add).sorted { aroundBefore(($0.at, $0.key), ($1.at, $1.key)) }
        Haptic.soft()
        save()
        await store.ensureProfiles(add.map(\.fid))
    }

    func again(_ store: Store) async { failed = nil; if reader == nil { await refresh(store) } else { await more(store) } }
}
