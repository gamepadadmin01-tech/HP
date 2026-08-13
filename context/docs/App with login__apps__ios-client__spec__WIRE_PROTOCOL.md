# GamepadOS UDP Client Protocol — Byte-Exact Specification (for Swift reimplementation)

Source of truth: `F:\hlooo\apps\android-client\app\src\main\cpp\gamepad-engine.cpp` (client engine), cross-checked against `F:\hlooo\apps\pc-server\server.py` (server decode) and `F:\hlooo\apps\controller-ui\src\app\App.tsx` (JS packet builder). AOA/USB-accessory paths are EXCLUDED (noted only where the same logic is shared). All multi-byte fields are LITTLE-ENDIAN everywhere.

---

## 1. The 20-byte input frame (cleartext wire format)

Packed struct, no padding, exactly 20 bytes (`static_assert(sizeof(GamepadPayload) == 20)`). Server decodes with Python `struct` format `'<Q H B B B B B B I'`.

| Offset | Size | Type | Field | Semantics |
|---|---|---|---|---|
| 0 | 8 | uint64 LE | `timestamp` | Client monotonic clock in NANOSECONDS at send time (`CLOCK_MONOTONIC`: `tv_sec*1_000_000_000 + tv_nsec`). Stamped by the TX thread on EVERY send (overwrites whatever the app layer wrote). Server echoes it verbatim in the ACK and uses it for stale/reorder rejection — it MUST be monotonically increasing (use `mach_absolute_time`-derived ns or `clock_gettime(CLOCK_MONOTONIC)` on iOS, never wall clock). |
| 8 | 2 | uint16 LE | `buttons` | Bitmask (see below). |
| 10 | 1 | uint8 | `leftTrigger` | 0–255 (0 = released, 255 = full pull). |
| 11 | 1 | uint8 | `rightTrigger` | 0–255. |
| 12 | 1 | uint8 | `leftStickX` | 0–255, neutral = 128. Encode: `clamp(round(128 + norm*127), 0, 255)` where norm ∈ [-1, +1]. Server decodes `(b-128)/127`. |
| 13 | 1 | uint8 | `leftStickY` | same encoding. |
| 14 | 1 | uint8 | `rightStickX` | same encoding. |
| 15 | 1 | uint8 | `rightStickY` | same encoding. |
| 16 | 4 | uint32 LE | `authToken` | The pairing-key hash (`expectedHash`, section 2). Stamped by the TX thread on EVERY send. |

### Button bitmask (uint16 at offset 8, bit N = `1 << N`)

| Bit | Button | Server maps to (ViGEm XUSB) |
|---|---|---|
| 0 | A | `XUSB_GAMEPAD_A` |
| 1 | B | `XUSB_GAMEPAD_B` |
| 2 | X | `XUSB_GAMEPAD_X` |
| 3 | Y | `XUSB_GAMEPAD_Y` |
| 4 | LB | `XUSB_GAMEPAD_LEFT_SHOULDER` |
| 5 | RB | `XUSB_GAMEPAD_RIGHT_SHOULDER` |
| 6 | menu (Start) | `XUSB_GAMEPAD_START` |
| 7 | view (Back) | `XUSB_GAMEPAD_BACK` |
| 8 | L3 (left stick click) | `XUSB_GAMEPAD_LEFT_THUMB` |
| 9 | R3 (right stick click) | `XUSB_GAMEPAD_RIGHT_THUMB` |
| 10 | D-pad Up | `XUSB_GAMEPAD_DPAD_UP` |
| 11 | D-pad Down | `XUSB_GAMEPAD_DPAD_DOWN` |
| 12 | D-pad Left | `XUSB_GAMEPAD_DPAD_LEFT` |
| 13 | D-pad Right | `XUSB_GAMEPAD_DPAD_RIGHT` |
| 14 | home / Guide (🎮) | `XUSB_GAMEPAD_GUIDE` (server-gated by a per-session `allow_guide` flag) |
| 15 | unused | — |

D-pad is 4 independent bits, NOT a hat/POV encoding. Triggers use the app-layer "hair trigger" rescale before packing (`activeThreshold = max(0.05, (100-15)/100)`; `byte = clamp(round(min(1, fill/activeThreshold) * 255), 0, 255)`) — this is app policy, not wire protocol, but reproduces identical feel.

---

## 2. Auth token derivation

- The pairing key is an **8-character lowercase hex string** (server: `secrets.token_hex(4)`, persisted in `%LOCALAPPDATA%\GamepadServer\pairing_key.txt`).
- It reaches the phone in the pairing QR code as CSV: `"{ip},{port},{key}"`.
- Client derivation (exact): `expectedHash = (uint32_t)strtoul(key, NULL, 16)` — i.e. parse the whole key string as base-16 into a 32-bit unsigned integer. Swift: `UInt32(keyString, radix: 16)!`.
- Server side: `expected_hash = int(key, 16)`; a cleartext frame is accepted iff `auth_token == expected_hash` (token `0` is accepted only for off-LAN/USB-tether clients — irrelevant for Wi-Fi iOS). There is no hashing/salting — the token IS the key value.
- The TX thread writes `expectedHash` into offset 16 of every outgoing frame; the app layer's value there is ignored.

---

## 3. TX thread loop (event-driven send)

One dedicated real-time-ish thread. Best-effort priority: try `SCHED_FIFO` at `sched_get_priority_min(SCHED_FIFO)+1`; on failure fall back to niceness `-19`; never fatal. NO CPU-core pinning (deliberately removed for thermals — do not add). Swift equivalent: a `Thread` with `.userInteractive` QoS or a real-time thread policy; best-effort.

Loop body (repeat while running):
1. Under a mutex: snapshot the latest injected payload, clear the `payloadDirty` flag.
2. `curInput` = the **8 contiguous bytes at offsets 8..15** (buttons + triggers + 4 stick bytes). `changed = (curInput != lastSentInput)`. `lastSentInput` is initialized to `0xFF x 8` so the very first iteration always counts as changed → an immediate first (neutral) packet goes out on engine start, which is what elicits the server's first ACK for discovery lock-on.
3. `rawTimestamp` = CLOCK_MONOTONIC in ns.
4. Keep-alive decision: `heartbeatNs = 16_000_000` (62.5 Hz) if rumble is active (`rumbleLeft != 0 || rumbleRight != 0` — the last motor values the PC sent), else `33_000_000` (~30.3 Hz). `heartbeat = (rawTimestamp - lastSendNs) >= heartbeatNs`. Rationale: the PC only emits fresh RMB in reply to inbound frames, so 60 Hz uplink during rumble halves rumble-update latency; reverts to 30 Hz when both motors are 0.
5. Redundancy: `CHANGED_PACKET_REDUNDANCY = 3`. A changed input is sent 3 times total on consecutive poll iterations (~2 ms apart). `redundant = (redundancyRemaining > 0)`.
6. `doSend = changed || heartbeat || redundant`.
7. Stamp `timestamp = rawTimestamp` (LE) and `authToken = expectedHash` (LE) into the frame.
8. GRX seal (section 7) — only when `doSend && grxReady`.
9. Send non-blocking (`MSG_DONTWAIT`): `send()` if the socket is `connect()`ed, else `sendto(serverAddr)`. On success: `packetCount++`, `lastSentInput = curInput`, `lastSendNs = rawTimestamp`; if `changed` → `redundancyRemaining = CHANGED_PACKET_REDUNDANCY - 1` (= 2; this send was the 1st), else if `redundancyRemaining > 0` → decrement. Keep-alive heartbeats are NOT duplicated and do not touch the counter.
10. On send error with `errno` in {ENETUNREACH, ENETDOWN, EADDRNOTAVAIL, EBADF}: close socket, mark unconnected → the recovery block recreates it with exponential backoff: start 50 ms, double each failure, cap 1000 ms (`backoff = min(backoff*2, 1000)`), reapplying non-blocking + SO_BROADCAST + TOS each time, and resetting to the sendto/broadcast-discovery state.
11. RX drain (sections 5–6) runs EVERY iteration, regardless of `doSend`.
12. Wait: block on a condition variable with timeout `RX_POLL_NS = 2_000_000` ns (2 ms). New input (inject call) signals the CV so a fresh touch is sent within microseconds; the 2 ms timeout only keeps RX draining, redundancy resends (~2 ms apart), and the keep-alive firing while input is steady. The wait predicate re-checks `payloadDirty || !isRunning` to survive lost wakeups.

Timing summary: input changes transmit immediately (CV wake); each change is repeated 3x at ~2 ms spacing; idle keep-alive ≈ 30 Hz (33 ms period); during rumble ≈ 60 Hz (16 ms period); RX polled every ≤ 2 ms.

---

## 4. Socket setup

- `socket(AF_INET, SOCK_DGRAM, 0)`, set `O_NONBLOCK`. No SO_SNDBUF/SO_RCVBUF changes, no SO_*TIMEO — everything is non-blocking with `MSG_DONTWAIT`.
- `setsockopt(SOL_SOCKET, SO_BROADCAST, 1)` — the initial destination may be a broadcast address.
- `applyLowLatencyTos`: `setsockopt(IPPROTO_IP, IP_TOS, 0xB8)` — DSCP EF (46) << 2, ECN 0 — plus (Linux-only) `setsockopt(SOL_SOCKET, SO_PRIORITY, 6)` (TC_PRIO_INTERACTIVE → WMM AC_VO). iOS equivalent: `IP_TOS = 0xB8` still works; also/instead set `SO_NET_SERVICE_TYPE = NET_SERVICE_TYPE_VO` (or `serviceClass = .voice` on Network.framework). Both are best-effort; failures are ignored.
- Destination: `serverAddr = {AF_INET, htons(port), inet_pton(ip)}` — ip and port come from the pairing QR. Server binds UDP starting at port **7777**, retrying up to 10 consecutive ports (7777–7786), so ALWAYS use the QR's port, never hardcode.
- **connect() lock-on (FIX 2):** start UNconnected and use `sendto()` (destination may be broadcast — `connect()` to a broadcast addr is wrong). After the first valid ACK: if the current destination IP is a broadcast address (`== INADDR_BROADCAST` or its **last octet == 0xFF**), replace `serverAddr.sin_addr` with the ACK's source address (unicast lock-on). Then, if the (now) destination is not broadcast and the socket isn't connected to that peer yet, `connect()` the UDP socket to it and use `send()` thereafter (kernel caches the route). Re-`connect()` if the locked peer IP ever changes; if `connect()` fails, keep using `sendto()` (non-fatal). A recreated socket always starts unconnected again.
- Engine start resets: `packetCount = 0`, `lastAckMonoNs = 0`, `latencyMs = 0`, `rumbleLeft = rumbleRight = 0` (rumbleSeq is NOT reset — it stays monotonic across reconnects).

---

## 5. ACK frame (server → client) and latency

Wire format: ASCII `"ACK"` (`0x41 0x43 0x4B`) followed by the **8-byte little-endian uint64 timestamp echoed verbatim** from the input frame the server just processed → normally 11 bytes total. Server sends one ACK per accepted frame, to the frame's source address. Stale/reordered frames are NOT ACK'd by the server.

Client RX drain (every ≤2 ms poll): loop `recvfrom(sock, rxBuffer, 127, MSG_DONTWAIT)` (buffer is `char rxBuffer[128]`, recv length `sizeof-1` = 127) until it returns ≤ 0. Per datagram, in this exact order:
1. If first byte is `0xE1`, `0xE2`, or `0xE3` → GRX control frame, hand the whole datagram to the GRX layer, `continue`.
2. If `len >= 5` and bytes 0–2 == `"RMB"` → rumble (section 6), `continue`.
3. If `len < 3` or bytes 0–2 != `"ACK"` → ignore (e.g. own loopback), `continue`.
4. Source guard: if the current destination is NOT broadcast and the datagram's source IP != destination IP → ignore (prevents LAN hosts spoofing liveness/RTT). During broadcast discovery any source is accepted. (The same guard applies to RMB in step 2.)
5. `lastAckMonoNs = now` (monotonic ns) — this is the ONLY "PC is alive" signal; UDP send success means nothing.
6. If `len >= 11`: read uint64 LE `echoed` from bytes 3..10. If `echoed != 0 && now > echoed`: `rttMs = (now - echoed) / 1e6`; if `0 <= rttMs < 1000` (sanity clamp): smoothed EMA — first sample taken raw, then `latency = prev*0.8 + rtt*0.2`.
7. Broadcast → unicast lock-on + `connect()` as described in section 4.
8. `break` out of the drain loop after handling an ACK (RMB/GRX frames keep draining; an ACK ends the drain for this tick).

`msSinceLastAck` (polled by UI): returns `-1` if no ACK ever received, else `(monotonicNowNs - lastAckMonoNs) / 1_000_000` (clamped to ≥ 0). The UI shows CONNECTED only while this is small. `latencyMs` getter returns the smoothed float (0 until first RTT).

---

## 6. RMB rumble frame (server → client)

Wire format, exactly 5 bytes (client requires `len >= 5`):

| Offset | Value |
|---|---|
| 0–2 | ASCII `"RMB"` (`0x52 0x4D 0x42`) |
| 3 | large / low-frequency motor ("left"), 0–255 |
| 4 | small / high-frequency motor ("right"), 0–255 |

Accepted only from the locked unicast peer (same source guard as ACK). Client stores `rumbleLeft = byte3`, `rumbleRight = byte4`, and increments `rumbleSeq` on EVERY RMB datagram (even identical values). Nonzero motors switch the keep-alive to 60 Hz (section 3). The server sends RMB repeatedly while motors are nonzero plus one final zero frame to stop.

App-layer polling (`getNativeRumble`) packs a 64-bit value: `(seq << 16) | (left << 8) | right` — bits ≥16 = sequence, bits 8–15 = left/large, bits 0–7 = right/small. The app fires the vibrator only when `seq` changes and applies user on/off + intensity itself. Swift: expose the same triple (a callback per RMB is fine; replicate seq-change semantics if polling).

---

## 7. GRX (encrypted input) integration points

- `grxReady` is a flag flipped by the app layer after the GRX handshake completes (`nativeSetGrxReady`). While false, the path is byte-identical legacy cleartext 20-byte frames.
- **Seal gating:** only when `doSend && grxReady` (and the seal callback exists) does the TX thread pass the fully-stamped 20-byte frame to the app-layer `grxSeal(bytes20) -> wireBytes` and transmit the sealed output INSTEAD. The sealed wire frame is **41 bytes** in the current protocol; the engine accepts any seal output of 1..64 bytes (`uint8_t grxBuf[64]` cap). If sealing fails/returns nothing/oversize, it silently falls back to sending the raw 20 bytes. Do NOT seal on ticks that don't send (that was a fixed perf bug — sealing is AES-GCM + allocations).
- **Raw handshake TX** (`nativeGrxSendRaw`): arbitrary GRX handshake byte arrays are sent on the SAME UDP socket, mirroring the hot path — `send()` if `connect()`ed, else `sendto(serverAddr)` (so the handshake works during broadcast discovery too).
- **RX routing:** any received datagram whose FIRST byte is `0xE1`, `0xE2`, or `0xE3` is handed whole to the GRX control handler (`onGrxControl`) and never treated as ACK/RMB. `0xE2` is SERVER_HELLO = 65 bytes (`0xE2` + 32B pubkey + 32B confirm) — hence rxBuffer sized 128 (>= 65). These type bytes never collide with legacy traffic (`'A'`=0x41, `'R'`=0x52).
- PSK bootstrap (server reference): 32-byte PSK = HKDF-SHA256(ikm = pairing key hex-decoded to 4 bytes if valid hex, else UTF-8 bytes; salt = empty; info = `"grx psk v1"`), domain id `"gamepados-grx-v1"`. GRX-decrypted frames skip the authToken check server-side (GCM is the auth). The 41-byte frame's internal layout (nonce/tag/etc.) lives in the Kotlin GRX module + `F:\hlooo\apps\docs\GRX_*.md`, not in this engine — from the engine's perspective seal is an opaque 20B→41B transform.

---

## 8. injectNativePayload semantics (app layer → engine)

- The app layer (JS) builds the EXACT same 20-byte layout described in section 1 into a single reused ArrayBuffer — **same buffer format, no repacking**. The engine validates `length == 20` (silently drops anything else) and memcpy's all 20 bytes into `currentPayload` under the payload mutex, sets `payloadDirty = true`, then signals the CV (after releasing the lock).
- However, two fields the app writes are PLACEHOLDERS on this path: the JS writes `Date.now()` at offset 0 and `0` at offset 16, and the TX thread **overwrites offsets 0–7 (monotonic-ns timestamp) and 16–19 (expectedHash) on every send**. Only offsets 8–15 from the injected buffer actually reach the wire.
- Storage is latest-wins: a single `currentPayload` slot, no queue. Multiple injections between TX iterations coalesce to the newest. The TX thread snapshots it and clears the dirty flag; the change-detector (section 3) decides whether it actually hits the wire.

---

## 9. Everything else a reimplementation must replicate

- **Neutral seed:** at engine init, before the TX thread starts, set `leftStickX/leftStickY/rightStickX/rightStickY = 128` in the payload slot (buttons/triggers/rest are 0 — the global struct is zero-initialized). Combined with the `0xFF`-seeded `lastSentInput`, the first TX iteration sends this neutral frame immediately — that first packet is what triggers server pad-acquisition and the discovery ACK.
- **Re-init guard:** starting the engine while already running is a no-op (log + ignore); caller must stop first.
- **Stop behavior:** clear the running flag, wake the CV (`notify_all`), join the TX thread, close the socket, clear connected-peer state. **Deliberately send NO "BYE"/teardown packet** — an unauthenticated teardown lets any LAN host spoof-kill the session; the server's idle watchdog retires the pad within ~3 s. Do not add one.
- **ACK is the only liveness signal.** UDP sends succeed locally with nobody listening; never infer "connected" from send success or packet count.
- Server dedups identical input reports (compares the 8-tuple) and drops stale/reordered frames by timestamp, so the 3x redundancy duplicates are harmless no-ops — but a NON-monotonic timestamp source will get frames dropped and un-ACK'd.
- Loopback/self traffic and any unrecognized datagrams in the RX queue are silently skipped.
- `packetCount` (successful sends) and the latency/msSinceLastAck getters are the only telemetry the UI needs.
- The crash-signal handler, JNI attach/`DetachCurrentThread` dance, and screen-surface functions are Android/JNI plumbing — irrelevant for Swift.
- AOA/USB-accessory transport (excluded here) reuses the SAME TX loop, change/keep-alive/redundancy logic, and the SAME "ACK"+ts / "RMB" parsing over a file descriptor — it just skips addressing, source guards, GRX sealing (AOA stays raw 20B), and auth (`expectedHash = 0` there). Nothing from it is needed on iOS.