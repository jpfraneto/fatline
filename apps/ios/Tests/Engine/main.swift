// The Around and For you engines, checked without the app.
//   swiftc -O Fatline/Protocol/*.swift Fatline/Store/AroundReader.swift Fatline/Store/Discover.swift Tests/Engine/main.swift -o /tmp/fl-engine && /tmp/fl-engine
// Offline: the cases of indexer/test/around.test.mjs (frontier) and discover.test.mjs (score, pick).
// With "live <fid> <node url> <out.json>": reads that account's Around (6 pages) and For you from the node and writes
// what it found, to compare with the web's around.mjs / discover.mjs on the same node (Tests/Engine/compare.mjs).
import Foundation

var failed = 0
func check(_ name: String, _ ok: Bool) { if ok { print("ok   \(name)") } else { failed += 1; print("FAIL \(name)") } }

// frontier: two newest-first runs (one per shard) are complete down to the newer of their ends
check("frontier one run", AroundReader.frontier([90, 80, 70, 60, 50]) == 50)
check("frontier two runs", AroundReader.frontier([90, 30, 85, 75]) == 75)
check("frontier empty", AroundReader.frontier([]) == nil)
check("order: newest first, then key", aroundBefore((10, "b"), (9, "a")) && aroundBefore((10, "a"), (10, "b")))

// score and pick (discover.test.mjs)
let now = Date(timeIntervalSince1970: 1_793_361_600) // 2026-10-30 12:00 UTC
func cast(_ fid: UInt64, _ hoursAgo: Double, _ text: String) -> Cast {
    Cast(id: "0x\(fid)\(hoursAgo)", fid: fid, text: text, timestamp: Farcaster.timestamp(now.addingTimeInterval(-hoursAgo * 3600)), embeds: [], parent: nil)
}
let follows: Set<UInt64> = [1, 2, 3]
func s(_ c: Cast, _ r: [Discover.Reactor] = [], near: Set<UInt64> = []) -> (value: Double, why: [Why]) {
    Discover.score(c, reactors: r, follows: follows, near: near, now: now)
}
let plain = s(cast(1, 1, "gm")).value
let asked = s(cast(1, 1, "what are you building this week, and why does it matter to you?"))
check("a question rises", asked.value > plain && asked.why.map(\.kind) == [.question])
let liked = s(cast(9, 1, "gm"), [Discover.Reactor(fid: 1, recast: false), Discover.Reactor(fid: 2, recast: true)])
check("what your people liked rises; someone new", liked.value > plain && liked.why.map(\.kind) == [.liked, .recast, .new])
check("near rises", s(cast(1, 1, "gm"), near: [1]).value > plain)
check("older sinks", s(cast(1, 20, "gm")).value < plain)
check("only a link sinks", s(cast(1, 1, "https://x.example/a")).value < plain)
check("nothing to say", s(cast(9, 1, "gm")).why.isEmpty)
// exact value: (1 + 2·log2(1 + 1 + 1.6) + 0 + 0 + 0.8) / (1 + 1/8)^1.2
check("exact score", abs(liked.value - (1 + 2 * log2(3.6) + 0.8) / pow(1.125, 1.2)) < 1e-9)
let picked = Discover.pick([(1, 9.0), (1, 8), (1, 7), (2, 6), (3, 1)].map { Pick(cast: cast($0.0, $0.1, "x"), score: $0.1, why: []) })
check("two per person, never twice in a row", picked.map { "\($0.cast.fid):\(Int($0.score))" } == ["1:9", "2:6", "1:8", "3:1"])

let args = CommandLine.arguments
if args.count >= 5, args[1] == "live", let fid = UInt64(args[2]) {
    let hub = Hub(node: Node(url: args[3], label: "live", own: false), timeout: 30)
    let reader = AroundReader(hub: hub, fid: fid)
    var keys: [String] = [], cursor: AroundCursor? = nil, pages = 0
    let t = Date()
    repeat {
        let (items, next) = try await reader.page(after: cursor)
        keys += items.map(\.key)
        let sorted = items.map { ($0.at, $0.key) }.sorted(by: aroundBefore)
        check("page \(pages): \(items.count) items, newest first", items.map(\.key) == sorted.map(\.1))
        if let c = cursor, let f = items.first { check("page \(pages) starts after the last", aroundBefore((c.at, c.key), (f.at, f.key))) }
        let replies = items.filter { $0.kind == .reply }
        check("page \(pages): every reply knows your cast", replies.allSatisfy { $0.yours != nil })
        cursor = next; pages += 1
    } while cursor != nil && pages < 6
    check("nothing twice", Set(keys).count == keys.count)
    print("around: \(keys.count) items in \(pages) pages, \(String(format: "%.1f", Date().timeIntervalSince(t))) s")
    let t2 = Date()
    let fy = try await Discover.build(hub: hub, fid: fid, near: [])
    print("for you: \(fy.picks.count) picks, \(String(format: "%.1f", Date().timeIntervalSince(t2))) s")
    check("for you: at most two per person, never twice in a row", zip(fy.picks, fy.picks.dropFirst()).allSatisfy { $0.cast.fid != $1.cast.fid }
          && Dictionary(grouping: fy.picks, by: \.cast.fid).values.allSatisfy { $0.count <= 2 })
    check("for you: never your own", fy.picks.allSatisfy { $0.cast.fid != fid })
    let out: [String: Any] = ["around": keys, "forYou": fy.picks.map { ["id": $0.cast.id, "score": $0.score, "why": $0.why.map(\.kind.rawValue)] }]
    try JSONSerialization.data(withJSONObject: out, options: .prettyPrinted).write(to: URL(fileURLWithPath: args[4]))
}
print(failed == 0 ? "all good" : "\(failed) failed")
exit(failed == 0 ? 0 : 1)
