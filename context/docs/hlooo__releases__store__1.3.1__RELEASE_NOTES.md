# GamepadOS Android 1.3.1 (versionCode 25) — 2026-07-11

Fix release on top of 1.3.0 (code 24, the live Play build). All 5 flavors rebuilt
from the same tree; artifacts land in this folder once built + copied.

## What broke in 1.3.0 (Play)

In-app **feedback** (and the update check) silently failed with "No connection".
Root cause: the UI is a WebView page that was loaded from
`file:///android_asset/dist/index.html`. A `fetch()` from a `file://` origin to
`https://supportportal.gamepad.space` is blocked by modern Android WebView no
matter what settings are enabled, and the old escape hatches
(`allowUniversalAccessFromFileURLs` / `allowFileAccessFromFileURLs`) are
deprecated + flagged by Play's pre-launch security report anyway.

## Fixes in 1.3.1

1. **WebViewAssetLoader origin switch** (`MainActivity.kt`): the bundled UI is now
   served from the secure `https://appassets.androidplatform.net/assets/dist/index.html`
   origin via `androidx.webkit:webkit:1.10.0`. fetch()/CORS to the backend work
   normally (backend `/api/support/ticket` + `/api/download` already send
   `Access-Control-Allow-Origin` for any origin — verified live 2026-07-11).
   The deprecated file-URL access flags are removed.
2. **One-time localStorage migration** (`migrate.html` + `MainActivity.kt`): the
   origin switch would have wiped every user's custom pads + gyro settings
   (localStorage is per-origin). First launch after update loads a tiny
   `migrate.html` from the old `file://` origin, dumps its localStorage through
   the AndroidBridge, replays it into the new origin, then reloads. Guarded by a
   SharedPreferences flag + a 4s watchdog so a migration failure can never hang
   startup.
3. **Editor panel overflow** (`CustomPadEditor.tsx`): selecting a trigger (LT/RT)
   and ticking "Rectangular" grew the settings panel past the bottom of the
   screen — the Throttle/Normal response buttons were unreachable. The settings
   panel and Add Widget menu are now capped at the viewport height and scroll
   internally (`max-h-[calc(100vh-7.5rem)] overflow-y-auto`).
4. **CameraX 1.3.1 → 1.4.0**: clears the Play Console 16 KB page-size warning
   for `libimage_processing_util_jni.so` (this is the warning that burned
   versionCode 23).

Origin note (who wrote what): the WebViewAssetLoader approach was prototyped by
the "Antigravity" AI in `F:\hlooo-workspace` (a partial copy of the project,
2026-07-10); its two file diffs were reviewed and re-applied to the real tree.
The localStorage migration, the editor overflow fix, and the version bump were
added on top — the workspace copy had none of them and is now obsolete.

## Publish checklist (per RELEASE.md)

- [ ] **Google Play**: upload `GamepadOS-1.3.1-playstore.aab` (code 25).
- [ ] **Website (direct)**: copy `GamepadOS-1.3.1-direct.apk` to
      `website/backend/downloads/GamepadOS-1.3.1.apk`, then Admin portal →
      📦 Releases → App → Register & Activate (RELEASE_KEY). `/api/version`
      currently still advertises versionCode 22 — activating this release is
      what moves it.
- [ ] **Aptoide / Uptodown / Amazon**: upload each flavor's APK.
- [ ] On-device test: send feedback from the app → appears in admin portal
      tagged `mobile`; custom pads survive the update.
