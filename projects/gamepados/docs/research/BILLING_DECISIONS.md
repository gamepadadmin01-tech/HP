# GamepadOS Billing — decisions taken

**Companion to `GAMEPADOS_BILLING_BLUEPRINT.md`.** That document is research written without
access to the repo; this one records what Akhil actually decided, what the code says, and where
the blueprint is wrong. **Where the two disagree, this file wins.**

**Date:** 17 August 2026 · **Status:** design agreed, no code written.

---

## 1. Pricing — LOCKED

| Plan | Price (INR, GST-inc) | Daily limit | Term | Priority |
|---|---|---|---|---|
| Free | ₹0 | 1 hour/day | forever | 0 |
| **3-Day Pass** | ₹19 | **unlimited** | 72 hours | 80 |
| **Quarterly** | ₹99 | 6 hours/day | 3 months | 60 |
| **Lifetime** | ₹400 | **unlimited** | forever | 100 |

`LIFETIME (100) > THREE_DAY (80) > QUARTERLY (60) > FREE (0)`

**No monthly tier. No yearly tier.** Both were dropped deliberately:

- A monthly plan cannot coexist with ₹99/quarter without one dominating the other.
- A yearly plan cannot coexist with a ₹400 lifetime — at any sane yearly price, lifetime wins.

### Why these numbers survive scrutiny

- **The competitor is a physical controller, not Netflix.** A cheap PC controller is ₹1,200–2,000.
  Lifetime at ₹400 is not a comparison, it is a landslide. Any lifetime price above ~₹1,200 loses
  to hardware that has better sticks and doesn't drain the user's phone.
- **The 3-day pass cannot be farmed.** Covering a quarter with passes costs 30 × ₹19 = **₹570 vs
  ₹99**. That 5.8× gap is why the pass can safely be unlimited while Quarterly is capped.
- **A year of Quarterly is ₹396; Lifetime is ₹400.** Four rupees apart, deliberately. Quarterly is
  positioned as a genuine 3-month trial, not as a long-term plan. Expect most revenue on Lifetime.
- Every price is far below RBI's ₹15,000 e-mandate threshold, so recurring debits never need
  per-renewal authentication.
- ₹19 / ₹99 / ₹400 are all valid Play price points. 3-monthly is a valid Play base-plan duration.

### Take-home, indicative only

On ₹400: roughly ₹61 is GST, Play takes 15% (~₹60) or Razorpay ~2% (~₹8). Net ≈ **₹280 via Play**,
**₹330 direct** — a standing reason to steer users to the direct build. **Confirm with a CA**; per
blueprint §16 an India-based developer is the taxable person on Play sales too.

---

## 2. Behaviour — LOCKED

### 2.1 No grandfathering

Every existing user drops to 1 hour/day. There is no legacy unlimited tier.

**Required mitigation:** ship an in-app notice **one release before** the limit takes effect. Play
production access was granted 2026-08-12 and the listing has no ratings history to absorb a wave
of 1-stars. A limit people were warned about is accepted; one that appears overnight is not.

#### 2.1a Launch bonus — DECIDED 2026-08-19

Everyone who already had the app gets **24 hours of unlimited playtime**, once, when plans ship.

This does not reverse "no grandfathering". Nobody keeps a legacy tier: the grant expires by
itself after a day and every account then sits on the same four plans. What it buys is the
awkward first hour — the release changes the deal for people who never agreed to one, and
arriving with a gift rather than only a restriction is the difference between an announcement
and a complaint.

**It also substitutes for the "one release before" notice above, which was not shipped.** That
mitigation assumed a spare release to warn in. There wasn't one, so the warning and the limit
arrive together — and the day of unlimited is what absorbs it. Worth being honest that this is
the weaker of the two options; it is chosen because the alternative is delaying the release.

Implemented as `website/backend/grant-launch-bonus.js`. It borrows the THREE_DAY *policy*
(unlimited, priority 80) with `endsAt` overridden to 24h — the plan code decides the policy,
never the duration. Idempotent on `(PROMO, launch-bonus-v1:<userId>)`, dry-run unless `--apply`.

Because the grant is a policy loan, the app must not call it by that plan's name: a 24-hour gift
displayed as "3-Day Pass" claims the user owns something they did not buy and implies two extra
days. `PlanPanel` therefore describes anything with `source` PROMO or MANUAL by what it does —
"Unlimited · Gift until <date>".

#### 2.1b Why the update is framed around latency, not billing

The release is led by the performance work, with plans as the thing that funds it. The measured
figure is the one to use — Phase 3 native input is **3.7x faster than the previous engine,
device-verified**. Still no "world's no.1 fastest gamepad": unsubstantiated superlatives are a
Play policy problem and a competitor can demand proof.

Announcement copy lives with the release notes; the shape agreed was: what got faster, that plans
now exist and why, and the free hour framed as the trial rather than the restriction.

### 2.2 What counts as playtime — REVISED 2026-08-17

**The clock runs whenever the controller is open. Nothing else matters.**

- **Not** conditional on the PC being connected. (This supersedes an earlier draft requiring both.)
- Time on Home / System / Account is never counted.
- Idle time with the controller open **is** counted.

| Plan | Limit |
|---|---|
| Free | 1 hour/day |
| Quarterly | 6 hours/day |
| 3-Day | unlimited |
| Lifetime | unlimited |

At zero: *"You're out of time — upgrade to play more, or wait for your next quota."*

> **Implementation note:** `ControllerScreen` already exposes an `isActive` signal, added in
> 1.3.23 to fix the always-streaming bug (the USB worker was blasting ~250 pkt/s from the
> dashboard and leaving ghost pads). **That existing signal is the billing clock's gate.** Do not
> invent a second one — if these two ever disagree, the app bills for time it isn't streaming.

**Known trade-off, accepted:** opening the controller merely to inspect a layout burns free
minutes. Predictable and easy to explain, which is why it was chosen over a link-dependent rule.

### 2.2b Time is counted LOCALLY, online or offline

The app counts playtime itself. There is no requirement to be online, and offline play behaves
identically to online play.

**Why this is acceptable, stated plainly:** the security model exists to protect *revenue*, not to
police free users. Gameplay is phone-to-PC over the LAN — a free user who cheats an extra hour
costs nothing in server, bandwidth or seat terms, and anyone willing to modify an APK to dodge a
free tier was never going to pay ₹400. The integrity that matters is on the paid side (nobody
forges a Lifetime entitlement), and that stays server-verified through purchase tokens and
signatures.

**Required refinement — the cheap hole must still be closed.** The easy bypass is not modifying
the app, it is *clearing app data* to wipe the counter, which any user can do on a forum tip.
Therefore:

> Count locally **and** record usage server-side whenever a connection exists.
> Effective usage = **max(local, server)**.

Clearing app data then restores nothing, because the server remembers. Only a permanently-offline
player benefits — a small, bounded group.

**This also resolves the conflict with §2.4.** Permission slips work as designed while online;
offline, the local count governs. Free tier = honour system with server memory. Paid tier =
properly enforced.

### 2.2c Daily reset — per-user timezone, decided SERVER-side

Each account pins its own IANA timezone so the reset feels local (a Delhi player and a London
player each reset in their own morning).

**The phone's clock and reported timezone are never trusted.** If the device decided, changing the
timezone in Settings would roll "today" over again and hand out a second free hour — ten seconds of
work, no modified app, repeatable. Instead: seed the zone from the user's location at signup, store
the reset boundary as an absolute timestamp, and rate-limit zone changes to roughly one a month.

Same user experience; no free hours available from the Settings app.

### 2.3 Sign-in is required to play

Not just to buy. Quota is keyed to the account so it survives reinstall, clear-data and device
swap. This is the only version that actually enforces the limit.

**Two signup paths, both required:** Google one-tap as the primary, manual email registration via
the Account page as the fallback. The current flow — email, password, then a 6-digit code — is far
too heavy to sit between install and first play.

**Accepted cost:** install-to-first-play conversion will drop. Today it is scan-QR-and-go.

**Where the wall sits:** at the moment the user taps PLAY. Browsing, pad editing and PC pairing all
stay open — sign-in is asked when value is about to be delivered and motivation is highest.

**Copy:** lead with the free hour as the trial, not with the restriction.

> **Experience GamepadOS first — 1 hour free, every day.**
> Then decide.

⚠️ **Do not ship "world's no.1 fastest gamepad."** It is an unsubstantiated superlative; Play
policy covers misleading claims and a competitor can demand proof. Use the measured figure
instead — Phase 3 native input was **3.7× faster than the previous engine, device-verified** (see
[[project_realtime_latency_stack]]). A defensible number lands harder than a superlative anyway.

### 2.4 PC-side enforcement — YES, in GamepadServer 2.0.2

The `direct` APK is a plain download, so a modified build can ignore its own limit. Only
GamepadServer can actually stop input, because it is what injects it.

**Mechanism:** the backend signs a short-lived capability ticket (Ed25519) on each heartbeat; the
phone forwards it over the **existing TCP control channel** (never the UDP input channel);
GamepadServer verifies against an embedded public key and enforces expiry on its **own monotonic
timer**, rejecting any ticket whose sequence number is not greater than the last accepted one.
When quota runs out the backend simply stops issuing tickets and the PC tears down within ~180s.
Steady-state cost on the input path: **zero**.

> **Blueprint correction:** §9.3 says to fold this into "the unactivated Rust 2.0.1."
> **2.0.1 went live on 2026-08-17.** This is now 2.0.2.

### 2.5 Rollout order — this matters more than it looks

```
1. PC server 2.0.2   — understands tickets, does NOT require them.
                       Harmless to existing users. Ships first, spreads for weeks
                       through the normal updater.
2. Mobile billing    — starts requiring tickets. By now most PCs already have 2.0.2.
3. Update prompt     — for stragglers only: "update your PC server to keep playing."
```

Ship 1 and 2 together and **every user hits a wall on day one.** The whole point of shipping the
PC server early is that it is inert until the app asks anything of it.

**Open:** grace period length before an un-updated PC server is hard-blocked. Recommend nagging
for ~4 weeks, then enforcing.

---

## 3. Admin control — NEW REQUIREMENT

The app's plans must be **driven by the admin portal**, not hardcoded. `GET /billing/plans`
already provides this; the portal gains a Billing panel beside 📦 Releases.

### 3.1 Must do

- **Edit prices** and display names per plan
- **Grant entitlements by hand** — free trials for chosen people (`source = PROMO` or `MANUAL`,
  any `planCode`, any `endsAt`). The resolver needs no new logic; a granted row is just another
  entitlement and the priority rules already handle it.
- **Revoke** an entitlement, with a reason
- **View a user's entitlement and payment history**

### 3.2 Three rules this panel must obey

**Play prices are display-only.** Google requires the in-app price to match Play Console, and a
mismatch is a policy violation. The portal fully controls direct/Razorpay prices; for the Play
build the DB value is a mirror and the app must read the real price from `ProductDetails` at
runtime. **Never render a DB price next to a Play SKU.**

**Never edit a price in place — version it.** Changing Quarterly ₹99 → ₹149 must not change what
existing subscribers pay; Razorpay binds a subscription to a specific plan id. A "price change"
creates a new `Plan` row and marks the old one `active = false`. The old row stays forever so
historical `Payment` rows still resolve to the price actually charged. This is what the `active`
flag exists for.

**Granting is owner-only and audited.** A button that hands out Lifetime is the most abusable
control in the portal. Route it through `AuditLog` with the acting admin and a reason, and gate it
on the owner role — same as Register & Activate.

---

## 4. Corrections to the blueprint

Written without repo access; these are now settled from the code.

| Blueprint says | Reality |
|---|---|
| "5 flavours" (§0.1) | **7.** `indusstore` and `apkpure` were added later. Both need the same no-purchase-surface treatment as Aptoide/Amazon, and **neither store's billing policy has been read.** |
| Auth unknown (§15.1) | Opaque **64-hex bearer token** in `UserSession`, **90-day** expiry. Not JWT. Bearer not cookie, because the WebView origin differs from the API origin. Server-side sessions mean instant revocation. `/play/session/*` can reuse the existing middleware. |
| "Who owns 'a session started'?" (§15.2) | **Nobody.** `onLaunch()` does no server round-trip, and the Rust server pairs on an 8-hex key with no user identity at all. The pre-flight gate is new code, not a move. |
| 48h is not a valid Play duration (§0.2) | True — but **3 days IS** on Play's prepaid list. Changing the pass to 3 days removed the constraint. *Still ship it as a one-time consumable*, so Razorpay and Play share one code path. |
| Fold tickets into Rust 2.0.1 (§9.3) | 2.0.1 is **live** as of 2026-08-17. This is 2.0.2. |
| — | `App.tsx` already threads dead `premium` / `credits` props (`useState(false)`, `useState(35*60)`) through `ControllerScreen` and `TabHome`, from an abandoned monetisation attempt. **Delete them before building alongside.** |

### Still unverified — do not treat as settled

Everything in blueprint §16 stands, plus Indus Appstore and APKPure billing policies. The
highest-risk item remains **Android 17 / `ACCESS_LOCAL_NETWORK`** (§0.4): it gates all local UDP
and TCP, which is the entire wire protocol. It is a bigger threat to the product than billing is
to the business, and it should be investigated before or alongside this work — not after.

Also from §0.4: the playtime foreground service **must** be type `connectedDevice`, not
`dataSync`. Android 15 caps `dataSync` at 6 hours per 24h — **exactly** the paid daily limit — so
the wrong type kills the service at precisely the moment the billing logic hits its limit, and the
resulting bug looks like a billing fault for as long as it takes to find.

---

## 5. Android 17 / ACCESS_LOCAL_NETWORK — RESEARCHED 2026-08-17

The blueprint called this "the highest-risk unknown." It is real, but **it is a 2027 problem, not
a now problem**, and the blueprint overstated the urgency.

**Enforcement keys off what the app TARGETS, not what the phone runs.** Apps targeting below
SDK 37 keep an implicit local-network grant via `INTERNET`. GamepadOS targets 36, so users on
Android 17 handsets are unaffected today.

| | |
|---|---|
| Play's only binding target-SDK deadline | **31 Aug 2026 → API 36** — already met |
| Published deadline for API 37 | **none** |
| Expected, from the annual cadence (34→2024, 35→2025, 36→2026) | **~Aug 2027** |

**What it gates once targeting 37:** outgoing TCP connect, accepting TCP, UDP unicast, UDP
multicast, UDP broadcast, and mDNS. That is the control channel, the 20-byte input frames, the GRX
handshake, and the USB-tether path (`192.168.42.x` is local too). Blocked UDP returns `EPERM`;
TCP merely times out — miserable to diagnose without knowing the cause.

### Two routes, and what the code says about each

**A. Request the permission.** One runtime prompt, in the `NEARBY_DEVICES` group — a user who has
already granted another permission in that group is not re-prompted.

**B. System device picker.** `NsdManager` + `DiscoveryRequest.FLAG_SHOW_PICKER`: the system shows
a chooser, the user picks the PC, and the app gets **real socket access to that device with no
permission at all** (not merely address resolution — confirmed).

**Verified in the repo 2026-08-17: there is no mDNS anywhere.** The Rust server does not advertise
and the Android client has no `NsdManager`. Route B is therefore net-new work on both sides. It
also would *not* replace QR pairing: the picker yields an address, while the QR carries an address
**plus the 8-hex pairing key**.

**DECISION: Route A.** The app's entire purpose is reaching a PC on the local network, so the
prompt is self-explanatory and a user who denies it has no working product regardless. Keep B as
the fallback if denial rates prove bad. Do the work when bumping to targetSdk 37 — not before.

**Do now, though: add mDNS advertising to the Rust server while 2.0.2 is being built anyway.**
It is small, it enables automatic PC discovery instead of QR-only, and it is the prerequisite for
Route B. Adding it later costs another PC release and another update cycle.

Sources: [Local network permission](https://developer.android.com/privacy-and-security/local-network-permission) ·
[Behavior changes: Android 17](https://developer.android.com/about/versions/17/behavior-changes-17) ·
[Play target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878)

---

## 6. Later decisions — LOCKED

### 6.1 All seven flavours show plan status

Every build displays the user's current plan and daily usage.

**Boundary that must not be crossed:** status is fine everywhere; a *purchase path* is not.
Only `direct` and `playstore` get a buy button. `aptoide`, `uptodown`, `amazonstore`,
`indusstore` and `apkpure` show a locked panel with **no price, no link, and no "visit
gamepad.space"** — that sentence alone breaches Amazon's policy against directing customers to
other payment methods, and Aptoide mandates its own billing.

### 6.2 Free access is granted by CODE, not per-user

A promo-code table (code, planCode, duration, max redemptions, expiry) plus a redemption record so
one account cannot claim the same code twice. Shareable for giveaways, which per-user grants are
not. Admin creates codes in the portal.

### 6.3 Admin playtime control — this is for COMPENSATION, not plan management

**Clarified requirement:** the point of admin control is to hand a user playtime back when a
genuine bug cost them theirs. Not to fiddle with plans.

This needs **no new tables**. Two sizes of apology, both already expressible:

| Scale | Mechanism |
|---|---|
| Small — an hour, a lost session | `UsageLedger` row with a **negative** `secondsDelta`, `reason = 'adjust'`. `UsagePeriod.secondsUsed` drops, so they get more time today. Auditable and rebuildable. |
| Large — a bad release, a broken week | Grant a `PROMO` entitlement for a few days of unlimited. |

Owner-only, and every grant written to `AuditLog` with the acting admin and a reason.

### 6.4 Refund policy — required, but mostly not engineering

Two reasons it is not optional:

1. **Google refunds without consulting you.** Play users get automatic refunds within 48 hours and
   Google may refund beyond that. The mandatory *engineering* work is handling
   `voidedPurchaseNotification` and revoking the entitlement — otherwise refunded users keep
   Lifetime.
2. **Razorpay compliance requires a published Refund & Cancellation policy** stating processing
   timelines, alongside Terms and Privacy. Verify against the account's own activation checklist.

**The written policy is short, and §6.3 is most of it.** For instantly-delivered digital goods the
standard position is: no refunds once used, except where the service genuinely did not work — and
when it genuinely did not work, compensate with **playtime rather than money**. Draft with a CA or
from a template; this is not a code task.

---

## 7. Running out of time — the UX, LOCKED

The most important screen in the system, and the **highest-converting moment in the product**:
someone who just hit a wall mid-game wants to keep playing more than they ever will again. It must
not feel like punishment.

```
15 min left  ·  quiet indicator, same visual weight as the gyro bar
 5 min left  ·  indicator brightens
 1 min left  ·  indicator + short haptic
 0           ·  input stops, controller closes cleanly back to the app
                → offer appears THERE: "Out of time. ₹19 = 3 days unlimited"
```

**Never a modal over live gameplay. Never a freeze mid-input.** The offer is shown after the
controller has closed, not on top of a running game.

---

## 8. Implementation status — BACKEND COMPLETE (2026-08-18)

All in `website/backend/billing/`. Plain CommonJS JavaScript, **zero new npm dependencies** —
Razorpay and Google Play are both reached with `fetch`, and the Play service-account JWT is signed
with `crypto`. Nine suites run from `npm test`; all pass.

| File | What it owns |
|---|---|
| `plans.js` | The catalogue: priorities, daily limits, durations. No prices — those live in the DB. |
| `entitlement.js` | The resolver. Nothing else decides what a user may do. |
| `period.js` | Daily reset boundaries, DST-safe, no date library. |
| `playtime.js` | Ledger, sessions, reaping, admin compensation. |
| `grant.js` | Verified payment → entitlement. Shared by every provider. |
| `providers/razorpay.js` | Orders, subscriptions, the two signature formulas. |
| `providers/googleplay.js` | Service-account JWT, purchase lookups, RTDN parsing. |
| `routes.js` | `/api/billing/plans`, `/api/billing/me`, `/api/play/session/*` |
| `routes.razorpay.js` | Checkout, callback verification, webhook. |
| `routes.googleplay.js` | Client callback, RTDN push. |
| `routes.admin.js` | Compensation, promo codes, plan versioning, manual grants. |
| `reconcile.js` | The sweep: stuck orders, abandoned sessions, Play refunds. |
| `seed.js` | Creates the three plan rows at boot. Never edits a price. |

**Paths deviate from the blueprint deliberately:** it proposed `/api/v1/*`; this project has no API
versioning anywhere, so billing sits at `/api/billing/*` and `/api/play/*` to match.

### Constraints found in the code, not in the blueprint

- **`schema.local.prisma` is SQLite** — no Prisma enums, no `Json` columns; both break local dev.
  Status fields are `String` with the values in a comment, matching `Ticket.status`.
- **There are no migrations** (`prestart` runs `prisma db push`), so the partial unique index for
  "one active session per user" had nowhere to live. Replaced by `PlaySession.activeKey`: the
  userId while active, NULL once closed, with a plain unique index — both engines treat NULLs as
  distinct. **Verified against a real database.**
- **`express.json()` is global at `server.js:151`.** The Razorpay webhook is signed over raw bytes,
  so its route is registered ABOVE it. Below, every delivery fails verification with no symptom.
- **SQLite returns `CURRENT_TIMESTAMP` as a string**, which `new Date()` reads as LOCAL time — a
  silent 5h30m error in local dev only. `serverNow` normalises it.

### Bugs caught while writing the tests

- `heartbeat` and `stopSession` looked sessions up by id **without checking ownership** — anyone
  could bill time to a stranger, or end their game, by guessing an id.
- The Play subscription shape is the **mirror image** of Razorpay: one purchase token reused across
  renewals, versus a fresh payment id per charge. Keying either the wrong way silently drops
  renewals or leaves entitlements that never expire.

### Environment variables

```bash
RAZORPAY_KEY_ID=            RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=    # a DIFFERENT secret — key_secret fails every delivery
RAZORPAY_MODE=test
GOOGLE_PLAY_PACKAGE_NAME=com.gamepad.client
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON=   # path, raw JSON or base64. Never in the repo.
GOOGLE_RTDN_SECRET=                 # optional guard on the push endpoint
PLAYTIME_RESET_TZ=Asia/Kolkata      PLAYTIME_RESET_HOUR=4
PLAYTIME_HEARTBEAT_SECONDS=60       PLAYTIME_REAP_GRACE_SECONDS=30
```

Unset providers return **503** rather than misbehaving.

### NOT built — the client side

Stopped deliberately at the backend boundary. Each of these needs device verification and touches
code marked do-not-touch:

1. **PC server 2.0.2** — Ed25519 ticket verification + mDNS. Ships FIRST (§2.5).
2. **Android** — `HeartbeatService` (FGS type `connectedDevice`, **never** `dataSync`), Play
   Billing 9.1.0 in the playstore source set, Razorpay checkout in the direct source set.
3. **controller-ui** — the plan panel, the countdown, the pre-launch gate, and §7's out-of-time
   flow. `App.tsx` is the file that lost 133,000 characters to a bad automated edit; see
   `context/recovery/`.
4. **Admin portal UI** — every endpoint exists; `admin.html` needs the panel that calls them.

---

## 8.5 External review — findings actioned (2026-08-18)

`GAMEPADOS_BACKEND_REVIEW.md` reviewed the backend and confirmed 12 issues. **Ten are fixed**;
all 11 test suites pass and the server boots with every route wired.

| # | Finding | Status |
|---|---|---|
| C1 | `P2002` caught inside a transaction leaves it unusable on PostgreSQL | **fixed** — all six sites now `upsert` |
| C2 | `productEntitlement` recognised no real Play one-time purchase | **fixed** — both v1 and v2 shapes |
| C3 | Client-supplied `productId` chose the plan | **fixed** — Play's reported product wins |
| C4 | `Plan @@unique([code,currency,active])` broke the 2nd price change | **fixed** — `activeKey` NULL trick |
| C5 | Razorpay webhook granted without an amount check | **fixed** |
| C6 | A failed webhook handler marked the event processed anyway | **fixed** — claim commits with the work |
| C7 | Daily limit enforced only at session open | **fixed** — heartbeat closes the session at zero |
| C8 | Suppressing heartbeats was a 6× playtime multiplier | **fixed** — see below |
| C9 | Unauthenticated entitlement revocation via RTDN | **fixed** — re-queries Play before revoking |
| C10 | `.env.example` documented no billing variables | **fixed** — 19 added |
| C11 | `ensureBilling` unguarded create → 500 on a new user | **fixed** (part of C1) |
| C12 | Concurrent session open surfaced as 500, not 409 | **fixed** — caught outside the transaction |

### The two that changed a design decision

**C1 — never `create` + `catch (P2002)` inside a transaction.** On PostgreSQL a constraint
violation aborts the whole transaction: every later statement fails `25P02` and the COMMIT
silently becomes a ROLLBACK, discarding work that already succeeded. Prisma 5.x issues no
per-query savepoints. Everything now uses `upsert`, which compiles to `INSERT ... ON CONFLICT`
and leaves the transaction usable; a freshly minted id tells us which branch ran.

The one exception is a concurrent `/session/start`: there the insert *should* fail and the
transaction *should* roll back, so it is caught OUTSIDE and answered as a 409.

**C8 — a session that never heartbeats now holds a 90-second lease, not 180.** Blocking the
heartbeat needed no patched APK, and 180s of play cost 30s of quota; re-opening was free because
`openSession` reaps first. A session that has never heartbeated is billed for the time it actually
held the slot; one that HAS heartbeated keeps the symmetric 30s grace, because that is a genuine
drop. Worst case for an honest user whose link dies instantly is 90s of a 3600s free tier.

### The most important change is to the tests

The review identified why nothing caught C1: every fake implemented `$transaction` as
`fn(prisma)` — no transaction semantics at all, so they proved the recovery code was *reached*
without seeing that everything after it failed on the real engine.

`billing/testdb.js` now models PostgreSQL: a failed statement poisons the transaction, a failed
transaction rolls back, and NULLs are distinct in unique indexes. All four hand-rolled fakes are
gone. **The first assertion in `transaction.test.js` reproduces the original production failure**,
so if the harness ever loses fidelity again that test starts passing when it should not.

The Play fixtures were also replaced: they had been feeding `purchaseState: 'PURCHASED'` as a
top-level string, which Google returns from **neither** endpoint — which is how C2 passed.

### Not actioned

- **R1 / no Play subscription renewal backstop** — the reconcile sweep still covers only
  `order_*` for Razorpay and refunds for Play.
- **Per-user timezone is still not wired up.** `resetTz` defaults to `Asia/Kolkata` and no
  endpoint writes it. The safety property holds; the UX promise in §2.2c is not delivered.
- **Long interactive transactions** (8–10 round trips) and per-process rate limiters remain as
  described in the review's scalability section.

---

## 8.6 Website checkout — BUILT 2026-08-18

**This is not a convenience feature, it is the missing half of §6.1.**

Five of the seven builds — `amazonstore`, `aptoide`, `uptodown`, `indusstore`, `apkpure` — are
forbidden from showing any purchase surface. That is exactly why entitlements were put on the
ACCOUNT rather than the install. But an account-based model only works if there is somewhere to
buy, and until now there wasn't: those users could see "Free · 1 hour/day" with no route out of it.
The website is that route, and it is also the only channel with no store cut.

| File | What it is |
|---|---|
| `frontend/account.html` | One page, five states: sign in, create account, confirm email, reset password, signed-in |
| `frontend/js/account.js` | Auth, plan + usage display, Razorpay checkout, promo redemption |
| `frontend/css/account.css` | Kept separate from `style.css`, which every other page loads |
| `frontend/refunds.html` | The policy page Razorpay's activation checklist requires |

**No new backend work was needed.** `/api/account/*` already had register, verify, login, me,
logout and password reset; `/api/billing/*` already had plans, me, the Razorpay order/verify pair
and promo redemption. This is purely the interface onto what was already built and tested.

### Decisions inside it

- **Bearer token in `localStorage`, not a cookie.** The API is on a different origin from the
  site, so a cookie would be third-party and dropped — the same reason the app uses bearer tokens.
- **The Razorpay script loads only when someone clicks Buy**, so it costs nothing to anyone
  browsing.
- **The amount is never sent from the browser.** `/razorpay/order` reads it from the `Plan` row.
- **A failed `verify` call does not claim the money is lost.** The webhook credits it
  independently, so the message says so instead of implying a failure.
- **Unlimited plans show no countdown at all** — a limit that does not apply should not be on
  screen implying it might.
- **`refunds.html` matches the "no refunds once used" decision** but documents the three cases we
  DO refund (double charge, paid-but-not-applied, didn't work and support couldn't fix it), and
  states plainly that Play purchases follow Google's policy, not ours.

Verified in a browser: state machine shows exactly one card, tab switching works, and an
unreachable backend produces *"Couldn't reach the server"* rather than silence.

**⚠️ `vite.config.js` gates which pages get built.** A page missing from `rollupOptions.input`
exists in the tree and 404s in production, silently. Both new pages are registered.

---

## 9. Still open

1. Grace period before an un-updated PC server is hard-blocked (recommend ~4 weeks)
2. Promo-code defaults: which plan, how long, how many redemptions
3. Who absorbs the GST on a refund (CA question)
4. Whether to fold mDNS advertising into PC server 2.0.2 (recommended — see §5)
5. Purchase UX in the app: Razorpay Checkout in a WebView vs the native SDK
