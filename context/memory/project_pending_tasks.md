---
name: project-pending-tasks
description: "GamepadOS open task list as of 2026-08-25 — what is in flight, what is deferred, what is quietly broken"
metadata: 
  node_type: memory
  type: project
  originSessionId: 57807460-0b48-4fba-a043-7e382c522c35
  modified: 2026-08-25T11:50:45.331Z
---

Snapshot **2026-08-25**. Akhil asked for this before a planning conversation that evening.
Verify against the repo before acting — this is a point-in-time list.

## ✅ Play Billing 8+ deadline — FIXED, built as 1.4.1 (2026-08-25)

Play flagged 1.4.0 on 7.1.1; every update from **31 Aug 2026** is rejected below Billing 8.0.0.
**Resolved same day.** 1.4.0/54 was already uploaded so 54 is burned → shipped as
**1.4.1 / versionCode 55**, staged at `releases/store/1.4.1/` with `PUBLISH-STEPS.md`.
**Akhil still has to upload it.**

- `billing-ktx:7.1.1` → **9.1.0** (current stable; v9's extras already met — targetSdk 36 >= 35,
  androidx.core 1.13.1 >= 1.9). Went past the 8.0.0 floor so it is not due again in months.
- **The only source change PBL 8 forced:** `queryProductDetailsAsync`'s callback now yields a
  **`QueryProductDetailsResult`**, not a bare `List<ProductDetails>` — read
  `.productDetailsList` (and `.unfetchedProductList` for per-product failure reasons, where
  before unfetchable products were silently omitted). One line in `BillingBridge.kt`.
- Nothing else needed touching: already on `PendingPurchasesParams` + `QueryPurchasesParams`, and
  none of the APIs 8.0.0 deleted were ever used (`queryPurchaseHistory`, `querySkuDetailsAsync`,
  no-arg `enablePendingPurchases`, the skuType `queryPurchasesAsync` overload).
- Verified: builds clean, `QueryProductDetailsResult` present in `classes.dex`, code 55 /
  name 1.4.1 in the manifest, signing key identical, UI bundle byte-identical to 1.4.0, 13 JNI
  symbols unchanged. **Not yet device-tested.**
- **Lesson worth keeping:** do SDK-compliance bumps while billing is dark — no service-account
  JSON means nothing is purchasable, so a purchase-flow regression cannot reach a paying customer.

## 🔴 In flight right now — 1.4.0 to Play closed testing

He is uploading the AAB himself. Artifact fully verified, see [[project_play_closed_test_140]].

- [ ] **App access test account** — the likeliest rejection and it is SILENT. 1.4.0 requires
      sign-in; a reviewer cannot get past the first screen. Play Console → App content → App
      access → "All or some functionality is restricted" + real working credentials.
- [ ] Upload `mapping-playstore-1.4.0.txt` as the deobfuscation file, or every crash report is
      unreadable R8 noise
- [ ] Confirm Play accepts **versionCode 54**. 51/52/53 are burned. If refused, bump in
      `build.gradle.kts` **and add a line to the history comment above it** — that comment is the
      only record of which codes are gone.
- [ ] Device test through the sign-in wall before promoting anywhere
- [ ] Checklist lives with the artifact: `releases/store/1.4.0/PUBLISH-STEPS.md`

## 🟡 Deferred by decision — not forgotten

- **Launch bonus (24h gift) → the release AFTER 1.4.0.** Decided 2026-08-25.
  `backend/grant-launch-bonus.js` is written, correct, and **wired to nothing** — no import, no
  npm script, no route, no timer. Manual one-shot, `--apply` required. **There is no claim
  endpoint or button anywhere**; the gift is pushed, never pulled. Deferring costs testers
  nothing: the script selects `createdAt < now-at-run-time`, so anyone who exists when it finally
  runs is swept in. Release notes must NOT mention it until it has run, and must then say it
  appears automatically — never "claim it".
- **Wheel mode 900°/720°** — committed to a customer, build after 1.4.0. [[project_wheel_mode_900]]
- **Website Register & Activate for 1.4.0** — deliberately held until device-tested.
- **The other 6 flavour APKs** — not built for 1.4.0 (Play only, on purpose).
- **Play Billing Part B** — `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` unset on Railway, so the purchase
  surface is hidden by design. Closed testing runs fine dark. Runbook: `context/PLAY_ACTIVATION.md`.
  Play Console products (THREE_DAY, LIFETIME, QUARTERLY) **unverified** — cannot be checked locally.
- **PC server 2.1.0** — built 2026-08-18, not released. Ships **deliberately inert** (no
  `SESSION_TICKET_PUBLIC_KEY`) so it can spread before the app requires it. Enabling enforcement
  needs both halves, backend first. [[project_rust_server_v2]]

## 🟠 Quietly broken — from `context/HP_INTEGRITY_AUDIT_2026-08-21.md`

- **`tools/regression-check.sh` cannot run at all** — CRLF line endings, fails with
  `$'\r': command not found`. This is the safety net the checklist says to run after every
  significant change, and it is dead. Fix: `sed -i 's/\r$//' <path>`.
- **`apps/pc-server/driver/install-driver.bat` has LF endings** — `.bat` must be CRLF. Contains a
  multi-line `if exist (...)` block, exactly what `cmd.exe` misparses. **Ships to customers.**
- **`CLAUDE.md` still warns the HP repo is "NOT pushed"** — untrue since the audit; remote exists,
  0 unpushed commits. A false alarm every session.
- Low: strip the UTF-8 BOM from `build_apk.bat` (tested harmless today); delete the 0-byte
  `apps/controller-ui/src/styles/globals.css`.

## ⚪ Uncommitted in the working tree

Nothing is committed yet. Modified: `context/README.md`, 5 memory files, `RELEASE.md`.
Untracked: `context/HP_INTEGRITY_AUDIT_2026-08-21.md`, `context/PLAY_ACTIVATION.md`,
4 docs in `docs/research/` (audit round 2, backend review, billing blueprint, performance audit),
plus `WHEEL_MODE_900_DEGREE.md` and `releases/store/1.4.0/PUBLISH-STEPS.md`.
**He pushes; never `git push`** — [[feedback_no_auto_push]].

## 🔵 Worth raising, no decision yet

- **`controller-ui` has no test framework** — no vitest, no jest. Noted during the linkState work.
- **Wheel mode blocker:** if the phone IS the wheel, its screen is unreachable → throttle/brake
  cannot be on-screen buttons. Needs gyro-throttle or a second device. Product call.
- **30-day Google refund window** is the real deadline on the reconciliation sweep once Play
  billing goes live — refunds older than 30 days become invisible.
- **Uptodown listing is 404/gone**, removed from the website 2026-08-23.
