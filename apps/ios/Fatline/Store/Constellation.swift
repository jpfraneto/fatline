// The other Fatlines: every egg the genesis hatchery knows, the server that keeps its node, and whether that node
// is awake and in step with the network right now (asked of the node itself).
import Foundation
import Observation

struct Being: Identifiable, Hashable {
    let label: String; let fid: UInt64; let host: String; let hatched: Bool
    var id: String { label }
    var status: NodeStatus?
    var warmDays: Int?; var needed: Int?; var dna: String?
    var asked = false
    var awake: Bool { status?.ok == true }
    var genesis: Bool { host == "46.225.208.199" }
    var surname: String { label.uppercased() }
}

@Observable @MainActor
final class Constellation {
    var beings: [Being] = []
    var asking = false
    var error: String?
    var askedAt: Date?

    private struct Names: Decodable { struct N: Decodable { let label: String; let fid: UInt64; let host: String; let hatched: Bool? }; let names: [N] }
    private struct Egg: Decodable { let warmDays: Int?; let needed: Int?; let dna: String? }

    func ask() async {
        asking = true; defer { asking = false; askedAt = Date() }
        do {
            let (data, _) = try await URLSession.shared.data(from: URL(string: "\(SignIn.hatchery)/names")!)
            let names = try JSONDecoder().decode(Names.self, from: data).names
            let known = Dictionary(uniqueKeysWithValues: beings.map { ($0.label, $0) })
            beings = names.map { n in
                var b = known[n.label] ?? Being(label: n.label, fid: n.fid, host: n.host, hatched: n.hatched ?? false)
                b.asked = false
                return b
            }.sorted { ($0.genesis ? 0 : 1, $0.label) < ($1.genesis ? 0 : 1, $1.label) }
            error = nil
        } catch {
            self.error = "The hatchery didn't answer."
            return
        }
        await withTaskGroup(of: (String, NodeStatus, Egg?).self) { g in
            for b in beings {
                g.addTask {
                    async let s = Hub(node: Node(url: "http://\(b.host):3381", label: b.label, own: false), timeout: 7).status()
                    async let e: Egg? = {
                        guard let (d, r) = try? await URLSession.shared.data(from: URL(string: "\(SignIn.hatchery)/eggs/\(b.fid)")!),
                              (r as? HTTPURLResponse)?.statusCode == 200 else { return nil }
                        return try? JSONDecoder().decode(Egg.self, from: d)
                    }()
                    return (b.label, await s, await e)
                }
            }
            for await (label, s, e) in g {
                guard let i = beings.firstIndex(where: { $0.label == label }) else { continue }
                beings[i].status = s; beings[i].asked = true
                beings[i].warmDays = e?.warmDays; beings[i].needed = e?.needed; beings[i].dna = e?.dna
            }
        }
    }
}
