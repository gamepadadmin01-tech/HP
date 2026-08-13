# GRX — GamepadOS Realtime eXchange (encrypted transport, v1)

Authenticated-encryption layer for the phone↔PC input link. Replaces the current
**cleartext, replayable 32-bit authToken** (a live security hole) with real AEAD.
This file is the byte-for-byte contract; the PC (`grx_crypto.py`) and Android
(`gamepad-engine.cpp` / Kotlin) implementations MUST match it exactly.

Designed + adversarially verified (crypto-breaker / latency / implementability).
Track-1 of the GRX design: pure userspace, no driver, runs over the existing
UDP / WebSocket transports. ~0.3 µs/packet (HW AES) — zero latency cost.

## Threat model
On-path attacker on the same LAN or USB host. Must guarantee: confidentiality,
integrity, replay rejection, and MITM/downgrade resistance. Loss-tolerant: a
dropped sample is superseded by the next; never retransmit.

## Pairing (one-time, out of band via the QR)
The QR establishes a long-term shared secret. It carries:
- `long_term_id` — opaque device/pair id (bytes)
- `psk` — 32-byte pre-shared key (the pairing secret)

The PSK authenticates every later handshake (binds the ECDH → kills MITM, since
an attacker without the PSK derives different keys and fails confirmation).

## Handshake (1-RTT, fresh per CONNECTION — NOT per pairing)
Fresh ephemeral X25519 keypair **each connect** (this is what makes counter-from-0
safe; reusing a key with a reset counter is a total GCM break).

```
1. exchange ephemeral public keys (32 B each), in the clear
2. transcript_hash = SHA256(
       len-prefixed: [version||cipher_id] , client_eph_pub , server_eph_pub , long_term_id )
3. shared  = X25519(my_eph_priv, their_eph_pub)            # 32 B
4. master  = HKDF-SHA256(ikm = shared || psk, salt = transcript_hash, info="grx master v1", 32)
5. k_c2s   = HKDF-Expand(master, "grx c2s v1", 16)         # client→server key (AES-128)
   k_s2c   = HKDF-Expand(master, "grx s2c v1", 16)         # server→client key
   k_conf  = HKDF-Expand(master, "grx confirm v1", 32)
6. each side sends confirm = HMAC-SHA256(k_conf, transcript_hash || role)   # role: "C"/"S"
   BOTH confirms MUST verify before ANY input packet is accepted.
```
The legacy unauthenticated path (`authToken == 0`) is **hard-disabled** once paired.

## Per-packet AEAD (AES-128-GCM)
- **Plaintext** = the existing 20-byte input frame `<Q H B B B B B B I` (the trailing
  `authToken` u32 is now vestigial → send 0; GCM provides authentication).
- **direction**: 1 = c2s (input), 2 = s2c (rumble/ack). Each direction uses its own key.
- **counter**: per-(key, direction), 64-bit, starts at 1, **strictly monotonic, NEVER resets.**
  Exhaustion or any state loss (process restart) → **new handshake**, never a reset.
- **nonce** (96-bit) = `LE32(direction) || LE64(counter)`  → unique per (key, packet).
- **AAD** = `LE8(version) || LE64(counter)`  (binds version + counter; anti-downgrade).
- **tag** = full 128 bits (no truncation — costs nothing at 20 B).

### Wire frame (41 bytes)
```
| version (1) | counter_low32 (4, LE) | ciphertext (20) | tag (16) |
```
Only the low 32 bits of the counter are sent; the receiver reconstructs the high
bits from its replay window (saves 4 B without weakening the 96-bit nonce).

## Replay / anti-DoS (strict order — this is load-bearing)
1. reconstruct full 64-bit counter from `counter_low32` + window high-water
2. early-reject if already-seen or older than the window
3. **verify GCM tag** — on failure: DROP, and **do NOT touch the window**
   (a forged high-counter packet must not slide the window → no input blackout)
4. only on auth success: mark seen / advance high-water
Window ≥ 1024 packets (~1-2 s at 500-1000 Hz) for reorder tolerance.

## Invariants (violating #1 is catastrophic)
1. **Never reuse a (key, nonce).** Fresh key per connection + never-reset counter.
2. Advance the replay window only on **authenticated** packets.
3. Anything the predictor consumes (e.g. timestamp) is inside the encrypted/authenticated frame.
4. Full 128-bit tag; never downgrade to the legacy cleartext path once paired.
