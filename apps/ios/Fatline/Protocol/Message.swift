// Farcaster messages, built and signed on this phone: protobuf by hand (the few fields we need),
// BLAKE3 for the hash, Ed25519 (CryptoKit) for the signature. Byte-for-byte what @farcaster/core makes.
import CryptoKit
import Foundation

struct Proto {
    var bytes: [UInt8] = []

    mutating func varint(_ v: UInt64) {
        var v = v
        while v >= 0x80 { bytes.append(UInt8(v & 0x7f) | 0x80); v >>= 7 }
        bytes.append(UInt8(v))
    }
    mutating func tag(_ field: Int, _ wire: Int) { varint(UInt64(field << 3 | wire)) }
    mutating func uint(_ field: Int, _ v: UInt64) { tag(field, 0); varint(v) }
    mutating func data(_ field: Int, _ b: [UInt8]) { tag(field, 2); varint(UInt64(b.count)); bytes += b }
    mutating func string(_ field: Int, _ s: String) { data(field, Array(s.utf8)) }
    mutating func message(_ field: Int, _ m: Proto) { data(field, m.bytes) }
    mutating func packed(_ field: Int, _ vs: [UInt64]) { var p = Proto(); vs.forEach { p.varint($0) }; data(field, p.bytes) }
}

enum MessageType: UInt64 { case castAdd = 1, castRemove = 2, reactionAdd = 3, reactionRemove = 4, linkAdd = 5, linkRemove = 6 }
enum ReactionKind: UInt64 { case like = 1, recast = 2 }

struct CastRef: Hashable, Codable { let fid: UInt64; let hash: String }

enum Farcaster {
    static let epoch: TimeInterval = 1_609_459_200 // 2021-01-01 UTC
    static let castMaxBytes = 320, longCastMaxBytes = 1024

    static func timestamp(_ date: Date = Date()) -> UInt64 { UInt64(max(0, date.timeIntervalSince1970 - epoch)) }
    static func date(_ ts: UInt64) -> Date { Date(timeIntervalSince1970: TimeInterval(ts) + epoch) }

    static func castId(_ ref: CastRef) -> Proto { var p = Proto(); p.uint(1, ref.fid); p.data(2, Hex.bytes(ref.hash)); return p }

    /// Links in the text become embeds, as the web client does: https only, at most 2, each ≤256 bytes.
    static func linkEmbeds(_ text: String) -> [String] {
        let re = try! NSRegularExpression(pattern: "https://[^\\s<>\"]+")
        var seen: [String] = []
        for m in re.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            var u = String(text[Range(m.range, in: text)!])
            while let c = u.last, ".,;:!?)]".contains(c) { u.removeLast() }
            if u.utf8.count <= 256, !seen.contains(u) { seen.append(u) }
        }
        return Array(seen.prefix(2))
    }

    static func castAddBody(text: String, parent: CastRef?, embeds: [String]) -> Proto {
        var b = Proto()
        b.packed(2, []) // mentions (ts-proto writes the empty packed field; kept so bytes match)
        if let parent { b.message(3, castId(parent)) }
        b.string(4, text)
        b.packed(5, []) // mentionsPositions
        for url in embeds { var e = Proto(); e.string(1, url); b.message(6, e) }
        if text.utf8.count > castMaxBytes { b.uint(8, 1) } // LONG_CAST
        return b
    }

    static func messageData(type: MessageType, fid: UInt64, timestamp: UInt64, body: (Int, Proto)) -> [UInt8] {
        var d = Proto()
        d.uint(1, type.rawValue)
        d.uint(2, fid)
        d.uint(3, timestamp)
        d.uint(4, 1) // FARCASTER_NETWORK_MAINNET
        d.message(body.0, body.1)
        return d.bytes
    }

    static func castAdd(fid: UInt64, text: String, parent: CastRef? = nil, timestamp: UInt64 = timestamp()) -> [UInt8] {
        messageData(type: .castAdd, fid: fid, timestamp: timestamp, body: (5, castAddBody(text: text, parent: parent, embeds: linkEmbeds(text))))
    }
    static func castRemove(fid: UInt64, hash: String, timestamp: UInt64 = timestamp()) -> [UInt8] {
        var b = Proto(); b.data(1, Hex.bytes(hash))
        return messageData(type: .castRemove, fid: fid, timestamp: timestamp, body: (6, b))
    }
    static func reaction(fid: UInt64, kind: ReactionKind, target: CastRef, remove: Bool = false, timestamp: UInt64 = timestamp()) -> [UInt8] {
        var b = Proto(); b.uint(1, kind.rawValue); b.message(2, castId(target))
        return messageData(type: remove ? .reactionRemove : .reactionAdd, fid: fid, timestamp: timestamp, body: (7, b))
    }
    static func follow(fid: UInt64, target: UInt64, remove: Bool = false, timestamp: UInt64 = timestamp()) -> [UInt8] {
        var b = Proto(); b.string(1, "follow"); b.uint(3, target)
        return messageData(type: remove ? .linkRemove : .linkAdd, fid: fid, timestamp: timestamp, body: (14, b))
    }

    /// The full Message: data, hash (BLAKE3, 20 bytes), signature over the hash, signer, and the data bytes themselves.
    static func sign(_ data: [UInt8], with key: Curve25519.Signing.PrivateKey) throws -> (bytes: [UInt8], hash: String) {
        let hash = Blake3.hash(data, length: 20)
        let signature = [UInt8](try key.signature(for: Data(hash)))
        var m = Proto()
        m.data(1, data)
        m.data(2, hash)
        m.uint(3, 1) // HASH_SCHEME_BLAKE3
        m.data(4, signature)
        m.uint(5, 1) // SIGNATURE_SCHEME_ED25519
        m.data(6, [UInt8](key.publicKey.rawRepresentation))
        m.data(7, data)
        return (m.bytes, Hex.string(hash))
    }
}

enum Hex {
    static func string(_ b: [UInt8]) -> String { "0x" + b.map { String(format: "%02x", $0) }.joined() }
    static func bytes(_ s: String) -> [UInt8] {
        let h = Array((s.hasPrefix("0x") ? String(s.dropFirst(2)) : s).utf8)
        var out: [UInt8] = []; out.reserveCapacity(h.count / 2)
        func v(_ c: UInt8) -> UInt8 { c >= 97 ? c - 87 : c >= 65 ? c - 55 : c - 48 }
        var i = 0
        while i + 1 < h.count { out.append(v(h[i]) << 4 | v(h[i + 1])); i += 2 }
        return out
    }
}
