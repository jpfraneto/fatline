// Any node that speaks the Snapchain HTTP API: Farcaster's Snapchain and Hypersnap read the same way.
// Every answer is tied to the node it came from, so the app can always say whose node it is reading.
import Foundation

// MARK: - The JSON a node returns (only the fields we read)

struct HubMessage: Decodable { let data: HubData?; let hash: String? }
struct HubData: Decodable {
    let type: String; let fid: UInt64; let timestamp: UInt64
    let castAddBody: CastAddBody?; let castRemoveBody: CastRemoveBody?; let userDataBody: UserDataBody?
    let linkBody: LinkBody?; let reactionBody: ReactionBody?
}
struct CastAddBody: Decodable {
    let text: String?; let embeds: [HubEmbed]?; let mentions: [UInt64]?; let mentionsPositions: [Int]?
    let parentCastId: CastRef?; let parentUrl: String?; let type: String?
}
struct HubEmbed: Decodable { let url: String?; let castId: CastRef? }
struct CastRemoveBody: Decodable { let targetHash: String? }
struct UserDataBody: Decodable { let type: String; let value: String }
struct LinkBody: Decodable { let type: String; let targetFid: UInt64? }
struct ReactionBody: Decodable { let type: String; let targetCastId: CastRef? }
struct MessagesPage: Decodable { let messages: [HubMessage]?; let nextPageToken: String? }
struct HubEvent: Decodable { let type: String; let id: UInt64; let mergeMessageBody: MergeBody? }
struct MergeBody: Decodable { let message: HubMessage }
struct EventsPage: Decodable { let events: [HubEvent]?; let nextPageEventId: UInt64? }
struct HubInfo: Decodable {
    struct Shard: Decodable { let shardId: Int; let maxHeight: UInt64?; let blockDelay: Int64?; let numMessages: UInt64? }
    struct Stats: Decodable { let numMessages: UInt64?; let numFidRegistrations: UInt64?; let approxSize: UInt64? }
    let dbStats: Stats?; let shardInfos: [Shard]?; let version: String?
}

// MARK: - What the app shows

enum Embed: Codable, Hashable {
    case url(String), cast(CastRef)
    var isImage: Bool {
        guard case .url(let u) = self else { return false }
        let l = u.lowercased()
        return [".jpg", ".jpeg", ".png", ".gif", ".webp"].contains { l.split(separator: "?").first?.hasSuffix($0) ?? false }
            || l.contains("imagedelivery.net") || l.contains("i.imgur.com")
    }
}

struct Cast: Identifiable, Codable, Hashable {
    let id: String // the message hash
    let fid: UInt64
    let text: String
    let timestamp: UInt64
    let embeds: [Embed]
    let parent: CastRef?
    let parentUrl: String?
    let mentions: [UInt64]
    let mentionsPositions: [Int]
    var date: Date { Farcaster.date(timestamp) }
    var ref: CastRef { CastRef(fid: fid, hash: id) }

    init?(_ m: HubMessage) {
        guard let d = m.data, d.type == "MESSAGE_TYPE_CAST_ADD", let b = d.castAddBody, let hash = m.hash else { return nil }
        id = hash; fid = d.fid; timestamp = d.timestamp; text = b.text ?? ""
        embeds = (b.embeds ?? []).compactMap { e in e.url.map(Embed.url) ?? e.castId.map(Embed.cast) }
        parent = b.parentCastId; parentUrl = b.parentUrl
        mentions = b.mentions ?? []; mentionsPositions = b.mentionsPositions ?? []
    }
    init(id: String, fid: UInt64, text: String, timestamp: UInt64, embeds: [Embed], parent: CastRef?) {
        self.id = id; self.fid = fid; self.text = text; self.timestamp = timestamp; self.embeds = embeds
        self.parent = parent; parentUrl = nil; mentions = []; mentionsPositions = []
    }

    /// The text with @names put back where the protocol keeps mentions (byte offsets into the UTF-8 text).
    func rendered(_ names: [UInt64: String]) -> String {
        guard !mentions.isEmpty, mentions.count == mentionsPositions.count else { return text }
        var bytes = Array(text.utf8)
        for (fid, pos) in zip(mentions, mentionsPositions).sorted(by: { $0.1 > $1.1 }) where pos <= bytes.count {
            bytes.insert(contentsOf: Array("@\(names[fid] ?? "!\(fid)")".utf8), at: pos)
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}

struct Profile: Codable, Hashable {
    let fid: UInt64
    var username: String?; var display: String?; var bio: String?; var pfp: String?; var url: String?
    var name: String { display?.isEmpty == false ? display! : username ?? "!\(fid)" }
    var handle: String { username.map { "@\($0)" } ?? "fid \(fid)" }
}

// MARK: - Nodes

enum Net: String, Codable, CaseIterable, Identifiable {
    case snapchain, hypersnap
    var id: String { rawValue }
    var label: String { self == .snapchain ? "Snapchain" : "Hypersnap" }
    /// Ours first, then public ones (always labelled as not ours).
    var nodes: [Node] {
        switch self {
        case .snapchain: return [Node(url: "http://46.225.208.199:3381", label: "Fatline master", own: true),
                                 Node(url: "https://crackle.farcaster.xyz:3381", label: "crackle.farcaster.xyz", own: false)]
        case .hypersnap: return [Node(url: "http://46.225.208.199:4381", label: "Fatline master", own: true),
                                 Node(url: "https://haatz.quilibrium.com", label: "haatz.quilibrium.com", own: false)]
        }
    }
}

struct Node: Codable, Hashable, Identifiable {
    let url: String; let label: String; let own: Bool
    var id: String { url }
}

struct NodeStatus: Hashable {
    var ok: Bool; var version: String?; var blockDelay: Int64?; var messages: UInt64?; var latencyMs: Int?; var error: String?
    var shards: [Int: UInt64] = [:] // shard → height
    static let healthyDelay: Int64 = 200
}

struct HubError: LocalizedError { let message: String; var errorDescription: String? { message } }

struct Hub {
    let node: Node
    var timeout: TimeInterval = 12

    static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.httpMaximumConnectionsPerHost = 32
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()

    func get<T: Decodable>(_ path: String, _ params: [String: String] = [:], as: T.Type = T.self) async throws -> T? {
        var c = URLComponents(string: node.url + path)!
        if !params.isEmpty { c.queryItems = params.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var req = URLRequest(url: c.url!); req.timeoutInterval = timeout
        let (data, res) = try await Hub.session.data(for: req)
        let code = (res as? HTTPURLResponse)?.statusCode ?? 0
        if code == 404 { return nil }
        // Snapchain says "not found" with a 400 and NotFound in the detail.
        if code == 400, String(decoding: data, as: UTF8.self).contains("NotFound") { return nil }
        guard (200..<300).contains(code) else { throw HubError(message: "\(node.label): HTTP \(code)") }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func status() async -> NodeStatus {
        let t = Date()
        do {
            guard let info = try await get("/v1/info", as: HubInfo.self) else { return NodeStatus(ok: false, error: "no answer") }
            let shards = (info.shardInfos ?? []).filter { $0.shardId != 0 }
            let delay = shards.map { $0.blockDelay ?? 0 }.max() ?? 0
            var s = NodeStatus(ok: !shards.isEmpty && delay <= NodeStatus.healthyDelay, version: info.version, blockDelay: delay,
                               messages: info.dbStats?.numMessages, latencyMs: Int(Date().timeIntervalSince(t) * 1000))
            for sh in shards { s.shards[sh.shardId] = sh.maxHeight ?? 0 }
            return s
        } catch {
            return NodeStatus(ok: false, error: (error as NSError).localizedDescription)
        }
    }

    func casts(fid: UInt64, pageSize: Int = 10) async throws -> [Cast] {
        let page = try await get("/v1/castsByFid", ["fid": "\(fid)", "pageSize": "\(pageSize)", "reverse": "true"], as: MessagesPage.self)
        return (page?.messages ?? []).compactMap(Cast.init)
    }

    func cast(_ ref: CastRef) async throws -> Cast? {
        try await get("/v1/castById", ["fid": "\(ref.fid)", "hash": ref.hash], as: HubMessage.self).flatMap(Cast.init)
    }

    func replies(_ ref: CastRef) async throws -> [Cast] {
        let page = try await get("/v1/castsByParent", ["fid": "\(ref.fid)", "hash": ref.hash, "pageSize": "100"], as: MessagesPage.self)
        return (page?.messages ?? []).compactMap(Cast.init).sorted { $0.timestamp < $1.timestamp }
    }

    func profile(fid: UInt64) async throws -> Profile {
        let page = try await get("/v1/userDataByFid", ["fid": "\(fid)"], as: MessagesPage.self)
        var p = Profile(fid: fid)
        // The newest value of each field wins.
        for m in (page?.messages ?? []).sorted(by: { ($0.data?.timestamp ?? 0) < ($1.data?.timestamp ?? 0) }) {
            guard let u = m.data?.userDataBody else { continue }
            switch u.type {
            case "USER_DATA_TYPE_USERNAME": p.username = u.value
            case "USER_DATA_TYPE_DISPLAY": p.display = u.value
            case "USER_DATA_TYPE_BIO": p.bio = u.value
            case "USER_DATA_TYPE_PFP": p.pfp = u.value
            case "USER_DATA_TYPE_URL": p.url = u.value
            default: break
            }
        }
        return p
    }

    func following(fid: UInt64) async throws -> [UInt64] {
        try await links("/v1/linksByFid", ["fid": "\(fid)"]) { $0.data?.linkBody?.targetFid }
    }

    func followers(fid: UInt64) async throws -> Int {
        try await links("/v1/linksByTargetFid", ["target_fid": "\(fid)"]) { $0.data?.fid }.count
    }

    private func links(_ path: String, _ base: [String: String], _ pick: (HubMessage) -> UInt64?) async throws -> [UInt64] {
        var out: [UInt64] = [], token: String? = nil
        repeat {
            var p = base.merging(["link_type": "follow", "pageSize": "1000"]) { a, _ in a }
            if let token { p["pageToken"] = token }
            guard let page = try await get(path, p, as: MessagesPage.self) else { break }
            out += (page.messages ?? []).filter { $0.data?.linkBody?.type == "follow" }.compactMap(pick)
            token = page.nextPageToken?.isEmpty == false ? page.nextPageToken : nil
        } while token != nil
        return out
    }

    func reactionCount(_ ref: CastRef, kind: ReactionKind) async -> Int {
        let page = try? await get("/v1/reactionsByCast", ["target_fid": "\(ref.fid)", "target_hash": ref.hash,
            "reaction_type": kind == .like ? "Like" : "Recast", "pageSize": "1000"], as: MessagesPage.self)
        return page?.messages?.count ?? 0
    }

    func events(shard: Int, from: UInt64) async throws -> EventsPage? {
        try await get("/v1/events", ["shard_index": "\(shard)", "from_event_id": "\(from)", "pageSize": "1000"], as: EventsPage.self)
    }

    /// POST a signed message (protobuf bytes). Returns the node's answer, or throws with its reason.
    func submit(_ bytes: [UInt8]) async throws {
        var req = URLRequest(url: URL(string: node.url + "/v1/submitMessage")!)
        req.httpMethod = "POST"; req.timeoutInterval = 20
        req.setValue("application/octet-stream", forHTTPHeaderField: "content-type")
        req.httpBody = Data(bytes)
        let (data, res) = try await Hub.session.data(for: req)
        let code = (res as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let why = (body?["error_detail"] ?? body?["details"] ?? body?["message"]) as? String ?? String(decoding: data, as: UTF8.self)
            throw HubError(message: "\(node.label) refused it: \(why.prefix(200))")
        }
    }
}

/// Snapchain event ids are the block height shifted left by 14 bits, plus a sequence number.
enum EventId { static func at(height: UInt64) -> UInt64 { height << 14 } }
