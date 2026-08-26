---
name: project-play-closed-test-140
description: "1.4.0 (subscriptions/billing build) going to Google Play CLOSED TESTING — AAB verified ready 2026-08-25; Akhil uploads, Claude never does"
metadata: 
  node_type: memory
  type: project
  originSessionId: 57807460-0b48-4fba-a043-7e382c522c35
  modified: 2026-08-25T09:07:53.730Z
---

**2026-08-25 — Akhil is uploading 1.4.0 to Google Play closed testing himself.** This is the
**subscriptions/billing build**. My job is to have the artifact verified and ready; **he does the
upload**. Same spirit as [[feedback_no_auto_push]] — prepare, don't publish.

## The artifact is verified ready — all checks passed 2026-08-25

`projects/gamepados/releases/store/1.4.0/`
- `GamepadOS-1.4.0-playstore.aab` (3.2 MB, built 2026-08-23 23:05)
- `mapping-playstore-1.4.0.txt` (12.6 MB) — **must be uploaded as the deobfuscation file**,
  or every crash report from this build is unreadable R8 noise

| Check | Result |
|---|---|
| UI bundle in AAB vs `assets/dist/index.html` | **byte-identical** (sha256 `37002c33…`) — so the sign-in-wall fixes `004beeb` + `26d5368` ARE in it |
| versionName / versionCode **inside the bundle** | `1.4.0` / **54** (protobuf `1a 02 35 34`), not just what gradle claims |
| Flavour | `com.android.vending.BILLING` present, `REQUEST_INSTALL_PACKAGES` absent → genuinely `playstore`, not a mislabelled `direct` |
| Upload key vs live 1.3.28 AAB | **identical** — SHA256 `5B:55:37:C6:37:5E:23:73…` |
| Native libs | arm64-v8a, armeabi-v7a, x86_64 all present |
| targetSdk | 36 |

**Method worth reusing:** an AAB manifest is *protobuf*, not binary XML, so `aapt2 dump badging`
does not work on it. Read `base/manifest/AndroidManifest.xml` with .NET `ZipFile` and scan printable
strings; `versionCode` is stored as the ASCII string right after the attribute name. Compare upload
keys by extracting `META-INF/*.RSA` from both bundles and running the pinned JDK's `keytool
-printcert`.

## Two things that will bite on upload — read before he clicks

1. **App access / test account is the likeliest rejection, and it is silent.** 1.4.0 requires an
   account to play. A Google reviewer simply cannot get past the first screen. Play Console → App
   content → **App access** → "All or some functionality is restricted" → give real working
   credentials on the live backend **plus** a note that a PC running GamepadServer on the same
   Wi-Fi is needed to pair, and that UI/plans/settings can be reviewed without one.
2. **versionCode 54 — 51, 52 and 53 are already burned.** A code is consumed permanently the instant
   any track sees it, including a draft that errored. If Play refuses 54, bump it in
   `build.gradle.kts`, rebuild, **and add a line to the running history comment above it** saying
   which number was burned and why — that comment is the only record.

Also: do not ship the phrase *"world's no.1 fastest gamepad"* in listing copy (unsubstantiated
superlative → Play policy breach).

## Billing is deliberately dark, and that is not a bug

The purchase surface is hidden because `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` is unset on Railway, so
`/api/billing/plans?channel=playstore` reports `purchasable: false`. **Closed testing can proceed
with billing dark.** Switching it on later needs **no app update** — the client renders whatever
the API says. Full runbook: `context/PLAY_ACTIVATION.md` Part B.

Related: [[project_play_production_access]] (production access unlocked 2026-08-12),
[[reference_release_checklist]], [[project_grx_crypto]].
