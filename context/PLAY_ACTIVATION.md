# Google Play — activating billing, and shipping 1.4.0

Written 2026-08-23. Two separate jobs that are easy to confuse:

- **Part A — publish 1.4.0 to Play.** The AAB is built and staged. This is a normal release.
- **Part B — switch Play Billing on.** All the code exists on both sides. One environment
  variable is missing, and until it is set the Play build shows plan status with **no buy
  button** — deliberately, not by accident.

They are independent. 1.4.0 can go live with billing still dark, and billing can be switched on
afterwards **without another app update** — the client renders whatever `/api/billing/plans`
says is purchasable.

---

## Where things actually stand

| | State |
|---|---|
| Play listing | **Live** — `com.gamepad.client`, serving **1.3.28** (verified 2026-08-23) |
| Production access | Unlocked 2026-08-12 |
| Play App Signing | Already enrolled (first upload) |
| 1.4.0 AAB | **Built and staged** — `projects/gamepados/releases/store/1.4.0/` |
| Play Billing — app side | **Complete.** `src/playstore/.../BillingBridge.kt`, 272 lines |
| Play Billing — server side | **Complete.** `/api/billing/google/purchase` + RTDN webhook |
| Play Billing — credentials | ❌ **`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` is not set on Railway** |
| Play Console products | ❓ Unverified — cannot be checked from here |
| Uptodown listing | **404 / gone.** Removed from the website 2026-08-23 |

---

## ⚠️ Read these three before uploading

### 1. 1.4.0 was deliberately held back

`app/build.gradle.kts` says so in its own words, next to `versionCode = 54`:

> Held back from Register & Activate deliberately — see BILLING_DECISIONS.md and RELEASE.md —
> until it has been tested through, on real hardware, start to finish.

That note is about the **website** Register & Activate step, but the reason applies to Play too:
1.4.0 is the build that introduced the billing system, the daily quota and the sign-in wall.
**Confirm the device test happened before uploading.** If it has not, upload to a closed or
internal track first, not production.

### 2. The sign-in wall will get 1.4.0 rejected unless you give Google a test account

This is the single most likely rejection, and it is silent — the reviewer simply cannot get past
the first screen. 1.4.0 requires an account to play (commits `004beeb`, `26d5368`).

**Play Console → App content → App access → "All or some functionality is restricted"**, then add:

- a real working email + password on the live backend (make one just for this)
- a one-line instruction: *"Sign in with these credentials on first launch. A PC running
  GamepadServer on the same Wi-Fi is required to pair; the app's UI, plans and settings can be
  reviewed without one."*

Google reviewers do not have a PC running your server, so say plainly what can and cannot be
exercised without one. Leaving App access set to "no restrictions" while the app demands a login
is the classic cause of a rejection that reads as inexplicable.

### 3. Do not ship the phrase "world's no.1 fastest gamepad"

From `docs/research/BILLING_DECISIONS.md` — unsubstantiated superlatives breach Play's listing
policy. Check the store description text before submitting.

---

## Part A — publish 1.4.0

### A1. The artifact

Already built and staged:

```
projects/gamepados/releases/store/1.4.0/GamepadOS-1.4.0-playstore.aab      (3.2 MB)
projects/gamepados/releases/store/1.4.0/mapping-playstore-1.4.0.txt        (12.6 MB)
```

Verified inside the bundle: package `com.gamepad.client`, versionName `1.4.0`, the
`com.android.vending.BILLING` permission (so it is genuinely the `playstore` flavour, not a
mislabelled `direct` build), and the current UI bundle.

To rebuild it:

```bash
cd D:/AKHIL/HP/projects/gamepados/apps/android-client && JAVA_HOME="D:/AKHIL/HP/projects/gamepados/tools/jdk/jdk-17.0.19+10" ANDROID_HOME="D:/AKHIL/HP/toolchain/android-sdk" "D:/AKHIL/HP/projects/gamepados/tools/gradle-9.6.1/bin/gradle.bat" bundlePlaystoreRelease
```

**Before any rebuild**, copy `apps/controller-ui/dist/index.html` into
`apps/android-client/app/src/main/assets/dist/` or the build silently ships the previous UI.
(Checked 2026-08-23: the two were identical, so this build is correct.)

### A2. versionCode

**54.** Codes **51, 52 and 53 are burned** — a versionCode is consumed permanently the instant
any Play track sees it, including a draft upload that errored. 53 is the live 1.3.28.

If Play refuses 54 as already used, **bump `versionCode` in `build.gradle.kts`, rebuild, and add
a line to the running history comment above it** saying which number was burned and why. Never
reuse one, and never quietly renumber without the note — that history is the only record of
which codes are gone.

### A3. Upload

1. Play Console → **Production** (or a closed track first, per warning 1) → **Create new release**
2. Upload `GamepadOS-1.4.0-playstore.aab`
3. Upload `mapping-playstore-1.4.0.txt` as the deobfuscation file — without it every crash report
   from this build is unreadable R8-minified noise
4. Release notes — 1.4.0 is a user-visible feature release. Cover: plans and playtime, the
   account requirement, and the battery work from 1.3.29 (adaptive tick, locks released on
   pause, screen-gated gyro loop)
5. Review the pre-launch report before rolling out

### A4. Also required by Play, if not already current

- **Data safety** — 1.4.0 collects an email address and account identifier. The declaration must
  say so, and must match `/privacy` on the website
- **Privacy policy URL** — `https://gamepad.space/privacy`
- **Target API level** — `targetSdk = 36`, current

### A5. After it is live

- Update the website's advertised version if the direct APK is also being refreshed — see
  `RELEASE.md`, the Register & Activate step, which is the one that keeps getting missed
- The `playstore` flavour has `SELF_UPDATE_ENABLED = false` by design. Play delivers updates.
  Do not "fix" this

---

## Part B — switch Play Billing on

Nothing here needs an app update. The gate is server-side: `play.isConfigured()` returns false
while the service-account JSON is unset, so `/api/billing/plans?channel=playstore` reports
`purchasable: false` and the app hides the entire purchase surface. Setting the variable reveals
it, live.

### B1. Create the products in Play Console

| Plan code | Type | Notes |
|---|---|---|
| `THREE_DAY` | In-app product (one-time) | 72 hours, unlimited |
| `LIFETIME` | In-app product (one-time) | never expires |
| `QUARTERLY` | **Subscription** + base plan | 3 months, 6h/day |

Note each product id, and the base plan id for the subscription.

### B2. Service account

1. Google Cloud Console → the project linked to Play → **Enable the Google Play Android
   Developer API**
2. Create a **service account**, create a **JSON key**, download it
3. Play Console → **Users and permissions** → invite the service account's email → grant
   **View financial data** and **Manage orders and subscriptions**
4. Permissions take a few minutes to propagate; a call made too early fails with a permission
   error that looks like a bad key

### B3. Railway environment

```
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = <the whole JSON, or its base64, or a path to it>
GOOGLE_PLAY_PACKAGE_NAME         = com.gamepad.client
```

`billing/providers/googleplay.js` accepts raw JSON, base64, or a file path — it tries them in
that order. Railway env vars handle multi-line JSON badly, so **base64 is the safer choice**.

### B4. Point the Plan rows at the Play products

Set `playProductId` (and `playBasePlan` for `QUARTERLY`) on each Plan row via the admin portal's
Billing panel. Without these the app cannot query `ProductDetails` and renders no price.

### B5. Real-time developer notifications

Play Console → **Monetization setup** → set a Pub/Sub topic, then create a **push subscription**
on that topic pointing at:

```
https://supportportal.gamepad.space/api/webhooks/google/rtdn
```

The handler already exists. This is what keeps a Play subscription's renewals, cancellations and
refunds mirrored into our entitlements.

### B6. Verify

```bash
curl -s "https://supportportal.gamepad.space/api/billing/plans?channel=playstore" | head -c 400
```

`purchasable` flips from `false` to `true` once the service account is accepted. Then buy each
plan once with a Play **licence tester** account — a real purchase that costs nothing — and
confirm the entitlement appears on the account page.

---

## Things that are true on Play and NOT on the website

- **Play Billing is mandatory** for digital goods in the Play build. Razorpay is compiled out of
  the `playstore` flavour, and the Play build must never link to the website checkout. A single
  "manage your plan at gamepad.space" is a policy breach.
- **The upgrade credit does not exist on Play.** Play charges the fixed SKU price set in Play
  Console; the server cannot discount it. So the "₹99 off Lifetime" upgrade is **direct-channel
  only** (`allowCredit: channel === 'direct'` in `billing/routes.js`). The *blocking* rules —
  a Lifetime owner is sold nothing, no cross-buying 3-Day and Quarterly — apply everywhere.
- **Cancelling a Play subscription is done in Play**, not by us. `/api/billing/subscription/cancel`
  answers 409 `external_subscription` and tells the user where to go, because we hold no mandate
  for it.
- Buying on the website avoids Play's 15–30% cut *and* is the only place the upgrade discount
  exists. That is a legitimate reason to prefer it — but the Play app may not say so.

---

## Related

- `projects/gamepados/RELEASE.md` — the full 5-flavour release process
- `projects/gamepados/docs/research/BILLING_DECISIONS.md` — why the billing model is what it is
- `projects/gamepados/docs/REGRESSION_CHECKLIST.md` — run after any significant change
- `context/memory/project_play_production_access.md`
