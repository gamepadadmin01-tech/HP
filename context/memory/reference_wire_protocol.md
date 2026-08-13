---
name: reference-wire-protocol
description: "The byte-for-byte phone↔PC contract: 20-byte input frame, button bitmap, GRX 41-byte encrypted frame"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 04fa20ba-c801-4536-9b63-6783224ac0d6
  modified: 2026-08-13T18:49:59.869Z
---

The single most load-bearing contract in GamepadOS. **Both sides must agree exactly** — it is a
`#pragma pack(1)` struct in C++ and a `struct.unpack` format in Python. Distilled from
`apps/docs/ARCHITECTURE.md` and `apps/docs/GRX_PROTOCOL.md` so those don't need re-reading.

## The end-to-end path

```
touch/gyro → React UI (App.tsx) → 20-byte ArrayBuffer via JSI
  → gamepad-engine.cpp (C++ NDK, SCHED_FIFO real-time thread) → UDP over LAN
  → server.py (Windows) → ViGEmBus → virtual DualShock 4 → the game
```

## The 20-byte input frame — `<Q H B B B B B B I`

| Offset | Size | Type | Field | Notes |
|---|---|---|---|---|
| 0 | 8 | uint64 LE | timestamp | ms since epoch; stale/out-of-order packets are dropped |
| 8 | 2 | uint16 LE | buttons | bitmask, see below |
| 10 | 1 | uint8 | leftTrigger | 0 released → 255 full |
| 11 | 1 | uint8 | rightTrigger | 0 released → 255 full |
| 12–15 | 4 | uint8 ×4 | LX, LY, RX, RY | 0 = left/up, 127 = center, 255 = right/down |
| 16 | 4 | uint32 LE | authToken | **vestigial under GRX — send 0.** GCM authenticates now |

`static_assert(sizeof(GamepadPayload) == 20)` in `gamepad-engine.cpp` is the compile-time guard.

### Button bits (`BTN_MAP` in App.tsx)

```
0 A/Cross   1 B/Circle   2 X/Square   3 Y/Triangle   4 LB/L1   5 RB/R1
6 Options   7 Share/Back  8 L3        9 R3          10 DUp    11 DDown
12 DLeft   13 DRight     14 Guide
```

Bit 14 (Guide) **is** forwarded on all transports — an earlier "no guide" note was a misread of
the user. It is gated by `sess.allow_guide`, default True.

## GRX encrypted frame — 41 bytes

```
| version (1) | counter_low32 (4, LE) | ciphertext (20) | tag (16) |
```

- **AES-128-GCM.** Plaintext is the 20-byte frame above.
- **Pairing:** the QR carries `long_term_id` + a 32-byte `psk`. The PSK binds the ECDH and is what
  kills MITM.
- **Handshake:** 1-RTT, fresh ephemeral X25519 keypair **per connection** (this is what makes
  starting the counter at 0 safe). `master = HKDF-SHA256(shared || psk, salt=transcript_hash)`,
  then separate c2s / s2c / confirm keys. Both sides' HMAC confirms must verify before any input
  packet is accepted.
- **Nonce** = `LE32(direction) || LE64(counter)`; direction 1 = c2s, 2 = s2c. **Counter is
  strictly monotonic and NEVER resets** — any state loss means a new handshake, never a reset.
- **AAD** = `LE8(version) || LE64(counter)` (anti-downgrade). Full 128-bit tag, never truncated.
- Only the low 32 bits of the counter go on the wire; the receiver reconstructs the high bits.

### Replay handling — the order is load-bearing

1. reconstruct the 64-bit counter
2. early-reject if seen or outside the window
3. **verify the GCM tag — on failure DROP and do NOT touch the window**
4. only on success, advance the high-water mark

Step 3 matters: if a forged high-counter packet slid the window, it would cause an input blackout.
Window ≥ 1024 packets (~1–2 s at 500–1000 Hz).

**Cardinal rule: never reuse a (key, nonce) pair.** Fresh key per connection plus a never-reset
counter is what guarantees it.

## Why it is built this way

- **UDP, not TCP** — TCP head-of-line blocking would delay input. A dropped sample is better than
  a late one; the server only processes the newest packet anyway and drains the rest.
- **C++ NDK, not Kotlin** — GC pauses cause packet jitter. The native thread bypasses that.
- **Pixel coordinates, not percentages** — the landscape canvas is a fixed 1263×540 virtual space,
  so rendering is deterministic across screen sizes.
- **Circular deadzone** (8%) — a square one causes diagonal drift.
- **Hair-trigger rescaling** (15% default) — partial trigger pulls still reach full throttle.

Server safety: if no packet arrives for >500 ms, the pad resets to neutral so inputs can't stick.

Related: [[project_grx_crypto]], [[project_realtime_latency_stack]], [[reference_remote_gamepad_protocol]].
