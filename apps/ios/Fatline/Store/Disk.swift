// What was last on screen, kept on this phone (Caches) so the app opens on it at once and refreshes quietly.
import Foundation

enum Disk {
    static let dir: URL = {
        let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("fatline", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    static func load<T: Decodable>(_ type: T.Type, _ name: String) -> T? {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent(name)) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    /// Encoded here, written off the main thread.
    static func save<T: Encodable>(_ value: T, _ name: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        let url = dir.appendingPathComponent(name)
        Task.detached(priority: .utility) { try? data.write(to: url, options: .atomic) }
    }
}
