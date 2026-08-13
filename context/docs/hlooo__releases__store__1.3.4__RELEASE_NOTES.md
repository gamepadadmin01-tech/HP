# GamepadOS Android 1.3.4 (versionCode 28) — 2026-07-12

Small UX release on top of 1.3.3. Feedback section redesigned.

## What changed

- **Feedback redesign (About tab).** The always-open form is replaced by two
  buttons: **Submit feedback** opens a slide-up tray with the email + message
  form; **Contact us** opens the website contact page
  (https://gamepad.space/contact.html) in the browser.
- **Live character hint.** The send button previously looked "dead" because it
  stays disabled until the message is 10+ characters — with no explanation. The
  tray now shows a live hint ("Write at least 10 characters" / "N more
  characters" / "Message looks good") and an email-validity hint, so it's always
  clear why send is disabled.

Feedback still posts to /api/support/ticket (source=mobile) exactly as in 1.3.3;
only the presentation changed.

## Publish checklist

- [ ] Play: upload GamepadOS-1.3.4-playstore.aab (code 28).
- [ ] Website (direct): push, then Register & Activate GamepadOS-1.3.4.apk.
- [ ] Aptoide / Uptodown / Amazon: upload each flavor's APK.
