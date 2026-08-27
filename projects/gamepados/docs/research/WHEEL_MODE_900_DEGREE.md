# Wheel Mode — true multi-turn steering (900° / 720°)

**Status:** BUILT 2026-08-26, not yet device-tested · **Raised by:** support ticket `#1959ade3`, 2026-08-24
**Decision:** build after 1.4.0 ships to Play. Do NOT fold into the staged 1.4.0 AAB.

---

## Where this came from

A support ticket, verbatim:

> make 900 and 720 degree gyro for truck or bus sims thanks.

900° and 720° are the standard lock-to-lock rotation ranges of real truck and bus
steering wheels. Arcade racing wheels are 180–270°; sim wheels are 900°. The request
is for the app to support that travel.

---

## The false start — and why it is wrong

The obvious reading is "raise the sensitivity slider's cap." Today `maxAngle`
([`App.tsx:3379`](../../apps/controller-ui/src/app/App.tsx)) is capped at `max="90"`, and
**that slider attribute is the only cap in the entire system** — `prefs.ts` stores the
number unclamped, and `NativeInputEngine.kt:228` only floors it at 1° with no ceiling.
So changing `90` → `900` is a one-character edit.

**It would ship a broken feature.**

`maxAngle` means *"how far do I tilt the phone to reach full lock."* At 900 you would
need to tilt the phone 900° to reach full lock. A phone in the hands tilts maybe 60°
before the wrist gives out, so steering would top out at roughly **7% of full lock** —
the truck would barely turn and a bus could never be parked.

The number would appear in the UI exactly as requested and the feature would be useless.
Do not do this.

---

## The actual design — rotate the phone, don't tilt it

The phone goes in a **holder/wheel mount and is physically rotated like a steering
wheel**, through the full 2.5 turns. This is real steering travel, not a sensitivity
curve pretending to be one — which is what the ticket actually asked for.

### The sensor half is already built

[`MainActivity.kt:1812`](../../apps/android-client/app/src/main/java/com/gamepad/client/MainActivity.kt):

```kotlin
val rollDeg = STEER_SIGN * Math.toDegrees(Math.atan2(ux.toDouble(), uy.toDouble()))
```

This measures **where gravity points within the screen plane** — which is precisely
"how far has this phone been rotated in its own plane," i.e. the wheel angle. Three
properties make it the right primitive:

- **Drift-free.** Derived from the gravity vector, not from integrating the gyro.
  A yaw-integrated angle would drift over a long haul; this cannot.
- **Absolute.** Re-acquires correctly after backgrounding.
- **Already ±180°, not ±90°.** It is `atan2`, so it covers the full circle.
  ⚠️ The JS comment at `App.tsx:788` claims *"RAW tilt ANGLE in degrees (native, +/-90)"*
  — **that comment is stale and wrong.** Do not design against it.

---

## What has to be built

### 1. Unwrap the angle — this is the whole job

`atan2` snaps from +180° to −180°. Rotate past half a turn and steering flips to full
opposite lock mid-corner. Track the previous sample, detect the ±360° jump, accumulate a
turn count. That converts ±180° into ±450° = 900° lock-to-lock.

~10 lines. Easy to write. **The one place a mistake is dangerous rather than merely
wrong** — it fails as a violent full-lock jerk, not a visible error.

Sample rate is not a concern: at ~200 Hz you would have to spin faster than 100
revolutions/second to alias.

### 2. Lock screen orientation — load-bearing, not cosmetic

[`MainActivity.kt:1798`](../../apps/android-client/app/src/main/java/com/gamepad/client/MainActivity.kt)
picks the sensor axis remap **from the current display rotation**:

```kotlin
val (axisX, axisY) = if (currentDisplayRotation() == Surface.ROTATION_270)
    AXIS_MINUS_Y to AXIS_X
else
    AXIS_Y to AXIS_MINUS_X
```

The activity is `SCREEN_ORIENTATION_SENSOR_LANDSCAPE` (`MainActivity.kt:826`), so Android
flips between ROTATION_90 and ROTATION_270 as the phone turns — **and the steering frame
swaps underneath the driver mid-turn.** Wheel mode must pin the orientation for the
duration. This was correctly anticipated when the feature was specified.

### 3. Unwrap BEFORE the smoothing filter

`rollFilter.filter(rollDeg, event.timestamp)` runs at `MainActivity.kt:1815`. Smoothing
across the wrap discontinuity produces a garbage spike. Order matters: unwrap, then filter.

### 4. Both input paths, or it half-works

JS `pumpGyro` (`App.tsx:773`) and the native Kotlin path compute steering
**independently**. Shipping one without the other yields "works on Wi-Fi, wrong on USB."
This is the same class of bug as commit `26d5368`, where the sign-in wall was enforced in
JS but not in the native touch engine.

### 5. Mode selection

Two modes, so nobody's existing setup changes:

| Mode | Range | Behaviour |
|---|---|---|
| **Direct** (existing) | 1°–90° tilt | Exactly what ships today. Untouched. |
| **Wheel** (new) | 90°–900° rotation | Multi-turn; 720° and 900° as presets. |

Storage follows the existing `prefs.ts` pattern; the mode toggle mirrors the
Racing/3D toggle already at `App.tsx:3413`.

---

## Known risks and open questions

- **Gimbal lock when flat.** `atan2(ux, uy)` is undefined with the phone screen-up —
  both legs go to zero. A wheel mount tilted like a real wheel is fine; a flat tabletop
  mount is degenerate. Needs a guard and probably a documented mounting requirement.
- **The phone is the wheel, so its screen is unreachable.** Throttle and brake cannot be
  on-screen buttons in this mode. Wheel mode likely has to assume gyro-throttle or a
  second input device. **Product decision, not yet made.**
- **Recentre/calibrate** must define wheel centre. The existing `calibrate()` /
  `gyroZeroX` mechanism covers this but needs re-testing across the wrap.
- **Idle detection is safe.** The flat-and-still detector (`gyroRestingFlat`) requires
  `abs(uz) >= flatUz` — a vertically mounted phone never satisfies it, so wheel mode will
  not falsely idle. Verified, no change needed. See `App.tsx:1225`.

---

## Effort

| Piece | Difficulty |
|---|---|
| Mode toggle + range UI | Easy — mirrors existing toggle |
| Unwrap maths (JS) | Easy — ~10 lines |
| Unwrap maths (Kotlin/native) | Easy, but **mandatory**, see §4 |
| Orientation lock | Easy |
| Persisting the setting | Easy — existing `prefs.ts` pattern |
| **Tuning the real feel in ETS2** | **The actual work — requires a phone, a mount, and hands** |

Overall: **medium, not hard.** The maths is easy; the risk is concentrated entirely in
the discontinuities.

---

## Reply sent to the reporter

Ticket left **In Progress** (not resolved) — this is now a commitment.

> Thanks for writing in, and for being specific — that helps a lot.
>
> Right now tilt steering maps to how far you tilt the phone, which caps out well short
> of a 900° or 720° wheel, so we can see why it doesn't feel right in a truck or bus.
>
> We're working on a proper wheel mode for this: mount the phone in a holder and
> physically rotate it like a steering wheel, with full multi-turn travel up to 900° and
> 720° as selectable ranges. The sensor side already tracks true rotation, so this is
> real steering travel rather than a sensitivity tweak.
>
> It won't make the update that's currently in testing, but it's on the list for the one
> after. We'll let you know when it's live.

---

## Related

- `projects/gamepados/RELEASE.md` — release process
- `context/PLAY_ACTIVATION.md` — why 1.4.0 must ship first
- `context/memory/feedback_gyro_indicator_design.md`, `feedback_gyro_idle_gate.md`

---

## What was actually built — 2026-08-26

Implemented against this design. **Not yet device-tested** — the feel in ETS2 is still
the real remaining work, and that needs a phone, a mount and hands.

### Sensor: unwrap once, at the source

`MainActivity.unwrapRoll()` converts the ±180° `atan2` reading into continuous
multi-turn travel, and runs **before** `rollFilter.filter()` as §3 requires.

It is deliberately placed at the single point BOTH input paths read (`fusedRollDeg`),
so §4 is satisfied structurally rather than by remembering to edit two files: the JS
`pumpGyro` loop and the native engine cannot drift apart, because neither one does the
unwrapping. That is the `26d5368` failure mode designed out rather than guarded against.

It also runs unconditionally, not just in wheel mode — direct tilt had the same latent
flip past ±180°, and its output is clamped long before that point anyway.

**A bug was caught here during development.** The first draft capped the turn count at
±3 "as a runaway guard". That was wrong twice over: nothing can run away (the counter is
an `Int`, needing billions of physical revolutions), and the clamp silently reintroduced
the exact 360° discontinuity the function exists to remove — after over-rotating and
returning, the wheel centre was left a full turn out. The cap is gone. `tools/wheel-unwrap.test.js`
test 5 exists specifically to stop it coming back.

### Orientation: pinned, because it is functional

`setWheelMode(on)` pins `SCREEN_ORIENTATION_LANDSCAPE` for the duration (§2), and
`setScreenOrientation("landscape")` now defers to it — otherwise opening the controller
screen handed orientation straight back to the sensor and undid the pin. Toggling the
mode also drops the banked turn count, so turns taken before the change cannot offset
the new centre by whole revolutions.

### Range: one derived value, no duplicated mode logic

`gyroEffectiveAngle` in `App.tsx` is `wheelRange / 2` in wheel mode and the plain tilt
sensitivity otherwise. It is computed **once** and handed to the controller screen, which
feeds both the JS gyro loop and the native `setNativeGyroConfig` push. The native side
needed no maths change at all — it just receives a larger `sens`. Mode logic exists in
exactly one place, in one language.

### Settings

Wheel mode toggle plus 360 / 540 / 720 / 900 presets, persisted through the existing
`prefs.ts` pattern (`gyro_wheel`, `gyro_wheel_range`, clamped 180–1080 on read and write).
Default is **off**, so no existing setup changes. The tilt-sensitivity slider says plainly
that it does nothing while wheel mode is on.

### Verification

- `tools/wheel-unwrap.test.js` — 12 assertions, wired into `regression-check.sh` Tier 1
  so it runs on every check. Covers continuity across ±900°, the +180° crossing, exact
  full lock at 720°/900°, ten turns out-and-back returning to exact centre, symmetry,
  reset, and that direct tilt is unchanged.
- Kotlin compiles clean (`:app:compilePlaystoreDebugKotlin`).
- TypeScript: 13 errors, **identical to the pre-existing baseline** — none new.
- `vite build` clean; UI bundle copied to the APK assets (B1 passes).

### Still open

- **Throttle and brake.** Unchanged and still undecided: if the phone is the wheel, its
  screen is unreachable. Wheel mode currently assumes tilt-throttle or a second device.
  This is the product call from the original design, and it is still unmade.
- **Device tuning in ETS2** — the actual remaining work.
- **Gimbal lock when flat** — a flat-mounted phone has no in-plane rotation to measure.
  The settings screen now says to mount it upright or tilted; there is no code guard.

### Release trap

The working tree carries wheel mode while `versionCode` is still **55 / 1.4.1** — the
same version as the staged AAB, which does NOT contain wheel mode. **Upload
`releases/store/1.4.1/GamepadOS-1.4.1-playstore.aab` as-is; do not rebuild 1.4.1 from
this tree.** Bump to 1.4.2 / code 56 before building the wheel-mode release. (Play's
versionCode uniqueness is a backstop — once 55 is consumed, a rebuild is refused.)

---

## Device-test round 1 — 2026-08-27

First install on real hardware. Four things came back, one a real bug of mine.

### The bug: the whole app went landscape at startup

`setWheelMode` was changing `requestedOrientation` directly. The JS side pushes that
flag **on mount**, not on entering the controller — so merely having wheel mode saved
threw the entire app into landscape the instant it launched, menus and settings
included. Toggling a range preset re-triggered it too.

Fixed at the root: `setWheelMode` now records the flag and resets the turn count, and
touches orientation **never**. Orientation belongs solely to `setScreenOrientation`,
which is the only code that knows which screen is showing.

### User-mandated: the lock applies to the CONTROLLER only

> "the app orientation should be locked inside the controller only not outside"

`setScreenOrientation` gained a distinct `"landscape-locked"` mode, which the controller
asks for and nothing else does. The layout editor and preset editor keep plain
`"landscape"` and stay free-rotating, because they are not the controller. With wheel
mode off, `"landscape-locked"` behaves identically to `"landscape"`, so nothing changes
for anyone not using the feature.

### User-mandated: a rotate control inside the controller

> "we will provide one option called rotate screen option to rotate the screen inside
> the controller because we will fix the controller screen orientation"

Pinning the orientation takes away the driver's normal way of choosing which way round
to sit in the mount, so that choice comes back as an explicit **ROTATE** button in the
controller HUD, beside CALIBRATE, shown only while wheel mode is on.
`rotateControllerScreen()` flips between the two landscape directions, remembers the
choice in `wheelLandscapeReverse` so re-entering the controller keeps it, and resets the
unwrap — flipping the display re-frames the sensor axes, so turns banked in the old
frame are meaningless in the new one.

### User-mandated: hide sensitivity in wheel mode

> "we will not show the sensitivity options after turning on the wheel mode"

The tilt-sensitivity slider is not rendered at all while wheel mode is on. It was
briefly shown with a note saying it did nothing, which is worse — a dead control still
invites a change. Steering follows the lock-to-lock range instead.

### Still open after this round

- Throttle and brake with the phone as the wheel. Unchanged, still unmade.
- The deadzone control is still labelled **"Steering range"**, which now reads
  ambiguously next to wheel mode's **"Lock-to-lock range"**. Renaming it was not asked
  for, so it has been left alone — worth a decision.
- Feel in ETS2 on real hardware.
