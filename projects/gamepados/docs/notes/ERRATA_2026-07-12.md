# Textbook / notes errata — 2026-07-12 (updated 2026-07-17, extended 2026-07-25)

> **2026-07-25 — corrections 12–43 live elsewhere.** The account + layout-sync work
> of 2026-07-24/25 invalidated a further 32 passages in
> `GamepadOS_The_Complete_Guide.pdf`. Rather than duplicate them here, they are the
> **Errata** chapter at the end of
> `GamepadOS_Guide_Part_VI_Accounts_and_Sync.md` / `.pdf` in this folder, which
> also documents the new material itself (accounts, sync, the storage layer,
> content-addressed sharing, and War Stories 4–7). Corrections 1–11 below remain
> valid. Note that correction #1 (the `appassets.androidplatform.net` origin) is
> load-bearing for the new Part's explanation of why user sessions use bearer
> tokens rather than cookies.

The PDFs in this folder were generated on 2026-07-04/07, before several code changes.
The `.md` source (`F:\hlooo\docs\notes\GamepadOS_Study_Plan.md`) has been corrected in
place; the PDFs are binary and can't be edited, so apply the corrections below when
reading them (regenerate the PDFs from the fixed `.md` to clear them permanently).

> Path note (2026-07-16 reorg): these notes previously lived in `F:\hlooo\NOTES\` and
> `F:\hlooo\high professional notes\`. Both folders were merged into `F:\hlooo\docs\notes\`
> — see `F:\hlooo\MOVE_LOG.md`.

## GamepadOS_The_Complete_Guide.pdf

1. **How the app loads its UI (pages ~40 and ~68).** The guide says the WebView
   loads `file:///android_asset/dist/index.html` and explains
   `allowFileAccessFromFileURLs` / `allowUniversalAccessFromFileURLs` as why CORS
   works. **Now stale.** The bundled UI is served by `androidx.webkit.WebViewAssetLoader`
   from the secure origin **`https://appassets.androidplatform.net/assets/dist/index.html`**
   (`APP_URL` in `MainActivity.kt`); the file-URL access flags were removed. A
   `file://` page is used only once, briefly, by `assets/migrate.html` to carry the
   old origin's `localStorage` (custom pads + gyro settings) into the new origin.
   *Reason for the change:* modern WebView blocks `fetch()` from a `file://`
   origin, which had silently broken in-app feedback + the update check.

2. **Current shipped versions (pages 1, 26, 95, 177, 184).** The guide presents
   **Android 1.3.0 / versionCode 22** as "the current shipped engine." As of
   2026-07-12 that is the **2026-07-04 snapshot**, not current. Current: website
   release **Android 1.3.1 (versionCode 25)**, Google Play **1.3.0 (versionCode 24)**,
   newest built **1.3.2 (versionCode 26)**. **PC server 1.1.16 is still correct.**

3. **The self-updater and REQUEST_INSTALL_PACKAGES (pages ~75–77).** The guide
   describes a single manifest with `REQUEST_INSTALL_PACKAGES` "for the one-click
   updater" and names `app/build/outputs/apk/release/app-release.apk` as the
   artifact `beginApkUpdate` downloads. **Now stale.** Since the 5-flavor split,
   the self-updater + that permission are compiled into the **`direct` flavor
   only**. The **`playstore`** flavor updates through **Google Play In-App Updates**
   (its own `UpdaterBridge`), and **aptoide / uptodown / amazonstore** show a
   store-listing banner. Artifacts are flavor-qualified — the website APK is
   `app-direct-release.apk` from `assembleDirectRelease`; there is no single
   `app-release.apk`.

## GamepadOS_Complete_Book.pdf  (and GamepadOS_Study_Plan.md, now fixed)

4. **Code baseline note (page ~2 / intro).** Says content reflects the code "as of
   2026-07-01 (… the v1.2.0 / v1.1.6 release)." Wrong on two counts: around
   2026-07-01 the code was already ~Android 1.2.9 / PC 1.1.15, and the current
   live set is **Android 1.3.1 (code 25) / PC 1.1.16** with the 5 Gradle flavors.

5. **Download-link exercise (Phase 6).** Says `[data-dl="android"]` points at
   `<API_BASE>/downloads/GamepadOS.apk` and that the static URLs reference a fixed
   `GamepadServer-Setup.exe`. **Now stale.** The buttons use the tracked routes
   **`/api/download/app`** and **`/api/download/pc`** (unique-download counter,
   added 2026-06-28), which redirect to the currently-**activated, version-unique**
   file from the admin Releases panel (e.g. `GamepadOS-1.3.1.apk`).

6. **Android release step (Phase 10).** Says "build the signed release APK
   (`gradlew assembleRelease`)" — one APK. **Now stale** per correction #3: use the
   flavor-qualified targets (`assembleDirectRelease`, `bundlePlaystoreRelease`,
   `assembleAptoideRelease`, `assembleUptodownRelease`, `assembleAmazonstoreRelease`).

## GamepadOS_Interdisciplinary_Analysis.pdf

No specific factual errors were flagged in this pass; if it references the file://
load origin, versions, or a single-APK build, apply corrections #1–#3/#6 above.

---

# 2026-07-17 re-verification (applies to ALL PDFs; the .md source is fixed in place)

The `.md` source was re-verified against the live code and production `/api/version`
on 2026-07-17 and corrected in place. When reading any of the PDFs, additionally
apply:

7. **Versions (supersedes correction #2).** Live on the website (verified against
   production `/api/version`): **Android 1.3.21 (versionCode 45)** and
   **PC server 1.1.17**. Google Play still carries 1.3.0 (versionCode 24). The
   errata's own earlier note "PC server 1.1.16 is still correct" is itself now stale.

8. **Distribution flavors: 7, not 5 (extends correction #3).** `build.gradle.kts`
   now defines **direct / playstore / aptoide / uptodown / amazonstore /
   indusstore / apkpure**. Store-facing artifact targets include
   `assembleIndusstoreRelease` and `assembleApkpureRelease`.

9. **Route inventory grew (~53 routes, was "~38").** New since the PDFs were
   generated: `POST /api/pads/share` + `GET /api/pads/:code` (controller-layout
   sharing by 6-char code, app 1.3.12), `GET /api/download/:asset` (tracked
   download redirect), `POST /api/track/uptodown`, the admin **Releases** panel
   routes (`GET/POST /api/admin/releases`, `POST …/releases/:id/activate`,
   `POST …/releases/register-activate`), `GET /api/admin/downloads`,
   `GET /api/admin/analytics` + the `/admin/analytics` page, and
   `GET/PUT /api/admin/maillist`. All `server.js` line numbers in the PDFs have
   drifted — see the regenerated Reference Table A in the fixed `.md`.

10. **Prisma models.** The schema now also has `Download`, `Release`, and
    `SharedPad` (all standalone, no relations) beyond the original six models.

11. **USB transports.** Where the PDFs say "two transports (UDP and AOA)": there
    are three paths — UDP (Wi-Fi / USB-tether), the USB-debugging **WebSocket
    bridge** (`adb reverse` to `localhost:7777`, `start_ws_bridge` in `server.py`),
    and AOA direct-USB ("Plan B" in `MainActivity.kt`, ~1–2 ms). Since 1.3.9 a
    wireless connect no longer overwrites the saved Wired-mode preference.
