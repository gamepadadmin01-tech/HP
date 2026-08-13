# iOS port — contracts & decisions index

The Swift sources were authored against byte-exact contracts extracted from
the shipped Android/PC 1.3.0/1.1.16 code (multi-agent extraction, 2026-07-06).
When fixing compile errors on the Mac, treat these as normative — Swift syntax
may change, protocol constants may NOT:

- `spec/WIRE_PROTOCOL.md` — 20-byte frame layout, auth token, TX loop
  (change-detect + 3x redundancy + 30/60 Hz adaptive keep-alive), ACK/RTT,
  RMB rumble, socket options, broadcast lock-on, no-BYE teardown.
- `spec/GRX_CLIENT.md` — GRX handshake (0xE1/E2/E3), X25519 + flat HKDF
  derivations (NOT the doc's two-stage scheme), transcript hash, AES-128-GCM
  41-byte sealing, replay window. GrxSession.swift implements this 1:1.
- `spec/SENSORS_LIFECYCLE.md` — gyro math (world-up projection, degrees,
  1€ filter 2.8/0.5), QR delivery (`window.onQRScanned` + escaping order),
  lifecycle, update-status callbacks.
- `spec/JS_BRIDGE_USAGE.md` — how the React UI consumes every bridge method,
  polling rates (gyro 8 ms!), and WHY all getters must stay synchronous
  (Promise-returning getters break gyro/telemetry/rumble catastrophically).

Key port decisions:
1. **Sync getters via push-state shim** — Swift pushes gyro/telemetry/rumble
   into `window.__iosPush` at up to 120 Hz (CADisplayLink); the shim's
   getters answer synchronously from that state. Verified against the real
   bundle in a browser harness (`WebBundle/preview-test.html`): UI boots in
   native mode, zero console errors, CONNECTED badge follows pushed state.
2. **GRX in CryptoKit** — X25519/HKDF/AES-GCM/HMAC all native; counter
   pre-increment, tag-last, LE everywhere. Cross-check against the Python
   reference (`apps/pc-server/grx_crypto.py`) with fixed keys before trusting.
3. **Gyro** — CMDeviceMotion `.xArbitraryZVertical` (no magnetometer, like
   GAME_ROTATION_VECTOR); up = -gravity; same STEER_SIGN=1/PITCH_SIGN=-1
   caveat as Android: flip on device if steering reads inverted.
4. **Deliberate v1 gaps** — no AOA/USB transport, no self-update (App Store),
   Wi-Fi info placeholders, charge bypass stubbed. `startApkUpdate` is absent
   from the shim ON PURPOSE so the UI falls back to `openUrl`.

Testing order on the Mac (after README_MAC_SETUP.md):
1. Compile fixes until clean build (protocol constants untouchable).
2. GRX vectors vs Python reference.
3. Pair with GamepadServer 1.1.16 → buttons on a real game, RTT sane.
4. Gyro signs in racing + 3D modes; rumble feel; QR scan flow.
