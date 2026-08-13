# GRX integration — wiring the verified crypto into the live apps

The crypto cores are DONE and verified:
- `apps/pc-server/grx_crypto.py` — AEAD + replay (6/6 self-tests pass)
- `apps/pc-server/grx_session.py` — handshake + framing (full client↔server self-test passes)
- `apps/android-client/.../GrxCrypto.kt` — mirrors the above byte-for-byte (needs build-verify)
- `apps/docs/GRX_PROTOCOL.md` — the byte contract

What remains is **wiring + device testing**. Do it behind a version flag so the
working cleartext app keeps running during migration. Keep `releases-archive/`
as the rollback point.

## PC side (`server.py`) — additive, low-risk
Per client source (UDP addr / WS conn / AOA link), hold a `GrxServerSession`:

```python
import grx_session, grx_crypto
sessions = {}   # key: client addr/conn id -> GrxServerSession

# in the recv loop, BEFORE struct.unpack(PAYLOAD_FORMAT, ...):
if grx_session.is_handshake(frame):
    s = sessions.get(addr) or grx_session.GrxServerSession(psk_for(addr), ltid_for(addr))
    sessions[addr] = s
    if frame[0] == grx_session.T_HELLO:   reply = s.handle_hello(frame); send(addr, reply)
    elif frame[0] == grx_session.T_CONFIRM: s.handle_confirm(frame)
    continue
s = sessions.get(addr)
if s and s.established:
    pt = s.open(frame)          # decrypt + replay
    if pt is None: continue     # drop forged/old/dup
    ts, buttons, lt, rt, lx, ly, rx, ry, _ = struct.unpack(PAYLOAD_FORMAT, pt)
elif GRX_REQUIRED:
    continue                    # post-migration: reject all cleartext
else:
    # legacy cleartext path (current code) — REMOVE once Android ships GRX
    ts, ... = struct.unpack(PAYLOAD_FORMAT, frame)
```
- `psk_for/ltid_for`: from the existing pairing record (store the 32-byte PSK +
  long_term_id in the QR + the server's pairing DB).
- Wrap `try/except grx_session.HandshakeError` → drop + optionally re-pair.
- Flip `GRX_REQUIRED=True` and delete the legacy branch ONLY after the Android
  build is in the field (hard-disables the cleartext downgrade hole).

## Android side
1. **Gradle**: `implementation("com.google.crypto.tink:tink-android:1.13.0")` ✅ added (confirm version on build).
2. **Pairing — NO QR change needed.** GRX bootstraps on the existing pairing `key`
   (the 3rd CSV field in the QR: `ip,port,key`). Both ends derive the PSK identically
   (matches `server.py:_grx_psk_from_key`):
   ```
   psk        = HKDF-SHA256(ikm = hexBytes(key), salt = "", info = "grx psk v1", 32)
   longTermId = "gamepados-grx-v1"   (ASCII, fixed; == server GRX_LTID)
   ```
   `hexBytes(key)` = the key parsed as hex (server does `bytes.fromhex(key)`); if the
   key isn't valid hex, fall back to UTF-8 bytes (server does the same). Then
   `ClientSession(psk, longTermId.toByteArray())`.
3. **Handshake (Kotlin)** — use `GrxClient` (already written, wraps all the state):
   ```kotlin
   val client = GrxClient(GrxCrypto.pskFromPairingKey(pairingKey), GrxCrypto.GRX_LTID) { send(it) }
   client.start()                                   // on connect -> CLIENT_HELLO
   // for each inbound datagram from the server:
   if (GrxClient.isControl(pkt)) { client.onServerMessage(pkt); return }   // handshake reply
   ```
   `GrxClient` auto-sends CLIENT_CONFIRM and flips `client.established`. Gate input on it.
4. **Per-packet seal — architecture decision (pick one):**
   - **(A) Kotlin seals, recommended for first cut:** the C++ engine hands the 20-byte
     frame up via the existing JNI bridge; Kotlin `session.seal(frame)` → send the 41 B
     wire frame. One JNI up-call per packet (~µs, fine at ms-class). Simplest, reuses
     the tested Kotlin crypto, no native crypto lib. *Downside:* moves the socket write
     off the C++ event thread.
   - **(B) C++ seals:** pass the derived `c2s` key + counter down to the engine and do
     AES-GCM in C++ (needs a bundled lib — BoringSSL/libsodium). Keeps the hot path
     native. *Downside:* native crypto dependency + must re-mirror the byte layout in C++.
   Start with (A); move to (B) only if profiling on-device shows the JNI hop matters.

## Device-test checklist (the part that CANNOT be skipped)
- [ ] Tink/Kotlin compiles; APK builds + installs (same release.keystore).
- [ ] Handshake completes over each transport (USB-tether, WiFi, AOA when built).
- [ ] Encrypted input drives the pad; pairing still works.
- [ ] Confirm a wrong-PSK / tampered peer is rejected (no input).
- [ ] Measure RTT via the echoed timestamp; confirm no latency regression vs cleartext.
- [ ] Then set `GRX_REQUIRED=True`, remove the legacy cleartext branch, bump versions.

## Other Track-1 quick wins (independent, ship anytime)
- Fix the 2 ms send quantizer (`RX_POLL_NS`, gamepad-engine.cpp) → event-driven TX.
- Server-side velocity extrapolation, gated to WiFi/WS only.
- Phone `setSustainedPerformanceMode(true)` + gyro on a dedicated HandlerThread.
- Disable USB selective suspend on the PC.
