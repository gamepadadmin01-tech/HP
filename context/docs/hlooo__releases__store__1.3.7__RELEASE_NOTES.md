# GamepadOS Android 1.3.7 (versionCode 31) — 2026-07-13

UX polish: per-button haptics + smoother button animations. Also carries the
1.3.6 build-tooling modernization (Kotlin 2.4 / Gradle 8.14.4), so 1.3.7
supersedes 1.3.6.

## Per-button haptic strength

Before, every button fired the same medium buzz. Now each control gets a
device-tuned tier that matches its role, so the pad feels like real hardware:

| Button role | Feel |
|---|---|
| Triggers (LT/RT, GAS/BRAKE/FIRE/AIM) | **Heavy** pull (HEAVY_CLICK) |
| Face buttons (A/B/X/Y), bumpers, stick-click, macros | **Medium** click (CLICK) |
| D-pad + system (View/Menu/Home/Start/Select) | **Light** crisp tick (TICK) |

- Works on both the standard controller and custom pads.
- Custom-pad widgets keep their per-widget haptic slider in the editor as an
  override; the role default applies when it's left at the default.
- Uses the three device-tuned VibrationEffect tiers already exposed by the native
  bridge (no native changes) — so on amplitude-capable phones it's OEM-tuned.

## Smoother button animations

- Press is near-instant (input stays responsive) but the button now **settles
  back with a soft spring overshoot** on release instead of a flat snap.
- Fill/stroke color transitions gently instead of popping.
- Slightly deeper press scale (0.92) for a more tactile feel.

## Also included (from 1.3.6)

- Kotlin 1.9 → 2.4, Gradle 8.9 → 8.14.4, AndroidX libs current.

## Device-test before activating

Kotlin was a major bump (carried from 1.3.6) and haptics/animations are best
judged by feel — install, pair, and press around before activating. Roll back to
1.3.5 if needed (preserved in store-releases/1.3.5/).

## Publish checklist

- [ ] On-device: pair + input + **feel the per-button haptics** + button anim.
- [ ] Play: upload GamepadOS-1.3.7-playstore.aab (code 31).
- [ ] Website (direct): push, then Register & Activate GamepadOS-1.3.7.apk.
- [ ] Aptoide / Uptodown / Amazon: upload each flavor's APK.
