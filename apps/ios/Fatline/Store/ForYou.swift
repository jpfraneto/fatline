import Foundation
import Observation

/// What the For you landing shows, kept on disk so it opens at once.
@Observable @MainActor
final class ForYouModel {
    static let keep: TimeInterval = 8 * 60

    private(set) var picks: [Pick] = []
    private(set) var building = false
    private(set) var builtAt: Date?
    var failed: String?
    private(set) var fid: UInt64?
    private(set) var net: Net?

    private struct Saved: Codable { let fid: UInt64; let net: Net; let picks: [Pick]; let at: Date }

    init() {
        if let s = Disk.load(Saved.self, "foryou.json") { fid = s.fid; net = s.net; picks = s.picks; builtAt = s.at }
    }

    var faces: [UInt64] { picks.flatMap { [$0.cast.fid] + $0.cast.mentions + $0.why.flatMap(\.fids) } }

    func stale(_ store: Store) -> Bool {
        fid != store.me || net != store.net || builtAt.map { Date().timeIntervalSince($0) > ForYouModel.keep } ?? true
    }

    func build(_ store: Store) async {
        guard !building, let hub = store.hub else { return }
        let fid = store.me, net = store.net
        if fid != self.fid || net != self.net { picks = [] }
        self.fid = fid; self.net = net
        building = true; defer { building = false }
        // "Near" comes from Around: read its top first if it has never been read.
        if store.around.items.isEmpty || store.around.fid != fid { await store.around.refresh(store) }
        do {
            let r = try await Discover.build(hub: hub, fid: fid, near: store.around.near())
            guard store.me == fid, store.net == net else { return }
            picks = r.picks; builtAt = Date(); failed = nil
            store.liked.formUnion(r.liked); store.recast.formUnion(r.recast)
            Disk.save(Saved(fid: fid, net: net, picks: picks, at: builtAt!), "foryou.json")
            await store.ensureProfiles(faces)
        } catch {
            failed = error.localizedDescription
        }
    }
}
