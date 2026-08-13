# iOS client — fixes made on the Mac (2026-07-06), merge back to F:\hlooo\apps\ios-client\

This folder is the Mac build copy of `apps/ios-client` (drive is NTFS =
read-only on macOS). Three files changed vs the drive version — copy them
back from the Lenovo:

1. **project.yml**
   - `UILaunchScreen: {}` added to `info.properties` — REQUIRED. The
     `INFOPLIST_KEY_UILaunchScreen_Generation` build setting is ignored when
     a custom Info.plist is used, so the shipped plist had no launch-screen
     key and iOS ran the app LETTERBOXED at legacy 4.7" resolution (black
     bars top/bottom, visible status bar, shrunken UI).
   - `PRODUCT_BUNDLE_IDENTIFIER: com.gamepad.client.akhil` (com.gamepad.client
     collided with another team) and `DEVELOPMENT_TEAM: 46PX2Z3779` baked in
     so `xcodegen` regeneration keeps signing intact.

2. **Sources/MainViewController.swift** — a boot WKUserScript now injects
   `window.__iosBootVersion={name,code}` BEFORE bridge-shim.js. The React UI
   reads getAppVersionCode ONCE at mount (useMemo, empty deps); the old
   push-after-load delivery meant the UI saw version 0 and showed a phantom
   "update available" forever.

3. **Shim/bridge-shim.js** — state.versionName/versionCode seed from
   `window.__iosBootVersion` instead of hardcoded 0.

Verified on the iPhone 16 Pro (iOS 26.5): Version shows 1.3.0 · Free, and
the letterbox fix ships in build installed 2026-07-06 ~17:05.

## Round 7 (same day): gyro optimization pass
12. **MotionEngine.swift — orientation-mapping BUG fixed**: the
    UIDevice.orientationDidChange observer never fired because nothing called
    beginGeneratingDeviceOrientationNotifications() — the landscape remap flag
    was frozen at its default, so one of the two landscape holds steered
    inverted. Now generation is on, AND MainViewController feeds the
    INTERFACE orientation (Android display-rotation parity; interface
    .landscapeRight == device .landscapeLeft) on every layout pass via new
    setInterfaceOrientation().
13. **MotionEngine.swift**: deviceMotionUpdateInterval 1/200 → 1/400
    (CoreMotion clamps to hardware max; freshest sample per push).
14. **MainViewController.pushFastState split**: gyro+rumble every CADisplayLink
    tick (120 Hz, %.3f trimmed), telemetry HUD blob every 8th tick (~15 Hz) —
    shorter per-frame JS strings keep the web process at 120 Hz and cut input
    latency. (QR verify polls telemetry at 150 ms — 15 Hz is ample.)

## Round 6 (same day): haptics rebuilt for the Taptic Engine (user: "haptics
## very bad")
11. **Sources/Haptics.swift rewritten.** Old code built a fresh pattern+player
    per triggerRumble call — which the UI fires up to 60 Hz during game
    rumble — and played one mid-sharpness continuous buzz off max(l,r).
    New design: two PERSISTENT looped CHHapticAdvancedPatternPlayers modeling
    the Xbox motors (large = sharpness 0.25 heavy/rounded, small = 0.85 fine
    buzz); each RMB packet is a near-free hapticIntensityControl dynamic-
    parameter update. γ0.75 perceptual curve lifts subtle rumble into the
    feelable range. Watchdog zeroes motors after the pulse duration (lost
    RMB(0,0) safety); players stop after 2 s idle (battery). Button haptics:
    .rigid impacts (mechanical click) for presses, .soft for releases, .light
    ticks, .heavy trigger pulls, re-prepared after each use. oneShot/waveform
    now use crisp transients for short segments. stopEngine/exitSession call
    haptics.stopAll().

## Round 5 (same day): gyro lifecycle + WKWebView touch fixes (user: "controls
## and gyro not working")
9. **MainViewController.swift — sensor lifecycle parity (the gyro bug)**:
   MotionEngine now starts in viewDidLoad and follows willResignActive /
   didBecomeActive (Android onPause/onResume parity per SENSORS_LIFECYCLE.md:
   "gyro works independently of the native engine"). Previously it only
   started inside connectToPC and was killed on exitSession → gyro read dead
   zeros before/outside a session. exitSession no longer stops motion.
10. **MainViewController.swift — WKWebView game-touch hygiene (the controls
    bug)**: WKWebView (unlike Android WebView) has text-selection/magnifier
    gestures that fire on press-and-hold / drag — exactly how sticks and
    held buttons are used — and steal pointer events. Injected CSS kills
    user-select/touch-callout everywhere except input/textarea (feedback form
    unaffected). Also: zoom clamped natively (iOS ignores user-scalable=no
    since iOS 10 — pinch could zoom the controller), scroll bounce off,
    long-press link previews off.

## Round 4 (same day): independent iOS versioning
7. **project.yml**: iOS now versions independently — CFBundleShortVersionString
   "1.0.0", CFBundleVersion "1" (was mirroring Android 1.3.0/22; user decision).
8. **controller-ui App.tsx (UpdateChecker.check)**: platform-aware manifest
   compare — iOS reads `manifest.ios` (entry absent = build is current)
   instead of `manifest.android`, so Android's higher versionCode can never
   show a phantom update on iPhone. WebBundle rebuilt.
   BACKEND NOTE: when iOS updates should be offered later, add an `ios` entry
   to /api/version ({version, versionCode, url, notes}) — the client already
   understands it.

## Round 3 (same day): app icon
6. **Assets.xcassets/AppIcon.appiconset** added (single 1024 universal icon)
   + `project.yml`: Assets.xcassets in sources, ASSETCATALOG_COMPILER_APPICON_NAME.
   Icon derived from `uptodown_icon_512.png` (gamepad re-centered — the store
   art had it padded low — then LANCZOS-upscaled to 1024, opaque background).

## Round 2 (same day): iOS-aware controller UI

4. **Shim/bridge-shim.js** — added `getPlatform: () => "ios"` to the bridge
   (Android's JNI bridge has no getPlatform, so absence = android).

5. **controller-ui source** (local copy `~/Desktop/controller-ui`, merge back
   to `apps/controller-ui` and rebuild for BOTH platforms when convenient —
   all changes are behind `IS_IOS`, Android renders byte-identical):
   - new top-level `IS_IOS` platform probe in App.tsx
   - Connect screen: Wireless/Wired tab selector hidden on iOS (no RNDIS
     tether / ADB path on iPhone); wireless is the only transport
   - Dashboard "Connect to PC" card subtitle: iOS says "Wireless — scan your
     PC's QR code"
   - About text: iOS variant without the USB-tethering pitch
   - LatencyCard (Wi-Fi band/RSSI + battery-optimization card): hidden on
     iOS (getWifiInfoJson returns placeholders; no battery-exemption concept)
   - rebuilt WebBundle/index.html from this source (vite singlefile, 533 kB)
     — iOS WebBundle now INTENTIONALLY differs from the APK's bundle until
     Android rebuilds from the same source.

