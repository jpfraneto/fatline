// This phone's own key for your account. It is made here, kept in the Keychain (this device only), and never leaves.
// You approve it once in the Farcaster app: @fatline's server signs the request (it names the app asking),
// Farcaster's app shows it to you and adds the key onchain. After that, every cast is signed on this phone.
import CryptoKit
import Foundation
import Security

struct SignerRecord: Codable {
    var fid: UInt64?
    var publicKey: String
    var state: String // "pending" | "active"
    var token: String?
    var deeplink: String?
}

enum Keychain {
    static let service = "ink.fatline.phone.signer"

    static func save(_ data: Data, account: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(q as CFDictionary)
        var add = q
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }
    static func load(account: String) -> Data? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: CFTypeRef?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }
    static func delete(account: String) {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] as CFDictionary)
    }
}

enum SignIn {
    static let hatchery = "http://46.225.208.199:8791" // the genesis server: signs key requests as @fatline
    static let apis = ["https://api.farcaster.xyz", "https://api.warpcast.com"]

    static func loadKey() -> Curve25519.Signing.PrivateKey? {
        Keychain.load(account: "key").flatMap { try? Curve25519.Signing.PrivateKey(rawRepresentation: $0) }
    }
    static func loadRecord() -> SignerRecord? {
        Keychain.load(account: "record").flatMap { try? JSONDecoder().decode(SignerRecord.self, from: $0) }
    }
    static func saveRecord(_ r: SignerRecord) { Keychain.save(try! JSONEncoder().encode(r), account: "record") }
    static func forget() { Keychain.delete(account: "key"); Keychain.delete(account: "record") }

    private static func post(_ url: String, _ body: [String: Any]) async throws -> [String: Any] {
        var req = URLRequest(url: URL(string: url)!)
        req.httpMethod = "POST"; req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, res) = try await URLSession.shared.data(for: req)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard ((res as? HTTPURLResponse)?.statusCode ?? 0) < 300 else {
            let msg = (json["error"] as? String) ?? ((json["errors"] as? [[String: Any]])?.first?["message"] as? String) ?? "HTTP error"
            throw HubError(message: msg)
        }
        return json
    }

    /// Makes the key and the request. Returns the link that opens the Farcaster app.
    static func start() async throws -> SignerRecord {
        let key = Curve25519.Signing.PrivateKey()
        let pub = Hex.string([UInt8](key.publicKey.rawRepresentation))
        let req = try await post("\(hatchery)/signer-request", ["key": pub])
        guard let requestFid = req["requestFid"], let signature = req["signature"], let deadline = req["deadline"] else {
            throw HubError(message: "The Fatline server didn't sign the request.")
        }
        var last: Error = HubError(message: "Farcaster didn't answer.")
        for api in apis {
            do {
                let out = try await post("\(api)/v2/signed-key-requests", ["key": pub, "requestFid": requestFid, "signature": signature,
                                                                            "deadline": deadline, "redirectUrl": "fatline://signed-in"])
                guard let skr = (out["result"] as? [String: Any])?["signedKeyRequest"] as? [String: Any],
                      let token = skr["token"] as? String, let link = skr["deeplinkUrl"] as? String else { continue }
                // Kept before you approve, so the key is never added without this phone holding it.
                Keychain.save(key.rawRepresentation, account: "key")
                let record = SignerRecord(fid: nil, publicKey: pub, state: "pending", token: token, deeplink: link)
                saveRecord(record)
                return record
            } catch { last = error }
        }
        throw last
    }

    /// Asks Farcaster where the request stands. Returns the record, active once approved and added.
    static func poll(_ record: SignerRecord) async throws -> SignerRecord {
        guard let token = record.token else { return record }
        for api in apis {
            guard let url = URL(string: "\(api)/v2/signed-key-request?token=\(token)"),
                  let (data, _) = try? await URLSession.shared.data(from: url),
                  let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let skr = (json["result"] as? [String: Any])?["signedKeyRequest"] as? [String: Any] else { continue }
            var r = record
            if let fid = skr["userFid"] as? NSNumber { r.fid = fid.uint64Value }
            if skr["state"] as? String == "completed", r.fid != nil { r.state = "active"; r.token = nil; r.deeplink = nil }
            saveRecord(r)
            return r
        }
        return record
    }
}
