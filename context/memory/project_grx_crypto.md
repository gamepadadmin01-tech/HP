---
name: project-grx-crypto
description: "GRX encrypted input layer — status, and the current shipped version state"
metadata: 
  node_type: memory
  type: project
  originSessionId: 04fa20ba-c801-4536-9b63-6783224ac0d6
  modified: 2026-08-13T18:49:36.186Z
---

**GRX (GamepadOS Realtime eXchange)** — the AEAD-encrypted phone↔PC input link. It replaced a
cleartext, replayable 32-bit `authToken`, which was a live security hole. Byte contract:
[[reference_wire_protocol]].

**Status: LIVE on the client.** `GRX_ENABLED=true` in `MainActivity.kt`. The Kotlin and Python
crypto implementations were verified byte-identical. Legacy cleartext and GRX coexist server-side
(`GRX_REQUIRED=False`), but the legacy path is hard-disabled once a device is paired.

## Version state — verify before trusting

| | Version |
|---|---|
| Live on `/api/version` (verified 2026-08-10) | **1.3.24 / code 48** |
| Committed to `website/backend/downloads/` but **never activated** | 1.3.26 |
| Source tree builds as of 2026-08-13 | **1.3.27 / code 51** |

**Activation is a separate manual step and is repeatedly forgotten.** Committing an APK to
`downloads/` does nothing on its own — the admin portal's 📦 Releases → *Register & Activate*
(needs `RELEASE_KEY`) is what flips `/api/version` and starts offering the update. The same
omission exists on the PC server: see [[project_rust_server_v2]], where 2.0.1 is built and pushed
but 2.0.0 is still live.

**Do not assert what changed in any build between 1.3.15 and 1.3.27** — only the version numbers
were ever verified, not the feature content. Read the code or the handoffs first.

## Durable engineering lessons from this work

These are the things worth carrying forward; the blow-by-blow build history is archived at
`context/archive/memory-history/project_grx_crypto_FULL_2026-08-14.md` (59 KB) if you ever need it.

- **Seal only on actual send.** The GRX seal was originally running on every ~500 Hz idle poll and
  the result discarded. Gate it on `doSend` (`gamepad-engine.cpp`).
- **Detach JNI threads.** The native TX thread never called `DetachCurrentThread`, which aborted
  ART on disconnect once GRX established. Guard before returning from `txThreadLoop`.
- **Length-check before routing by type byte.** `is_handshake()` matched on the *first byte only*;
  legacy 20-byte frames start with a little-endian timestamp whose low byte sweeps 0–255, so ~1 in
  128 input frames were misrouted into the handshake path. An uncaught `struct.error` there killed
  the UDP loop thread — **port stayed bound, server went deaf.** Fixed with `_HS_MIN_LEN` plus a
  broad `except` around every `handle_frame`. Regression test:
  `apps/pc-server/tests/test_handshake_misroute.py`.
- **Ghost ViGEm pads.** The per-pad rumble callback captured the `PadSession`, which holds the pad
  → reference cycle → dead pads lingered as 0-input XInput controllers, squatting slot 0 and
  pushing the real phone to player 2 ("buttons don't work"). Fix: explicitly unregister the
  notification and null the refs in `PadManager._free`. See [[project_double_pad_bug]].
- **Tether auth.** When a phone tethers with mobile data, Windows default-routes through the phone,
  so `get_lan_ip()` picked the tether IP and the "token 0 only off primary LAN" rule silently
  dropped every frame. Fixed by enumerating adapters via ctypes `GetAdaptersAddresses`
  (locale-independent) plus an explicit `is_usb_tether_client()`.
- **Debug trick that worked repeatedly:** poll XInput directly with ctypes (`XInputGetState`, slots
  0–3) while pressing buttons — it instantly shows which slot is actually receiving input.

## Known open risk

The App.tsx reconstruction after the 2026-07-14 corruption spliced in a middle section from a
~1.2.x/1.3.3-era backup, so **middle components (`ControllerScreen`, `TabHome`, `TabSystem`) may
be missing features added in 1.3.1–1.3.7.** Head and tail were current. If a feature that
definitely existed appears to have vanished, suspect this first. See `context/recovery/README.md`.
