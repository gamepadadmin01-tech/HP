# GamepadOS Android 1.3.5 (versionCode 29) — 2026-07-12

Follow-up to 1.3.4, fixing issues a focused 4-agent audit found in the code
written earlier the same day. No new features.

## App fixes

- **Feedback tray always opens fresh.** Opening "Submit feedback" now resets the
  form every time. Previously, reopening right after a successful send (or after
  dismissing mid-send) could show the already-sent message pre-filled — a tap of
  Send then submitted a duplicate — or a late timer could blank the fields out
  from under you.
- **Foreground update re-check no longer blanks the banner.** Returning to the
  app while an update is available (or an in-app download is running) no longer
  briefly hides the banner / clobbers live download progress.
- **WebView origin guard hardened (security).** The navigation allow-list now
  matches the parsed host exactly, so a lookalike URL like
  `https://appassets.androidplatform.net@evil.com/` can no longer load inside the
  privileged WebView and inherit the AndroidBridge.

## Backend / admin (deployed separately)

- Release activation validates `versionCode` as a real integer (a fat-fingered
  "1.3.5" no longer silently stores versionCode 1 and breaks the update manifest).
- Admin reply editor is focused only once per ticket open, so a background
  refresh no longer steals your cursor out of the search box.
- Internal-note save is guarded against a double-Enter double-save.

## Publish checklist

- [ ] Play: upload GamepadOS-1.3.5-playstore.aab (code 29).
- [ ] Website (direct): push, then Register & Activate GamepadOS-1.3.5.apk.
- [ ] Aptoide / Uptodown / Amazon: upload each flavor's APK.
