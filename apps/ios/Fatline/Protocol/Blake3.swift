// BLAKE3, the hash Farcaster messages are named by (the first 20 bytes of BLAKE3 over the message data).
// A plain single-threaded port of the reference implementation.
import Foundation

enum Blake3 {
    private static let iv: [UInt32] = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19]
    private static let perm = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8]
    private static let chunkStart: UInt32 = 1, chunkEnd: UInt32 = 2, parent: UInt32 = 4, root: UInt32 = 8
    private static let blockLen = 64, chunkLen = 1024

    @inline(__always) private static func rotr(_ x: UInt32, _ n: UInt32) -> UInt32 { (x >> n) | (x << (32 - n)) }

    @inline(__always) private static func g(_ s: inout [UInt32], _ a: Int, _ b: Int, _ c: Int, _ d: Int, _ x: UInt32, _ y: UInt32) {
        s[a] = s[a] &+ s[b] &+ x; s[d] = rotr(s[d] ^ s[a], 16)
        s[c] = s[c] &+ s[d]; s[b] = rotr(s[b] ^ s[c], 12)
        s[a] = s[a] &+ s[b] &+ y; s[d] = rotr(s[d] ^ s[a], 8)
        s[c] = s[c] &+ s[d]; s[b] = rotr(s[b] ^ s[c], 7)
    }

    private static func compress(_ cv: [UInt32], _ block: [UInt32], _ counter: UInt64, _ len: UInt32, _ flags: UInt32) -> [UInt32] {
        var s = cv + Array(iv[0..<4]) + [UInt32(truncatingIfNeeded: counter), UInt32(truncatingIfNeeded: counter >> 32), len, flags]
        var m = block
        for r in 0..<7 {
            g(&s, 0, 4, 8, 12, m[0], m[1]); g(&s, 1, 5, 9, 13, m[2], m[3])
            g(&s, 2, 6, 10, 14, m[4], m[5]); g(&s, 3, 7, 11, 15, m[6], m[7])
            g(&s, 0, 5, 10, 15, m[8], m[9]); g(&s, 1, 6, 11, 12, m[10], m[11])
            g(&s, 2, 7, 8, 13, m[12], m[13]); g(&s, 3, 4, 9, 14, m[14], m[15])
            if r < 6 { m = perm.map { m[$0] } }
        }
        for i in 0..<8 { s[i] ^= s[i + 8]; s[i + 8] ^= cv[i] }
        return s
    }

    private static func words(_ bytes: ArraySlice<UInt8>) -> [UInt32] {
        var block = [UInt8](bytes); block += [UInt8](repeating: 0, count: blockLen - block.count)
        return (0..<16).map { i in UInt32(block[i*4]) | UInt32(block[i*4+1]) << 8 | UInt32(block[i*4+2]) << 16 | UInt32(block[i*4+3]) << 24 }
    }

    /// The output of one node, kept so the root can be finalized with the ROOT flag.
    private struct Output { let cv: [UInt32]; let block: [UInt32]; let counter: UInt64; let len: UInt32; let flags: UInt32
        var chaining: [UInt32] { Array(Blake3.compress(cv, block, counter, len, flags)[0..<8]) }
    }

    private static func chunkOutput(_ chunk: ArraySlice<UInt8>, counter: UInt64) -> Output {
        var cv = iv
        let bytes = Array(chunk)
        let blocks = max(1, (bytes.count + blockLen - 1) / blockLen)
        for b in 0..<blocks {
            let lo = b * blockLen, hi = min(lo + blockLen, bytes.count)
            var flags: UInt32 = 0
            if b == 0 { flags |= chunkStart }
            let block = words(bytes[lo..<hi])
            if b == blocks - 1 { return Output(cv: cv, block: block, counter: counter, len: UInt32(hi - lo), flags: flags | chunkEnd) }
            cv = Array(compress(cv, block, counter, UInt32(blockLen), flags)[0..<8])
        }
        fatalError("unreachable")
    }

    private static func parentOutput(_ l: [UInt32], _ r: [UInt32]) -> Output { Output(cv: iv, block: l + r, counter: 0, len: UInt32(blockLen), flags: parent) }

    static func hash(_ input: [UInt8], length: Int = 32) -> [UInt8] {
        // Chunks into a tree: the classic stack merge, by the number of completed chunks.
        var stack: [[UInt32]] = []
        let chunks = max(1, (input.count + chunkLen - 1) / chunkLen)
        var last: Output!
        for c in 0..<chunks {
            let lo = c * chunkLen, hi = min(lo + chunkLen, input.count)
            let out = chunkOutput(input[lo..<hi], counter: UInt64(c))
            if c == chunks - 1 { last = out; break }
            var cv = out.chaining
            var total = UInt64(c + 1)
            while total & 1 == 0 { cv = parentOutput(stack.removeLast(), cv).chaining; total >>= 1 }
            stack.append(cv)
        }
        while let l = stack.popLast() { last = parentOutput(l, last.chaining) }
        // Root output, extended to `length` bytes.
        var out: [UInt8] = []
        var counter: UInt64 = 0
        while out.count < length {
            let w = compress(last.cv, last.block, counter, last.len, last.flags | root)
            for x in w { out += [UInt8(x & 0xff), UInt8(x >> 8 & 0xff), UInt8(x >> 16 & 0xff), UInt8(x >> 24)] }
            counter += 1
        }
        return Array(out.prefix(length))
    }
}
