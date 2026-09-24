# Pending work reconciled and implemented — 2026-09-15

## Completed in this turn

- Main Android manifest now enables activity resizing. A new playstore manifest
  overlay retains false only for Play. Direct, Aptoide, Uptodown, Amazon, Indus
  and APKPure all inherit true. All seven generated Debug main manifests checked.
- Display keep-awake now follows the existing controller input-streaming signal
  AND Activity resume state. Home/Account do not hold the display on; background
  clears it; returning to an active controller restores it; guest expiry clears it.
  Native input timing and network transport were not changed.
- Added ScreenAwakePolicy and three unit tests. Added responsive-smoke.mjs,
  a local-only browser check with external requests mocked or blocked.
- Updated the regression checklist and context/CHANGE_AUDIT.txt.

## Verified

- Gradle compilation and testDirectDebugUnitTest: eight tests, zero failures/errors
  (five existing guest/angle tests, three new keep-awake policy tests).
- All seven process<Flavor>DebugMainManifest tasks passed; actual merged values
  inspected rather than just source XML. Release variants have not been regenerated.
- UI TypeScript check using tsconfig.check.json: passed.
- Browser dashboard/controller smoke checks: 412x915, 1280x800, 800x1280, 600x800;
  no horizontal document overflow or uncaught page errors detected. Also passed
  one-time introduction, plan choice opening sign-in, and browser quota expiry.
  This is basic automated coverage, not visual certification or native touch QA.
- Wheel unwrap tests: all nine groups passed.
- Existing UI dist and embedded Android asset SHA-256 still match:
  FDCC7D055B3FA2B459C64282B0086A88A7D3EC93D1779DAA4295CCEBF85057D9.
  UI product source and its bundle were not changed during this turn.
- First offline Gradle attempt could not resolve uncached AGP; normal online retry
  resolved dependencies and passed. No dependency versions were changed.

## Not completed / requires hardware or a separate release step

- No phone attached according to adb devices. Physical display timeout, tablet or
  foldable resizing, controller touch alignment, camera preview, prolonged gyro,
  Wi-Fi/USB reconnect, native quota expiry and paid-account transitions remain.
- A browser viewport cannot prove Android's native overlay geometry on a tablet.
- Real purchase/restore, email delivery, cross-device cloud sync and production
  activation are not proven by these local checks. No purchases or account mutations.
- Standing UDP link is intentionally retained on background. Suspending it is not
  automatically a missing bug fix: reconnect and power measurements must inform it.
- No new APK/AAB packaged, installed, or released; source version remains 1.4.3/57.
  Existing test APKs do NOT contain this turn's native/manifest changes. Before
  distribution, assign a distinct release version and complete hardware validation.
- Rust tests not rerun: cargo was absent from PATH and the usual user toolchain
  location. No PC server source was changed.
- The exhaustive HP corpus review remains incomplete; this turn handled the
  concrete pending Android items rather than every historical TODO.

## Policy correction

Play's false setting is the owner's requested configuration, NOT a Google mandate.
The earlier chat agreement incorrectly accepted the policy rationale. Android 16
may ignore resizing/orientation restrictions on large screens for target API 36;
this manifest split does not guarantee Play is non-resizable on every device.
No new platform opt-out or game-category workaround was added.
Source: https://developer.android.com/develop/adaptive-apps/guides/app-orientation-aspect-ratio-resizability

All pre-existing changes were preserved. No delete, commit, push or publishing.
