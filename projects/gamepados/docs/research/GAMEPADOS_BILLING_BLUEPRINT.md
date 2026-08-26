# GamepadOS — Payment, Subscription, Entitlement & Playtime Blueprint

**Status:** design + research complete. **No code written yet** — I have no access to your repos in this session.
**Date:** 17 August 2026
**Scope:** GamepadOS Android client (5 flavours) + gamepad.space Express/Prisma backend + GamepadServer (Rust 2.0.1).

---

## 0. Read this part first — three things that change the plan you chose

You picked "Play Billing in the Play build, Razorpay everywhere else." That is right for two channels and **wrong for two others**, because Aptoide and Amazon both mandate their own billing.

### 0.1 The channel matrix is not 2-way, it's 5-way

| Flavour | Billing you are allowed to use | Take rate | Source |
|---|---|---|---|
| `playstore` | **Google Play Billing only.** "Additional playtime" is named verbatim in Play's Payments policy as requiring GPB. No link-outs, no Razorpay code in the binary. | 15% (India, sub-$1M) | [Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738) |
| `amazonstore` | **Amazon IAP mandatory.** "If you make digital content available for purchase that can be used in your app, you must use our In-App Purchasing API… You also may not direct customers to use other methods of paying." | 30%, or 20% via Small Business Accelerator | [Amazon Monetization policy](https://developer.amazon.com/docs/policy-center/monetization.html) |
| `aptoide` | **Aptoide Connect billing mandatory.** "If your Apps are paid or include paid In-App Products you must integrate Aptoide Connect's billing into your Apps." | **25%** — your worst channel | [Aptoide MoR agreement](https://connect.aptoide.com/developers-distribution-policy-mor) |
| `uptodown` | Their terms describe an 80/20 billing product but contain **no explicit prohibition** on third-party processors. Not the same as permission. | 20% via theirs | [Uptodown developer terms](https://en.uptodown.com/developers-zone/services) |
| `direct` | **Razorpay, freely.** Your only genuinely open channel. | ~2% + 18% GST on the fee | — |

**My recommendation: don't build four billing integrations.**

**Phase 1 — build two:** Razorpay for `direct`, Google Play Billing for `playstore`. These are your two real channels.

**Phase 2 — for `aptoide` / `uptodown` / `amazonstore`, ship the app with no purchase surface at all.** The entitlement lives on the gamepad.space *account*, not on the install. A user on those builds signs in and the app honours whatever entitlement the account already has, bought on the website. This is the standard account-based model (how Netflix/Spotify handle it) and it sidesteps all three store billing mandates, because there is nothing being "made available for purchase" inside the app.

The hard constraint on that: those builds must contain **no link, button, webview, or message** pointing at your checkout. Just a plain "Manage your plan at gamepad.space" is already too much on Amazon. Show plan status and a locked upgrade panel that says nothing about where to buy.

This is also why the **entitlement service must be provider-agnostic from day one** — same entitlement rows, different `source` values. Adding Amazon IAP later becomes one verifier module, not a redesign.

### 0.2 Play has no 48-hour product. Your 2-day plan cannot be a subscription.

Play's allowed base-plan durations are: auto-renewing — weekly, 4-weekly, monthly, 2/3/4/6/8-monthly, yearly; prepaid — 1 day, 3 days, 1 week, 4 weeks, 1/2/3/4/6/8 months, 1 year. **48 hours is not on either list.** ([Create and manage subscriptions](https://support.google.com/googleplay/android-developer/answer/140504))

There is a `rent` purchase option on one-time products that offers a 48-hour rental period — but it **forces a 24-hour expiration cap once the user starts consuming**, Play returns *no rental expiry timestamp server-side* (`RentOfferDetails` has no fields in `purchases.productsv2`), and there is **no RTDN for rental expiry**. It gives you nothing and costs you half the entitlement.

**So: the 2-day plan is a consumable one-time product (`INAPP`), and your backend owns the 48-hour clock.** Same on Razorpay — a plain Order, not a Subscription. This is fine, and it's actually the cleaner design: the 48-hour window is computed once at activation and stored as an absolute `endsAt`.

Same logic for **Lifetime**: one-time product, non-consumable on Play, plain Order on Razorpay.

Only **Monthly** and **Yearly** are subscriptions — one Play subscription product with two base plans (monthly + yearly), and one Razorpay Plan each.

### 0.3 Two India-specific facts that will shape your pricing

**Keep the yearly price under ₹15,000.** RBI's *Digital Payments – E-mandate Framework, 2026* (RBI/DPSS/2026-27/396, issued 21 Apr 2026) sets AFA-free recurring debits at **≤ ₹15,000**; above that, **every renewal needs the customer to authenticate**, which in practice means the renewal silently fails and you bleed churn. The ₹1,00,000 exemption covers insurance/mutual funds/credit-card bills only — digital subscriptions are not on that list. ([RBI Master Direction](https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13374))

**Default UPI Autopay, cards as fallback.** Razorpay's own guidance is that UPI Autopay is the recommended default under ₹15,000 for OTT/SaaS-style billing, and that card e-mandate failure rates hit 20%+ in some categories. Your APK-sideloading audience skews heavily UPI-first. ([Razorpay: UPI Autopay vs card e-mandates](https://razorpay.com/blog/upi-autopay-vs-card-e-mandates/))

### 0.4 Two unrelated findings I hit that matter more than billing

**Android 17 / targetSdk 37 will break your PC companion path.** `ACCESS_LOCAL_NETWORK` becomes a mandatory runtime permission in the `NEARBY_DEVICES` group, gating outgoing TCP connect, incoming TCP accept, **and all UDP unicast/multicast/broadcast** to 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10 and IPv6 link-local. That is your entire wire protocol. Apps targeting <37 keep an implicit grant via `INTERNET`, *temporarily*. There is a permission-free escape: `NsdManager` discovery with `DiscoveryRequest.FLAG_SHOW_PICKER`, where the user picks the service and you get `getHostAddresses()` without the permission. ([Local network permission](https://developer.android.com/privacy-and-security/local-network-permission))

**Your playtime foreground service must be type `connectedDevice`, not `dataSync`.** Android 15+ caps `dataSync` at **6 hours per 24h**, then calls `Service.onTimeout()` and throws `ForegroundServiceStartNotAllowedException` on restart. `connectedDevice` is documented for "continuous interactions with external devices requiring… network connections" and has **no documented time limit** — and it's the semantically correct type for a gamepad anyway. ([FGS timeouts](https://developer.android.com/develop/background-work/services/fgs/timeout))

If you were going to do one thing from this document before the billing work, it's these two.

---

## 1. What I could not do, and what I'll do when you upload

I designed against your stated architecture (Express + Prisma backend, Android client with 5 flavours, Rust PC server, TCP-control + UDP-input with a 20-byte protocol and 41-byte GRX frames). Everything below is **provisional until I read the code.** Specifically I don't yet know:

- how auth works (session cookies? JWT? refresh tokens? who issues them, what the Android client stores)
- your Prisma schema — the `User` model shape, whether you use `cuid()`/`uuid()`, existing migrations
- whether gameplay "sessions" already exist as a concept anywhere
- your Express router structure, middleware chain, and which endpoints are latency-sensitive
- the UI framework and how the glassy components are built
- whether the phone or the PC server is the one that knows a session has started

**The inspection checklist I'll run first, in order:**

1. `git log --oneline -20`, branch state, and whether the tree is clean
2. Backend: `package.json`, entrypoint, router mounting, middleware order, `prisma/schema.prisma`, migration history
3. Auth: where tokens are minted, how the Android client authenticates, token lifetime, refresh flow, and whether there's an existing `requireAuth` middleware I can reuse
4. Android: `build.gradle.kts` flavour config, `AndroidManifest.xml` (foreground service types, permissions, targetSdk), DI setup, networking layer (OkHttp/Retrofit config), existing repository pattern
5. The input path specifically: locate the gamepad polling loop, the UDP send path, the GRX frame construction, and any thread/coroutine dispatchers involved — then mark those files **do-not-touch**
6. The TCP control channel: message types, whether there's room for a new control message (for the Tier-2 ticket, §9.3)
7. Rust server: pairing flow, control message parsing, whether adding a verification step is cheap
8. UI: locate the glass component primitives, spacing/typography tokens, and the settings/account screen I'd add a plan panel to
9. `docs/REGRESSION_CHECKLIST.md` — read it, and add billing cases to it
10. Produce a written "untouched files" list before making a single edit

Then I implement, then I run your 31 tests (§14).

---

## 2. Plan catalogue — centralized, never hardcoded

One source of truth, seeded into the DB, referenced by code only via the enum.

```ts
// packages/billing/src/plans.ts  (or server/src/billing/plans.ts)
export const PLAN = {
  FREE:     'FREE',
  TWO_DAY:  'TWO_DAY',
  MONTHLY:  'MONTHLY',
  YEARLY:   'YEARLY',
  LIFETIME: 'LIFETIME',
} as const;

export const PLAN_POLICY = {
  FREE:     { priority:   0, dailySeconds:  3600, durationDays: null, unlimited: false },
  TWO_DAY:  { priority:  80, dailySeconds:  null, durationHours:  48, unlimited: true  },
  MONTHLY:  { priority:  60, dailySeconds: 21600, durationMonths:  1, unlimited: false },
  YEARLY:   { priority:  60, dailySeconds: 21600, durationYears:   1, unlimited: false },
  LIFETIME: { priority: 100, dailySeconds:  null, duration:     null, unlimited: true  },
} as const;
```

`priority` encodes exactly the hierarchy you specified: `LIFETIME(100) > TWO_DAY(80) > MONTHLY/YEARLY(60) > FREE(0)`.

**Prices live in the `Plan` table, not in code**, one row per `(planCode, currency)`. For Play and Amazon the price is authoritative *in the store console*, so the DB price for those channels is display-only and must be refreshed from `ProductDetails` at runtime — never render a hardcoded price next to a Play SKU, that's a policy violation ("in-app pricing must match the pricing displayed in the user-facing Play billing interface").

Placeholder prices, all configurable:

| Plan | Placeholder INR | Constraint |
|---|---|---|
| TWO_DAY | ₹29 | see the pricing hole below |
| MONTHLY | ₹199 | — |
| YEARLY | ₹1,499 | < 12 × ₹199 = ₹2,388 ✓, and < ₹15,000 so renewals stay AFA-free ✓ |
| LIFETIME | ₹2,999 | — |

Change them by editing the `Plan` rows. No business logic references a number.

**⚠ There is a pricing hole in the spec as written, and you should decide it deliberately.**

You asked for the 2-Day pass to be "slightly higher than a simple proportional daily price." Proportionally, ₹199/30 ≈ ₹6.6/day → **₹13.3 for two days**. But the 2-Day plan is **unlimited** and sits *above* Monthly in your entitlement hierarchy. So at a proportional price, a heavy user buys 15 consecutive 2-Day passes for ~₹199/month and gets **unlimited playtime for the same money as the 6h/day plan**. Monthly becomes strictly dominated and nobody rational buys it.

The floor is set by how much premium unlimited should carry over 6h/day:

| TWO_DAY price | 15 passes ≈ 1 month | vs Monthly ₹199 |
|---|---|---|
| ₹13 | ₹195 | 0.98× — **monthly is dead** |
| ₹19 | ₹285 | 1.43× — thin |
| **₹29** | **₹435** | **2.2× — sane** |
| ₹49 | ₹735 | 3.7× — 2-Day becomes an impulse-only product |

₹29 is my placeholder because it keeps the ladder coherent. If you want to honour "slightly higher than proportional" literally, the fix is to **cap the 2-Day plan at 6h/day instead of unlimited** — then proportional pricing works and the hierarchy stays consistent. Your call; the resolver supports either by changing one field in `PLAN_POLICY`.

---

## 3. Data model (Prisma)

Additive only — nothing in your existing schema is modified except one optional back-reference on `User`.

```prisma
enum PlanCode      { FREE TWO_DAY MONTHLY YEARLY LIFETIME }
enum EntSource     { PLAY RAZORPAY AMAZON PROMO MANUAL }
enum EntStatus     { PENDING ACTIVE EXPIRED REVOKED SUPERSEDED }
enum PaymentStatus { CREATED PENDING CAPTURED FAILED REFUNDED }
enum SessionState  { ACTIVE CLOSED REAPED }

model Plan {
  id            String   @id @default(cuid())
  code          PlanCode
  currency      String   // ISO 4217
  priceMinor    Int      // paise. NEVER a float.
  active        Boolean  @default(true)
  displayName   String
  sortOrder     Int      @default(0)
  playProductId String?  // Play SKU / base plan id
  playBasePlan  String?
  razorpayPlanId String? // rzp plan_id, subscriptions only
  amazonSku     String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([code, currency])
}

model Entitlement {
  id          String     @id @default(cuid())
  userId      String
  planCode    PlanCode
  source      EntSource
  externalRef String     // Play purchaseToken | rzp payment_id | rzp subscription_id
  status      EntStatus  @default(PENDING)
  startsAt    DateTime
  endsAt      DateTime?  // null = never expires (LIFETIME)
  autoRenew   Boolean    @default(false)
  revokedAt   DateTime?
  revokeReason String?
  meta        Json?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  user        User       @relation(fields: [userId], references: [id])

  @@unique([source, externalRef])          // <- the anti-double-credit constraint
  @@index([userId, status, endsAt])
}

model Payment {
  id             String        @id @default(cuid())
  userId         String
  provider       EntSource
  providerRef    String        // rzp payment_id | Play purchaseToken | Amazon receiptId
  providerOrder  String?
  planCode       PlanCode
  amountMinor    Int?
  currency       String?
  status         PaymentStatus
  raw            Json?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  @@unique([provider, providerRef])
  @@index([userId, createdAt])
}

model WebhookEvent {
  id          String   @id @default(cuid())
  provider    EntSource
  eventId     String   // rzp x-razorpay-event-id | Pub/Sub messageId
  eventType   String?
  payloadHash String
  processedAt DateTime @default(now())
  @@unique([provider, eventId])            // <- the idempotency constraint
}

model PlaySession {
  id             String       @id @default(cuid())
  userId         String
  fence          BigInt
  state          SessionState @default(ACTIVE)
  deviceId       String
  deviceLabel    String?
  planCodeAtStart PlanCode
  unlimited      Boolean
  startedAt      DateTime     @default(now())
  lastBilledAt   DateTime     @default(now())
  leaseExpiresAt DateTime
  hbSeq          Int          @default(0)
  closedAt       DateTime?
  closeReason    String?
  @@index([userId, state])
}

model UsageLedger {
  id           BigInt   @id @default(autoincrement())
  userId       String
  sessionId    String
  periodStart  DateTime          // denormalised bucket key
  secondsDelta Int
  reason       String            // heartbeat | close | reap | adjust
  idemKey      String
  createdAt    DateTime @default(now())
  @@unique([sessionId, idemKey])
  @@index([userId, periodStart])
}

model UsagePeriod {
  userId      String
  periodStart DateTime
  periodEnd   DateTime
  secondsUsed Int      @default(0)
  @@id([userId, periodStart])
}

model UserBilling {              // 1:1 side table — does not touch your User model
  userId       String   @id
  fenceCounter BigInt   @default(0)
  resetTz      String   @default("Asia/Kolkata")
  pendingTz    String?
  periodStart  DateTime
  periodEnd    DateTime
  riskTier     String   @default("normal")
  user         User     @relation(fields: [userId], references: [id])
}
```

Two constraints do most of the security work:
- `Entitlement @@unique([source, externalRef])` — a Play `purchaseToken` or a Razorpay `payment_id` can be credited **exactly once, ever**, across all users. Play's own guidance: *"purchaseToken is globally unique, so you can safely use this value as a primary key… Don't use orderId to check for duplicate purchases."*
- `WebhookEvent @@unique([provider, eventId])` — duplicate webhook delivery is a no-op.

**One partial unique index Prisma can't express** — add it in a raw migration:

```sql
CREATE UNIQUE INDEX one_active_session_per_user
  ON "PlaySession" ("userId") WHERE state = 'ACTIVE';
```

That single line is what enforces "multiple tabs / multiple devices / duplicate session prevention." It lives in the database, so it survives backend restarts and works across however many Node instances you run.

---

## 4. Entitlement resolver — the centralized brain

One module. Nothing else in the codebase decides what a user is allowed to do.

```ts
// server/src/billing/entitlement.ts

export type Effective = {
  planCode: PlanCode;
  unlimited: boolean;
  dailySeconds: number | null;
  entitlementId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  autoRenew: boolean;
  source: EntSource | null;
};

export async function resolveEffective(tx, userId): Promise<Effective> {
  const now = await serverNow(tx);              // SELECT now() — one clock, always
  const rows = await tx.entitlement.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
  });
  if (rows.length === 0) return FREE_EFFECTIVE;

  // highest priority wins; tie-break on the later endsAt (null = infinite)
  rows.sort((a, b) => {
    const d = PLAN_POLICY[b.planCode].priority - PLAN_POLICY[a.planCode].priority;
    if (d !== 0) return d;
    if (a.endsAt === null) return -1;
    if (b.endsAt === null) return 1;
    return b.endsAt.getTime() - a.endsAt.getTime();
  });
  return toEffective(rows[0]);
}
```

**Rules that fall out of this, matching your spec:**

- **Nothing is ever deleted or overwritten on a new purchase.** Buying Monthly while a 2-Day pass is live creates a second row. The 2-Day wins (priority 80 > 60) until it expires; then the Monthly takes over automatically with no cron, no migration, no write. This directly satisfies *"do not accidentally remove a valid entitlement just because another plan was purchased."*
- **Expiry is never a scheduled job.** An entitlement expires because `endsAt < now()` at read time. A server that was down for a week wakes up with correct state. There is no "expiry cron" that can fail.
- **Stacking same-plan purchases queues them.** Buying a second Monthly sets `startsAt = max(now, latest ACTIVE MONTHLY endsAt)`. You get 2 months, not 2 overlapping rows granting nothing extra.
- **Play subscriptions mirror, they don't compute.** For `source = PLAY`, `endsAt` is set from `lineItems[].expiryTime` returned by `purchases.subscriptionsv2.get` — Play owns the renewal clock, we reflect it.
- **`FREE` is never a row.** It's the fallback when the query returns nothing. There is no "grant free plan" step at signup, so a user who deletes and recreates state can't lose it.

---

## 5. Playtime accounting — the ledger

### 5.1 Invariants

1. Time is billed **only** from deltas the server measures on its own clock, between requests it actually received. The client's `elapsedRealtime` is accepted as a corroborating signal for anomaly detection and nothing else.
2. The ledger is **append-only and idempotent**. `UsagePeriod.secondsUsed` is a materialised fold, rebuildable from `UsageLedger` at any time.
3. All time comes from **Postgres `now()` inside the transaction** — never `Date.now()` per Node process, or multi-instance clock skew enters your billing silently.

### 5.2 Daily reset — the timezone decision, documented

**Boundary: 04:00 `Asia/Kolkata` (= 22:30 UTC the previous day).** Configurable via `PLAYTIME_RESET_TZ` and `PLAYTIME_RESET_HOUR`.

*Why a fixed server timezone rather than the device's:* if you recompute "today" from a client-reported timezone at evaluation time, a user burns 60 minutes in `Pacific/Kiritimati` (UTC+14), reports `Etc/GMT+12` (UTC−12), and their local calendar date walks backwards — a naive check grants a second allowance. The boundary span is 26 hours, so that's ~2 allowances per 26h, repeatable. A fixed server timezone is structurally immune.

*Why 04:00 and not midnight:* almost nobody is mid-session at 4am, so a reset never truncates active play. (Same reasoning Genshin uses for its 04:00 server-region reset.)

*The implementation detail that makes it safe:* `UserBilling.periodStart` / `periodEnd` are stored as **absolute timestamps** and are immutable mid-period. They roll only when `now() >= periodEnd`:

```
if (now >= billing.periodEnd) {
  billing.resetTz     = billing.pendingTz ?? billing.resetTz;   // deferred tz change
  billing.periodStart = billing.periodEnd;
  billing.periodEnd   = nextBoundary(billing.periodStart, billing.resetTz, RESET_HOUR);
}
```

Windows tile the timeline with no overlap and no gap. Use Luxon or `date-fns-tz` with IANA identifiers for `nextBoundary` — it must handle 23- and 25-hour DST days, which is why you compare *calendar dates in a zone*, never do 24-hour arithmetic.

**Upgrade path if you go properly global:** switch to a per-user pinned IANA zone with the same deferred-change mechanism (a zone change takes effect at the *next boundary computed under the old zone*), rate-limit zone changes to 1 per 30 days, and seed the suggestion from server-side IP geolocation rather than the device's report. The absolute-boundary design above already supports this — it's a config flip, not a rewrite.

### 5.3 Heartbeat accounting

Defaults, all env-configurable: `HB = 60s`, lease TTL `= 3 × HB = 180s`, grace `= HB / 2 = 30s`.

*(Grace is deliberately **half** the heartbeat, not equal to it. If grace = HB, the reap always bills a full extra interval while the user actually played somewhere in [0, HB) — that's a guaranteed over-charge of up to 60s and never any under-charge. At HB/2 the error is symmetric: at most 30s over, at most 30s free. Worth getting right, since it's the difference between "fair" and "we quietly bill everyone a minute they didn't play" every time a session drops.)*

```
BEGIN;
  SELECT * FROM "PlaySession" WHERE id = $1 FOR UPDATE;

  if state <> 'ACTIVE'          -> 410 Gone      (client must re-open)
  if $fence < session.fence     -> 409 Conflict  (superseded by a newer session)
  if leaseExpiresAt < now()     -> reap inline, then 410

  delta := EXTRACT(EPOCH FROM (now() - lastBilledAt))::int;

  INSERT INTO "UsageLedger" (..., secondsDelta := delta,
                             idemKey := sessionId || ':' || $seq, reason := 'heartbeat')
    ON CONFLICT (sessionId, idemKey) DO NOTHING;

  -- only if a row was actually inserted:
  INSERT INTO "UsagePeriod" (...) VALUES (...)
    ON CONFLICT (userId, periodStart)
    DO UPDATE SET secondsUsed = "UsagePeriod".secondsUsed + EXCLUDED.secondsUsed;

  UPDATE "PlaySession"
     SET lastBilledAt = now(), leaseExpiresAt = now() + interval '180 seconds', hbSeq = $seq;
COMMIT;
```

Response: `{ remainingSeconds, unlimited, nextHeartbeatMs, ticket? }`.

### 5.4 Crash / disconnect recovery

Two mechanisms, both required:

1. **Sweeper cron** (every 30s): `UPDATE "PlaySession" SET state='REAPED' WHERE state='ACTIVE' AND leaseExpiresAt < now()`, then one final ledger row per reaped session with `secondsDelta = LEAST(now() - lastBilledAt, GRACE)` and `idemKey = sessionId || ':reap'`.
2. **Lazy reap on read** — the same reap runs whenever *any* request touches the user (session open, heartbeat, `/billing/me`). This is what makes correctness independent of the cron being alive. Backend restarts don't lose time.

**The fairness property, which you should state in your ToS:**
- Maximum over-charge on an abandoned session = **30s**.
- Maximum free time on a crash = **30s**.

Symmetric by construction. Critically, **do not bill the full `now() - lastBilledAt` at reap time** — that lets a 3-hour network partition charge a user for 3 hours they didn't play.

A clean `POST /session/stop` carries only `{sessionId, fence}` and bills `now() - lastBilledAt` uncapped, because a clean close *proves* liveness at `now()`. **The client never sends a duration.** `playedTime = 5000` from the client is ignored — there is no field for it.

---

## 6. API surface

All under `/api/v1`, all behind your existing auth middleware, all on the **normal** Express router — none of these are on any latency-sensitive path.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/billing/plans` | Plan catalogue for the current currency + channel |
| `GET` | `/billing/me` | Effective entitlement + today's usage snapshot (the dashboard's only call) |
| `POST` | `/play/session/start` | Pre-flight gate. Validates entitlement, creates session, returns budget |
| `POST` | `/play/session/heartbeat` | Bills the delta, extends lease, returns remaining |
| `POST` | `/play/session/stop` | Finalises the session |
| `POST` | `/billing/razorpay/order` | Creates an Order (one-time) or Subscription |
| `POST` | `/billing/razorpay/verify` | Client callback — verifies signature, re-fetches, grants |
| `POST` | `/webhooks/razorpay` | `express.raw` route, HMAC-verified |
| `POST` | `/billing/google/purchase` | Client posts `purchaseToken` after a Play purchase |
| `POST` | `/webhooks/google/rtdn` | Pub/Sub push endpoint |
| `POST` | `/billing/amazon/verify` | Phase 2 |

`GET /billing/me` response shape:

```json
{
  "plan": "MONTHLY",
  "status": "ACTIVE",
  "unlimited": false,
  "startsAt": "2026-08-01T00:00:00Z",
  "endsAt":   "2026-09-01T00:00:00Z",
  "autoRenew": true,
  "today": { "limitSeconds": 21600, "usedSeconds": 15120, "remainingSeconds": 6480 },
  "resetsAt": "2026-08-17T22:30:00Z",
  "resetTimezone": "Asia/Kolkata",
  "serverTime": "2026-08-17T14:05:22Z"
}
```

`serverTime` is included so the client can render a countdown without ever trusting its own clock — it computes an offset once at session start and ticks locally from `SystemClock.elapsedRealtime()`.

---

## 7. Payment flows

### 7.1 Razorpay (direct build)

**One-time — 2-Day and Lifetime:**

```
POST /billing/razorpay/order  →  server creates Order (amount in PAISE, receipt ≤ 40 chars, unique)
                              →  client opens Checkout
                              →  handler returns razorpay_payment_id / order_id / signature
                              →  POST /billing/razorpay/verify
```

Verification, exact: `HMAC_SHA256(order_id + "|" + razorpay_payment_id, KEY_SECRET)`, compared with `crypto.timingSafeEqual`. Razorpay's own docs use `==`; that's a timing leak in your code, not theirs.

**Then re-fetch before granting.** `GET /v1/payments/:id`, confirm `status === "captured"` and that `amount`/`currency` match the plan. *The signature only proves the IDs are authentic — it does not prove money moved or that the amount is right.* Skipping this is the single most common way "fake payment success" gets through.

Use **auto-capture**. You're selling instant digital entitlements with no fulfilment risk, and manual capture introduces a 3-day cliff where uncaptured payments are silently auto-refunded.

**Subscriptions — Monthly and Yearly:** Razorpay Plans + Subscriptions, UPI Autopay default. **The subscription signature formula is reversed**: `HMAC_SHA256(razorpay_payment_id + "|" + subscription_id, KEY_SECRET)`. Two separate verify functions — not one helper with a boolean flag, that's how this gets confused.

Recurring grants are driven by `subscription.charged`, deduped on the **`payment_id` inside the payload**, not the `subscription_id` (which repeats every cycle). `subscription.halted` / `subscription.cancelled` stop future extension but **never retroactively revoke an already-paid period**.

**Webhooks:**
- Route mounted with `express.raw({type:'application/json'})` — *before* any `express.json()`. Sign the raw bytes; parsing and re-stringifying breaks the signature.
- Header `X-Razorpay-Signature`, HMAC-SHA256, keyed with the **webhook secret** — a different secret from `key_secret`. Using the wrong one is the second most common bug.
- **5-second timeout.** Verify → dedupe on `x-razorpay-event-id` → enqueue → return 200. Do not do multi-table Prisma writes plus an email inline.
- Retries run with exponential backoff for 24h, then the **endpoint is auto-disabled**. A bad weekend deploy permanently kills delivery until you re-enable it manually — which is exactly why §7.3 exists.

### 7.2 Google Play (playstore build)

**Ship Play Billing Library 9.1.0.** PBL 8+ is required for new apps and updates from 31 Aug 2026 (extension to 1 Nov 2026); PBL 9 buys you until Aug 2028. Note `queryPurchaseHistoryAsync()` is **removed** in PBL 9 — there is no client-side way to enumerate past consumed purchases, so your backend must be the history of record from day one.

Flow:
```
Client: launchBillingFlow with setObfuscatedAccountId(sha256(userId)) [≤64 chars, no PII]
     →  onPurchasesUpdated
     →  POST /billing/google/purchase { purchaseToken, productId }
Server: purchases.subscriptionsv2.get   (subs)  — purchases.subscriptions is DEPRECATED
        purchases.productsv2.getproductpurchasev2  (one-time)
     →  verify obfuscatedExternalAccountId == sha256(userId)
     →  insert Entitlement (unique on [PLAY, purchaseToken]) — collision = already credited
     →  acknowledge server-side (or consume, which also acknowledges)
```

**Acknowledge within 3 days or Play auto-refunds and revokes the purchase.** Do it server-side, checking `acknowledgementState` first. In test mode this window compresses to **5 minutes** — size your ack path accordingly. And per Play's security guidance, never *use* non-acknowledgement as a rejection mechanism (it's ambiguous with a processing timeout) — explicitly call `Orders.refund` with `revoke=true` instead.

**RTDN:** Pub/Sub topic, grant `google-play-developer-notifications@system.gserviceaccount.com` the Publisher role, set the topic as `projects/{id}/topics/{name}` in Play Console. **Select "Get all notifications for subscriptions and one-time products"** — the default scope omits `ONE_TIME_PRODUCT_PURCHASED`, so your 2-Day and Lifetime purchases would silently never notify.

**The RTDN payload is not trustworthy on its own** — Google states plainly that notifications only tell you state changed. Every handler re-queries the API and does a **full state reconciliation** keyed on `purchaseToken`, not an event-applied delta. That is order-independent by construction, which matters because Google documents no ordering guarantees. Dedupe on Pub/Sub `messageId`. Treat unknown notification integers as "re-query," never as a no-op (types 14, 15, 16, 21 are undocumented).

**`linkedPurchaseToken`:** when a monthly↔yearly switch happens, the response carries `linkedPurchaseToken` pointing at the old token. Mark that old entitlement `SUPERSEDED` and detach it, then bind the new one — otherwise you double-credit on every plan change.

**Refunds:** primary path is the `voidedPurchaseNotification` RTDN; back it with a `purchases.voidedpurchases.list` reconciliation sweep (pass **`type=1`** or you get one-time purchases only; 30-day retention window; 6,000 queries/day, 30 per 30s).

### 7.3 The reconciliation sweep (do not skip this)

A cron every 5 minutes that:
- polls Razorpay orders stuck in `created`/`attempted` older than 10 minutes via `GET /v1/orders/:id/payments` and settles them
- re-queries Play tokens in `PENDING`
- runs `voidedpurchases.list` hourly

This is what makes "server restart during payment processing," "webhook arrives late," and "payment server temporarily unavailable" non-events. Without it, a 24-hour webhook outage becomes permanent silent revenue loss.

---

## 8. Security & anti-abuse — mapped to your list

| Threat | Control |
|---|---|
| Frontend timer manipulation | Client never sends a duration. Server bills `now() - lastBilledAt` from Postgres. No API field accepts elapsed time. |
| System clock manipulation | All billing time is `SELECT now()` server-side. Client's `System.currentTimeMillis()` is never used; UI countdown ticks from `SystemClock.elapsedRealtime()` (monotonic, includes doze, unsettable) anchored to `serverTime`. Optionally report `TrustedTime` vs wall-clock skew as an anomaly signal. |
| Multiple tabs / devices / simultaneous sessions | `CREATE UNIQUE INDEX ... ON "PlaySession"("userId") WHERE state='ACTIVE'`. Second open → 409 with the existing device label + explicit "take over" (bumps fence, reaps old, opens new, one transaction). |
| Zombie sessions after a pause/partition | Monotonic **fence token** on `UserBilling.fenceCounter`, stamped on every session and ticket. Backend *and* PC server reject anything with a fence below the highest seen. (A TTL alone is unsafe — a GC pause longer than the lease creates two legitimate holders.) |
| Fake payment-success requests | Signature verification **plus** a server-side re-fetch confirming `captured` and matching amount/currency. |
| Replay attacks | `purchaseToken` / `payment_id` unique on `Entitlement` — globally credited once, ever. Short-lived access tokens bound to `sessionId`+`fence`. |
| Duplicate webhook processing | `WebhookEvent @@unique([provider, eventId])` inserted **inside** the same transaction as the business mutation. A concurrent duplicate blocks on the uncommitted index row and then no-ops — the transaction boundary *is* the mutual exclusion; no Redis lock needed. |
| Expired subscription abuse | Expiry evaluated at read time from `endsAt`. No cron can fail open. |
| API tampering / client-side entitlement modification | The client receives entitlement, it never asserts it. Every gate is server-side. |
| Restarting the app / logging out & in | Allowance is keyed on `userId` in Postgres. No device state, no local counter, nothing to clear. |
| **Multi-accounting (your cheapest real bypass)** | This is the one that actually costs you money — three free accounts = 180 min/day. Mitigations in cost order: require Play Integrity `appLicensingVerdict = LICENSED`; rate-limit account creation per device fingerprint + IP ASN; consider `deviceRecall` (beta — bits survive reinstall *and* factory reset); and price so paid is cheaper than the hassle. |

**On Play Integrity:** use it as a **risk tier, not a gate**. Quota is **10,000 requests/day** by default, shared across preparations and server-side decryptions — at one check per session start that's ~3,000 DAU at 3 sessions/day. Attaching it to every heartbeat would cap you at ~83 users/day. Opt into `MEETS_STRONG_INTEGRITY` and `recentDeviceActivity`, but don't hard-block on a missing STRONG verdict — you'd lose legitimate older devices, and your audience skews toward rooted enthusiasts. Note that Magisk/Zygisk "Play Integrity Fix" modules reliably spoof `MEETS_DEVICE_INTEGRITY`; and as of Quarkslab's August 2026 writeup, even hardware attestation can be relayed through one clean phone. It's a cost function, not a wall. **The real enforcement remains: the server owns the clock and the ledger.**

---

## 9. Latency isolation — the part that matters most

### 9.1 The rule

```
REAL-TIME PATH                      NON-REAL-TIME PATH
Controller input                    Auth
   ↓                                   ↓
Gamepad / UDP / TCP control         Subscription
   ↓                                   ↓
GRX frame construction              Payment
   ↓                                   ↓
Game state                          Entitlement
   ↓                                   ↓
Rendering                           Playtime accounting
                                       ↓
                                    Billing UI
```

**Nothing on the left may ever await anything on the right.** These are different hosts, different sockets, different threads, different lifecycles.

### 9.2 Where billing touches gameplay — exactly three points

1. **Before** the TCP control connection opens: one call to `/play/session/start`. Blocking is acceptable here because gameplay hasn't started. Budget it at 2s with a timeout.
2. **During** gameplay: one HTTP POST every 60s, from a dedicated coroutine on `Dispatchers.IO` inside the `connectedDevice` foreground service. It touches no shared mutable state on the input path — the only thing it writes is an `AtomicLong` remaining-seconds counter that the UI reads.
3. **After**: one call to `/play/session/stop`.

That's **three touch points and one request per minute.** Nothing per frame, nothing per input event, nothing per packet.

### 9.3 Tier-2 enforcement (recommended for the direct build)

The gap in a client-only design: your APK is a direct download, so a modified build can simply ignore "time's up." Closing it requires the **PC server** to be the enforcer, since it's what actually injects input.

**Capability ticket:**
- Backend signs `{sessionId, userId, fence, seq, issuedAt, ttl}` with **Ed25519**. GamepadServer embeds the public key.
- Every heartbeat response carries a fresh ticket, `ttl = 180s`.
- The phone forwards it to the PC over the **existing TCP control channel** — never the UDP input channel.
- The PC enforces expiry on its **own monotonic timer** started at ticket receipt (its wall clock is untrusted), and rejects any ticket whose `seq` ≤ the last accepted `seq`.
- When quota is exhausted, the backend simply **stops issuing tickets**. The PC tears down within ≤180s.

**Steady-state cost on the hot path: zero.** No per-packet check, no added RTT, no backend anywhere in the input loop. Ed25519 verification happens once per 60s on a control message. Given your Rust 2.0.1 server rewrite is already built and unactivated, this is a good thing to fold into that release.

### 9.4 Degradation

If the billing backend is unreachable mid-session:
- Gameplay **does not stop**. Ever.
- The client enters an offline grace window (default 10 min, configurable) and keeps retrying with jittered backoff.
- On reconnect, the server bills the reconciled delta (capped at the grace window) and issues a fresh ticket.
- If grace expires with no contact, the session ends *gracefully* with a toast — not a freeze, not a modal over gameplay.
- Never block controller input on an HTTP response. Never show a subscription overlay on top of an active game.

### 9.5 Explicit "do not touch" list

I'll produce the real list after reading the code, but the categories: the gamepad polling loop, the GRX frame builder, the UDP send path, the TCP control writer, haptics, gyro handling, and any thread/dispatcher wiring around them. **No new middleware on latency-sensitive endpoints. No new dependencies pulled into the input module.**

---

## 10. UI — subscription panel, isolated

Fits the existing glass language; I'll extract the actual tokens from your components rather than inventing any.

```
Plan: Monthly                          Plan: Lifetime
Today: 4h 12m / 6h                     Unlimited Playtime
Remaining: 1h 48m                      Active since 12/03/2026
Resets: 04:00 IST
Expires: 01/09/2026
```

Limit-reached copy, per your spec:
- Free: *"You've used today's 1 hour free playtime."*
- Monthly/Yearly: *"You've used today's 6 hour playtime limit."*
- Unlimited plans show **no daily restriction UI at all** while active.

**Rendering isolation:**
- The countdown lives in **one leaf component** with its own local state. No global store update, no context write, nothing above it re-renders.
- It ticks from `SystemClock.elapsedRealtime()` against a server-time offset captured once — no network call to tick.
- Update cadence **1 Hz only while the panel is visible**; paused entirely when off-screen or backgrounded.
- No animations, no blur recomputation, no layout thrash.
- Zero new UI libraries.

---

## 11. Environment variables

```bash
# --- Entitlement / playtime ---
PLAYTIME_RESET_TZ=Asia/Kolkata
PLAYTIME_RESET_HOUR=4
PLAYTIME_HEARTBEAT_SECONDS=60
PLAYTIME_LEASE_MULTIPLIER=3
PLAYTIME_REAP_GRACE_SECONDS=30           # = HB/2, keeps reap error symmetric
PLAYTIME_OFFLINE_GRACE_SECONDS=600
PLAYTIME_FREE_DAILY_SECONDS=3600
PLAYTIME_PAID_DAILY_SECONDS=21600

# --- Session ticket (Tier 2) ---
SESSION_TICKET_ED25519_PRIVATE_KEY=      # backend only
SESSION_TICKET_TTL_SECONDS=180
# public key is compiled into GamepadServer

# --- Razorpay ---
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=                     # signature verification
RAZORPAY_WEBHOOK_SECRET=                 # DIFFERENT secret, X-Razorpay-Signature
RAZORPAY_MODE=test|live

# --- Google Play ---
GOOGLE_PLAY_PACKAGE_NAME=
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON=        # file path or base64; never in the repo
GOOGLE_PLAY_PUBSUB_VERIFY_AUDIENCE=
GOOGLE_CLOUD_PROJECT_NUMBER=             # Play Integrity

# --- Play Integrity (optional) ---
PLAY_INTEGRITY_ENABLED=false
```

Every secret is backend-only. The Android client holds **only** `RAZORPAY_KEY_ID` (public by design) and the Play public licence key.

---

## 12. Provider configuration steps

**Razorpay:** activate account (PAN + address proof + bank proof matching PAN exactly; GST cert if turnover > ₹20L; approval 2–7 working days, settlement T+2) → generate test keys → create Plans for Monthly/Yearly → add webhook endpoint (**port 443 only**, max 30 URLs) subscribed to `payment.captured`, `payment.failed`, `order.paid`, `subscription.*`, `refund.processed` → set its own webhook secret.

**Google Play:** create GCP project (**no Play Console linking required any more**) → enable `androidpublisher.googleapis.com` → create service account + JSON key → Play Console → Users & Permissions → invite the service-account email with *"View financial data"* + *"Manage orders and subscriptions"* → create the subscription product with monthly + yearly base plans, and two one-time products (2-Day consumable, Lifetime non-consumable) → Monetization setup → RTDN → set Pub/Sub topic + grant Publisher to `google-play-developer-notifications@system.gserviceaccount.com` → **select the "all notifications" scope** → Settings → License testing → add your test accounts.

**Sandbox testing:** Razorpay `rzp_test_` keys, card `4111 1111 1111 1111`, UPI `success@razorpay` / `failure@razorpay`, subscriptions charged manually via the Dashboard **"Charge this now"** button (cycles are *not* auto-compressed; test card tokens expire in 3 days). Play: publish to internal test track, add license testers, use the "always approves" / "always declines" / "approves then charges back" test instruments. Play test durations compress — monthly → 5 min, yearly → 30 min, acknowledgement window → 5 min, max 6 renewals.

---

## 13. Files I expect to create vs modify

**Create (backend):** `billing/plans.ts`, `billing/entitlement.ts`, `billing/playtime.ts`, `billing/session.ts`, `billing/ticket.ts`, `billing/providers/razorpay.ts`, `billing/providers/googleplay.ts`, `billing/webhooks/razorpay.ts`, `billing/webhooks/rtdn.ts`, `billing/reconcile.ts`, `routes/billing.ts`, `routes/play-session.ts`, plus Prisma migrations.

**Create (Android):** `billing/EntitlementRepository.kt`, `billing/PlaySessionClient.kt`, `billing/HeartbeatService.kt` (FGS type `connectedDevice`), `billing/PlayBillingManager.kt` (playstore flavour source set only), `billing/RazorpayCheckout.kt` (direct flavour source set only), `ui/PlanPanel.kt`, `ui/PlaytimeCounter.kt`.

**Modify (minimal):** router mounting (add two routers), `schema.prisma` (additive), `AndroidManifest.xml` (FGS type + permissions), `build.gradle.kts` (flavour-scoped billing deps), the pre-game entry point (one gate call), the settings/account screen (one panel), `docs/REGRESSION_CHECKLIST.md`.

**Untouched:** gamepad polling, GRX frames, UDP/TCP transport, haptics, gyro, pairing, auth, existing UI components.

Per-file `File / What changed / Why / Dependencies added / Env vars` reports come with the implementation.

---

## 14. Test matrix — your 31 tests, and how each gets verified

| # | Test | Method |
|---|---|---|
| 1–3 | Free 1h, blocked at limit, next-day reset | Integration test with an injectable clock; assert `UsagePeriod` rolls at the 04:00 IST boundary |
| 4–7 | Monthly activation, 6h/day, blocked, reset | Razorpay test-mode subscription + Play test instrument |
| 8–9 | Yearly same daily rule, correct expiry | Same suite parameterised; assert `endsAt` = +1y |
| 10–12 | 2-Day unlimited, expires at exactly 48h, falls back | Clock-advance test asserting resolver returns FREE at T+48h+1s |
| 13 | Lifetime permanent unlimited | `endsAt = null`, resolver returns unlimited at T+10y |
| 14 | Multiple purchases | Overlapping 2-Day + Monthly: assert 2-Day wins, then Monthly takes over with **no data loss** |
| 15–17 | Payment success / fail / cancel | Razorpay test card success + failure; abandoned checkout leaves order `created`, no entitlement |
| 18 | Webhook arrives after client callback | Delay webhook, assert exactly one entitlement (unique on `payment_id`) |
| 19 | Same webhook multiple times | Replay 5× with the same `x-razorpay-event-id`; assert one `WebhookEvent`, one grant |
| 20 | Verification fails | Tampered signature → 400, no entitlement, logged |
| 21–22 | Disconnect / crash mid-session | Kill heartbeat; assert reap at lease expiry, billed delta ≤ grace |
| 23–24 | Multiple tabs / devices | Concurrent `/session/start` → one 201, one 409 with device label |
| 25–26 | App restart, logout/login | Assert `UsagePeriod.secondsUsed` unchanged across both |
| 27 | System time change | Set device clock ±12h mid-session; assert billed seconds track wall time exactly |
| 28 | Frontend tampering | Post crafted payloads to `/heartbeat`; assert no field can influence the delta |
| 29 | Subscription expires while app open | Advance past `endsAt`; assert next heartbeat returns free-tier remaining, no crash |
| 30 | Payment server unavailable | Kill Razorpay/Play reachability mid-session; assert gameplay continues, reconciles on recovery |
| 31 | **Latency unaffected** | See below |

**Test 31 methodology** — measured, not asserted. Baseline on the current build, then re-measure identically:
- input→UDP-send latency at p50/p95/p99, instrumented with `elapsedRealtimeNanos()` at the poll and at the socket write
- input event processing time distribution
- GC allocation rate in the input path (Android Studio Profiler) — target **zero new allocations**
- frame timing via `dumpsys gfxinfo` — janky-frame percentage
- CPU and memory delta, app-level
- network: packet count and bytes on the gameplay socket must be **byte-identical**; billing traffic is a separate socket at 1 req/min
- haptic round-trip and gyro event rate

**Acceptance: p99 input latency regression < 1ms, zero new allocations in the input path, zero change in gameplay socket traffic.** If any of those fail, the billing integration is wrong and gets reworked — not the gameplay path.

---

## 15. Open questions I need answered before implementing

1. **Auth:** what does the Android client hold — a long-lived token, a session cookie, JWT + refresh? This determines whether `/play/session/*` can reuse your existing middleware as-is.
2. **Who owns "a session started"** — does the phone know, or does the PC server tell it? That decides where the pre-flight gate goes.
3. **Do you want Tier-2 (PC-server ticket) enforcement in v1?** It's the difference between "the ledger is right" and "a modded APK can't play free." Folding it into the unactivated Rust 2.0.1 release is the cheap moment to do it.
4. **Global or India-first?** Fixed IST reset is simpler and abuse-proof; per-user pinned zones are nicer for users like Aukstea. The design supports both — I need to pick a default.
5. **Do you want the aptoide/uptodown/amazon builds to show plan status at all,** or be entirely free-tier with no billing UI?
6. **Confirm the Play production access from 12 Aug** covers what you need, and check whether your Google payments profile has a **BillDesk KYC** deadline — one source indicated 31 Aug 2026 for existing Indian merchants, with sales blocked on failure. **Verify this in your Payments Center directly; I could not confirm it applies to you.**

---

## 16. Things I could not verify — do not treat these as settled

- Whether Aptoide's Annex I "MoR Territories" includes India (changes who's merchant of record and who owes GST there).
- Whether Uptodown actually permits third-party processors — absence of a ban is not permission. **Get it in writing before shipping a Razorpay build there.**
- Whether Amazon's 80/20 Small Business Accelerator rate covers IAP/subscriptions or only app sales.
- Razorpay order expiry — **no TTL is documented anywhere**. Don't build logic that assumes one.
- Razorpay international card MDR: their pricing page implies 2%, their pricing explainer says 3%. Confirm on your own rate card.
- Android 17's stable status and the exact `ACCESS_LOCAL_NETWORK` enforcement date — Google's release-notes page still showed Beta 4.1 when I checked. **This is the highest-risk unknown in this document for your PC path.**
- The status of Google's Supreme Court appeal against the NCLAT ruling — India's Play billing terms are legally unsettled, and the 4% India alternative-billing discount is not worth its PCI-DSS + 24-hour-reporting burden at your scale anyway.
- GST treatment for Razorpay-collected digital subscriptions (18% assumed) and export-of-service/LUT treatment for foreign customers. **As an India-based developer you are the taxable person on Play sales too — Google does not act as GST merchant of record for you, unlike for foreign developers.** Talk to a CA.
