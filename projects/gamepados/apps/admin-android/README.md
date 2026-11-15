# GamepadOS Admin Android app

**Where things live (moved 2026-11-15 from the Codex folder on C:):** this source is
`D:/AKHIL/HP/projects/gamepados/apps/admin-android`; the PRIVATE signing key is
`D:/AKHIL/HP/keys/admin-android/` (`admin-release.jks` + `release.properties`), which the build reads directly. The key
is never committed. Without it the installed app cannot be updated in place. Built APKs go to `D:/DOWNLOADS/GamepadOS-Admin/`.

**1.3.0 (2026-11-15):** dark + white sign-in screen, top bar and bottom menu; **face sign-in**. The POCO's face unlock is
camera-only ("weak" to Android), which cannot unlock a Keystore key, so the saved login (vault v2) is encrypted with a
Keystore key that needs no biometric and the app asks for face OR fingerprint before using it. Release approvals are
unchanged: they need a STRONG biometric (fingerprint) bound to the approval key. A login saved by 1.0-1.2 is dropped on
first start; sign in with the password once to turn face sign-in on.

Native Java Android shell for the live GamepadOS admin portal at `https://supportportal.gamepad.space/admin`. Android 10+, target API 36. Uses the portal's live design and APIs, Android Keystore for credential encryption and signed release approvals, and the system biometric prompt.

## Build

Use JDK 17, Gradle 9.8.2, AGP 9.5.0, Android SDK 36 and Build Tools 37.0.0. Update `local.properties` for your SDK location. On the original computer, `./build-apk.ps1` uses the existing toolchain paths. Elsewhere run `gradle assembleRelease lintRelease`.

`signing/admin-release.jks` and `signing/release.properties` are PRIVATE signing material generated for this app. Keep them backed up; reuse this key to update the installed APK. They are unrelated to the portal's RELEASE_KEY. Do not publish this source ZIP with its signing directory.

Run `node --test mobile-ui.test.cjs` to test mobile release integration. Native app and biometrics must also be tested on a real phone.

Biometric login uses the existing portal backend. Release approvals without entering RELEASE_KEY require the separately supplied Railway update and its additive Prisma tables. Install and deploy that update, then sign in with your owner password and choose Enable to register the phone. Face authentication requires Android strong-biometric support; ordinary camera face unlock may be ineligible. The app uses no camera permission.
