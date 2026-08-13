# GamepadOS Android 1.3.6 (versionCode 30) — 2026-07-13

Build-tooling modernization only. **No app-behaviour changes** — the app code is
identical to 1.3.5; only the build toolchain was brought up to date.

## What changed (build system, not the app)

- **Kotlin 1.9.0 → 2.4.0** (latest; the modern K2 compiler).
- **Gradle 8.9 → 8.14.4** (Kotlin 2.4's minimum).
- **AndroidX** bumped to current: core-ktx 1.13.1, appcompat 1.7.0, material 1.12.0.
- Migrated the removed `kotlinOptions` block to Kotlin 2.x's `compilerOptions` DSL.

Not changed: AGP stays 8.6.1 (AGP 9 reworks the NDK/CMake native build and needs
its own device-tested upgrade), NDK stays pinned 25.1.8937393, compile/target SDK
stays 35.

## IMPORTANT — device-test before activating

Because Kotlin was a major-version upgrade, verified by a clean build but not yet
on a device: install the direct APK, **pair with the PC and confirm input works**
(and gyro/QR), then activate. If anything misbehaves, roll back to 1.3.5 — those
artifacts are preserved in store-releases/1.3.5/.

## Publish checklist

- [ ] On-device smoke test (pair + input + gyro) — do this FIRST.
- [ ] Play: upload GamepadOS-1.3.6-playstore.aab (code 30).
- [ ] Website (direct): push, then Register & Activate GamepadOS-1.3.6.apk.
- [ ] Aptoide / Uptodown / Amazon: upload each flavor's APK.
