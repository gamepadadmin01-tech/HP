---
name: feedback_gyro_idle_gate
description: "USER-MANDATED gyro idle gate — gyro suppresses after 1s of no TOUCH, wakes on any button/touch (never gyro itself)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 48166bf1-41e4-4e7d-8603-dbf2bd064555
  modified: 2026-07-22T05:45:35.884Z
---

USER-MANDATED (2026-07-22), the accepted fix for "phone set down forces PC volume to 100%": gyro contributes to the pad **only while the user is physically touching a control**. After **1 second** of no touch, gyro output is suppressed (pad rests); **any** button/stick/trigger/finger-down wakes it on the next frame. **Gyro motion itself must NEVER count as activity** — that is the whole point: a phone lying flat with a pegged (gimbal-lock) tilt cannot keep its own deflection alive.

**Why:** root-caused via 4-agent audit. The Rust server is PROVEN unable to fabricate input (only ever writes received bytes or all-zeros) — so this was never a server bug, and it happened on Python too (handoff §6 / B10, 2026-07-20: phone flat + gyro ON + controller screen → LS pegged ~92% → Xbox Game Bar volume widget walked up). It is common to EVERY server because the server only relays. Chain: H button (bit 14, easy to fumble top-center) opens Game Bar + gyro-pegged stick walks its volume slider. Measured: a pegged stick alone moves volume 0% UNLESS Game Bar overlay is open.

**How to apply:** implemented in BOTH gyro merge paths, identical logic (`touchActiveNow` derived only from held buttons / pressed triggers / displaced sticks / finger-down — never gyro):
- Native (live path when gp_native_input ON): `NativeInputEngine.kt` buildAndInjectLocked — fields `lastTouchMs`/`gyroIdleMs=1000`, gate `if (gyroOn && !gyroIdle)`.
- JS fallback: `App.tsx` sendTelemetry — ref `lastTouchMs`, `gyroIdle`, gates both the haptic tick and the `if (gyroOn && !gyroIdle)` merge.
This RESPECTS the earlier rejection of orientation-based neutralizing ([[feedback_gyro_indicator_design]] context): it targets ACTIVITY/PRESENCE, never orientation — full range preserved at every angle while holding the phone.

**Known trade-off (accepted by user):** pure gyro-only steering with zero touch for >1s will idle. In practice throttle/buttons are near-constant during play so it never idles mid-game; it only idles when the phone is genuinely set down.

**Status:** built into APK (direct release, 1.3.23/code 47 line) 2026-07-22, compiles clean. NOT yet device-verified — phone dropped USB before install. Also separately: distinct from the leaving-the-screen streaming gate ([[project_grx_crypto]] B0 fix) — that stops ALL input off the controller screen; THIS gates gyro WHILE on the controller screen.