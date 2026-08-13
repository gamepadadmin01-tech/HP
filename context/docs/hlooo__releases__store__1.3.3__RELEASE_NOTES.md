# GamepadOS Android 1.3.3 (versionCode 27) — 2026-07-12

Bug-hunt release: an 8-agent audit of the whole codebase surfaced ~20 real
defects; the confirmed ones were fixed and folded into this build. No new
features. All 5 flavors in this folder; direct APK also staged at
website/backend/downloads/GamepadOS-1.3.3.apk.

## App fixes (controller-ui + android-client)

- **Update banner reliability.** The update checker is mounted twice (dashboard
  banner + About card); both wrote the same native callback globals and each
  unmount deleted them, so download progress could freeze and the Play update
  answer could be lost. Callbacks now fan out to a subscriber set.
- **Preset customization no longer lost.** Button remaps and dragged widget
  positions on the built-in presets are now saved to localStorage (were reset on
  every app restart).
- **Migration hardening.** The one-time localStorage migration reloads
  unconditionally even if a write throws, so the input bridge always initializes.
- **WebView locked to our origin.** External navigations open in the real browser
  instead of inheriting the privileged AndroidBridge.
- **Wi-Fi lock leak** on a failed connect is released (was pinning the radio in
  low-latency mode until the process died).
- **Play interrupted-update recovery**: an immediate update interrupted by
  backgrounding can now be resumed (banner reappears on foreground).
- Minor: false "won't register in games" warning on L-Mode/R-Mode editor widgets
  fixed; sliders ignore drags that didn't start on them; network-details JSON is
  escaped against a hostile QR IP.

## Backend / admin portal (deployed separately from the app)

- Admin SSE stream re-validates its session every 25s and closes on logout /
  deactivation, so a stream can't outlive the 20-minute idle timeout.
- Release activation is atomic + validates versionCode/file — a bad activation
  can no longer leave the app with no active release (which dropped everyone to an
  ancient fallback + 404 download).
- Pre-existing 30-day admin sessions are clamped to the idle window.
- Public ticket endpoint gets length caps + a per-IP rate limit.
- Quill reply-editor bugs fixed (canned replies insert, live refresh no longer
  wipes a reply mid-typing, no double-send, attach button only where it works).

## Docs

- Study Plan markdown corrected (versions, download routes, 5-flavor build).
- ERRATA_2026-07-12.md added for the generated PDFs.

## Publish checklist

- [ ] Play: upload `GamepadOS-1.3.3-playstore.aab` (code 27) — supersedes 26 if
      it was uploaded.
- [ ] Website (direct): push, then Register & Activate `GamepadOS-1.3.3.apk`.
- [ ] Aptoide / Uptodown / Amazon: upload each flavor's APK.
- [ ] Backend + admin changes go live with the website push (Railway).
