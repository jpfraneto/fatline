// swiftc -O ../Fatline/Protocol/*.swift main.swift -o /tmp/fl-test && /tmp/fl-test
// Expected values come from @farcaster/core and @noble/hashes (see the commit that added this).
import CryptoKit
import Foundation

var failed = 0
func check(_ name: String, _ got: String, _ want: String) {
    if got == want { print("ok   \(name)") } else { failed += 1; print("FAIL \(name)\n  got  \(got)\n  want \(want)") }
}
let hexOf = { (b: [UInt8]) in b.map { String(format: "%02x", $0) }.joined() }

check("blake3 empty", hexOf(Blake3.hash([])), "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262")
check("blake3 3000", hexOf(Blake3.hash((0..<3000).map { UInt8($0 % 251) })), "5fade288bf27444bee55ba2babb98c3c922c1e84c2e445e7d1f6da24756f5060")

let ts: UInt64 = 150_000_000
let cast = Farcaster.castAdd(fid: 16098, text: "hello fatline https://fatline.ink", parent: CastRef(fid: 3, hash: "0x00112233445566778899aabbccddeeff00112233"), timestamp: ts)
check("cast data", hexOf(cast), "080110e27d1880a3c34720012a5812001a180803121400112233445566778899aabbccddeeff00112233222168656c6c6f206661746c696e652068747470733a2f2f6661746c696e652e696e6b2a0032150a1368747470733a2f2f6661746c696e652e696e6b")
check("cast hash", hexOf(Blake3.hash(cast, length: 20)), "de39f30b82ec34fccbe5231b434be34a5b30ba6e")
check("like", hexOf(Farcaster.reaction(fid: 16098, kind: .like, target: CastRef(fid: 3, hash: "0x" + String(repeating: "01", count: 20)), timestamp: ts)), "080310e27d1880a3c34720013a1c08011218080312140101010101010101010101010101010101010101")
check("follow", hexOf(Farcaster.follow(fid: 16098, target: 378, timestamp: ts)), "080510e27d1880a3c3472001720b0a06666f6c6c6f7718fa02")
check("long cast", String(hexOf(Farcaster.castAdd(fid: 16098, text: String(repeating: "é", count: 200), timestamp: ts)).prefix(40)), "080110e27d1880a3c34720012a99031200229003")
let key = try! Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 7, count: 32))
check("pubkey", hexOf([UInt8](key.publicKey.rawRepresentation)), "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c")
let signed = try! Farcaster.sign(cast, with: key)
FileManager.default.createFile(atPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "/dev/null", contents: Data(signed.bytes))
print(failed == 0 ? "all good" : "\(failed) failed")
exit(failed == 0 ? 0 : 1)
