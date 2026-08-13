import Foundation
import CryptoKit

// GRX v1 client — byte-exact port of GrxClient.kt/GrxCrypto.kt per
// spec/GRX_CLIENT.md. All integers little-endian. Every failure mode is a
// silent drop (nil/false) — no error frames, no exceptions across the API.
//
// Invariants (do not weaken):
//  - fresh ephemeral X25519 per connection; NEVER reuse a session object for
//    a re-handshake — the higher layer builds a new GrxSession instead
//  - send counter starts at 0 and PRE-increments (first packet = 1), never resets
//  - full 16-byte GCM tag; never send input before `established`
final class GrxSession {

    // Wire constants
    private static let T_HELLO: UInt8 = 0xE1
    private static let T_SHELLO: UInt8 = 0xE2
    private static let T_CONFIRM: UInt8 = 0xE3
    private static let VERSION: UInt8 = 0x01
    private static let CIPHER_ID: UInt8 = 0x01
    private static let LTID = Data("gamepados-grx-v1".utf8) // 16 bytes

    private let psk: Data                     // 32B, from pskFromPairingKey
    private let sendRaw: (Data) -> Void       // transport (engine UDP send)
    private let ephPriv = Curve25519.KeyAgreement.PrivateKey()

    private(set) var established = false
    var onEstablished: (() -> Void)?

    // Sender (c2s, dir 1)
    private var kC2S: SymmetricKey?
    private var sendCounter: UInt64 = 0
    // Receiver (s2c, dir 2) — dormant in v1 (server rumble is still cleartext)
    private var kS2C: SymmetricKey?
    private var rxHigh: UInt64 = 0
    private var rxMask: UInt64 = 0

    init(pairingKey: String, send: @escaping (Data) -> Void) {
        self.psk = Self.pskFromPairingKey(pairingKey)
        self.sendRaw = send
    }

    /// PSK = HKDF-SHA256(ikm = hex-decoded key if valid even-length hex else
    /// UTF-8 bytes, salt = empty, info = "grx psk v1", L = 32).
    static func pskFromPairingKey(_ key: String) -> Data {
        let ikm = hexDecode(key) ?? Data(key.utf8)
        return hkdf(ikm: ikm, salt: Data(), info: Data("grx psk v1".utf8), length: 32)
    }

    /// Send CLIENT_HELLO. Call once per connection; no retries — a lost
    /// handshake means the app layer keeps running legacy cleartext (the
    /// server accepts both while GRX_REQUIRED=False).
    func start() {
        var f = Data([Self.T_HELLO])
        f.append(ephPriv.publicKey.rawRepresentation)     // 32B
        f.append(le32(UInt32(Self.LTID.count)))           // 10 00 00 00
        f.append(Self.LTID)
        sendRaw(f)                                        // 53 bytes
    }

    /// Feed any datagram whose first byte is 0xE1/0xE2/0xE3.
    /// Returns true when the frame was consumed as a handshake message.
    @discardableResult
    func onServerMessage(_ frame: Data) -> Bool {
        guard let t = frame.first else { return false }
        guard t == Self.T_SHELLO, !established else { return false }
        guard frame.count >= 65 else { return true }      // parse failure: consumed, not established

        let serverPub = frame.subdata(in: 1..<33)
        let serverConfirm = frame.subdata(in: 33..<65)

        guard let pub = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: serverPub),
              let shared = try? ephPriv.sharedSecretFromKeyAgreement(with: pub) else { return true }
        let sharedBytes = shared.withUnsafeBytes { Data($0) } // 32B; CryptoKit already rejects all-zero

        let th = Self.transcriptHash(clientPub: ephPriv.publicKey.rawRepresentation,
                                     serverPub: serverPub, ltid: Self.LTID)
        // Flat single-shot HKDFs (salt = transcript hash) — NOT the two-stage
        // "grx master v1" scheme the protocol doc describes; the shipped
        // Kotlin/Python code is normative here.
        let ikm = sharedBytes + psk
        let c2s = Self.hkdf(ikm: ikm, salt: th, info: Data("grx c2s v1".utf8), length: 16)
        let s2c = Self.hkdf(ikm: ikm, salt: th, info: Data("grx s2c v1".utf8), length: 16)
        let conf = SymmetricKey(data: Self.hkdf(ikm: ikm, salt: th, info: Data("grx confirm v1".utf8), length: 32))

        // Constant-time verify of HMAC-SHA256(k_conf, th || 'S').
        guard HMAC<SHA256>.isValidAuthenticationCode(serverConfirm, authenticating: th + Data([0x53]), using: conf) else {
            return true // wrong pairing key / MITM: stay unestablished, send nothing
        }

        kC2S = SymmetricKey(data: c2s)
        kS2C = SymmetricKey(data: s2c)
        sendCounter = 0
        established = true

        var confirmFrame = Data([Self.T_CONFIRM])
        confirmFrame.append(Data(HMAC<SHA256>.authenticationCode(for: th + Data([0x43]), using: conf))) // 'C'
        sendRaw(confirmFrame) // 33 bytes
        onEstablished?()
        return true
    }

    /// 20-byte input frame -> 41-byte wire frame, nil until established.
    func seal(_ plaintext20: Data) -> Data? {
        guard established, plaintext20.count == 20, let key = kC2S else { return nil }
        sendCounter &+= 1                                  // pre-increment: first packet = 1
        let ctr = sendCounter
        let nonce = le32(1) + le64(ctr)                    // LE32(DIR_C2S=1) || LE64(counter)
        let aad = Data([Self.VERSION]) + le64(ctr)
        guard let n = try? AES.GCM.Nonce(data: nonce),
              let box = try? AES.GCM.seal(plaintext20, using: key, nonce: n, authenticating: aad) else { return nil }
        var wire = Data([Self.VERSION])
        wire.append(le32(UInt32(truncatingIfNeeded: ctr))) // low 32 bits on the wire
        wire.append(box.ciphertext)                        // 20B
        wire.append(box.tag)                               // 16B, tag LAST
        return wire                                        // 41B
    }

    /// Decrypt an s2c data frame (dormant in v1 — server rumble is cleartext).
    /// 64-entry sliding window; the window advances ONLY on authenticated
    /// packets so a forged high counter can never slide it (anti-DoS rule).
    func open(_ frame: Data) -> Data? {
        guard established, frame.count == 41, frame[frame.startIndex] == Self.VERSION,
              let key = kS2C else { return nil }
        let low32 = UInt64(readLE32(frame, at: 1))
        // Reconstruct the full 64-bit counter around the high-water mark.
        var cand = (rxHigh & 0xFFFF_FFFF_0000_0000) | low32
        if cand &+ 0x8000_0000 < rxHigh { cand &+= 0x1_0000_0000 }
        else if cand > rxHigh &+ 0x8000_0000 && cand >= 0x1_0000_0000 { cand &-= 0x1_0000_0000 }
        let counter = cand
        guard counter > 0 else { return nil }
        if counter <= rxHigh {
            let off = rxHigh - counter
            if off >= 64 || (rxMask >> off) & 1 == 1 { return nil } // too old / duplicate
        }
        let body = frame.subdata(in: frame.startIndex + 5..<frame.startIndex + 41)
        let nonce = le32(2) + le64(counter)
        let aad = Data([Self.VERSION]) + le64(counter)
        guard let n = try? AES.GCM.Nonce(data: nonce),
              let box = try? AES.GCM.SealedBox(nonce: n,
                                               ciphertext: body.prefix(20),
                                               tag: body.suffix(16)),
              let pt = try? AES.GCM.open(box, using: key, authenticating: aad) else { return nil }
        if counter > rxHigh {
            let shift = counter - rxHigh
            rxMask = shift >= 64 ? 1 : (rxMask << shift) | 1
            rxHigh = counter
        } else {
            rxMask |= 1 << (rxHigh - counter)
        }
        return pt
    }

    // ── Primitives ──────────────────────────────────────────────────────

    /// SHA-256 over four length-prefixed fields: lp([VERSION,CIPHER_ID]) ||
    /// lp(clientPub) || lp(serverPub) || lp(ltid), lp(x) = LE32(len) || x.
    private static func transcriptHash(clientPub: Data, serverPub: Data, ltid: Data) -> Data {
        var m = Data()
        for part in [Data([VERSION, CIPHER_ID]), clientPub, serverPub, ltid] {
            m.append(le32(UInt32(part.count)))
            m.append(part)
        }
        return Data(SHA256.hash(data: m))
    }

    private static func hkdf(ikm: Data, salt: Data, info: Data, length: Int) -> Data {
        let key = HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: ikm),
                                         salt: salt, info: info, outputByteCount: length)
        return key.withUnsafeBytes { Data($0) }
    }

    private static func hexDecode(_ s: String) -> Data? {
        guard !s.isEmpty, s.count % 2 == 0 else { return nil }
        var out = Data(capacity: s.count / 2)
        var idx = s.startIndex
        while idx < s.endIndex {
            let next = s.index(idx, offsetBy: 2)
            guard let b = UInt8(s[idx..<next], radix: 16) else { return nil }
            out.append(b)
            idx = next
        }
        return out
    }
}

// Little-endian helpers shared with the engine.
@inline(__always) func le32(_ v: UInt32) -> Data {
    withUnsafeBytes(of: v.littleEndian) { Data($0) }
}
@inline(__always) func le64(_ v: UInt64) -> Data {
    withUnsafeBytes(of: v.littleEndian) { Data($0) }
}
@inline(__always) func readLE32(_ d: Data, at offset: Int) -> UInt32 {
    let i = d.startIndex + offset
    return UInt32(d[i]) | UInt32(d[i+1]) << 8 | UInt32(d[i+2]) << 16 | UInt32(d[i+3]) << 24
}
@inline(__always) func readLE64(_ d: Data, at offset: Int) -> UInt64 {
    var v: UInt64 = 0
    let i = d.startIndex + offset
    for k in 0..<8 { v |= UInt64(d[i+k]) << (8 * k) }
    return v
}
