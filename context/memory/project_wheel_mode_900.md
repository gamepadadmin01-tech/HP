---
name: project-wheel-mode-900
description: "Customer-requested 900°/720° wheel mode — rotate a mounted phone, not tilt it; designed 2026-08-25, build after 1.4.0 ships"
metadata: 
  node_type: memory
  type: project
  originSessionId: 57807460-0b48-4fba-a043-7e382c522c35
  modified: 2026-08-25T09:08:14.334Z
---

**Support ticket `#1959ade3` (2026-08-24):** *"make 900 and 720 degree gyro for truck or bus sims."*
900°/720° are real truck/bus wheel lock-to-lock ranges. **Committed to the customer**; ticket still
In Progress (tell the reporter when it is live).

## ✅ BUILT 2026-08-26 — not yet device-tested

Implementation record + the trap list: `docs/research/WHEEL_MODE_900_DEGREE.md`.
Unwrap lives in `MainActivity.unwrapRoll`, BEFORE the 1€ filter, at the one point BOTH
input paths read (`fusedRollDeg`) — so the JS and native paths cannot diverge.

- **A capped turn count is a BUG, do not re-add one.** The first draft clamped at ±3
  turns and silently recreated the same 360° jump the unwrap exists to remove; over-
  rotate and come back and the wheel centre was a full turn out. `tools/wheel-unwrap.test.js`
  test 5 guards this, and now runs in `regression-check.sh` Tier 1 (12 assertions).
- Range presets 360/540/720/900, default OFF, persisted as `gyro_wheel`/`gyro_wheel_range`.
- Orientation is PINNED while the mode is on, and `setScreenOrientation` defers to it.
- **Release trap:** the tree has wheel mode but is still versionCode 55 / 1.4.1 — the same
  version as the staged AAB, which does NOT contain it. Upload the staged 1.4.1 file as-is;
  bump to 1.4.2 / 56 before building the wheel-mode release.
- Still open: throttle/brake when the phone IS the wheel (unmade product call), and
  tuning the feel in ETS2 on real hardware.

Full design: `projects/gamepados/docs/research/WHEEL_MODE_900_DEGREE.md`.

## The trap — do not just raise the slider cap

`maxAngle` at `App.tsx:3379` is capped `max="90"`, and **that attribute is the only cap in the whole
system** (`prefs.ts` stores it unclamped; `NativeInputEngine.kt:228` only floors at 1°). So `90` →
`900` is a one-character edit — **and it ships a broken feature.** `maxAngle` means "tilt this far to
reach full lock"; at 900 a hand-held phone (~60° of wrist travel) reaches ~7% of full lock. The truck
barely turns, a bus can never park.

## The right design — physically rotate a mounted phone

Phone in a wheel mount, rotated through the real 2.5 turns. **The sensor half already exists:**
`MainActivity.kt:1812` computes `atan2(ux, uy)` = where gravity points *within the screen plane* =
the wheel angle. Gravity-derived so **drift-free and absolute**, unlike an integrated gyro yaw.

⚠️ **`App.tsx:788`'s comment "RAW tilt ANGLE in degrees (native, +/-90)" is STALE AND WRONG** — it is
`atan2`, already ±180°. Do not design against that comment.

## The four real jobs

1. **Unwrap the ±180° wrap** into ±450°. ~10 lines, easy — but the one place a bug is *dangerous*:
   it fails as a violent full-lock jerk mid-corner, not a visible error. (200 Hz sampling cannot
   alias — you'd need >100 rev/sec.)
2. **Lock screen orientation — load-bearing, not cosmetic.** `MainActivity.kt:1798` picks the sensor
   axis remap *from the current display rotation*, and the activity is `SENSOR_LANDSCAPE`
   (`MainActivity.kt:826`), so rotating the phone flips the steering frame underneath the driver.
3. **Unwrap BEFORE `rollFilter.filter()`** (`MainActivity.kt:1815`) — smoothing across the
   discontinuity produces a garbage spike.
4. **Do both paths.** JS `pumpGyro` and the native Kotlin path compute steering independently —
   same split that caused `26d5368` (sign-in wall enforced in JS, not in native touch).

## Open, not yet decided

- **The phone is the wheel, so its screen is unreachable** → throttle/brake cannot be on-screen
  buttons. Needs gyro-throttle or a second device. **Product call, unmade.**
- Flat-mounted phone hits gimbal lock (`atan2(ux,uy)` undefined screen-up) — mount must be tilted.
- Idle detection is **safe as-is**: `gyroRestingFlat` needs `abs(uz) >= flatUz`, which a vertical
  phone never satisfies. No change needed.

Difficulty overall: **medium, not hard** — the maths is easy, the risk is all in the discontinuities.
The genuine work is tuning the feel in ETS2 on real hardware.
