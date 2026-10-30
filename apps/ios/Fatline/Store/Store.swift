// Everything the app knows, in one place: which network and node, who you follow, the stream, the people in it,
// and your key. Reads go straight to the node; nothing passes through a hosted API.
import CryptoKit
import Foundation
import Observation
import UIKit

@Observable @MainActor
final class Store {
    static let ownerFid: UInt64 = 16098

    // Network and node
    var net: Net = Net(rawValue: UserDefaults.standard.string(forKey: "net") ?? "") ?? .snapchain {
        didSet { UserDefaults.standard.set(net.rawValue, forKey: "net") }
    }
    var pinned: [String: String] = (UserDefaults.standard.dictionary(forKey: "pinned") as? [String: String]) ?? [:] {
        didSet { UserDefaults.standard.set(pinned, forKey: "pinned") }
    }
    var statuses: [String: NodeStatus] = [:]
    var node: Node?
    var hub: Hub? { node.map { Hub(node: $0) } }

    // You
    var signer: SignerRecord? = SignIn.loadRecord()
    var signingIn = false
    /// Whose surroundings: your key's account; without one, the launch argument "-viewFID <fid>", else the owner's.
    var me: UInt64 {
        if signer?.state == "active", let f = signer?.fid { return f }
        return UInt64(UserDefaults.standard.string(forKey: "viewFID") ?? "") ?? Store.ownerFid
    }
    var canCast: Bool { signer?.state == "active" && SignIn.loadKey() != nil }

    // The stream
    var feed: [Cast] = []
    var follows: [UInt64] = []
    var profiles: [UInt64: Profile] = [:]
    var fresh: Set<String> = []
    var liked: Set<String> = []
    var recast: Set<String> = []
    var gathering: (done: Int, total: Int)?
    var live = false
    var lastEvent: [Int: UInt64] = [:]
    var lastBreath: Date?
    var toast: String?
    var retap = Retap(tab: .feed, n: 0)
    var bubbles: [Bubble] = [] // likes and recasts on their way, one bubble each

    let around = AroundModel()
    let forYou = ForYouModel()

    var keepAwake: Bool = UserDefaults.standard.object(forKey: "keepAwake") as? Bool ?? true {
        didSet { UserDefaults.standard.set(keepAwake, forKey: "keepAwake"); UIApplication.shared.isIdleTimerDisabled = keepAwake }
    }

    private var liveTask: Task<Void, Never>?
    private var gatherTask: Task<Void, Never>?
    private var profileWanted: Set<UInt64> = []
    private var savedAt: Date?

    init() { loadCache() }

    // MARK: Nodes

    func checkNodes() async {
        await withTaskGroup(of: (String, NodeStatus).self) { g in
            for n in Net.allCases.flatMap(\.nodes) { g.addTask { (n.url, await Hub(node: n, timeout: 8).status()) } }
            for await (url, s) in g { statuses[url] = s }
        }
    }

    /// The node to read: the one you chose (even if behind, and labelled so), or else the first in sync, ours first.
    func choose() {
        if let url = pinned[net.rawValue], let n = net.nodes.first(where: { $0.url == url }), statuses[url]?.error == nil {
            node = n; return
        }
        node = net.nodes.first { statuses[$0.url]?.ok == true } ?? net.nodes.first { statuses[$0.url]?.error == nil }
    }

    func switchTo(_ n: Net) async {
        guard n != net else { return }
        net = n
        await reconnect()
    }

    func pin(_ url: String?) async {
        pinned[net.rawValue] = url
        await reconnect()
    }

    private func reconnect() async {
        stopLive()
        await checkNodes()
        choose()
        lastEvent = [:]
        gather()
        startLive()
        rearound()
    }

    /// Around and For you, read again (another node, network or account).
    func rearound() {
        Task { await around.refresh(self); await forYou.build(self) }
    }

    // MARK: Boot

    func wake() async {
        UIApplication.shared.isIdleTimerDisabled = keepAwake
        await checkNodes()
        choose()
        if signer?.state == "pending" { await pollSigner() }
        // A short gap is filled from the node's event stream; a long one is gathered again from everyone you follow.
        let stale = feed.isEmpty || savedAt.map { Date().timeIntervalSince($0) > 45 * 60 } ?? true
        if stale { lastEvent = [:]; gather() }
        startLive()
        Task { await ensureProfiles([me]) }
        // What was on screen is shown already (from disk); the node is asked again quietly.
        Task {
            await around.refresh(self)
            if forYou.stale(self) { await forYou.build(self) }
        }
    }

    func sleep() { stopLive(); saveCache(); around.save() }

    // MARK: Gathering: the newest casts of everyone you follow, asked of the node one account at a time

    func gather() {
        gatherTask?.cancel()
        gatherTask = Task { await runGather() }
    }

    private func runGather() async {
        guard let hub else { toast = "No \(net.label) node answers."; return }
        let me = self.me
        if fids(changedFrom: me) { feed = [] }
        do {
            let list = try await hub.following(fid: me)
            follows = list
        } catch {
            if follows.isEmpty { toast = error.localizedDescription; return }
        }
        let fids = Array(Set(follows + [me]))
        gathering = (0, fids.count)
        var seen: [String: Cast] = Dictionary(uniqueKeysWithValues: feed.map { ($0.id, $0) })
        var done = 0, lastPublish = Date()
        await withTaskGroup(of: [Cast].self) { g in
            var it = fids.makeIterator()
            for _ in 0..<32 { if let f = it.next() { g.addTask { (try? await hub.casts(fid: f, pageSize: 8)) ?? [] } } }
            for await casts in g {
                if Task.isCancelled { g.cancelAll(); break }
                for c in casts where c.parent == nil { seen[c.id] = c }
                done += 1
                if let f = it.next() { g.addTask { (try? await hub.casts(fid: f, pageSize: 8)) ?? [] } }
                if Date().timeIntervalSince(lastPublish) > 0.35 || done == fids.count {
                    lastPublish = Date()
                    publish(seen)
                    gathering = (done, fids.count)
                }
            }
        }
        publish(seen)
        gathering = nil
        saveCache()
    }

    private func publish(_ seen: [String: Cast]) {
        feed = Array(seen.values.sorted { $0.timestamp > $1.timestamp }.prefix(700))
        Task { await ensureProfiles(feed.prefix(60).map(\.fid)) }
    }

    // MARK: Live: the node's own event stream, both shards, filtered to the people you follow

    func startLive() {
        guard liveTask == nil, let hub else { return }
        live = true
        liveTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.breathe(hub)
                try? await Task.sleep(for: .seconds(2.5))
            }
        }
    }

    func stopLive() { liveTask?.cancel(); liveTask = nil; live = false }

    private func breathe(_ hub: Hub) async {
        if lastEvent.isEmpty {
            let s = await hub.status()
            for (shard, height) in s.shards { lastEvent[shard] = EventId.at(height: height) }
            if let n = node { statuses[n.url] = s }
            return
        }
        let watch = Set(follows + [me])
        for (shard, from) in lastEvent {
            var cursor = from
            for _ in 0..<5 { // at most 5000 events per breath; the rest next time
                guard let page = try? await hub.events(shard: shard, from: cursor), let events = page.events, !events.isEmpty else { break }
                for e in events { absorb(e, watch) }
                cursor = page.nextPageEventId ?? (events.last!.id + 1)
                if events.count < 1000 { break }
            }
            lastEvent[shard] = cursor
        }
        lastBreath = Date()
    }

    private func absorb(_ e: HubEvent, _ watch: Set<UInt64>) {
        guard e.type == "HUB_EVENT_TYPE_MERGE_MESSAGE", let m = e.mergeMessageBody?.message, let d = m.data, watch.contains(d.fid) else { return }
        if let c = Cast(m), c.parent == nil, !feed.contains(where: { $0.id == c.id }) {
            feed.insert(c, at: feed.firstIndex { $0.timestamp < c.timestamp } ?? feed.count)
            fresh.insert(c.id)
            Task { await ensureProfiles([c.fid] + c.mentions) }
        } else if d.type == "MESSAGE_TYPE_CAST_REMOVE", let h = d.castRemoveBody?.targetHash {
            feed.removeAll { $0.id == h }
        }
    }

    // MARK: People

    func ensureProfiles(_ fids: [UInt64]) async {
        guard let hub else { return }
        let want = Set(fids).subtracting(profiles.keys).subtracting(profileWanted)
        guard !want.isEmpty else { return }
        profileWanted.formUnion(want)
        await withTaskGroup(of: Profile?.self) { g in
            for f in want { g.addTask { try? await hub.profile(fid: f) } }
            for await p in g { if let p { profiles[p.fid] = p } }
        }
        profileWanted.subtract(want)
    }

    func names(for c: Cast) -> [UInt64: String] {
        Dictionary(uniqueKeysWithValues: c.mentions.compactMap { f in profiles[f]?.username.map { (f, $0) } })
    }

    // MARK: Your key

    func signIn() async {
        signingIn = true
        defer { signingIn = false }
        do {
            let r = try await SignIn.start()
            signer = r
            if let link = r.deeplink, let url = URL(string: link) { await UIApplication.shared.open(url) }
            for _ in 0..<150 where signer?.state == "pending" { // up to 5 minutes
                try? await Task.sleep(for: .seconds(2))
                await pollSigner()
            }
        } catch { toast = error.localizedDescription }
    }

    func pollSigner() async {
        guard let s = signer, s.state == "pending" else { return }
        let r = (try? await SignIn.poll(s)) ?? s
        signer = r
        if r.state == "active" {
            toast = "Your key is in. Cast away."
            Haptic.success()
            if r.fid != Store.ownerFid { gather(); rearound() }
        }
    }

    func forgetKey() { SignIn.forget(); signer = nil }

    // MARK: Speaking

    enum SendState { case confirmed, pending }

    /// Signs here, sends to the node you are reading, then reads it back from that node.
    @discardableResult
    func send(_ data: [UInt8]) async throws -> (hash: String, state: SendState) {
        guard let key = SignIn.loadKey(), canCast else { throw HubError(message: "Approve a key first.") }
        guard let hub else { throw HubError(message: "No \(net.label) node answers.") }
        let signed = try Farcaster.sign(data, with: key)
        try await hub.submit(signed.bytes)
        return (signed.hash, .confirmed)
    }

    /// A cast, a reply (parent) or a quote (quote: the cast it embeds first). `confirmed`: read back from the node.
    @discardableResult
    func cast(_ text: String, parent: CastRef? = nil, quote: CastRef? = nil) async throws -> (cast: Cast, confirmed: Bool) {
        let ts = Farcaster.timestamp()
        let data = Farcaster.castAdd(fid: me, text: text, parent: parent, quote: quote, timestamp: ts)
        let (hash, _) = try await send(data)
        let embeds = Array(((quote.map { [Embed.cast($0)] } ?? []) + Farcaster.linkEmbeds(text).map(Embed.url)).prefix(2))
        let c = Cast(id: hash, fid: me, text: text, timestamp: ts, embeds: embeds, parent: parent)
        if parent == nil { feed.insert(c, at: 0); fresh.insert(c.id) }
        // Read it back from the same node, so "sent" means the node has it.
        if let hub {
            for _ in 0..<15 {
                if (try? await hub.cast(c.ref)) != nil { return (c, true) }
                try? await Task.sleep(for: .seconds(1))
            }
            toast = "\(hub.node.label) took it; it isn't showing yet."
        }
        return (c, false)
    }

    /// Like or recast (or take it back), each in its own bubble: it opens, a current runs round it while the node takes
    /// it, it lights up when the node shows it, then it pops. `from`: where the finger was (the spark leaves from there).
    /// True once the node shows it (or shows it gone).
    @discardableResult
    func react(_ kind: ReactionKind, _ c: Cast, from: CGPoint? = nil) async -> Bool {
        let on = kind == .like ? liked.contains(c.id) : recast.contains(c.id)
        func set(_ v: Bool) { if kind == .like { if v { liked.insert(c.id) } else { liked.remove(c.id) } } else { if v { recast.insert(c.id) } else { recast.remove(c.id) } } }
        set(!on)
        on ? Haptic.light() : Haptic.medium()
        let b = Bubble(kind: kind, undo: on, who: profiles[c.fid]?.handle ?? "fid \(c.fid)", from: from)
        bubbles.append(b)
        func end(_ s: Bubble.State, _ note: String, after: Double) {
            if let i = bubbles.firstIndex(where: { $0.id == b.id }) { bubbles[i].state = s; bubbles[i].note = note }
            Task { try? await Task.sleep(for: .seconds(after)); bubbles.removeAll { $0.id == b.id } }
        }
        do { try await send(Farcaster.reaction(fid: me, kind: kind, target: c.ref, remove: on)) }
        catch { set(on); Haptic.fail(); end(.failed, error.localizedDescription, after: 5); return false }
        guard let hub else { end(.pending, "sent", after: 2); return false }
        for _ in 0..<12 {
            if let has = try? await hub.reaction(fid: me, kind: kind, target: c.ref), has != on {
                end(.done, "on \(hub.node.label)", after: 1.8)
                return true
            }
            try? await Task.sleep(for: .seconds(1))
        }
        end(.pending, "sent; not showing yet", after: 3)
        return false
    }

    func follows(_ fid: UInt64) -> Bool { follows.contains(fid) }

    func toggleFollow(_ fid: UInt64) async {
        let was = follows(fid)
        if was { follows.removeAll { $0 == fid } } else { follows.append(fid) }
        Haptic.medium()
        do { try await send(Farcaster.follow(fid: me, target: fid, remove: was)) }
        catch {
            if was { follows.append(fid) } else { follows.removeAll { $0 == fid } }
            Haptic.fail(); toast = error.localizedDescription
        }
    }

    // MARK: Cache (this phone only)

    private struct Cache: Codable {
        var feed: [Cast]; var follows: [UInt64]; var profiles: [UInt64: Profile]; var liked: [String]; var recast: [String]; var savedAt: Date
        var lastEvent: [Int: UInt64]?; var net: Net?; var fid: UInt64?
    }
    private var cacheFid: UInt64?
    /// The stream was gathered for someone else (another key, or another -viewFID): start it again.
    private func fids(changedFrom f: UInt64) -> Bool {
        defer { cacheFid = f }
        if let c = cacheFid, c != f { follows = []; return true }
        return false
    }
    func saveCache() {
        let c = Cache(feed: Array(feed.prefix(400)), follows: follows, profiles: profiles, liked: Array(liked), recast: Array(recast), savedAt: Date(), lastEvent: lastEvent, net: net, fid: me)
        Disk.save(c, "stream.json")
        savedAt = c.savedAt
    }
    private func loadCache() {
        // Kept in Caches; before 2026-10-30 it was in Application Support.
        let old = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("stream.json")
        guard let c = Disk.load(Cache.self, "stream.json") ?? (try? Data(contentsOf: old)).flatMap({ try? JSONDecoder().decode(Cache.self, from: $0) }) else { return }
        cacheFid = c.fid
        if let f = c.fid, f != me { profiles = c.profiles; return }
        feed = c.feed; follows = c.follows; profiles = c.profiles; liked = Set(c.liked); recast = Set(c.recast); savedAt = c.savedAt
        if c.net == net { lastEvent = c.lastEvent ?? [:] }
    }
}

struct Retap: Equatable { let tab: Tab; let n: Int }

/// One like or recast on its way to the node.
struct Bubble: Identifiable, Equatable {
    enum State: Equatable { case busy, done, pending, failed }
    let id = UUID()
    let kind: ReactionKind
    let undo: Bool
    let who: String
    let from: CGPoint?
    var state: State = .busy
    var note = "signing…"
}
