# Release checklist — bump the version EVERY time

The in-app updater compares the running version against what `/api/version` reports.
If the version numbers don't line up, updates either never trigger or trigger forever.
**Bump every spot below, build, publish, activate.** Don't skip the "must match" group.

---

## PC Server (Windows)

### 1. Bump the version — all THREE must match (e.g. `1.1.4` → `1.1.5`)

| File | What | Why it matters |
|---|---|---|
| `apps/pc-server/server.py` | `APP_VERSION = "1.1.5"` | What each running server compares against `/api/version`. **This is the one that decides "is an update available".** |
| `apps/pc-server/installer/GamepadServer.iss` | `#define AppVersion "1.1.5"` | Shown in Add/Remove Programs + the installer. |
| `apps/pc-server/installer/GamepadServer.iss` | `VersionInfoVersion=1.1.5.0` | Stamped into the EXE's file metadata — the admin **Releases** panel auto-detects the version from this. Get it wrong and the panel shows `?`. |

> Keep the `AppId` GUID in the `.iss` **unchanged** — that's what makes it an in-place upgrade instead of a second install.

### 2. Build (PyInstaller first, then Inno)

```powershell
# from apps/pc-server
pyinstaller GamepadServer.spec          # -> dist/GamepadServer.exe
# from apps/pc-server/installer
./build-installer.ps1                    # -> Output/GamepadServer-Setup.exe
```

### 3. Checksum

The website no longer displays the installer's SHA-256 (removed 2026-07-17), so
there is nothing to paste anywhere. You do **not** need to touch `/api/version`'s
hash either — the backend hashes the active file automatically and the in-app
updater verifies against that.

### 4. Publish — copy into the backend with a UNIQUE name

```
copy Output\GamepadServer-Setup.exe  website\backend\downloads\GamepadServer-Setup-1.1.5.exe
```

Unique filename = old versions are preserved. Reusing `GamepadServer-Setup.exe` overwrites
the previous download.

### 5. Activate (this is what flips the switch for users)

Admin portal → **📦 Releases** → PC column → the new file shows as **Unregistered** →
**Register & Activate** → confirm version → enter the **RELEASE_KEY**.
(Activating deactivates the previous PC version automatically.)

### 6. Verify

- `GET /api/version` → `pc.version` is `1.1.5` and `pc.sha256` is present.
- Open a server still on the old version → **Download & install update** → confirm it
  lands on `1.1.5` and relaunches. (Do this once per release — it's the only true
  end-to-end test of the updater.)

---

## Android — 7 flavors, one release

The app has one Gradle product flavor **per distribution channel**, all sharing the
same `applicationId`, `versionCode`/`versionName`, and UI bundle:

| Flavor | Goes to | Self-updater | Build command | Output |
|---|---|---|---|---|
| `direct` | our own website | ✅ full in-app updater | `assembleDirectRelease` | `.apk` |
| `playstore` | Google Play | ❌ (Play forbids it) | `bundlePlaystoreRelease` | `.aab` |
| `aptoide` | Aptoide | ❌ | `assembleAptoideRelease` | `.apk` |
| `uptodown` | Uptodown | ❌ | `assembleUptodownRelease` | `.apk` |
| `amazonstore` | Amazon Appstore | ❌ | `assembleAmazonstoreRelease` | `.apk` |
| `indusstore` | Indus Appstore | ❌ | `assembleIndusstoreRelease` | `.apk` |
| `apkpure` | APKPure | ❌ | `assembleApkpureRelease` | `.apk` |

> ⚠️ **This table drifted once already** — `indusstore` and `apkpure` were added to
> `build.gradle.kts` while this doc still said 5 flavors, so a build that followed the doc
> shipped two channels short (caught 2026-08-17). **`productFlavors` in
> `app/build.gradle.kts` is the only trustworthy list** — check it, not this table, every
> release. Each flavor compiles in its own `DISTRIBUTION_CHANNEL` string, so the APKs are
> **not interchangeable**: renaming one store's APK for another store makes that store's
> "Update available" banner open the wrong listing.

DEF:: Only `direct` has the self-updater. On every other flavor, `startApkUpdate` and
`REQUEST_INSTALL_PACKAGES` are compiled out entirely (see
`apps/android-client/app/src/{direct,store}/` and `UpdaterBridgeBase.kt`) — Google
Play (and, out of the same caution, the other three marketplaces) forbid an app from
updating its own APK by any method other than the store's own mechanism. Their "Update
available" banner opens that store's listing page instead (see **Store listing URLs**
below) — the JS UI (`App.tsx`) already falls back to this automatically whenever
`AndroidBridge.startApkUpdate` is absent, so nothing else changes per flavor.

### 1. Bump both fields (applies to every flavor at once)

`apps/android-client/app/build.gradle.kts` → `defaultConfig`:
- `versionCode = 11`  ← **increment the integer every release** (Android compares this; the in-app updater only offers an update when the server's versionCode is higher)
- `versionName = "1.1.9"`  ← human-readable

### 2. Rebuild the web UI bundle (only if the React UI changed)

The app is a native shell hosting the `controller-ui` React app. It's shared by all 5
flavors — one build, copied in once. If you edited `apps/controller-ui/src/**`,
rebuild and copy the bundle in BEFORE building any flavor, or they all ship the old UI:

```powershell
# from apps/controller-ui
npm run build                         # -> dist/
# copy dist/* into the shell's assets (overwrite)
robocopy dist ..\android-client\app\src\main\assets\dist /MIR
```

### 3. Build each artifact you're shipping this release

```powershell
# from apps/android-client
# NOTE: there is no gradlew wrapper — Gradle 9.6.1 is invoked by absolute path.
# One invocation builds every channel (~4 min clean):
$env:JAVA_HOME    = "D:\AKHIL\HP\projects\gamepados\tools\jdk\jdk-17.0.19+10"
$env:ANDROID_HOME = "D:\AKHIL\HP\toolchain\android-sdk"
$env:PATH         = "$env:JAVA_HOME\bin;$env:PATH"
& "D:\AKHIL\HP\projects\gamepados\tools\gradle-9.6.1\bin\gradle.bat" clean `
    assembleDirectRelease `        # -> website (the ONLY self-updating build)
    bundlePlaystoreRelease `       # -> Google Play (AAB)
    assembleAptoideRelease `       # -> Aptoide
    assembleUptodownRelease `      # -> Uptodown
    assembleAmazonstoreRelease `   # -> Amazon Appstore
    assembleIndusstoreRelease `    # -> Indus Appstore
    assembleApkpureRelease         # -> APKPure
```

### 3b. Verify the artifacts before publishing anything

A green build does **not** mean it is shippable. Four checks, all cheap:

```powershell
$sdk = "D:\AKHIL\HP\toolchain\android-sdk\build-tools\36.1.0"
# 1. version stamped correctly
& "$sdk\aapt2.exe" dump badging <apk> | Select-Object -First 1
# 2. THE CRITICAL ONE — signing key must match the previous release, or every
#    existing user gets "App not installed" on update
& "$sdk\apksigner.bat" verify --print-certs <new.apk>  | Select-String "SHA-256 digest"
& "$sdk\apksigner.bat" verify --print-certs <old.apk>  | Select-String "SHA-256 digest"
# 3. the website APK must be the DIRECT flavor (store flavors have no updater)
& "$sdk\aapt2.exe" dump permissions <apk> | Select-String INSTALL_PACKAGES
# 4. after any NDK/AGP/R8 change — the JNI symbols the .so exports must still
#    match MainActivity's `external fun` names, and R8 must not have renamed them.
#    Mismatch = UnsatisfiedLinkError the instant input starts, never at build time.
#    Symbols:  unzip -p <apk> lib/arm64-v8a/libgamepad_engine.so | grep -aoE "Java_com_gamepad[A-Za-z0-9_]+"
#    Kept:     grep MainActivity app/build/outputs/mapping/directRelease/seeds.txt
```

> ⚠️ **The `direct` APK must be signed with the same `release.keystore`** as every
> prior release — the in-app updater hands it to the system installer, which
> **rejects an update signed with a different key** ("App not installed"). Same key =
> seamless update. The other four flavors go through each store's own update
> mechanism, so this constraint doesn't apply to them the same way — but keep using
> `release.keystore` for all of them too unless a store requires otherwise (Play is
> the one exception: see **Play signing** below).

### 4. Publish each artifact to its destination

- **Website** (direct only): `copy <built>.apk website\backend\downloads\GamepadOS-1.1.9.apk`, then Admin portal → **📦 Releases** → App column → **Register & Activate** → confirm version + versionCode → **RELEASE_KEY**.
- **Google Play**: upload the `.aab` in Play Console. First-time setup only: enroll in **Play App Signing** using your own upload key (`release.keystore`) — Google then holds the final distribution signing key, you keep signing uploads with your existing keystore. New personal developer accounts also need a **closed test with 12+ opted-in testers for 14 continuous days** before Play grants production access — start that clock early.
- **Aptoide / Uptodown / Amazon Appstore**: upload the respective flavor's `.apk` through each store's own developer console.

### 5. Store listing URLs (one-time, then whenever a listing moves)

Once each store listing is live, set its URL on the Railway backend so the "Update
available" banner sends users to the right place:

| Env var | Used by |
|---|---|
| `PLAYSTORE_LISTING_URL` | `playstore` flavor (defaults to the standard Play listing URL for `com.gamepad.client` if unset) |
| `APTOIDE_LISTING_URL` | `aptoide` flavor |
| `UPTODOWN_LISTING_URL` | `uptodown` flavor |
| `AMAZONSTORE_LISTING_URL` | `amazonstore` flavor |

Until an env var is set, that flavor's banner falls back to the raw APK download link
— harmless, but not what you want once the listing exists, so fill these in as each
one goes live.

### 6. Verify

`GET /api/version` → `android.version` / `android.versionCode` (and `sha256`) match.
Then, for `direct`, on a device running the OLD version: open the app → "Update
available" → **Update** → confirm the system install → tap **Open**. For the store
flavors, confirm the banner's **Update via store** button opens the correct listing
page (test with `?channel=playstore` etc. against `/api/version` directly if a
listing URL was just added).

---

## One-time prerequisites (do once, not per release)

- **`RELEASE_KEY`** must be set in the Railway backend env, or activation fails closed
  (you'll get "Invalid release key"). Use a long random string — never a personal password.
- Only the **owner** role sees the Register/Activate buttons.
- **Play App Signing**: enroll on first Play Console upload, using your own upload key
  (`release.keystore`) rather than letting Google generate one — Google then holds the
  final distribution signing key and you keep signing every upload with the same
  keystore as always.
- **Play closed testing**: new personal developer accounts need a closed test with
  12+ opted-in testers for 14 continuous days before Play grants production access —
  this has real calendar lead time, so start it well before you intend to launch.
- **Store listing URLs** (`PLAYSTORE_LISTING_URL`, `APTOIDE_LISTING_URL`,
  `UPTODOWN_LISTING_URL`, `AMAZONSTORE_LISTING_URL`): set each on the Railway backend
  as its listing goes live — see the Android section's **Store listing URLs** step.

## Quick reference — every version touchpoint

| Asset | Files to bump |
|---|---|
| PC | `apps/pc-server/server.py` (`APP_VERSION`) · `installer/GamepadServer.iss` (`AppVersion` + `VersionInfoVersion`) |
| Android | `apps/android-client/app/build.gradle.kts` (`versionCode` + `versionName`) |
| Website (PC only) | `website/frontend/index.html` (`.dl-trust` SHA-256) |
