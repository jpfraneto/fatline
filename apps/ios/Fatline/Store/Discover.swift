// For you: a handful of casts worth answering, from the people you follow and from what they are paying attention to.
// Scored the same way as the web (indexer/src/discover.mjs), read straight from the node.
//
//   Pool A: each followed account's latest top-level casts of the last 36 hours.
//   Pool B: what they liked and recast in that time, from anyone: the way to meet people you don't follow yet.
//   score = (1 + social + conversation + near + new) / (1 + hours/8)^1.2
//     social        2·log2(1 + Σ over people you follow who reacted: like 1, recast 1.6)
//     conversation  +1.2 asks a question, +0.6 60–700 characters, +0.4 a picture, −1 only a link
//     near          +1.5 its author has been around you this week
//     new           +0.8 someone you don't follow, brought by people you do
//   Never: your own casts, casts you already answered, empty ones. At most two per person, never two in a row.
import Foundation
import Observation

struct Why: Codable, Hashable {
    enum Kind: String, Codable { case liked, recast, near, new, question }
    let kind: Kind
    var fids: [UInt64] = []
    var more = false
}

struct Pick: Codable, Hashable, Identifiable {
    let cast: Cast
    let score: Double
    let why: [Why]
    var id: String { cast.id }
}

enum Discover {
    static let follows = 300, perPerson = 6, reactors = 150, targetCap = 120, top = 30, atOnce = 24
    static let window: TimeInterval = 36 * 3600

    struct Reactor: Hashable { let fid: UInt64; let recast: Bool }

    private static let image = try! NSRegularExpression(pattern: #"^https://(imagedelivery\.net|i\.imgur\.com|.*\.(png|jpe?g|gif|webp)(\?|$))"#, options: .caseInsensitive)
    private static let onlyLink = try! NSRegularExpression(pattern: #"^\s*https?://\S+\s*$"#)
    private static func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    /// The score of one cast and the reasons shown with it. Pure, so it can agree with the web.
    static func score(_ c: Cast, reactors: [Reactor], follows: Set<UInt64>, near: Set<UInt64>, now: Date) -> (value: Double, why: [Why]) {
        var likes: [UInt64] = [], recasts: [UInt64] = []
        for r in reactors { if r.recast { if !recasts.contains(r.fid) { recasts.append(r.fid) } } else if !likes.contains(r.fid) { likes.append(r.fid) } }
        let weight = Double(likes.count) + Double(recasts.count) * 1.6
        let social = weight > 0 ? 2 * log2(1 + weight) : 0
        let n = c.text.utf16.count // as JavaScript counts
        var conversation = 0.0
        if c.text.contains("?") { conversation += 1.2 }
        if n >= 60 && n <= 700 { conversation += 0.6 }
        if c.embeds.contains(where: { if case .url(let u) = $0 { return matches(image, u) } else { return false } }) { conversation += 0.4 }
        if matches(onlyLink, c.text) { conversation -= 1 }
        let isNear = near.contains(c.fid) ? 1.5 : 0
        let isNew = !follows.contains(c.fid) && social > 0 ? 0.8 : 0
        let hours = max(0, now.timeIntervalSince(c.date) / 3600)
        let value = (1 + social + conversation + isNear + isNew) / pow(1 + hours / 8, 1.2)
        var why: [Why] = []
        if !likes.isEmpty { why.append(Why(kind: .liked, fids: Array(likes.prefix(5)), more: likes.count > 5)) }
        if !recasts.isEmpty { why.append(Why(kind: .recast, fids: Array(recasts.prefix(5)), more: recasts.count > 5)) }
        if isNear > 0 { why.append(Why(kind: .near)) }
        if isNew > 0 { why.append(Why(kind: .new)) }
        if c.text.contains("?") { why.append(Why(kind: .question)) }
        return (value, why)
    }

    /// Best first, at most two per person, never the same person twice in a row.
    static func pick(_ scored: [Pick], top: Int = top) -> [Pick] {
        var per: [UInt64: Int] = [:]
        var kept = scored.sorted { $0.score > $1.score }.filter { s in
            let n = per[s.cast.fid] ?? 0
            if n >= 2 { return false }
            per[s.cast.fid] = n + 1
            return true
        }
        kept = Array(kept.prefix(top))
        var out: [Pick] = []
        while !kept.isEmpty {
            let i = kept.firstIndex { $0.cast.fid != out.last?.cast.fid } ?? 0
            out.append(kept.remove(at: i))
        }
        return out
    }

    /// Runs `work` over `items`, `atOnce` at a time, in order; a failure is nil.
    static func each<T: Sendable, R: Sendable>(_ items: [T], _ work: @escaping @Sendable (T) async -> R?) async -> [R?] {
        var out = [R?](repeating: nil, count: items.count)
        await withTaskGroup(of: (Int, R?).self) { g in
            var it = items.enumerated().makeIterator()
            for _ in 0..<atOnce { if let (i, x) = it.next() { g.addTask { (i, await work(x)) } } }
            for await (i, r) in g {
                out[i] = r
                if let (j, x) = it.next() { g.addTask { (j, await work(x)) } }
            }
        }
        return out
    }

    /// Builds the list for `fid`. Also returns the casts this account has liked and recast (to show those pressed).
    static func build(hub: Hub, fid: UInt64, near: Set<UInt64>, now: Date = Date()) async throws -> (picks: [Pick], liked: [String], recast: [String]) {
        let since = Farcaster.timestamp(now.addingTimeInterval(-window))

        // Who you follow: the 300 most recent.
        var followList: [UInt64] = [], token: String? = nil
        for _ in 0..<6 where followList.count < follows {
            var p = ["fid": "\(fid)", "link_type": "follow", "pageSize": "100", "reverse": "true"]
            if let token { p["pageToken"] = token }
            guard let page = try await hub.page("/v1/linksByFid", p) else { break }
            for m in page.messages ?? [] where m.data?.type == "MESSAGE_TYPE_LINK_ADD" {
                if let t = m.data?.linkBody?.targetFid, !followList.contains(t) { followList.append(t) }
            }
            token = page.nextPageToken?.isEmpty == false ? page.nextPageToken : nil
            if token == nil { break }
        }
        followList = Array(followList.prefix(follows))
        let followSet = Set(followList)

        // What you already answered, and what you already liked or recast.
        async let mineP = try? hub.page("/v1/castsByFid", ["fid": "\(fid)", "pageSize": "100", "reverse": "true"])
        async let yoursP = try? hub.page("/v1/reactionsByFid", ["fid": "\(fid)", "reaction_type": "None", "pageSize": "200", "reverse": "true"])
        let (mine, yours) = await (mineP, yoursP)
        let answered = Set((mine?.messages ?? []).compactMap { $0.data?.castAddBody?.parentCastId?.hash })
        var liked: [String] = [], recast: [String] = []
        for m in yours?.messages ?? [] where m.data?.type == "MESSAGE_TYPE_REACTION_ADD" {
            guard let h = m.data?.reactionBody?.targetCastId?.hash else { continue }
            if m.data?.reactionBody?.type == "REACTION_TYPE_RECAST" { recast.append(h) } else { liked.append(h) }
        }

        // Pool A: what they said.
        var casts: [String: Cast] = [:]
        for r in await each(followList, { f in try? await hub.casts(fid: f, pageSize: perPerson) }) {
            for c in r ?? [] where c.parent == nil && c.timestamp >= since { casts[c.id] = c }
        }

        // Pool B: what they liked and recast.
        var reactions: [String: [Reactor]] = [:], targets: [String: CastRef] = [:]
        let reactorList = Array(followList.prefix(reactors))
        let pages = await each(reactorList) { f in
            try? await hub.page("/v1/reactionsByFid", ["fid": "\(f)", "reaction_type": "None", "pageSize": "25", "reverse": "true"])
        }
        for (i, page) in pages.enumerated() {
            for m in page?.messages ?? [] {
                guard let d = m.data, d.type == "MESSAGE_TYPE_REACTION_ADD", let t = d.reactionBody?.targetCastId, d.timestamp >= since else { continue }
                reactions[t.hash, default: []].append(Reactor(fid: reactorList[i], recast: d.reactionBody?.type == "REACTION_TYPE_RECAST"))
                targets[t.hash] = t
            }
        }
        let missing = Array(targets.values.filter { casts[$0.hash] == nil }
            .sorted { (reactions[$0.hash]?.count ?? 0) > (reactions[$1.hash]?.count ?? 0) }.prefix(targetCap))
        for c in await each(missing, { t in try? await hub.cast(t) }) {
            if let c, c.timestamp >= since { casts[c.id] = c }
        }

        let scored = casts.values
            .filter { $0.fid != fid && !answered.contains($0.id) && (!$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !$0.embeds.isEmpty) }
            .map { c -> Pick in
                let s = score(c, reactors: (reactions[c.id] ?? []).filter { $0.fid != c.fid }, follows: followSet, near: near, now: now)
                return Pick(cast: c, score: s.value, why: s.why)
            }
        return (pick(scored), liked, recast)
    }
}

