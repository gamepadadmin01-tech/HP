---
name: reference-release-checklist
description: "Every version touchpoint for a GamepadOS release, the 5 Android flavors, and the activation step everyone forgets"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 04fa20ba-c801-4536-9b63-6783224ac0d6
  modified: 2026-08-13T18:50:35.289Z
---

Distilled from `projects/gamepados/RELEASE.md`. The in-app updater compares the running version
against `/api/version`; if the numbers don't line up, updates either never fire or fire forever.

## Every version touchpoint — bump ALL of them

| Asset | Files |
|---|---|
| PC | `apps/pc-server/server.py` (`APP_VERSION`) · `installer/GamepadServer.iss` (`AppVersion` **and** `VersionInfoVersion`) |
| Android | `apps/android-client/app/build.gradle.kts` (`versionCode` **and** `versionName`) |

`APP_VERSION` is the one that decides "is an update available". `VersionInfoVersion` is what the
admin Releases panel auto-detects — get it wrong and the panel shows `?`. **Keep the `AppId` GUID
in the `.iss` unchanged** — that is what makes it an in-place upgrade rather than a second install.

## Android — 7 flavors, one release

`direct` (own website, **the only one with the in-app updater**), `playstore` (.aab),
`aptoide`, `uptodown`, `amazonstore`, `indusstore`, `apkpure`. All share one `applicationId`,
version, and UI bundle.

⚠️ **`indusstore` and `apkpure` were added after RELEASE.md was written** — that doc still says 5
and a build that follows it silently ships two channels short. `productFlavors` in
`app/build.gradle.kts` is the only trustworthy list; check it every release. Each flavor sets its
own `DISTRIBUTION_CHANNEL`, so they are NOT interchangeable — never rename one store's APK for
another store, or that store's update banner points at the wrong listing.

On every non-direct flavor `startApkUpdate` and `REQUEST_INSTALL_PACKAGES` are compiled out —
Play forbids self-updating APKs. Those flavors' banners open the store listing instead, driven by
`PLAYSTORE_LISTING_URL` / `APTOIDE_LISTING_URL` / `UPTODOWN_LISTING_URL` /
`AMAZONSTORE_LISTING_URL` on the Railway backend. `playstore` additionally uses **Google Play
In-App Updates** rather than the website manifest.

⚠️ **The `direct` APK must be signed with the same `release.keystore` as every prior release** —
the system installer rejects an update signed with a different key ("App not installed").

## The step that is always forgotten

Copying an APK/exe into `website/backend/downloads/` **does nothing on its own.** You must then:

> Admin portal → 📦 Releases → the file shows *Unregistered* → **Register & Activate** → confirm
> version → enter `RELEASE_KEY`

That is what flips `/api/version` and starts offering the update. Activating deactivates the
previous version automatically. Only the **owner** role sees the buttons.

**Check the admin portal before claiming a release is or isn't live.** These notes twice asserted
that 1.3.26 and PC 2.0.1 had been left unactivated; the portal showed both **ACTIVE** on
2026-08-17. The Releases panel is the source of truth, not memory.

⚠️ **Before building, check Play Console → App bundle explorer for the highest versionCode used.**
A code is consumed permanently the moment any track sees it — even a draft upload that errored.
51 was burned this way, so 1.3.27 was never shippable and had to be rebuilt as 1.3.28 / code 52.

Also: use a **unique filename** per version in `downloads/`, or the previous download is
overwritten.

## Build order — the trap

The Android app is a shell hosting the React UI. **Rebuild and copy the bundle BEFORE building any
flavor**, or all five ship the previous UI:

```
npm run build            # in apps/controller-ui
robocopy dist ..\android-client\app\src\main\assets\dist /MIR
```

Full commands and toolchain paths: `context/REBUILD.md`. Regression sweep afterwards:
`projects/gamepados/docs/REGRESSION_CHECKLIST.md`.

## One-time prerequisites

- `RELEASE_KEY` set in the Railway backend, or activation fails closed.
- **Play App Signing** — enrolled using the existing `release.keystore` as the upload key, so
  Google holds the distribution key and uploads keep using the same keystore.
- Play production access needed 12+ testers × 14 continuous days — **cleared 2026-08-12**, see
  [[project_play_production_access]].

Related: [[project_grx_crypto]], [[project_downloads_feedback]], [[feedback_no_auto_push]].
