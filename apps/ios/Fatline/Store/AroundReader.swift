// Around you: everything that happened around you, newest first: who liked or recast one of your casts, who replied,
// who said your name, who began following you. A port of indexer/src/around.mjs, read straight from the node.
//
// The node has no notifications list, so it is put together from what the node does keep, newest first: your casts
// (and, for each, its replies and reactions), casts that mention you, and follows of you. It is read a stretch at a
// time. Everything at or after the "horizon" is complete; scrolling past it reads the next stretch.
// Not shown: a like today on a cast older than the stretch read when that moment scrolled by.
import Foundation
import Observation

struct AroundItem: Codable, Hashable, Identifiable {
    enum Kind: String, Codable { case like, recast, reply, mention, follow }
    let key: String
    let kind: Kind
    let at: UInt64 // Farcaster seconds
    let fid: UInt64
    var cast: Cast? // the reply or mention itself
    var target: String? // hash of your cast it is about
    var yours: Cast? // that cast, for its one line
    var id: String { key }
    var date: Date { Farcaster.date(at) }
}

/// Where a page ended: the moment and key of the last thing shown, so two things in the same second are never lost.
struct AroundCursor: Codable, Hashable { let at: UInt64; let key: String }

/// Newest first, then by key.
func aroundBefore(_ a: (at: UInt64, key: String), _ b: (at: UInt64, key: String)) -> Bool {
    a.at != b.at ? a.at > b.at : a.key < b.key
}

/// One reading of someone's surroundings: kept while you scroll down; the top is read again with a fresh one.
@MainActor
final class AroundReader {
    nonisolated static let castsPerStretch = 40, atOnce = 10, pageSize = 40

    struct List { var token: String?; var edge = Double.infinity; var done = false }
    let hub: Hub, fid: UInt64
    private var lists: [String: List] = ["casts": List(), "mentions": List(), "follows": List()]
    private var events: [String: AroundItem] = [:]
    private var mine: [String: Cast] = [:]

    init(hub: Hub, fid: UInt64) { self.hub = hub; self.fid = fid }

    /// How far back a newest-first page is complete. A node answers per shard, so one page can hold two newest-first
    /// runs; the page is complete down to the newest of their oldest items.
    nonisolated static func frontier(_ ts: [UInt64]) -> Double? {
        guard let first = ts.first else { return nil }
        var floor = -Double.infinity, low = Double(first)
        for i in 1..<ts.count {
            if ts[i] > ts[i - 1] { floor = max(floor, low); low = Double(ts[i]) } else { low = min(low, Double(ts[i])) }
        }
        return max(floor, low)
    }

    private var horizon: Double { lists.values.map { $0.done ? -Double.infinity : $0.edge }.max() ?? -Double.infinity }
    private var finished: Bool { lists.values.allSatisfy(\.done) }
    private func add(_ e: AroundItem) { if events[e.key] == nil { events[e.key] = e } }

    private func next(_ name: String, _ path: String, _ params: [String: String]) async throws -> [HubMessage] {
        guard var l = lists[name], !l.done else { return [] }
        var p = params; p["reverse"] = "true"
        if let t = l.token { p["pageToken"] = t }
        let page = try await hub.page(path, p)
        let msgs = page?.messages ?? []
        l.token = page?.nextPageToken?.isEmpty == false ? page?.nextPageToken : nil
        l.done = l.token == nil
        let f = AroundReader.frontier(msgs.map { $0.data?.timestamp ?? 0 })
        l.edge = l.done ? -.infinity : min(l.edge, f ?? -.infinity)
        lists[name] = l
        return msgs
    }

    /// Reads the next stretch of each list that is not done.
    private func extend() async throws {
        let fid = self.fid
        async let c = next("casts", "/v1/castsByFid", ["fid": "\(fid)", "pageSize": "\(AroundReader.castsPerStretch)"])
        async let m = next("mentions", "/v1/castsByMention", ["fid": "\(fid)", "pageSize": "100"])
        async let f = next("follows", "/v1/linksByTargetFid", ["target_fid": "\(fid)", "link_type": "follow", "pageSize": "100"])
        let (casts, mentions, follows) = try await (c, m, f)
        let own = casts.compactMap(Cast.init)
        for c in own { mine[c.id] = c }
        let hub = self.hub
        var i = 0
        while i < own.count {
            let chunk = Array(own[i..<min(i + AroundReader.atOnce, own.count)])
            i += AroundReader.atOnce
            let answers = await withTaskGroup(of: (Cast, [HubMessage], [HubMessage]).self) { g in
                for c in chunk {
                    g.addTask {
                        async let r = try? hub.page("/v1/castsByParent", ["fid": "\(fid)", "hash": c.id, "pageSize": "100"])
                        async let x = try? hub.page("/v1/reactionsByCast", ["target_fid": "\(fid)", "target_hash": c.id, "reaction_type": "None", "pageSize": "100"])
                        let (replies, reactions) = await (r, x)
                        return (c, replies?.messages ?? [], reactions?.messages ?? [])
                    }
                }
                var out: [(Cast, [HubMessage], [HubMessage])] = []
                for await a in g { out.append(a) }
                return out
            }
            for (c, replies, reactions) in answers {
                for m in reactions {
                    guard let d = m.data, d.type == "MESSAGE_TYPE_REACTION_ADD", d.fid != fid else { continue }
                    let kind: AroundItem.Kind = d.reactionBody?.type == "REACTION_TYPE_RECAST" ? .recast : .like
                    add(AroundItem(key: "\(kind.rawValue):\(d.fid):\(c.id)", kind: kind, at: d.timestamp, fid: d.fid, target: c.id))
                }
                for m in replies {
                    guard let r = Cast(m), r.fid != fid else { continue }
                    add(AroundItem(key: "cast:\(r.id)", kind: .reply, at: r.timestamp, fid: r.fid, cast: r, target: c.id))
                }
            }
        }
        for m in mentions {
            guard let c = Cast(m), c.fid != fid else { continue }
            // A reply that also says your name is a reply; it is shown once.
            let key = "cast:\(c.id)"
            guard events[key] == nil else { continue }
            let reply = c.parent?.fid == fid
            add(AroundItem(key: key, kind: reply ? .reply : .mention, at: c.timestamp, fid: c.fid, cast: c, target: reply ? c.parent?.hash : nil))
        }
        for m in follows {
            guard let d = m.data, d.type == "MESSAGE_TYPE_LINK_ADD" else { continue }
            add(AroundItem(key: "follow:\(d.fid)", kind: .follow, at: d.timestamp, fid: d.fid))
        }
    }

    /// The next page after `cut` (nil: the top). `next` is nil once history has run out.
    func page(after cut: AroundCursor?, limit: Int = AroundReader.pageSize) async throws -> (items: [AroundItem], next: AroundCursor?) {
        func after(_ e: AroundItem) -> Bool { cut.map { aroundBefore(($0.at, $0.key), (e.at, e.key)) } ?? true }
        for _ in 0..<8 {
            let h = horizon
            let ready = events.values.filter { after($0) && Double($0.at) >= h }.count
            if ready >= limit || finished { break }
            try await extend()
        }
        let h = horizon
        var page = Array(events.values.filter { after($0) && Double($0.at) >= h }.sorted { aroundBefore(($0.at, $0.key), ($1.at, $1.key)) }.prefix(limit))
        let more = !finished || (events.values.contains(where: after) && page.count == limit)

        // Your cast each one is about (a line of it).
        let missing = Set(page.compactMap(\.target).filter { mine[$0] == nil })
        let hub = self.hub, fid = self.fid
        let found = await withTaskGroup(of: Cast?.self) { g in
            for h in missing { g.addTask { try? await hub.cast(CastRef(fid: fid, hash: h)) } }
            var out: [Cast] = []
            for await c in g { if let c { out.append(c) } }
            return out
        }
        for c in found { mine[c.id] = c }
        for i in page.indices { if let t = page[i].target { page[i].yours = mine[t] } }

        let next: AroundCursor? = more ? (page.last.map { AroundCursor(at: $0.at, key: $0.key) } ?? AroundCursor(at: UInt64(max(0, h)), key: "~")) : nil
        return (page, next)
    }
}

