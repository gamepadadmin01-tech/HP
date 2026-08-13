# GRX v1 — Client-Side Protocol, Byte-Exact Reimplementation Spec (Swift/CryptoKit target)

Normative sources: `F:\hlooo\apps\docs\GRX_PROTOCOL.md`, `GrxCrypto.kt`, `GrxClient.kt`. Where the doc and Kotlin code disagree (one place, see §3 note), the CODE is normative — the Kotlin header states it mirrors the unit-tested Python reference (`apps/pc-server/grx_crypto.py` / `grx_session.py`) byte-for-byte.

Global conventions:
- ALL multi-byte integers on the wire and in derivations are LITTLE-ENDIAN.
- `VERSION = 0x01`, `CIPHER_ID = 0x01`.
- `lp(b)` = LE32(len(b)) || b (4-byte little-endian length prefix, then the bytes).
- Constants: KEY_LEN=16, TAG_LEN=16, PLAINTEXT_LEN=20, HEADER_LEN=5, WIRE_LEN=41.

## 1. Frame types and byte layouts

Control-frame type bytes (first byte of datagram):
- `T_HELLO   = 0xE1` (CLIENT_HELLO, client→server)
- `T_SHELLO  = 0xE2` (SERVER_HELLO, server→client)
- `T_CONFIRM = 0xE3` (CLIENT_CONFIRM, client→server)
Data frames start with `VERSION = 0x01`, so there is no collision. `isControl(frame)` = non-empty AND first byte ∈ {0xE1, 0xE2, 0xE3}.

CLIENT_HELLO (client sends; 53 bytes with the standard LTID):
```
offset 0      : 0xE1
offset 1..32  : client ephemeral X25519 public key (32 bytes, raw)
offset 33..36 : LE32 length of long_term_id  (= 0x10 0x00 0x00 0x00 for the 16-byte LTID)
offset 37..   : long_term_id bytes (16 bytes = GRX_LTID, see §5)
```

SERVER_HELLO (client receives; client requires size >= 65, type byte 0xE2; bytes beyond 65 are ignored):
```
offset 0      : 0xE2
offset 1..32  : server ephemeral X25519 public key (32 bytes, raw)
offset 33..64 : server_confirm = HMAC-SHA256(k_conf, transcript_hash || 'S') (32 bytes)
```

CLIENT_CONFIRM (client sends; exactly 33 bytes):
```
offset 0      : 0xE3
offset 1..32  : client_confirm = HMAC-SHA256(k_conf, transcript_hash || 'C') (32 bytes)
```

Data wire frame (c2s input; exactly 41 bytes) — see §7:
```
offset 0      : version = 0x01
offset 1..4   : counter_low32 (LE, low 32 bits of the 64-bit send counter)
offset 5..24  : AES-128-GCM ciphertext of the 20-byte input frame
offset 25..40 : GCM tag (16 bytes, FULL 128-bit, appended AFTER ciphertext — tag-LAST, not tag-first)
```

## 2. X25519 ephemeral keys

- Generate a FRESH ephemeral X25519 keypair PER CONNECTION (at client-session construction). Never reuse across connects — fresh key per connection is what makes counter-from-0 safe; key reuse with a reset counter is a total GCM break.
- Swift: `Curve25519.KeyAgreement.PrivateKey()`; raw 32-byte public key (`publicKey.rawRepresentation`) goes into CLIENT_HELLO offset 1..32.
- `shared = X25519(client_eph_priv, server_eph_pub)` — 32 bytes (`sharedSecretFromKeyAgreement`). Both Tink and CryptoKit reject an all-zero shared secret (low-order point) by throwing — treat that as handshake failure/abort.

## 3. HKDF-SHA256 derivations (session keys)

Let `th` = transcript hash (§6), `ikm = shared || psk` (32+32 = 64 bytes, shared first).

Three INDEPENDENT single-shot HKDF-SHA256 calls (full extract-then-expand, i.e. exactly CryptoKit `HKDF<SHA256>.deriveKey(inputKeyMaterial:salt:info:outputByteCount:)` / Tink `Hkdf.computeHkdf("HMACSHA256", ikm, salt, info, n)`):
```
k_c2s  = HKDF-SHA256(ikm, salt = th, info = "grx c2s v1"     (ASCII, 10 bytes), L = 16)   // client→server AES-128 key
k_s2c  = HKDF-SHA256(ikm, salt = th, info = "grx s2c v1"     (ASCII, 10 bytes), L = 16)   // server→client AES-128 key
k_conf = HKDF-SHA256(ikm, salt = th, info = "grx confirm v1" (ASCII, 14 bytes), L = 32)   // confirm-HMAC key
```
IMPORTANT DISCREPANCY NOTE: GRX_PROTOCOL.md describes a two-stage scheme (a 32-byte "grx master v1" HKDF, then HKDF-Expand per key). The shipped Kotlin/Python code does NOT do that — it does the three flat HKDF calls above with salt = th and info = the per-key label. Implement the flat scheme (the code), not the doc's two-stage text. There is no "grx master v1" derivation anywhere in the code.

Info strings byte-for-byte:
- "grx c2s v1"     = 67 72 78 20 63 32 73 20 76 31
- "grx s2c v1"     = 67 72 78 20 73 32 63 20 76 31
- "grx confirm v1" = 67 72 78 20 63 6F 6E 66 69 72 6D 20 76 31
- "grx psk v1"     = 67 72 78 20 70 73 6B 20 76 31   (used in §4)
- "grx master v1"  — DOC-ONLY, unused; do not implement.

## 4. PSK derivation from the pairing key string (`pskFromPairingKey`)

Input: the pairing key STRING = the 3rd CSV field of the pairing QR.
1. Hex-decode attempt: if the string is non-empty, has even length, and every character is a valid hex digit (case-insensitive, 0-9a-fA-F), `ikm` = the hex-decoded bytes. Otherwise (odd length, empty, or any non-hex char) `ikm` = the UTF-8 bytes of the string as-is. (Matches Python `bytes.fromhex` fallback semantics used by `server.py:_grx_psk_from_key`.)
2. `psk = HKDF-SHA256(ikm, salt = empty (zero-length; per RFC 5869 equivalent to 32 zero bytes), info = "grx psk v1" (ASCII, 10 bytes), L = 32)`.

## 5. GRX_LTID exact bytes

`long_term_id` is the fixed domain string "gamepados-grx-v1" in ASCII, 16 bytes:
```
67 61 6D 65 70 61 64 6F 73 2D 67 72 78 2D 76 31
```
It is sent length-prefixed in CLIENT_HELLO and bound into the transcript hash. It must equal the server's GRX_LTID.

## 6. Transcript hash

`th = SHA-256` over the concatenation of four length-prefixed fields, in this exact order, each as `lp(x)` = LE32(len) || bytes:
```
lp( [VERSION, CIPHER_ID] )      = 02 00 00 00 01 01
lp( client_eph_pub )            = 20 00 00 00 || 32 bytes
lp( server_eph_pub )            = 20 00 00 00 || 32 bytes
lp( long_term_id )              = 10 00 00 00 || "gamepados-grx-v1"
```
Output: 32 bytes. Used as HKDF salt (§3) and as the HMAC message body of the confirm tags.

Confirm tags: `confirm(role) = HMAC-SHA256(key = k_conf, msg = th || role_byte)` where role_byte = 0x43 ('C') for client, 0x53 ('S') for server. Full 32-byte output. Compare the received server confirm in CONSTANT TIME (Kotlin uses `MessageDigest.isEqual`).

## 7. Per-packet AEAD — sealing the 20-byte input frame into the 41-byte wire frame

- Plaintext: the existing 20-byte input frame, Python struct `<Q H B B B B B B I` (little-endian: u64 timestamp, u16 buttons, 6×u8 axes/triggers, trailing u32 authToken which is now vestigial — always 0; GCM provides authentication). GRX does not reinterpret it; it seals the 20 bytes opaquely. `seal` REQUIRES plaintext length == 20.
- Cipher: AES-128-GCM, key = k_c2s (16 bytes), tag = full 16 bytes (never truncate).
- Directions: `DIR_C2S = 1` (input, client sender), `DIR_S2C = 2` (rumble/ack, client receiver). Each direction has its own key.
- Counter: per-(key, direction) unsigned 64-bit. Sender state starts at 0 and PRE-increments, so the FIRST packet uses counter = 1. Strictly monotonic, NEVER resets. Counter exhaustion or ANY state loss (process restart, reconnect) → new handshake with a fresh ephemeral key; never reset the counter under an existing key. (Nonce reuse under a key is catastrophic — invariant #1.)
- Nonce (12 bytes / 96-bit): `LE32(direction) || LE64(counter)`. For c2s packet n: `01 00 00 00` || LE64(n).
- AAD (9 bytes): `version_byte(0x01) || LE64(counter)` — binds version + full counter (anti-downgrade, and authenticates the high counter bits that are not on the wire).
- Wire frame (41 bytes): `0x01 || LE32(counter & 0xFFFFFFFF) || ciphertext(20) || tag(16)`. Tag comes LAST (Java `doFinal` returns ct||tag; CryptoKit: emit `sealedBox.ciphertext` then `sealedBox.tag`; the nonce is NOT on the wire).
- Swift: `AES.GCM.seal(pt, using: SymmetricKey(data: k_c2s), nonce: try AES.GCM.Nonce(data: nonce12), authenticating: aad9)`.

## 8. Handshake state machine (GrxClient)

Construction: `GrxClient(psk, ltid, send)` — psk from §4, ltid = GRX_LTID, `send` = the transport callback (the engine's existing UDP send). Constructing it creates the session and generates the fresh ephemeral keypair. States are effectively two booleans: NOT-ESTABLISHED → ESTABLISHED (one-way; no other states).

- `start()`: sends CLIENT_HELLO (§1) via the callback. Call once per (re)connect. There is NO built-in retry, retransmit, or timeout — if the HELLO or SERVER_HELLO is lost, the higher layer handles it by creating a NEW GrxClient (fresh ephemeral) and calling start() again. Never restart a handshake on the same session object.
- Inbound routing: for every datagram from the server, first check `isControl(pkt)` (first byte 0xE1/0xE2/0xE3); if true, feed to `onServerMessage(pkt)` and do not treat it as data.
- `onServerMessage(frame) -> Bool` (true = frame was a handshake message and was consumed):
  - empty frame → false.
  - `t = frame[0] & 0xFF`.
  - If `t == 0xE2 (T_SHELLO)` AND not yet established:
    1. Validate size >= 65 and type byte; else fail (returns consumed=true but stays unestablished — the inner handler returned null on the size/type check only when type mismatches; practically: parse failure = null).
    2. serverPub = frame[1..32], serverConfirm = frame[33..64].
    3. shared = X25519(ephPriv, serverPub); th = transcriptHash(clientPub, serverPub, ltid); derive k_c2s/k_s2c/k_conf (§3).
    4. Constant-time compare serverConfirm vs HMAC-SHA256(k_conf, th || 'S'). MISMATCH (wrong pairing key / MITM) → discard keys, remain unestablished, send NOTHING, return true (consumed). No exception, no retry — the client just never sends input.
    5. MATCH → create Sender(k_c2s, dir=1) and Receiver(k_s2c, dir=2), flip `established = true`, build CLIENT_CONFIRM = 0xE3 || HMAC-SHA256(k_conf, th || 'C') (33 bytes) and auto-send it. Return true.
  - Any other type byte, or a SERVER_HELLO arriving AFTER establishment → return false (not consumed; duplicate SERVER_HELLOs post-establishment are ignored by the isControl caller in practice).
- `seal(frame20) -> ByteArray?`: returns the 41-byte wire frame, or nil if not established. Input frames MUST be dropped (not queued, not sent cleartext) until established. Note: per the protocol doc, the server does not accept input until it has verified CLIENT_CONFIRM, so early input packets may be dropped server-side too — that is fine (loss-tolerant link, never retransmit).
- `open(frame) -> ByteArray?`: decrypt an s2c frame via the Receiver, nil on any failure or before establishment. NOTE: in v1 the server's s2c traffic is still CLEARTEXT, so this path is dormant — implement it for forward-compat but do not require it for a working client.
- Error handling: every failure mode is silent-drop (nil/false). There are no error frames, no NAKs, no exceptions crossing the API.

## 9. Replay window (client side)

- c2s replay protection is entirely the SERVER's job; the client sender only guarantees the strictly-monotonic never-reset counter.
- The client-side Receiver (s2c, key k_s2c, direction 2) keeps a 64-entry sliding window (s2c is low-rate): `high` (u64 high-water counter) + `mask` (u64 bitmap; bit i set ⇔ counter (high − i) already accepted). Both start at 0.
- `open(frame)` algorithm, in this exact order:
  1. size must be exactly 41; first byte must be 0x01; else drop.
  2. Read LE32 `low32`; reconstruct the full 64-bit counter around `high`:
     ```
     lo   = u64(low32)                      // zero-extended
     cand = (high & 0xFFFFFFFF_00000000) | lo
     if cand + 0x8000_0000 < high:                      cand += 0x1_0000_0000
     else if cand > high + 0x8000_0000 && cand >= 0x1_0000_0000: cand -= 0x1_0000_0000
     counter = cand
     ```
  3. `counter <= 0` → drop.
  4. Pre-auth replay check: if `counter <= high`: let `off = high − counter`; if `off >= 64` (older than window) or the mask bit `off` is set (duplicate) → drop.
  5. GCM-decrypt body (bytes 5..40 = ct||tag) with nonce = LE32(2)||LE64(counter), AAD = 0x01||LE64(counter), key k_s2c. AUTH FAILURE → drop and DO NOT touch high/mask (a forged high-counter packet must never slide the window — load-bearing anti-DoS rule).
  6. Only on auth success, advance the window: if `counter > high`: `shift = counter − high`; `mask = (shift >= 64) ? 1 : (mask << shift) | 1`; `high = counter`. Else: `mask |= 1 << (high − counter)`. Return the 20-byte plaintext.
- (Server-side, for context: window ≥ 1024 packets; same verify-before-advance rule.)

## 10. Test vectors

None are present in any of the three source files. The doc contains no byte vectors; the Kotlin cites the Python reference (`apps/pc-server/grx_crypto.py`) as unit-tested source of truth. For a Swift port, generate cross-implementation vectors against the Python reference (fixed ephemeral keys, fixed pairing string → expected th / k_c2s / k_s2c / k_conf / confirm tags / first wire frame).

## 11. Kotlin Cipher-reuse note

The Kotlin Sender caches ONE `Cipher.getInstance("AES/GCM/NoPadding")` instance and re-`init()`s it per packet purely to avoid JCE provider-lookup overhead on the hot path; this is safe only because every init gets a distinct nonce (monotonic counter). It has ZERO wire effect. In Swift, a stateless `AES.GCM.seal` call per packet is byte-identical and is the correct approach (pre-build the `SymmetricKey` once; construct nonce/AAD per packet).

## 12. Invariants checklist (client)

1. Fresh ephemeral X25519 per connection; counter starts at 1 and never resets; any state loss → full new handshake (new GrxClient).
2. Never send input before `established` (server confirm verified constant-time).
3. Full 128-bit GCM tag; version byte 0x01 everywhere; never fall back to the legacy cleartext path once paired.
4. Receiver window advances only on authenticated packets.
5. All integers little-endian; all info/label strings ASCII with no NUL terminator; HKDF is single-shot flat (salt = transcript hash), not the doc's master/expand two-stage.