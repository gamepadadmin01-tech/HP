# GamepadOS Android 1.3.2 (versionCode 26) — 2026-07-11

Follow-up to 1.3.1 (code 25, activated on the website earlier today). One fix:
**the Play Store build now takes updates from Google Play itself, not from the
website's version manifest.**

## The bug (reported after 1.3.1)

The playstore flavor decided "update available" by comparing against
`/api/version` — the WEBSITE's active release. The moment a new version was
activated in the admin portal, Play users saw the update banner, but the button
sent them to the Play listing, where the new version often isn't published yet
(Play review/propagation lag). Result: a banner that dead-ends.

## The fix

- New playstore-only `UpdaterBridge` (`app/src/playstore/java`) built on
  **Google Play In-App Updates** (`com.google.android.play:app-update:2.1.0`):
  `checkPlayUpdate()` asks Play's `AppUpdateManager` whether an update is
  actually available on Play; `startPlayUpdate()` hands the whole
  download+install to Play's full-screen immediate-update flow.
- `UpdateChecker` (App.tsx) is channel-aware: `playstore` → native Play check
  (website manifest never consulted); `direct` → unchanged self-updater;
  `aptoide`/`uptodown`/`amazonstore` → unchanged listing-page banner (their
  `?channel=` store URLs went live on the backend today).
- Sideloaded copies of the playstore flavor (no Play install record) simply
  never show a banner — the Play API failure is treated as "no update".
- Button label on Play builds: "Update via Google Play".

Verified: tsc clean; playstore JS path exercised in browser with a stubbed
bridge (checkPlayUpdate called instead of the manifest fetch, correct banner
text + button); Kotlin compiled in the release build.

## Publish checklist

- [ ] **Google Play**: upload `GamepadOS-1.3.2-playstore.aab` (code 26). If the
      1.3.1/code-25 AAB was already uploaded, 26 simply supersedes it.
- [ ] **Website (direct)**: `GamepadOS-1.3.2.apk` staged in backend/downloads →
      push → Register & Activate (moves /api/version off 25).
- [ ] **Aptoide / Uptodown / Amazon**: upload each flavor's 1.3.2 APK.
- [ ] On a Play-installed device: banner must appear ONLY once 1.3.2 is live on
      Play, and the Update button must open Play's own update screen.
