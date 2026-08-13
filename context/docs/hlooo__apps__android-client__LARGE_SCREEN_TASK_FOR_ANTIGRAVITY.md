# Task: Fix Play Console "Large-screen resizability / orientation restriction" warning

## Project context (read this first)

**GamepadOS** — a native Android app (`com.gamepad.client`) that turns a phone into a
low-latency wireless/USB game controller for a Windows PC. It is NOT a content app;
the entire UI is a controller layout (buttons, sticks, triggers) rendered by a React
app running inside a single WebView hosted by `MainActivity.kt`.

- Native project root: `F:\hlooo\apps\android-client\`
  - Manifest: `app\src\main\AndroidManifest.xml`
  - Activity: `app\src\main\java\com\gamepad\client\MainActivity.kt`
  - Build config: `app\build.gradle.kts` (currently `compileSdk = 35`, `targetSdk = 35`,
    `minSdk = 24`, `versionCode = 40`, `versionName = "1.3.16"`)
- Web UI source (compiled into a single `index.html` and bundled as an Android asset):
  `F:\hlooo\apps\controller-ui\` (React + TypeScript + Tailwind + framer-motion).
  - Build with `npm run build` in that folder (outputs `dist/index.html`).
  - **After every UI change you MUST copy the fresh bundle into the native project:**
    `dist/index.html` → `F:\hlooo\apps\android-client\app\src\main\assets\dist\index.html`
    (there is no automated copy step — this is a known gotcha, forgetting it ships a
    stale UI even though the native code is correct).
  - Main app component: `controller-ui\src\app\App.tsx` (very large file, ~4500 lines).

**Why the app is portrait-locked today:** `AndroidManifest.xml` currently has, on the
`MainActivity` entry:
```xml
android:screenOrientation="portrait"
android:configChanges="orientation|screenSize|keyboardHidden|keyboard|smallestScreenSize"
```
The controller layout (button positions, D-pad, sticks, triggers) is hand-tuned for a
phone held upright in portrait. Additionally, **gyro/tilt steering** reads the phone's
physical orientation sensors relative to a portrait hold (see `MainActivity.kt`
`onSensorChanged`, `STEER_SIGN`/`PITCH_SIGN`, and the `useGyro` hook in `App.tsx`) — an
unlocked or landscape-forced orientation would visually and functionally break both the
button layout and the tilt-steering math, which are core to the product.

## The actual problem

Google Play Console (Play Console → "For your next release" panel) is now flagging:

> **Remove resizability and orientation restrictions in your app to support large
> screen devices**
> From Android 16, Android will ignore resizability and orientation restrictions for
> large-screen devices, such as foldables and tablets. This may lead to layout and
> usability issues for your users.

In short: on Android 16+ devices with a large screen (tablets, foldables, ~≥600dp
smallest width), the OS will **stop honoring** `android:screenOrientation="portrait"`
and any implicit resizability restriction, and will force the activity into whatever
orientation/size the device's window manager decides (freeform, split-screen, unlocked
rotation, etc.) — **regardless of what the manifest says**. If the app isn't prepared
for that, the controller UI will visually break (buttons overlapping, gyro math wrong)
on those devices.

## What needs to happen

There are two layers to this — do BOTH, in this order:

### 1. Contain the blast radius immediately (defensive, low-risk)

Add the Android "large screen compatibility" manifest properties that explicitly tell
the OS this app intentionally wants its orientation/resizability restrictions honored,
so it degrades gracefully instead of getting silently force-resized/rotated on Android
16 large-screen devices. Research the exact, current, correct property names/values
from the official Android developer documentation before implementing — these are
manifest `<property>` entries under the `<application>` tag (NOT `<activity>`), roughly
of the form:

```xml
<property
    android:name="android.window.PROPERTY_COMPAT_ALLOW_ORIENTATION_OVERRIDE"
    android:value="false" />
<property
    android:name="android.window.PROPERTY_COMPAT_ALLOW_RESIZEABLE_ACTIVITY_OVERRIDES"
    android:value="false" />
```

**Verify these exact property names, required `targetSdkVersion`/API-level gating, and
whether they still require `android:resizeableActivity="false"` to also be declared on
the `<activity>` tag** — check the official Android developer docs (developer.android.com,
search "large screen compatibility overrides" / "orientation and resizability API 36")
since Google revises these APIs across Android 15/16 previews and finalized releases;
do not guess the values from memory. Confirm they compile (they require a recent enough
Android Gradle Plugin / compileSdk — this project is on AGP with `compileSdk = 35`,
check whether these properties need `compileSdk = 36` and if so evaluate the risk of
bumping it — see build.gradle.kts).

**Important:** this does NOT make the Play Console warning disappear — Google's own
docs are explicit that these overrides are a *transitional* escape hatch, not a
long-term fix, and the pre-launch report may keep flagging it. It DOES prevent the app
from actually breaking on Android 16 tablets/foldables in the meantime, which is the
real risk we're mitigating.

### 2. Make the app degrade sanely on large screens even when forced (defensive UI work)

Because Android 16 can override the lock regardless of #1 on some device
configurations (and #1 may not be honored forever), the app should not visually fall
apart if it ever IS shown at a large size or in landscape/split-screen/freeform. Two
concrete, low-risk options — pick based on what's fastest to verify:

**Option A — explicit "unsupported form factor" guard (recommended, matches how most
controller/game-input apps handle this):** In `MainActivity.kt`, detect when the
activity's current window size crosses a "large screen" threshold (e.g.
`Configuration.smallestScreenWidthDp >= 600`) via `onConfigurationChanged` (already
partially wired since `configChanges` includes `screenSize|smallestScreenSize`, so the
activity won't restart — you get a callback instead). When that's true, do NOT try to
reflow the controller UI; instead show a simple native (or WebView-injected) message
like *"GamepadOS is designed for phones — please use it on your phone."* with a
continue-anyway option, OR simply center/letterbox the existing portrait-designed
WebView content at its natural portrait aspect ratio inside the larger window (padding
the extra space with the app's background color, `#0B0E14`/`#070910` from the current
theme) rather than letting it stretch/reflow awkwardly. This keeps the phone experience
100% unchanged (the vast majority of users) and just prevents a broken/garbled UI on
the rare tablet/foldable/Android-16 case.

**Option B — true adaptive layout (bigger effort, not required to satisfy the Play
warning, only do this if there's appetite for a larger redesign):** Make
`controller-ui/src/app/App.tsx` responsive to arbitrary aspect ratios/orientations
(the CSS safe-area vars `--android-safe-top/bottom/left/right` are already piped in
from `MainActivity.kt`'s `WindowInsetsCompat` listener, so the plumbing exists) and
allow `android:screenOrientation="unspecified"`/`resizeableActivity="true"`, then
re-derive the gyro `STEER_SIGN`/`PITCH_SIGN` math to work relative to whatever rotation
the device reports (`Surface.ROTATION_0/90/180/270`) instead of assuming portrait.
**Do not attempt this without device-testing on an actual tablet/foldable** — the gyro
math is fragile and has a documented history of sign/gimbal bugs in this codebase (see
project memory: multiple past rewrites of the steering algorithm).

## Constraints — do not break these

- **Do not change anything for phone users.** The overwhelming majority of installs are
  phones in portrait; this task is scoped to large-screen/Android-16 devices only.
  Verify with `adb shell dumpsys window` or an emulator at a phone-sized profile that
  normal portrait behavior is byte-for-byte unchanged after your edits.
- **Do not touch gyro/tilt-steering code** unless you're doing Option B and can test on
  a real large-screen device — it has broken before from orientation-math changes.
- **Do not remove the existing `configChanges` list** on the `MainActivity` entry
  (`orientation|screenSize|keyboardHidden|keyboard|smallestScreenSize`) — this is what
  currently prevents the Activity from being destroyed/recreated (and losing an active
  Wi-Fi/USB controller session) on rotation/resize events. Any large-screen handling
  should hook `onConfigurationChanged`, not rely on Activity recreation.
- **This project has no `gradlew`** — it's built with a bundled Gradle at
  `F:\hlooo\tools\gradle-8.14.4\bin\gradle.bat` and a bundled JDK 17 at
  `F:\hlooo\tools\jdk\jdk-17.0.19+10`. To build and verify:
  ```
  $env:JAVA_HOME = "F:\hlooo\tools\jdk\jdk-17.0.19+10"
  $env:ANDROID_HOME = "F:\Android\Sdk"
  & "F:\hlooo\tools\gradle-8.14.4\bin\gradle.bat" -p "F:\hlooo\apps\android-client" :app:assembleDirectDebug --console=plain
  ```
  (`direct` flavor + `Debug` build type needs no signing key and is fastest to iterate
  with. There are 5 flavors total — `direct`, `playstore`, `aptoide`, `uptodown`,
  `amazonstore` — all share this manifest/activity, so a fix here applies to all of
  them automatically.)
- **Bump the version** when the change is release-ready: in
  `app\build.gradle.kts`, increment `versionCode` (currently 40) and `versionName`
  (currently "1.3.16"), and add a one-line dated comment above them describing the
  change, matching the existing changelog-in-comments convention already in that file.
- If you touch `AndroidManifest.xml`'s `<application>` tag, be careful not to disturb
  the existing `android:theme="@style/Theme.App.Splash"` (a recently-added native splash
  screen — see `app\src\main\res\values\themes.xml`) or any of the other existing
  attributes/permissions already declared there.

## Deliverable

1. Manifest changes (researched against current official docs, not guessed).
2. `MainActivity.kt` large-screen guard (Option A) wired via `onConfigurationChanged`,
   OR a clear written explanation if you determine Option A isn't warranted/needed after
   researching how the compat properties in step 1 actually behave.
3. A debug APK build proving it compiles (`assembleDirectDebug`, per the command above).
4. A short summary of: (a) exactly which manifest properties you added and why, (b)
   whether phone/portrait behavior was verified unchanged, (c) whether this is expected
   to fully clear the Play Console warning or only mitigate real breakage (be honest —
   Google's docs suggest it may keep flagging as advisory even after mitigation).
