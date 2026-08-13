# Session handoff — 2026-07-11

## LATE-DAY ADDITION — 1.3.2 (code 26): Play-native updates
User reported: the Play build showed update banners driven by the WEBSITE's
/api/version, but the button routed to Play, where the release often isn't
published yet (review lag) — a dead-end banner. Fixed same day:
- New `app/src/playstore/java/UpdaterBridge.kt` using **Google Play In-App
  Updates** (`com.google.android.play:app-update:2.1.0`, playstoreImplementation
  only): `checkPlayUpdate()` → `window.__onPlayUpdate(available, code)`;
  `startPlayUpdate()` → Play's immediate full-screen flow. `MainActivity.evalJs()`
  helper added. sourceSets: playstore now uses src/playstore/java (others keep
  src/store/java).
- `UpdateChecker` (App.tsx) channel-aware: playstore never fetches the manifest;
  direct/aptoide/uptodown/amazonstore unchanged. Verified in browser with a
  stubbed bridge + tsc clean; flavor isolation verified in the artifacts (Play
  classes present in playstore AAB, absent in direct APK).
- Meanwhile the USER pushed + Registered & Activated 1.3.1/code 25 (live
  /api/version = 1.3.1/25) and the channel-aware backend went live
  (?channel=playstore → Play listing URL). So 25 is consumed → this fix is
  **1.3.2 / versionCode 26** (all 5 flavors in store-releases/1.3.2/, direct APK
  committed to website repo — 1 commit awaiting user push).
- User still to do: push website; upload GamepadOS-1.3.2-playstore.aab to Play
  (supersedes any 25 upload); Register & Activate 1.3.2; other-store uploads;
  on-device Play-update test.

## STORE LISTINGS LINKED (evening)
User published to Play Store, Uptodown, and Amazon Appstore. Backend
STORE_LISTING_URLS defaults now filled (commit 3ebea99, unpushed):
- playstore: play.google.com/store/apps/details?id=com.gamepad.client
  (404 until Google finishes publishing — deterministic, no change needed)
- uptodown: https://gamepados.en.uptodown.com/android (user-provided slug;
  404 until Uptodown moderation publishes)
- amazonstore: https://www.amazon.com/gp/mas/dl/android?p=com.gamepad.client
  (VERIFIED LIVE — 302 → amazon.com/dp/B0H6MPPFZN)
- aptoide: still '' (not published there)
After push, verify: /api/version?channel=uptodown and ?channel=amazonstore
return these URLs.

## TEMP admin-portal bundle download (evening — REMOVE NEXT UPDATE)
Commit 8ca0508: "⬇ 1.3.2 files" button in admin.html + GET
/api/admin/release-bundle (requireAdmin) serving
downloads/GamepadOS-1.3.2-store-bundle.zip (uptodown APK + amazonstore APK +
Play AAB, 6.9 MB) — added ONLY so the user can pull the store-upload files onto
their phone from admin.gamepad.space (Drive sync is off; Gmail blocks .apk;
LAN share was permission-denied). All three pieces must be deleted together in
the next update (route + button + zip).

## What happened (morning)
1. **Feedback-broken-on-Play root cause found + fixed → Android 1.3.1 (versionCode 25).**
   The Play build (1.3.0/code 24) loads the UI from `file:///android_asset/`; modern
   WebView blocks `fetch()` from `file://` origins, so feedback + the update check
   silently died ("No connection"). Fix = WebViewAssetLoader → UI now served from
   `https://appassets.androidplatform.net/assets/dist/index.html`
   (`androidx.webkit:webkit:1.10.0`); deprecated `allow*FromFileURLs` flags removed.
   The origin switch wipes localStorage, so a **one-time migration** was added
   (`assets/migrate.html` → `AndroidBridge.onLegacyStorageDump` → replay + reload,
   guarded by SharedPreferences `gamepados/webstorage_migrated` + a 4s watchdog) —
   custom pads + gyro settings survive the update.
   Credit/history: the asset-loader approach was prototyped by Antigravity in
   `F:\hlooo-workspace` (now quarantined in `F:\_TRASH_REVIEW`); it missed the
   migration, the version bump, and 4 of 5 flavors, and its build OOM'd
   (hence `org.gradle.jvmargs=-Xmx4g` now in gradle.properties).
2. **LT/RT editor bug fixed** (`CustomPadEditor.tsx`): the settings panel had no
   max-height, so "Rectangular" mode pushed the Throttle/Normal buttons off-screen.
   Panel + Add Widget menu now cap at viewport height and scroll internally.
3. **CameraX 1.3.1 → 1.4.0** — clears the Play 16 KB page-size warning (the one that
   burned versionCode 23).
4. **All 5 flavors rebuilt** (gradle 8.9 + bundled JDK17, BUILD SUCCESSFUL 5m41s) →
   `store-releases/1.3.1/` (with RELEASE_NOTES.md). Direct APK also staged at
   `website/backend/downloads/GamepadOS-1.3.1.apk`
   (sha256 A16E1179B20CF8259ED703A03938891629860AD2CD94D24CEAAC68FAB65EC07D).
5. **Website repo: 3 commits ready, NOT pushed** (per standing rule):
   - `backend: channel-aware /api/version store listing URLs` — pre-existing
     uncommitted work found in the tree; live backend still ignores `?channel=`
     until this deploys.
   - `keepalive: fix dead Railway host` — `-9351` host 404s; live host is
     `gamepad-production.up.railway.app` (also fixed the stale ref in apps/docs/SKILL.md).
   - `release: add GamepadOS 1.3.1 (code 25) direct APK`.
6. **Codebase verification sweep (agent)**: PC server URLs/versions (1.1.16 all in
   sync), ticket validation (mobile posts pass), /api/version logic (reports code 22
   because that's the active DB release — activation is the fix), iOS bundles, update
   channels — all OK. Only finding was the dead -9351 host (fixed).
7. **F:\ drive reorganized** — root cleared (resumes → `F:\personal`, logos →
   `F:\flexsquares\branding`, 22 stray DLLs quarantined), hlooo root tidied
   (`marketing\` created, study plans → NOTES), 4.02 GB quarantined in
   `F:\_TRASH_REVIEW` (MOVE_LOG.md documents every move; nothing hard-deleted).

## What the USER still has to do (in order)
1. `git push` in `F:\hlooo\website` → deploys Railway backend (channel URLs + 1.3.1 APK
   file) and fixes the keepalive workflow.
2. Play Console: upload `store-releases\1.3.1\GamepadOS-1.3.1-playstore.aab` (code 25).
3. Admin portal → 📦 Releases → App → **Register & Activate** GamepadOS-1.3.1.apk
   (RELEASE_KEY) — this flips `/api/version` off code 22 and starts offering the
   update to direct users.
4. Aptoide / Uptodown / Amazon: upload each flavor's APK from store-releases\1.3.1.
5. On-device: update from 1.3.0 → confirm custom pads survive (migration), send a
   feedback → shows in admin portal tagged 📱, check the update banner per store flavor.
6. Drive cleanup finale: delete `F:\.tmp.driveupload` (10.4 GB) via Explorer, empty
   Recycle Bin (688 MB), review + delete `F:\_TRASH_REVIEW` (4.02 GB).
   Consider moving `F:\keys` (plaintext secrets) off the cloud-synced drive.

## Still-open items carried from earlier sessions
- On-device GRX/gyro validation (STEER_SIGN/PITCH_SIGN, tilt-throttle sign).
- One real updater end-to-end test per platform after activation.
- PC 1.1.16 unchanged today — no rebuild needed.
