# Preserved known-good builds (rollback point before GRX crypto / big update)
Archived: pre-GRX, 2026-06

## Android 1.1.9 (code 11) — ZXing build, QR pairing verified working on device
1e58e50a9a0d81437695a27ca0d2e6ca42d722130227881e33f402c809301770 *releases-archive/v1.1.9-android/GamepadOS-1.1.9.apk

## PC 1.1.5 — in-app updater build
2c3cacf2473da8011e35eb067e331b2eb1ecbd00cc91eb6dfc9e25cf872ed523 *releases-archive/v1.1.5-pc/GamepadServer-Setup-1.1.5.exe

---

# Snapshot 2026-07-04 — "latest" rollback point (all fixes below folded in)
Preserved so we can revert to this exact build later. Both binaries are re-deployable
as-is; `src/` holds the defining source files for a code-level revert.

## Android 1.2.9 (versionCode 21) — release-signed (cert 5b5537c6…)
62803EC44355B19BF216E6423B14CE0B773677ED4EAE583C83E47FBEF9F84028 *releases-archive/v1.2.9-android/GamepadOS-1.2.9.apk
- Pairing: wireless-drop fix (handleManualConnect resets sticky gp_wired_pref)
- Gyro 3D: CALIBRATE moved beside GYRO toggle (no overlap)
- Racing gyro bar: removed the stray borderBottom line
- LT/RT triggers: cyan theme + centered ellipse gloss (was red + square) to match other buttons

## PC 1.1.15 — all server-side pairing/multi-device fixes
CED9FFB80A3606326ED86E8426F97F16D007D4A98C8E32C9A8E0C20199097DC0 *releases-archive/v1.1.15-pc/GamepadServer-Setup-1.1.15.exe
- USB-tether auth fix (ctypes adapter enumeration + tether-aware token-0 rule)
- GRX handshake misroute that killed the UDP thread (is_handshake length guard)
- Transport-switch pad/XInput-slot migration (single-device only; player 1 stays player 1)
- Ghost-pad leak fixed (unregister FFB callback + break ref cycle → pad frees immediately)
- No ACK without a pad (5th device shows disconnected, not fake-connected)
- Xbox Guide (🎮) forwarded on ALL transports incl. tether (Game Bar reset retested clean)
- Multi-device verified: 2 same/diff-subnet, 3, 4-cap, WS+UDP mixed → all independent pads
