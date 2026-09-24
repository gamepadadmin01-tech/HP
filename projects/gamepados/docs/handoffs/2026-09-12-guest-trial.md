# Guest trial and gyro changes — 2026-09-12

## Behavior

Guests receive 30 minutes per installation per day, without an account. Time is
charged while the controller screen is open, including background time while it
remains open. Leaving the controller stops counting. Android SharedPreferences
retain usage across launches. The installation's saved timezone defines midnight.
The timer uses elapsed time for consumption and does not refund time on clock rollback.
App data clearing/reinstallation can reset the allowance; this is not person-level
identification or tamper-proof metering. Forward clock manipulation remains possible.

A local daily allowance is recommended over the one-time first-install timer:
both need persisted local state, and daily renewal supports the requested return
visits without collecting an identifier. A one-time wall-clock trial could expire
before the user connects a PC. Neither option prevents reinstall abuse.

Guests can browse the public plan catalogue in Account and via the controller's
remaining-time pill. Expiry stops native input and routes to plans. Choosing a
purchase opens authentication; the selected plan remains after sign-in, with a
second explicit purchase action. Prices, store restrictions, payment verification
and signed-in account entitlements use the existing billing paths.

## Gyro evidence and scope

The sensor listener already registers on resume and unregisters on pause and
destruction. No listener leak has been demonstrated. A concrete code defect exists:
roll unwrapping accumulates full turns even in ordinary tilt mode, and subtracting
the saved zero before clamping can pin the stick at full lock after rotations.
Ordinary tilt now uses the shortest angular difference in both native and WebView
paths. Wheel mode retains continuous multi-turn travel. Resets and sensor filter
updates share a lock; a display-coordinate change resets the filters. Calibration
returns one consistent native snapshot to both paths.

This fixes a reproducible mathematical failure path, not a physically confirmed
diagnosis of every reported freeze. A phone endurance test remains required.

## Motion

The local iPhone glass reference guided the quiet plan surfaces and floating glass
trial control. Reduced-motion preferences are respected by MotionConfig. Controller
entry fades instead of scaling: scaling could invalidate the geometry sampled by
Android's touch overlay before the animation finished. Outgoing controller screens
stop input and billing at the start of their exit animation.

## Review and validation

The original direct APK manifest reports 1.4.1 / 55. This test release is 1.4.2 / 56.
The Rust source is 2.1.2; its existing default unarmed ticket gate permits guest
input. No server protocol change is required for this build. Strict ticket-enabled
deployments would need a separate guest protocol design.

The document corpus was indexed/extracted (297 paths, deduplicated content,
including PDFs). Relevant billing, gyro, build, regression and glass documents
were read and compared with code. This was not a complete manual reading of every
line of the corpus before implementation, as originally requested.

Automated checks: UI typecheck/build; mocked browser plan-to-sign-in flow and guest
controller expiry/persistence; Rust cargo tests; existing wheel unwrap tests.
Native quota tests cover restart, inactive time, delayed expiry, rollback and midnight.
See the final build result for completion of the Android tests and release packaging.

On-device checks still needed: install over the existing direct app, launch as guest,
connect over Wi-Fi and USB, steer and calibrate, reopen/rotate repeatedly, background
and resume, exhaust the allowance, verify neutral input and plans, then sign in to
an existing paid account. Confirm midnight renewal and perform a longer gyro session.
Real payment, sensor behavior, latency and Android overlay touch targeting cannot be
proven by the headless browser checks. No purchase or production publishing was done.

## Final packaging result

Direct release build succeeded (4m49s). All five Android unit tests passed.
APK 1.4.2 / 56 verifies with APK Signature Scheme v2 and the same signing
certificate as the preserved 1.4.1 direct APK. Embedded UI matches the current
production bundle byte-for-byte. Guest/calibration bridge method names survive
release shrinking. Native libraries are present for arm64-v8a, armeabi-v7a and x86_64.

Artifact: releases/test-builds/GamepadOS-1.4.2-guest-trial-TEST-direct.apk
SHA-256: 405059c2f7c2360f681c8db3f3706d3fb26d544e147e56dc9398a3c4621d6e0d
Size: 2,676,997 bytes.

The live public direct catalogue returned success without an authentication token.
The browser tests used a mocked catalogue and made no payment. The existing source
also contains separate native telemetry edits; they were preserved, not reverted.
No device was connected; no install, purchase, push or production upload occurred.

## 2026-09-13 — one-time introduction

User requested that the home banner disappear after the first launch. LaunchNotice
now records guest-intro-v1 in the existing persisted notice key when first shown.
It remains on that first Home view, and is absent when Home is revisited or the app
is restarted. Existing plan access through Account and the controller remains.
Version 1.4.3 / 57 carries this change. The UI typecheck/build and existing browser
flow passed, including a reload assertion that the introduction does not reappear.

1.4.3 direct release build and signature verification passed. Packaged UI matches
the current bundle. Artifact: releases/test-builds/GamepadOS-1.4.3-guest-trial-TEST-direct.apk
