# GamepadOS Billing Backend — Architecture Review & Baseline

**Reviewed:** 18 August 2026 · **Scope:** `backend/` as supplied (9,344 lines across 29 files)
**Nothing was modified.** No code was rewritten, no dependencies added, no migrations created.

**What I could run:** PostgreSQL 16.13 locally, to test the two claims that only a real database can
settle. Three of nine test suites (`entitlement`, `period`, `playtime` — the ones with no `zod` or
`express` import); all pass. npm is blocked in this environment, so the six suites needing
`node_modules` could not be executed, and Prisma itself could not be run. Where a finding depends on
Prisma behaviour I verified it against Prisma's issue tracker and changelog and say so explicitly.

---

## 1. Executive Summary

This is a well-designed system. The core architectural decisions — append-only entitlements, priority
resolution at read time, expiry as a read-time fact rather than a cron, external references as the
idempotency key, the database as the only clock — are correct, they are consistently applied, and the
comments explaining *why* are better than almost any codebase I read. The design document and the code
agree with each other, which is rare. Whoever wrote this understood the problem.

The defects are concentrated, and they cluster into three groups:

**One systemic mechanism is wrong.** The codebase uses the pattern *"try to insert, catch `P2002`,
carry on inside the same transaction"* in six places. **On PostgreSQL this does not work.** A
constraint violation aborts the whole transaction; every subsequent statement fails with `25P02` and
the `COMMIT` silently becomes a `ROLLBACK`. Prisma does not wrap queries in savepoints on 5.x or 6.x.
I confirmed both halves — the PostgreSQL behaviour by running it, the Prisma behaviour from their
issue tracker and changelog. The most common consequence is not exotic: **a retried heartbeat returns
500 and does not extend the lease**, and heartbeat retries happen on every flaky mobile connection.
This is the single most important finding in the review.

**The Google Play one-time path cannot work as written.** `productEntitlement()` reads
`purchase.purchaseState || purchase.purchaseStateContext`, which matches neither the v1 shape (where
`purchaseState: 0` means *purchased* and `0` is falsy) nor the v2 shape (where `purchaseStateContext`
is an object). Every real 3-Day and Lifetime purchase through Play would be read as not-purchased,
and the code would then try to *revoke* it. The test suite passes because it feeds a third shape,
`purchaseState: 'PURCHASED'` as a top-level string, which Google returns from neither endpoint.
Behind that bug sits a second one: the client's `productId` is trusted, so once the state parsing is
fixed, a user can buy the ₹19 pass and claim the Lifetime SKU.

**Two documented invariants are not actually enforced.** The daily limit is checked only when a
session opens — nothing terminates or refuses a session that has run past its quota, and the Ed25519
capability ticket that BILLING_DECISIONS §2.4 relies on to make that safe does not exist anywhere in
the codebase, on either side. And the Razorpay `payment.captured` webhook grants a plan from
`notes.planCode` **without checking the amount**, which is exactly the check invariant 6 says is never
skipped. The client-callback path does check it; the webhook path does not.

Against that, several things are genuinely, verifiably right, and I want to say so with the same
specificity:

- **`period.js` is correct.** I ran every one of the 418 IANA zones Node knows, over 2026–2028, with
  dense sampling either side of all 260 DST transitions. At the configured reset hour of 4 there are
  **zero** containment failures, zero tiling gaps or overlaps, and zero out-of-range period lengths.
  It handles 23- and 25-hour days, the 26-hour zone spread, and leap days. `addMonths` clamps
  correctly, including 30 Nov + 3 months → 29 Feb 2028.
- **`PlaySession.activeKey` works.** I built the table in PostgreSQL 16 and confirmed it: many NULLs
  coexist, and a second `ACTIVE` row for the same user is rejected by the index. The trick is sound.
- **Both Razorpay signature formulas are correct and correctly applied**, including the reversal.
- **The ownership checks caught in testing are properly fixed**, and returning `410 GONE` rather than
  `403` so the endpoint can't be used to probe session ids is a nice touch.

My honest summary: the architecture is production-grade; the implementation is not yet, and the gap is
narrower than the list below makes it look. Nothing here requires a redesign. The systemic transaction
issue is one mechanism repeated six times.

---

## 2. System Architecture

### Application shape

A single Express 5 process, `server.js` (2,608 lines), serving three separate products from one app:
the support/ticketing backend, the admin portal, and — new — billing. There are no routers; every
route is a bare `app.get`/`app.post`, and billing follows that convention deliberately (four
`register*Routes(app, deps)` functions called near the end of the file). Prisma 5.21 on PostgreSQL in
production, with a parallel SQLite schema for local development that constrains the design (no enums,
no `Json` columns).

Boot sequence: `prestart` runs `prisma generate` then a non-fatal `prisma db push` — **there are no
migration files**, which is the single most consequential structural fact about this codebase. It is
why the partial unique index for one-active-session-per-user had to become the nullable `activeKey`
column, and it is why the `Plan` uniqueness problem (§14, C4) cannot be fixed by hand-writing an
index. On `listen`: legacy reply backfill, `seedPlans`, `startReconciliation`.

### Middleware order (this is load-bearing and correctly built)

```
1  ALLOWED_ORIGINS parsed from FRONTEND_URL
2  publicCors (origin: true) on /api/support/ticket, /api/download, /api/pads,
   /api/account, /api/billing, /api/play          ← must precede 3
3  allowlist cors()
4  registerRazorpayWebhook  → express.raw on /api/webhooks/razorpay   ← must precede 5
5  express.json({ limit: '2mb' })
…  ticketing, account, admin routes
N  registerBillingRoutes / Razorpay / GooglePlay / BillingAdmin
N+1 GET /  (health)
N+2 404 handler                                    ← must stay last
```

Both documented ordering constraints hold in the file as supplied. The reasoning in the comments is
right, and the failure modes if they are broken are exactly as described: the Razorpay webhook would
fail every delivery with no symptom, and the WebView's preflight would fail on billing.

One thing the comments do not say: the webhook route sits at `/api/webhooks/razorpay`, which is *not*
under `/api/billing`, so it is governed by the allowlist CORS at step 3, not `publicCors`. That is
harmless — Razorpay sends no `Origin` header and the allowlist admits requests without one — but it
means the two prefixes at step 2 are not a complete description of "the billing surface".

### Authentication — two independent systems

| | Users | Admins |
|---|---|---|
| Table | `User` / `UserSession` | `Admin` / `AdminSession` |
| Credential | opaque 64-hex **bearer token**, 90-day expiry | 64-hex token in an **HttpOnly cookie** |
| Resolver | `requireUser(req,res)` — returns a user or sends 401 itself | `requireAdmin` middleware, sets `req.admin` |
| Escalation | none | `requireOwner` (role === 'owner'), `requireStaff` |
| Back door | none | `Authorization: Bearer <ADMIN_PASSWORD>` acts as owner |

Passwords are scrypt with a per-password salt and constant-time compare (`auth.js`). Sessions are
server-side, so revocation is immediate — the right call, and the reason bearer-not-JWT was chosen
(the WebView origin differs from the API origin) is sound.

`requireUser` is a *function*, not middleware, and every billing route calls it as
`const user = await requireUser(req,res); if (!user) return;`. Consistent across all eight user-authenticated billing
routes; I checked each one.

### Billing module map

```
plans.js        catalogue + policy: priorities, daily limits, durations, addMonths, computeEndsAt
period.js       daily reset boundaries — Intl only, no date library
entitlement.js  serverNow (THE clock), pickEffective (pure), resolveEffective, stackedStartsAt
grant.js        grantEntitlement / recordPayment / claimWebhookEvent / revoke / supersede
playtime.js     ledger, sessions, reap, heartbeat, stop, admin compensation
providers/razorpay.js    signatures ×3, orders, subscriptions, paymentMatchesPlan
providers/googleplay.js  SA JWT, purchase lookups, RTDN parsing, entitlement shaping
routes.js              /api/billing/plans, /api/billing/me, /api/play/session/{start,heartbeat,stop}
routes.razorpay.js     /api/billing/razorpay/{order,verify}, /api/webhooks/razorpay
routes.googleplay.js   /api/billing/google/purchase, /api/webhooks/google/rtdn
routes.admin.js        promo redeem + /api/admin/billing/*
reconcile.js           three sweeps on unref'd timers
seed.js                plan rows at boot, never edits a price
```

The dependency graph is clean and acyclic: `plans` and `period` are leaves; `entitlement` depends on
`plans`; `grant` and `playtime` depend on `entitlement`; routes depend on everything; nothing depends
on a route. **`plans.js` is the only place a limit or priority is written down**, and I verified no
other file hardcodes one.

---

## 3. Request / Data / Billing Flow

Your proposed flow, corrected against the implementation:

```
User
 → authentication                    bearer token → UserSession → User        ✅ as described
 → purchase initiated               POST /api/billing/razorpay/order          ✅
                                    (amount read from Plan, notes stamped server-side)
                                    — no equivalent step for Play: the client
                                      launches the billing flow itself and only
                                      tells us afterwards
 → provider payment                  outside our system                       ✅
 → provider verification             TWO doors per provider, converging:      ⚠️ see below
      Razorpay: /razorpay/verify (signature → re-fetch → amount check)
                /webhooks/razorpay (webhook signature → NO amount check)
      Play:     /google/purchase (re-query by token)
                /webhooks/google/rtdn (re-query by token)
      backstop: reconcile.js sweeps
 → entitlement creation/update       grantEntitlement, keyed @@unique(source, externalRef)  ✅
 → entitlement resolution            resolveEffective — priority, read-time expiry          ✅
 → playtime authorization            openSession ONLY                          ⚠️ not re-checked after
 → active play session               PlaySession + activeKey uniqueness         ✅
 → playtime accumulation             heartbeat → UsageLedger → UsagePeriod      ⚠️ no quota cut-off
 → entitlement fallback/expiry       automatic, no write                        ✅
```

Two corrections worth stating plainly:

**"Provider verification" is not one step, it is a convergence.** Both providers have a client door
and a server door that race, and the whole design rests on them being idempotent rather than ordered.
That is the right architecture. But the two Razorpay doors do **not** apply the same checks — the
callback verifies the amount against the `Plan` row, the webhook trusts `notes.planCode`.

**"Playtime authorization" happens once, at the start.** After `openSession` returns, nothing in the
backend will stop or refuse a session because the quota ran out. `heartbeat` computes
`remainingSeconds`, returns it, and extends the lease regardless of whether it is zero. The design
that was supposed to close this — the Ed25519 ticket the backend stops issuing (§2.4) — is not
present in the code at all.

### The two request shapes that matter

**Session open.** One `prisma.$transaction`: `serverNow` → `reapExpired(user)` → `ensureBilling`
(creates or rolls the period) → `resolveEffective` → `usedSecondsFor` → refuse if exhausted → check
for an existing ACTIVE session (409, or bill-and-close on takeover) → increment `fenceCounter` →
create the session with `activeKey = userId`. Roughly 8–10 round trips inside one transaction.

**Heartbeat.** One transaction: `serverNow` → load session → ownership, state, fence and lease checks
→ `ensureBilling` → `resolveEffective` → `appendUsage(now − lastBilledAt)` → optional offline
reconciliation via `max(server, client)` → update `lastBilledAt`/lease/`hbSeq` → re-read the total.
Also ~8–10 round trips, once a minute per active player (once per 5 minutes for unlimited plans,
which is a genuinely good optimisation — the most committed customers become the cheapest to serve).

---

## 4. Core Invariants

Your twelve, assessed against the code:

| # | Invariant | Holds? | Enforced by |
|---|---|---|---|
| 1 | Purchases are append-only; nothing is removed | ✅ | `grantEntitlement` only ever inserts; `revoke`/`supersede` set a status, never delete |
| 2 | Highest-priority active entitlement wins | ✅ | `pickEffective` sort; tested exhaustively |
| 3 | Expired entitlements fall back automatically | ✅ | read-time filter — no write, no cron |
| 4 | External references are globally idempotent | ✅ (mechanism) ⚠️ (recovery path) | `@@unique([source, externalRef])`. The constraint is sound; the `P2002` **recovery** is broken — §14 C1 |
| 5 | Clearing app data cannot reset playtime | ✅ | quota keyed on `userId`; `reconcileClientTotal` takes `max` |
| 6 | Server/database time is authoritative | ✅ mostly | `serverNow` uses `CURRENT_TIMESTAMP` everywhere in the billing path. Four `Date.now()` uses remain, all outside billing arithmetic — §15 R11 |
| 7 | One active play session per user | ✅ **verified against PostgreSQL 16** | unique index on nullable `activeKey`; all three close paths clear it atomically with `state` |
| 8 | A signature alone never grants | ✅ Razorpay callback / ❌ Razorpay webhook | §14 C5 |
| 9 | Provider status and amount/currency independently verified | ⚠️ partial | `paymentMatchesPlan` is only called on the callback path |
| 10 | Providers abstracted behind provider-specific verification | ✅ | `grant.js` is provider-agnostic; both providers funnel into it |
| 11 | Money is integer paise | ✅ | `Int` throughout; the only division is `/100` for display in audit strings |
| 12 | Ownership enforced on every relevant endpoint | ✅ | checked all eight user-authenticated billing routes — §9 |

### Additional invariants I found that are not on your list

13. **FREE is never a row.** `grantEntitlement` throws if asked to store one. This is what makes
    "delete and recreate state" safe, and it is load-bearing: a stored FREE row could expire, leaving
    a user with less than nothing.
14. **Same-plan purchases queue, they do not overlap.** `stackedStartsAt` starts a second Quarterly at
    the first one's `endsAt`, so buying twice buys six months rather than paying twice for three.
15. **We compute duration for what we sell; we mirror it for what a provider sells.** `computeEndsAt`
    for one-time and promo/manual grants; `endsAt` mirrored from Play's `expiryTime` and Razorpay's
    `current_end` for subscriptions. Explicitly distinguished by whether `endsAt` is passed at all
    (`endsAt !== undefined`), which correctly allows an explicit `null`.
16. **A cancelled subscription never retroactively revokes a paid period.** The
    `subscription.halted/cancelled/completed` branch clears `autoRenew` and touches nothing else.
17. **`state` and `activeKey` are always written together.** All three close paths (reap, takeover,
    stop) set both in one `update`. Nothing else writes either column. This is currently correct and
    is entirely a convention — see §17.
18. **`UsagePeriod` is a fold, never a source.** Every mutation goes through `appendUsage`, which
    writes the ledger first and only increments the period if the ledger row was actually new. The
    period total is rebuildable. This is what makes admin compensation safe as a negative row.

---

## 5. Concurrency & Distributed-System Review

### 5.1 The systemic problem: `P2002` inside an interactive transaction

**This is the finding I would act on first.**

The pattern appears six times:

| File | Function | After the catch it does |
|---|---|---|
| `grant.js:57` | `grantEntitlement` | `tx.entitlement.findUnique` |
| `grant.js:97` | `recordPayment` | `tx.payment.update` |
| `grant.js:118` | `claimWebhookEvent` | returns `false` — **the caller continues** |
| `playtime.js:169` | `appendUsage` | returns `false` — **the caller continues** |
| `routes.admin.js:98` | promo redeem | `promoRedemption.create`, `count`, `update`, `resolveEffective` |
| `reconcile.js:69` | order sweep | `grantEntitlement`, `payment.updateMany` |

**What actually happens on PostgreSQL.** I ran this against PostgreSQL 16.13:

```sql
BEGIN;
INSERT INTO usage_ledger VALUES ('l1','sessA','sessA:1',60);   -- INSERT 0 1
INSERT INTO usage_ledger VALUES ('l2','sessA','sessA:1',60);   -- ERROR 23505 unique_violation
SELECT 'can I still query?';        -- ERROR 25P02 current transaction is aborted
UPDATE play_session SET state='REAPED' WHERE id='s1';  -- ERROR 25P02
COMMIT;                             -- ROLLBACK
```

Afterwards: `ledger_rows = 0`, `s1` still `ACTIVE`. **The first, successful insert was lost too.**
PostgreSQL's own documentation is explicit that `ROLLBACK TO SAVEPOINT` is *"the only way to regain
control of a transaction block that was put in aborted state by the system due to an error"*.

**Prisma does not issue those savepoints.** Savepoint support is still an open request
([prisma#12898](https://github.com/prisma/prisma/issues/12898),
[prisma#19346](https://github.com/prisma/prisma/issues/19346)); the word does not appear on the
transactions docs page for v5 or v6; savepoints landed only in **v7.5.0 (11 Mar 2026)** and even then
only around *nested `$transaction` calls*, not per query. The symptom is reported against both 5.x
([prisma#22536](https://github.com/prisma/prisma/issues/22536)) and 6.x
([prisma#26863](https://github.com/prisma/prisma/issues/26863)). This project is on **5.21**.

**The everyday failure, in full.** Not a rare race — this is the common case:

> A client heartbeats with `seq = 5`. The server bills 60s, commits, and starts writing the response.
> The mobile connection drops before the response arrives. The client retries `seq = 5` (correctly —
> the idempotency key exists precisely so retries are safe).
> `appendUsage` runs `INSERT INTO UsageLedger ... idemKey = 'sess:5'` → `23505` → Prisma raises
> `P2002` → `appendUsage` catches it, returns `false`, and `heartbeat` continues as designed.
> The next statement — `tx.playSession.update({ lastBilledAt, leaseExpiresAt, hbSeq })` — fails with
> `25P02`. The error is not a `PlaytimeError`, so `sendPlaytimeError` logs it and returns **500**.
> **The lease was not extended.** If the client's retries keep colliding, the lease expires after
> 180s, the session is reaped, and the player is thrown out of a game they are still playing.

The same mechanism in the other five places:

- **`reapExpired` under two instances.** Both sweepers select the same stale sessions; both try
  `idemKey = '<id>:reap'`; the loser's `P2002` poisons its transaction, so its
  `playSession.update(state: REAPED, activeKey: null)` never runs and the *entire batch of up to 200
  sessions* it had already processed rolls back. With `PLAYTIME_SWEEP_INTERVAL_MS = 30s` on every
  instance, this happens on essentially every tick once you scale past one instance.
- **`grantEntitlement` in the callback/webhook race** — the exact race the file was written for. The
  winner commits and the user does get their entitlement, so money is not lost; but the loser 500s
  instead of returning the winner's row, and if the loser is the webhook it has already been marked
  processed (§5.3).
- **`recordPayment`** collides whenever the callback and webhook both write `payment.id`, which is
  the normal case, taking the surrounding `grantEntitlement` down with it.
- **`sweepRazorpayOrders`** — if a `Payment` row for the captured id already exists but the
  entitlement was never granted, `recordPayment` collides and poisons the transaction *before*
  `grantEntitlement` runs. The `catch` logs a warning and moves on. **The backstop cannot repair
  precisely the state it exists to repair**, and it will fail identically on every future pass.
- **Promo redemption**, on a double-tap.

**Why no test catches this.** Every suite uses an in-memory stand-in whose transaction is
`async $transaction(fn) { return fn(prisma) }` — no transaction semantics at all. It throws
`P2002`-shaped errors and then happily continues. The tests are therefore verifying that the
*recovery code is reached*, and it is; they cannot see that on the production engine everything after
it fails. This is not a gap in test *coverage*, it is a gap in test *fidelity*, and it is the single
highest-leverage thing to change about the test setup.

**Scope note.** `usagePeriod.upsert` is *not* affected — Prisma compiles `upsert` to a native
`INSERT ... ON CONFLICT` on PostgreSQL when five documented conditions hold, and I confirmed
separately that `ON CONFLICT` against an existing row raises no error and leaves the transaction
usable. Only the explicit `create`-then-catch sites are affected.

### 5.2 `PlaySession.activeKey` — does it actually hold? Yes.

I built the table in PostgreSQL 16 and tested it directly rather than reasoning about it:

```
 id  | userId | activeKey | state
-----+--------+-----------+--------
 s0  | u1     |           | CLOSED     ← NULL
 s00 | u1     |           | CLOSED     ← NULL, coexists fine
 s1  | u1     | u1        | ACTIVE

INSERT ... ('s2','u1','u1','ACTIVE');
ERROR:  duplicate key value violates unique constraint "play_session_activeKey_key"
```

**The guarantee is genuine and it is the database's, not the application's.** PostgreSQL's default
`NULLS DISTINCT` behaviour means unlimited closed sessions coexist while at most one row can hold any
given `userId`. It holds across any number of Node instances, survives restarts, and does not depend
on the `findFirst` check above it. The `findFirst` is an optimisation for a friendly 409; the index is
the guarantee. That is the correct division of labour and the comment says so.

Two qualifications:

- **The losing concurrent open returns 500, not 409.** Two devices call `/session/start` at the same
  instant; both `findFirst` see nothing; both reach `playSession.create`; one gets `P2002`, which is
  *not* caught anywhere in `openSession`, so it propagates as a generic error. Correctness is intact
  — there is still exactly one session — but the user sees "Something went wrong" instead of "Already
  playing on another device", and it is invisible in monitoring.
- **`ensureBilling` has the same unguarded shape.** Two first-ever requests for a user (say
  `/billing/me` and `/session/start` fired together on first launch) both find no `UserBilling` row
  and both `create`. One gets an uncaught `P2002` → 500. Self-healing on retry, but it lands on the
  very first request a new user ever makes.

### 5.3 Webhook idempotency — the claim is stronger than the implementation

The schema comment says: *"The row is inserted INSIDE the same transaction as the business mutation,
so a concurrent duplicate blocks on the uncommitted index row and then no-ops. The transaction
boundary IS the mutual exclusion."* That is a correct description of a good design. **It is not what
the code does.**

```js
const fresh = await prisma.$transaction((tx) => claimWebhookEvent(tx, {...}));  // commits
if (!fresh) return res.json({ success: true, duplicate: true });
const result = await handleEvent(prisma, event);                               // separate txn
```

The claim commits first, in its own transaction. The consequence:

> Razorpay delivers `payment.captured`. `claimWebhookEvent` commits the `WebhookEvent` row.
> `handleEvent` then throws — a transient database blip, a `recordPayment` collision (§5.1), a deploy
> mid-request. The route returns 500, which is correct: it asks Razorpay to retry.
> Razorpay retries. `claimWebhookEvent` now finds the committed row and returns `false`. The route
> answers **200 `{duplicate: true}`**. Razorpay stops retrying. **The entitlement is never granted,
> and no retry will ever grant it.**

The `reconcile` sweep is named as the backstop, and for Razorpay *orders* it genuinely is — except in
the case described at the end of §5.1, where `recordPayment` collides on every pass. For
`subscription.charged` there is **no** backstop: `sweepRazorpayOrders` skips anything whose
`providerOrder` doesn't start with `order_`. For Play, RTDN has no renewal backstop at all
(`sweepPlayVoided` only covers refunds).

The same pattern is in the Play RTDN handler at `routes.googleplay.js:249`.

Double-*crediting* is still impossible — `@@unique([source, externalRef])` guarantees that
independently — so this loses events, it does not duplicate them. Which is the better failure
direction, but it is silent.

### 5.4 Reconciliation re-entrancy

Idempotent in intent and mostly in fact. `revokeEntitlement` and `supersedeEntitlement` check status
first and return `{revoked:false}` on a second call. `markExpiredEntitlements` is an `updateMany`
filtered on `status: ACTIVE`, so it converges. `grantEntitlement` is idempotent by constraint.

Not safe to run **concurrently**, for the reason in §5.1: `sweepSessions` calls `reapExpired`
globally, and two instances racing on the same stale session poison each other's transaction. Since
`startReconciliation` is called unconditionally at `listen`, **every instance runs every sweep**.
At two instances this is already happening every 30 seconds.

### 5.5 Other concurrency notes

- **Interactive transactions are long.** `openSession` and `heartbeat` each hold a connection for
  8–10 round trips. Prisma's default interactive-transaction timeout is 5s and the default pool is
  `num_cpus * 2 + 1`; at high concurrency, pool exhaustion will show up as `P2024` before anything
  else does.
- **`reapExpired` inside a caller's transaction** does `take: 200` and then two queries per stale
  session — up to 400 extra round trips inside a user-facing request that is nominally "open a
  session". Bounded, but the tail latency is not what the design intends.
- **The promo `count` phantom** is correctly acknowledged in the brief. Under `READ COMMITTED` two
  concurrent redemptions of the last slot can both see `count = max`. The per-user constraint is
  exact; the global cap can overshoot by the number of concurrent requests. For giveaway codes this
  is the right trade.
- **The in-memory rate limiters and the `presence` Map are per-process.** `server.js:443` says so
  ("Single-instance backend, so a Map is enough"). That comment is now in tension with the plan to
  scale horizontally.

---

## 6. Time & Period Calculation Review

**I tested this rather than reasoning about it.** For all 418 IANA zones Node 22 knows, over
2026-01-01 → 2028-01-01: samples every 37 hours, plus every 20 minutes for ±26 hours around all 520
UTC-offset transitions in the 130 DST-observing zones (located by 12-hour scan, then bisected to the
minute). Four assertions
per sample: `start ≤ t < end`; period length within 22–26 h; `periodFor(end).start === end` (tiling);
and the boundary renders at the intended local hour.

### Result: correct at the configured reset hour

| Reset hour | Genuine failures across all 418 zones |
|---|---|
| **4 (the default)** | **none** |
| 5 | none |
| 3 | none |
| 2 | none |
| 1 | 1 zone — `Antarctica/Troll` (containment) |
| 0 | 2 zones — `Africa/Cairo`, `Asia/Beirut` (tiling + containment) |

The mechanism, which I extracted separately: a failure needs the reset hour to coincide with the local
hour at which a **spring-forward gap begins** in that zone. Across 2026–2028 those hours are:

```
hour  0 → 5 zones    Africa/Cairo, America/Havana, America/Santiago, Asia/Beirut, Atlantic/Azores
hour  1 → 10 zones   Europe/Dublin, Europe/London, Atlantic/Canary, Antarctica/Troll, …
hour  2 → 100 zones  most of North America and continental Europe
hour  3 → 12 zones   Europe/Athens, Europe/Helsinki, Europe/Kiev, Asia/Nicosia, …
hour 22 → 1 zone     Pacific/Easter
hour 23 → 2 zones    America/Godthab, America/Scoresbysund
hour  4 → none
```

**04:00 is the one hour in the day that no IANA zone currently uses as a DST transition point.** The
choice was made for a UX reason ("almost nobody is mid-session at 4am") and it happens to also be the
safest possible value. That is luck, not design, and it is worth writing down so nobody changes it
casually.

At hours 2 and 3 the DST guard in `boundaryOnLocalDate` does its job: when the requested wall time
falls in a gap it steps forward to the next real hour, and containment and tiling both still hold. The
guard cannot fire at hour 0, because its condition is `p.hour < hour` and nothing is less than zero —
which is exactly why Cairo and Beirut (both of which jump 00:00 → 01:00) break there.
`Antarctica/Troll` breaks at hour 1 because it makes a **two-hour** jump, which the single-hour bump
does not clear.

Concretely, `Africa/Cairo` at reset hour 0, 23 Apr 2026: `periodFor` returns
`[2026-04-22T22:00Z, 2026-04-23T21:00Z)` for an instant of `2026-04-23T21:00:28Z` — the instant is
*after* the period end. `ensureBilling` would then see `now >= periodEnd` and re-roll on **every
request** for about an hour, rewriting `UserBilling` each time while never advancing.

### The rest of the time model

- **Boundaries are absolute and immutable mid-period.** `UserBilling.periodStart/periodEnd` are
  stored timestamps; they roll only when `now >= periodEnd`, and a pending zone change is applied at
  that moment. This is the correct design and it is what makes timezone farming structurally
  impossible rather than merely difficult.
- **The roll recomputes from `now`, not from the old `periodEnd`.** A server down for a week lands in
  the current period instead of replaying six. Correct, and the comment says why.
- **`serverNow` normalises the SQLite string.** `'YYYY-MM-DD HH:MM:SS'` is UTC, but `new Date()` reads
  that shape as *local* — a silent 5h30m error on an IST dev machine. Caught and handled. The kind of
  bug that would otherwise be diagnosed as "the logic is wrong" for a week.
- **`addMonths` clamps, verified:** 30 Nov 2026 + 3 → 28 Feb 2027; 31 Jan + 1 → 28 Feb; 30 Nov 2027 +
  3 → **29 Feb 2028** (leap); 29 Nov 2028 + 3 → 28 Feb 2029.
- **Entitlement durations are pure UTC arithmetic**, deliberately independent of the user's zone. 72h
  is 72h regardless of DST. Correct for a *term*, as distinct from a *daily boundary*.

### The gap: the per-user timezone is not wired up

`UserBilling.resetTz` defaults to `Asia/Kolkata` and **nothing ever changes it**. `pendingTz`,
`tzChangedAt` and `riskTier` are declared in the schema and read in exactly one place
(`ensureBilling` reads `pendingTz`), but **no endpoint writes any of them** — I grepped the whole
backend. So BILLING_DECISIONS §2.2c ("each account pins its own IANA timezone… seed the zone from the
user's location at signup… rate-limit zone changes to roughly one a month") is designed, has correct
infrastructure, and is not implemented. Today every user in the world resets at 04:00 IST — 18:30 the
previous evening in New York. The safety property is intact (nothing is farmable); the UX promise is
not delivered.

---

## 7. Razorpay Review

### Correct, and worth confirming explicitly

- **Both signature formulas, and their application.** One-time: `HMAC_SHA256(order_id + '|' +
  payment_id)`. Subscription: `HMAC_SHA256(payment_id + '|' + subscription_id)` — reversed. Both match
  Razorpay's documentation. `routes.razorpay.js:128` selects on `Boolean(razorpay_subscription_id)`,
  which is right. Keeping them as two functions rather than one with a flag is the correct call, and
  the tests assert each formula *fails* the other's verification — which is the assertion that
  actually matters.
- **Three distinct secrets, correctly separated.** `KEY_ID`, `KEY_SECRET` (signatures),
  `WEBHOOK_SECRET` (`X-Razorpay-Signature`). Using `key_secret` for webhooks is the classic error and
  the test explicitly guards it.
- **Raw-body handling.** `express.raw({type:'application/json', limit:'1mb'})`, hashed and verified
  before any parse. Registered above `express.json()`.
- **`safeEqual`** compares length first (not secret) then `timingSafeEqual`, and returns `false` for
  empty — so an unset secret can never verify as true.
- **The callback path does the step that matters.** Signature → `fetchPayment` → `paymentMatchesPlan`
  (captured + exact amount + currency) → grant. The amount comes from the `Plan` row, never the
  client.
- **Auto-capture** (`payment_capture: 1`) is right for instant digital goods, and the reasoning about
  the uncaptured-payment auto-refund window is correct.
- **Subscription shape is right.** `externalRef = payment.id` per charge, `endsAt` mirrored from
  `subscription.current_end`. A row per charge, which is correct for Razorpay and the mirror image of
  Play.
- **`makeReceipt`** respects the 40-char limit and is unique.

### Defects

**The webhook grants without an amount check.** `handleEvent`'s `payment.captured` / `order.paid`
branch reads `notes.userId` and `notes.planCode` from the payment entity and grants that plan. It
records `payment.amount` but never compares it to `Plan.priceMinor`. Compare with the callback path,
which does exactly that comparison twenty lines earlier in the same codebase.

The notes are trustworthy *if* they can only have been set by `/razorpay/order`, which stamps
`{userId, planCode, env}` server-side. The question is whether a client can attach its own `notes` to
the payment via Razorpay Checkout options — `notes` is a documented Checkout option, and if
client-supplied notes land on (or override) `payment.notes`, then: start a legitimate ₹19 THREE_DAY
order, add `notes: {userId: <self>, planCode: 'LIFETIME'}` to the Checkout options, pay ₹19, and the
webhook grants LIFETIME. I could not confirm Razorpay's precedence rules between order notes and
checkout notes — see §16 V1 — but **the check should not depend on the answer.** The callback path
already demonstrates the correct shape.

**`refund.created` revokes.** Razorpay's `refund.created` can still be followed by `refund.failed`;
the entitlement is already revoked and nothing un-revokes it. `refund.processed` is the terminal
event. Also, *any* refund — including a partial one — revokes the whole entitlement, and `voidedQuantity`-style
partial handling is absent.

**`subscription.cancelled` is not scoped to the subscription.** It clears `autoRenew` on *every*
`ACTIVE`, `autoRenew`, `RAZORPAY` entitlement the user has, not just those belonging to the cancelled
`subscription.id`. Harmless with one subscription per user; wrong the moment that stops being true.

**`sweepRazorpayOrders` does not verify the captured amount** before granting. Lower risk than the
webhook — the order was created by us with the plan price and `partial_payment` is off — but it means
two of three Razorpay grant paths skip the check that invariant 6 promises.

---

## 8. Google Play Review

### Correct

- **Service-account JWT** built and signed with `crypto` (RS256), correct claim set, token cached with
  a 60s safety margin.
- **`subscriptionsv2`** is used, not the deprecated `purchases.subscriptions.get`. Acknowledgement
  correctly uses the v1 endpoint, because there is no v2 equivalent.
- **`subscriptionEntitlement`** treats `ACTIVE`, `IN_GRACE_PERIOD` and `CANCELED` as entitled — right,
  and the reasoning ("the user paid for the period they are in") is right.
- **The shape asymmetry is the right way round.** Play reuses one `purchaseToken` across renewals →
  one entitlement row whose `endsAt` moves. Razorpay issues a fresh `payment_id` per charge → a row
  per charge. `routes.googleplay.js:129-138` updates the existing row's `endsAt`/`autoRenew`/`status`
  on renewal; `routes.razorpay.js:251` inserts. Both correct, and getting either wrong would be
  invisible for three months.
- **`linkedPurchaseToken` is detached** via `supersedeEntitlement` on a plan change.
- **RTDN is treated as a signal, never as data.** Every branch re-queries by `purchaseToken` and acts
  on the answer. Unknown notification types fall through to "go and look" rather than being dropped —
  which correctly handles the undocumented types 14/15/16/21.
- **`obfuscatedAccountId`** is `sha256(userId)`: 64 chars (Play's limit), no PII, constant-time
  compared on return.
- **`listVoidedPurchases` passes `type=1`.** Without it the response covers one-time purchases only
  and refunded subscriptions would never be seen. Easy to miss, correctly handled.

### Defects

**`productEntitlement()` cannot return `active: true` for any real Play response.** This is the most
serious functional bug in the codebase.

```js
const state = purchase.purchaseState || purchase.purchaseStateContext || '';
const purchased = state === 'PURCHASED' || state === 'PURCHASE_STATE_PURCHASED' || state === 0;
```

- Against **`purchases.productsv2`** (what `getProductPurchase` actually calls): the state lives at
  `purchaseStateContext.purchaseState`, and `purchaseStateContext` is an **object**. `state` becomes
  `{purchaseState:'PURCHASED'}`; all three comparisons are false.
- Against **v1 `purchases.products`**: `purchaseState` is the **integer 0** for Purchased. `0` is
  falsy, so `0 || ...` falls through to `purchaseStateContext` (undefined) and then to `''`. The
  `state === 0` arm can therefore never be reached — it is dead code guarding the exact case it was
  written for.

Failure scenario, end to end:

> A user buys Lifetime for ₹400 on Play. The client posts the token to `/api/billing/google/purchase`.
> `getProductPurchase` returns a valid `ProductPurchaseV2` with
> `purchaseStateContext: {purchaseState: 'PURCHASED'}`. `productEntitlement` returns `active: false`.
> The route takes the `!ent.active` branch, calls `revokeEntitlement` (a no-op — the row was never
> created), and returns `{handled: true, kind: 'product', active: false}`. The route sees
> `out.handled === true`, so it responds **200 `{success: true}`** with the user's *unchanged* plan.
> The purchase is never acknowledged, so after three days **Google auto-refunds it and revokes it.**
> The user paid, got nothing, and then got their money back without anyone understanding why.

This affects the 3-Day pass and Lifetime — two of the three paid plans — on the entire `playstore`
flavour. Quarterly is a subscription and takes a different function, which is correct.

The test suite passes because `googleplay.test.js` stubs `getProductPurchase` to return
`{purchaseState: 'PURCHASED'}` — a top-level **string**, which is neither the v1 shape (integer) nor
the v2 shape (nested object). The stub encodes the same misunderstanding as the implementation, so
they agree with each other and disagree with Google.

**Client-supplied `productId` decides which plan is granted.** `planForProduct(prisma, productId)`
looks up the `Plan` by the id the *client* sent. Nothing compares it to the product Play reports on
the token.

> Buy the ₹19 3-Day pass on Play → receive token `T` → POST
> `{purchaseToken: T, productId: 'gpos_lifetime'}`. `purchaseBelongsTo` passes (same account).
> `planForProduct` returns the LIFETIME plan. `grantEntitlement` writes a LIFETIME row keyed on `T`.
> **₹19 buys Lifetime.**

Currently unreachable only because the state bug rejects everything first. **Fixing that bug without
also fixing this one turns a broken feature into a monetisation hole.** They must be fixed together.
The subscription branch has the same shape: `productId || subscriptionEntitlement(remote).productId`
prefers the client's value over Play's own.

**The voided-purchase RTDN branch does not re-query Play** — the one branch that contradicts the
file's own stated rule. It revokes directly from the notification body. Combined with
`GOOGLE_RTDN_SECRET` being optional (and absent from `.env.example`), an unauthenticated caller who
knows a `purchaseToken` can permanently revoke that entitlement. For a one-time product there is no
re-activation path: a later reconcile finds the row via `already`, returns `created: false`, and the
product branch — unlike the subscription branch — never sets `status` back to `ACTIVE`. **A revoked
Lifetime stays revoked forever.**

**No renewal backstop.** If a `SUBSCRIPTION_RENEWED` RTDN is lost, `markExpiredEntitlements` flips the
row to `EXPIRED` and the paying subscriber silently drops to the free tier until they next open the
app and the client callback fires. `sweepPlayVoided` only looks at refunds. Nothing sweeps
`subscriptionsv2` for entitlements that should have renewed.

**Endpoint probing is a guess.** `reconcilePlayPurchase` calls `getProductPurchase` first and falls
back to `getSubscription` only on 400/404. Google does not document which error a subscription token
produces at the products endpoint. If it is 403 or 500, the code rethrows and the purchase fails. It
also doubles the API calls for every subscription reconcile, against a 3,000 QPM bucket.

**`accessToken` uses `Date.now()`** for `iat`/`exp`. Correct in principle (this is not billing time),
but a container with a skewed clock gets its JWT rejected by Google with an opaque error, and this is
the one place where Node's clock has an external dependency.

---

## 9. Authentication / Authorization / Security Review

### Definite vulnerabilities

**S1 — Unauthenticated entitlement revocation via RTDN.** `POST /api/webhooks/google/rtdn` with a
forged `voidedPurchaseNotification` revokes the entitlement for any `purchaseToken` the caller knows.
No signature check, no OIDC verification, and `GOOGLE_RTDN_SECRET` defaults to empty — and is not in
`.env.example`, so an operator following that file will deploy with the guard off. The file's own
argument for why an unguarded endpoint is acceptable ("nothing is ever granted from the notification
body — every path re-queries Play") is sound and I agree with it, but **it is not true of the voided
branch**, which is the one destructive path. You asked whether I disagreed with the accepted risk: I
agree about grants, and disagree about revocations.

**S2 — Play plan selection from a client-supplied `productId`.** §8. Pay ₹19, claim the Lifetime SKU.
Latent behind the state-parsing bug today.

**S3 — Razorpay webhook grants without an amount check.** §7. Severity depends on whether Checkout
notes reach `payment.notes` (§16 V1); the missing check is unconditional.

### Realistic risks

**S4 — No rate limiting on anything in billing.** `POST /api/billing/promo/redeem` accepts codes of
3–40 characters with no throttle, so an authenticated user can enumerate promo codes at whatever rate
the server sustains. Admin-created codes tend to be guessable (`LAUNCH50`, `DIWALI`). The two rate
limiters that exist (`TICKET_RATE`, `PAD_RATE`) cover tickets and pads only, are in-memory, and stop
working correctly the moment there is more than one instance.

**S5 — RTDN as a Play-quota drain.** Unauthenticated, unthrottled, and each call with a fresh
`messageId` and any `purchaseToken` triggers 1–2 Play API calls. The Play bucket is 3,000 QPM.
Exhausting it blocks real purchase verification. Requests with no `messageId` skip dedupe entirely.

**S6 — `/api/billing/plans` is public and unthrottled**, and hits the database on every call. Minor,
but it is the cheapest amplification target in the billing surface.

**S7 — `/api/admin/billing/user` is `requireAdmin` only, not `requireStaff` or `requireOwner`.** Any
agent can read any user's email, entitlement history, payment history and usage ledger by email
address. Compare `/api/admin/contacts`, which *is* `requireStaff`. Probably intentional (support
agents need it), but it is inconsistent with the neighbouring surfaces and worth a deliberate decision.

**S8 — 90-day bearer tokens with no rotation, no device binding and no re-auth on sensitive actions.**
An exfiltrated token is good for three months across every device.

### Theoretical

**S9 — `/razorpay/verify` does not check that the order belongs to the caller.** It verifies the
signature and the amount, which an attacker cannot forge. Claiming someone else's payment requires
already having their callback payload. `@@unique([source, externalRef])` means the first claimant
wins, so the practical effect would be denying the real buyer their purchase — but the attacker must
already have data only the victim's browser held.

**S10 — Session-id enumeration** is properly closed: ownership failures return `410 SESSION_GONE`,
identical to "no such session".

**S11 — Timing on `verifyPassword` / `safeEqual` / the admin bearer** — all constant-time. Correctly
done, including hashing both sides of the admin bearer comparison before `timingSafeEqual` so lengths
can't diverge.

### Already mitigated (worth recording so nobody "fixes" them)

- **Client entitlement tampering** — impossible by construction; the client is told the answer and
  never asserts it. There is no request field anywhere that accepts a duration.
- **Clear-app-data reset** — `max(server, client)` in `reconcileClientTotal`.
- **Timezone farming** — structurally impossible: boundaries are absolute, server-decided and
  immutable mid-period.
- **Session-id guessing to bill a stranger** — fixed, and both `heartbeat` and `stopSession` carry the
  check.
- **Amount tampering on the Razorpay callback** — `paymentMatchesPlan` against the `Plan` row.
- **Cross-account Play redemption** — `obfuscatedAccountId` compared on return.
- **CORS** — reflecting any origin on the bearer-token routes is correct and the reasoning is right:
  there is no ambient credential to ride on. The admin API stays cookie-gated behind the allowlist.

---

## 10. Express Middleware & Routing Review

Both documented ordering constraints hold. The three that are load-bearing, in order of how quietly
they fail:

1. **`registerRazorpayWebhook` above `express.json()`** (`server.js:161` vs `:164`). Move it below and
   every webhook delivery fails signature verification. **No error is logged that points at the
   cause** — the handler returns 400 "bad signature", which reads like a misconfigured secret. Money
   is silently lost until someone checks the Razorpay dashboard's webhook failure count.
2. **`publicCors` on `/api/billing` and `/api/play` above the allowlist CORS** (`:143-144` vs `:146`).
   Reverse them and the WebView's preflight fails. This one at least fails loudly and immediately.
3. **The 404 handler must stay last.** `registerBillingRoutes` and friends are called at `:2561-2564`,
   the 404 at `:2573`. Moving any registration below it makes those routes return "Route not found"
   while still existing in the source — a genuinely confusing debugging session.

Additional observations:

- **`express.raw({limit:'1mb'})` on the webhook vs `express.json({limit:'2mb'})` globally.** A
  Razorpay payload above 1MB is rejected before verification. Very unlikely; worth knowing.
- **The webhook path is not under a `publicCors` prefix**, so it is governed by the allowlist. Fine
  today (no `Origin` header from Razorpay), but it means the "billing gets publicCors" mental model
  has an exception.
- **Express 5 forwards async rejections to the error handler**, so the handful of billing routes
  without a `try/catch` (`/api/admin/billing/plans`, `/api/admin/billing/promos`) will not crash the
  process. They will return Express's default HTML error page rather than the JSON shape every other
  route returns, which a JSON-only client will fail to parse.
- **`prestart`'s non-fatal `prisma db push`** means a schema drift on boot logs a line and starts
  anyway. The reasoning (the 2026-08-13 crash-loop) is good, but the consequence is that the server
  can be running against a schema that does not match the code, and the only signal is one line in the
  boot log.

---

## 11. Database & Prisma Schema Review

### The billing models

| Model | Key | Notes |
|---|---|---|
| `Plan` | `@@unique([code, currency, active])` | **Broken — see C4.** `@@index([active, sortOrder])` |
| `Entitlement` | `@@unique([source, externalRef])` | The anti-double-credit constraint. `@@index([userId, status, endsAt])` covers `resolveEffective` exactly |
| `Payment` | `@@unique([provider, providerRef])` | Kept on failure so "was I charged?" is answerable |
| `WebhookEvent` | `@@unique([provider, eventId])` | Sound; used outside the business transaction (§5.3) |
| `PlaySession` | `@@unique([activeKey])` | **Verified working on PostgreSQL 16** |
| `UsageLedger` | `@@unique([sessionId, idemKey])` | Append-only; negative deltas for compensation |
| `UsagePeriod` | `@@id([userId, periodStart])` | Materialised fold, rebuildable |
| `UserBilling` | `@id userId` | 1:1 side table — `User`'s on-disk shape is genuinely unchanged |
| `PromoCode` / `PromoRedemption` | `code @unique` / `@@unique([promoCodeId,userId])` | Per-user exactness is guaranteed; global cap is advisory |

**Nullable fields carrying semantics** (all deliberate, all documented, all worth protecting):
`Entitlement.endsAt = null` means *never expires*; `PlaySession.activeKey = null` means *closed*;
`Plan.razorpayPlanId = null` means *subscriptions not configured* (and the route says so explicitly
rather than failing obscurely); `PromoCode.durationDays = null` means *use the plan's own duration*.

**The `String`-instead-of-enum and `String`-instead-of-`Json` conventions** are forced by SQLite
parity and are consistent with the pre-existing `Ticket.status`. The cost is that nothing at the
database level prevents a typo'd status. `plans.js` exports the constant objects and the code uses
them; that is the only enforcement.

### C4 in schema terms

`@@unique([code, currency, active])` permits at most **one** inactive row per `(code, currency)`,
because `active` is a non-null boolean with exactly two values. Price versioning requires unbounded
inactive rows. I ran it:

```
-- price change #1 (₹99 → ₹149)
BEGIN; UPDATE plan SET active=false WHERE id='p1'; INSERT p2 ...; COMMIT;   → works

-- price change #2 (₹149 → ₹199)
BEGIN; UPDATE plan SET active=false WHERE id='p2';
ERROR:  duplicate key value violates unique constraint "plan_code_currency_active_key"
DETAIL:  Key (code, currency, active)=(QUARTERLY, INR, f) already exists.
ROLLBACK
```

So each plan's price can be changed **exactly once, ever**. The second attempt returns
`500 "Could not change that price."` with no indication why. Note the intent — "only one *active* row
per code+currency" — is a partial unique index, the same problem `PlaySession` solved with the
nullable-column trick. The trick was not applied here.

### Does the model support future scaling without redesign?

**Mostly yes.** The strong parts:

- **More providers / more stores** — `Entitlement.source` and `Payment.provider` are open strings and
  `grant.js` is provider-agnostic. Amazon IAP is a new verifier module plus a `source` value; no
  schema change. This is the single best thing about the data model.
- **Promotional entitlements** — already present, and correctly modelled as just another entitlement
  row that the priority resolver handles with no special-casing.
- **Refunds and chargebacks** — `REVOKED` status plus `revokedAt`/`revokeReason`, never deleted.
- **Upgrades/downgrades** — `SUPERSEDED` plus `linkedPurchaseToken`.
- **Multiple devices** — `deviceId`/`deviceLabel` on the session; `activeKey` enforces one at a time
  and the takeover flow already exists.
- **Additional subscription periods** — a new `PLAN_POLICY` entry and a `Plan` row.

Where it will need work:

- **Regional pricing** — `Plan` has `currency`, but nothing else does. `Payment.currency` exists but
  `Entitlement` has no notion of what was paid, and there is no user→region mapping. Adding INR + USD
  is one more `Plan` row; deciding *which* a given user sees is net-new logic.
- **Family / shared accounts** — `Entitlement.userId` is a hard 1:1. A shared plan needs either an
  owning-group indirection or duplicated rows. This is the one addition on your list that is a real
  schema change.
- **Enterprise plans / seats** — same shape as family; plus seat counting has no home today.
- **Promotional campaigns beyond codes** — `PromoCode` is a code table, not a campaign table. Rules
  like "first 100 users in August" need something new.
- **`Entitlement.meta` as a `String` of JSON** cannot be queried. Once you want "all entitlements from
  campaign X", that becomes a column.

**Verdict: no fundamental redesign needed for the additions you listed except family/shared and
enterprise seats, both of which need an owner-group indirection between `User` and `Entitlement`.**
Everything else is additive.

---

## 12. Scalability Review

**100 users.** Everything is fine. Single instance, sweeps trivial.

**10,000 users** (say 1,000 daily players, ~100 concurrent). ~100 heartbeats/min, each 8–10 round
trips → ~15 queries/sec from heartbeats. Comfortable. The first thing to feel it is the Prisma
connection pool, because `openSession`/`heartbeat` hold a connection for the whole transaction.

**100,000 users** (~1,000 concurrent). Now you need multiple instances, and this is where the design
runs into itself, in this order:

1. **The `P2002` transaction problem (§5.1) stops being occasional.** Concurrent `reapExpired` across
   instances collides on essentially every sweep tick. **This is the first thing that breaks, and it
   breaks because of horizontal scaling specifically.**
2. **Every instance runs every sweep.** `startReconciliation` is unconditional at `listen`. Ten
   instances = ten concurrent global `reapExpired`, ten Razorpay order sweeps, ten
   `markExpiredEntitlements`. There is no leader election and no advisory lock.
3. **Connection pool.** Prisma defaults to `num_cpus * 2 + 1` per instance. Long interactive
   transactions × 1,000 concurrent heartbeats will produce `P2024` pool timeouts. Supabase's direct
   connection (port 5432, as `.env.example` specifies) has a hard connection ceiling — this is where
   PgBouncer/Supavisor becomes necessary, and note that transaction-mode pooling would break any
   future use of PostgreSQL advisory locks.
4. **`reapExpired` inside user-facing transactions.** `take: 200` plus two queries per session, inside
   `openSession`. At scale this is a latency spike on exactly the request the user is waiting on
   before they can play.
5. **In-memory state.** `TICKET_RATE`, `PAD_RATE`, `presence`, and the Play `_token` cache are all
   per-process. The rate limits become "N× the intended limit" with N instances.
6. **`UsageLedger` growth.** Roughly one row per player per minute: 1,000 concurrent players ≈ 1.4M
   rows/day. `@@index([userId, periodStart])` is the right index, and `usedSecondsFor` reads
   `UsagePeriod` rather than aggregating the ledger — so reads stay O(1). But nothing archives the
   ledger, and it is the largest table in the system by an order of magnitude.

**1,000,000+ users.** Needs: a Redis or advisory-lock leader for the sweeps; ledger partitioning or
archival; a read replica for the admin panel; and heartbeat moved off the interactive-transaction
pattern onto single statements (`INSERT ... ON CONFLICT` + one `UPDATE`), which would also make the
`P2002` problem disappear as a side effect.

**What breaks first, in one line: concurrent `reapExpired` from a second instance, via the aborted-transaction
bug — not throughput.** The architecture is stateless and horizontally scalable in every other
respect: no server-side session affinity, no in-memory billing state, everything in Postgres.

---

## 13. Testing & Coverage Review

**Nine suites, ~360 assertions.** I ran the three with no external imports; all pass. The other six
need `zod`/`express` from `node_modules`, which I could not install.

Coverage is genuinely good where it is good:

- `entitlement.test.js` — the priority hierarchy, "a purchase never takes anything away", read-time
  expiry, tie-breaks, stacking, duration maths. This is the heart of the system and it is well tested.
- `period.test.js` — IST boundaries, tiling, 23- and 25-hour days, a reset hour inside a spring-forward
  gap, extreme zones, UTC. My independent 418-zone sweep found nothing it missed at hour 4.
- `playtime.test.js` — the reap cap, the symmetric-fairness property, `max(local, server)`, the
  compensation guard rail.
- `razorpay.test.js` — both signature formulas *and* the assertion that each fails the other's
  verification, which is the test that actually matters.

**The structural weakness: every database-touching test uses an in-memory stand-in whose transaction
is `async $transaction(fn) { return fn(prisma) }`.** That stub throws `P2002`-shaped errors and then
continues normally — which is the opposite of what PostgreSQL does. So the suite systematically
cannot see the most important class of bug in this codebase. The tests confirm the recovery code is
*reached*; they cannot confirm it *works*.

**Second weakness: provider response fixtures are invented rather than captured.** The Play stub
returns `{purchaseState: 'PURCHASED'}` as a top-level string, a shape neither `purchases.products`
(integer) nor `purchases.productsv2` (nested object) ever returns. The fixture and the implementation
share one misunderstanding, so they agree with each other and both disagree with Google. A single
recorded real response would have caught this.

**Not covered at all:** concurrent anything; the webhook-claim-then-fail path; middleware ordering (no
test asserts the raw body route precedes `express.json`); the second price change; `ensureBilling`
racing itself; quota exhaustion *during* a session; `sweepRazorpayOrders` against a pre-existing
`Payment` row.

**`npm test` also cannot run without `node_modules`,** which is expected, but the brief's phrasing
("they need no database and no network") could be read as "no setup".

---

## 14. Confirmed Issues

Ordered by what I would fix first. Every one has a concrete failure scenario.

---

**C1 — `P2002` caught inside an interactive transaction leaves the transaction unusable.**
*Files:* `grant.js:57,97,118` · `playtime.js:169` · `routes.admin.js:98` · `reconcile.js:69`
*Confidence: Confirmed.* PostgreSQL behaviour reproduced locally on 16.13; Prisma savepoint absence
confirmed from [#12898](https://github.com/prisma/prisma/issues/12898),
[#19346](https://github.com/prisma/prisma/issues/19346) and the
[v7.5.0 changelog](https://www.prisma.io/changelog/2026-03-11) (savepoints added Mar 2026, nested
transactions only; this project is on 5.21).

> A client heartbeats `seq=5`; the server commits; the response is lost. The client retries `seq=5`.
> `appendUsage` hits `23505` on `(sessionId, idemKey)`, catches `P2002`, returns `false`. The next
> statement — `tx.playSession.update({lastBilledAt, leaseExpiresAt, hbSeq})` — fails with `25P02`.
> The route returns 500 and **the lease is not extended**. Repeat across a flaky connection and the
> session is reaped mid-game.

Also: two instances running `reapExpired` collide on `'<id>:reap'` and roll back the whole 200-session
batch; `sweepRazorpayOrders` cannot repair a payment whose `Payment` row already exists, because
`recordPayment` poisons the transaction before `grantEntitlement` runs — permanently, on every pass.

---

**C2 — `productEntitlement()` never recognises a real Play one-time purchase.**
*File:* `providers/googleplay.js:309-316` · *Confidence: Confirmed* (from the v1/v2 response shapes;
the falsy-`0` half is provable by inspection alone).

`purchase.purchaseState || purchase.purchaseStateContext || ''` matches neither shape: v2 puts the
state in a nested object, and v1's "Purchased" value is the integer `0`, which is falsy. Full
scenario in §8 — user pays ₹400, gets nothing, purchase is never acknowledged, Google auto-refunds
after 3 days. Blocks the 3-Day pass and Lifetime on the entire `playstore` flavour.

---

**C3 — Client-supplied `productId` decides which plan a Play purchase grants.**
*File:* `routes.googleplay.js:91-93` · *Confidence: Confirmed by inspection.*

> Buy the ₹19 3-Day pass, POST `{purchaseToken: <the ₹19 token>, productId: 'gpos_lifetime'}`.
> `purchaseBelongsTo` passes; `planForProduct` returns LIFETIME; a LIFETIME entitlement is written.

Latent behind C2. **Fixing C2 alone activates this.** The product Play reports for the token is never
compared to the plan.

---

**C4 — `Plan @@unique([code, currency, active])` breaks the second price change.**
*Files:* `prisma/schema.prisma:254` · `routes.admin.js:291-307` · *Confidence: Confirmed, reproduced
on PostgreSQL 16.* Transcript in §11. Each plan's price can be changed exactly once; the second
attempt is a 500 with no diagnostic.

---

**C5 — The Razorpay webhook grants a plan without checking the amount.**
*File:* `routes.razorpay.js:214-231` · *Confidence: Confirmed that the check is absent; the
exploitability depends on §16 V1.*

`notes.planCode` selects the plan; `payment.amount` is recorded but never compared to
`Plan.priceMinor`. The callback path twenty lines earlier does exactly this comparison. Directly
contradicts stated invariant 6.

---

**C6 — A webhook whose handler fails is marked processed and never retried.**
*Files:* `routes.razorpay.js:329-338` · `routes.googleplay.js:249-255` · *Confidence: Confirmed by
inspection.*

`claimWebhookEvent` commits in its own transaction *before* `handleEvent` runs. If `handleEvent`
throws, the route returns 500 (asking for a retry), the retry is rejected as a duplicate, and 200 is
returned. The event is lost. `sweepRazorpayOrders` covers only `order_*` — **`subscription.charged`
has no backstop**, and Play RTDN has no renewal backstop at all.

---

**C7 — The daily limit is enforced only when a session opens.**
*File:* `playtime.js:324-398` · *Confidence: Confirmed.*

`heartbeat` computes `remainingSeconds`, returns it, and extends the lease regardless of whether it is
zero. Nothing terminates a session for quota exhaustion. The mechanism BILLING_DECISIONS §2.4 relies
on — the backend stopping issuing Ed25519 capability tickets — **does not exist**: I grepped the whole
backend for `ed25519`/`ticket` and there is no signing code, no key handling, and no ticket in any
response body. So a client that simply ignores `remainingSeconds` plays indefinitely, and the server
dutifully bills it. §8's design ("the offer appears after the controller closes") is a client-side
courtesy, not an enforcement point.

---

**C8 — Not sending heartbeats is a 6× playtime multiplier, with no app modification.**
*Files:* `playtime.js:86-88, 193-230, 240-254` · *Confidence: Confirmed by arithmetic.*

`LEASE_SECONDS = 180`, `REAP_GRACE_SECONDS = 30`. Reaping bills `min(elapsed, 30)`.

> Open a session. Play for 180 seconds. Send no heartbeats (block the request — a proxy setting, not a
> patched APK). The lease expires; the reap bills **30 seconds** for **180 seconds** played. Call
> `/session/start` again — `openSession` reaps the old one first, so the slot is free. Repeat.
> The free tier's 1 h/day becomes 6 h/day; Quarterly's 6 h/day becomes 36 h/day.

It is indistinguishable from a flaky connection, which is why the grace cap is right in isolation.
BILLING_DECISIONS §2.2b accepts free-tier leakage on the reasoning that free users cost nothing — but
this applies equally to the **paid** Quarterly tier, where the document says enforcement matters, and
it is far cheaper than the APK modification the threat model assumes.

---

**C9 — Unauthenticated entitlement revocation.**
*File:* `routes.googleplay.js:230-268` · *Confidence: Confirmed by inspection.*

The `voided` branch does not re-query Play; it revokes straight from the body. `GOOGLE_RTDN_SECRET`
is optional and empty by default. For one-time products the revocation is permanent — the product
branch of `reconcilePlayPurchase`, unlike the subscription branch, never sets `status` back to
`ACTIVE`.

---

**C10 — `.env.example` documents none of the billing variables.**
*File:* `.env.example` · *Confidence: Confirmed* — zero occurrences of `RAZORPAY`, `GOOGLE_PLAY`,
`GOOGLE_RTDN` or `PLAYTIME`. They are documented only in BILLING_DECISIONS §8. An operator following
`.env.example` deploys with Razorpay and Play unconfigured (which fails safe, returning 503) **and the
RTDN guard off** (which does not — see C9).

---

**C11 — `ensureBilling` creates without guarding the unique constraint.**
*File:* `playtime.js:130` · *Confidence: Confirmed by inspection.* Two concurrent first-touch requests
for a new user both find no `UserBilling` row and both `create`; one gets an uncaught `P2002` → 500.
Lands on the first request a new user ever makes.

---

**C12 — A concurrent session open surfaces as 500, not 409.**
*File:* `playtime.js:291` · *Confidence: Confirmed by inspection.* The database correctly prevents the
second session; `openSession` does not catch the resulting `P2002`, so the user is told "Something
went wrong" instead of "Already playing on another device", and the takeover affordance is never
offered.

---

## 15. Potential Risks

**R1 — No Play subscription renewal backstop.** A lost `SUBSCRIPTION_RENEWED` RTDN silently drops a
paying subscriber to free until they reopen the app.

**R2 — `refund.created` revokes.** Premature; `refund.failed` can follow and nothing un-revokes.

**R3 — Partial refunds revoke in full.** No quantity-aware handling on either provider.

**R4 — `subscription.cancelled` clears `autoRenew` on all the user's Razorpay entitlements**, not just
the cancelled subscription's.

**R5 — `period.js` is incorrect at reset hours 0 and 1** (`Africa/Cairo`, `Asia/Beirut`,
`Antarctica/Troll`). Inert today — `PLAYTIME_RESET_HOUR` is 4 and no per-user hour exists — but it is
one environment variable away from live.

**R6 — The per-user timezone feature is designed but not wired.** `pendingTz`, `tzChangedAt` and
`riskTier` are never written. Every user resets at 04:00 IST.

**R7 — A heartbeat spanning a period boundary bills to the wrong bucket.** `ensureBilling` rolls the
period, then `appendUsage` writes `now − lastBilledAt` — up to one heartbeat interval of pre-boundary
time — against the *new* `periodStart`. Bounded at 60s per user per day.

**R8 — Every instance runs every sweep.** No leader election, no advisory lock.

**R9 — `reapExpired` runs inside user-facing transactions** with `take: 200` and two queries per
session.

**R10 — Play endpoint probing depends on undocumented error codes.** Products-first, falling back only
on 400/404; also doubles API calls for every subscription.

**R11 — Four `Date.now()` uses outside the DB clock:** `reconcile.js:44` (stuck-order cutoff),
`reconcile.js:105` (voided window), `reconcile.js:177` (sweep pacing),
`providers/googleplay.js:95,97` (JWT `iat`/`exp` and token cache). None are billing arithmetic, but
the JWT one fails opaquely against Google if the container clock drifts.

**R12 — `UsageLedger` has no archival strategy.** ~1.4M rows/day at 1,000 concurrent players.

**R13 — No rate limiting on promo redemption** → code enumeration.

**R14 — In-memory rate limiters and `presence` break under horizontal scaling.**

**R15 — `/api/admin/billing/user` is `requireAdmin`, not `requireStaff`**, unlike neighbouring
data-exposing admin routes.

**R16 — `grantEntitlement`'s `already` check ignores status.** A `REVOKED` row short-circuits a later
legitimate grant with `created: false`; only the Play subscription branch re-activates.

**R17 — Non-fatal `prisma db push` can leave code and schema disagreeing** with only a log line.

**R18 — `/api/admin/billing/grant` keys `externalRef` on `Date.now()`.** Two grants of the same plan
to the same user in the same millisecond collide.

**R19 — Admin compensation can drive `UsagePeriod.secondsUsed` negative** (the `upsert` `create`
branch writes a negative value). Deliberate and documented, but it means a UI reading `usedSeconds`
directly can display a negative number.

---

## 16. Needs Verification

**V1 — Do Razorpay Checkout-supplied `notes` reach or override `payment.notes`?** This decides
whether C5 is a monetisation hole or only a missing defence-in-depth check. `notes` is a documented
Checkout option; I could not confirm the precedence between order notes and checkout notes. *Test:*
create an order server-side for THREE_DAY, add conflicting `notes` in the Checkout options, pay in
test mode, and inspect `payload.payment.entity.notes` on the delivered webhook.

**V2 — The exact `purchases.productsv2` response shape**, from a real test purchase. My reading is
`purchaseStateContext.purchaseState ∈ {PURCHASE_STATE_UNSPECIFIED, PURCHASED, CANCELLED, PENDING}`
and `productLineItem[].productId`, but C2's fix should be written against a captured response, not
against documentation or against me.

**V3 — What error does `purchases.productsv2` return for a subscription token?** The fallback in
`reconcilePlayPurchase` only triggers on 400/404.

**V4 — Does `activeKey` behave identically on SQLite?** The comment says "Verified against a real
database". SQLite does treat NULLs as distinct in a unique index, so I expect yes, but I could not
run it.

**V5 — Does Prisma 5.21's `usagePeriod.upsert` compile to native `INSERT ... ON CONFLICT`?** It needs
all five documented conditions, one of which is "only one unique field in the `where`" — and
`userId_periodStart` is a compound primary key. If Prisma falls back to select-then-write, `appendUsage`
gains a second race. *Test:* `log: ['query']` and read the emitted SQL.

**V6 — Play RTDN ordering.** Google documents no guarantee. The re-query design is order-independent
by construction, but `markExpiredEntitlements` running between a lost RENEWED and its replacement
produces a visible free-tier window (R1).

**V7 — Prisma's connection-pool and interactive-transaction timeouts under load**, given 8–10 round
trips per heartbeat.

**V8 — Whether Play's obfuscated account id is present on purchases made outside the app** (promo
codes redeemed in the Play Store, family sharing). `purchaseBelongsTo` returns `true` when absent,
which is the documented-safe choice, but the frequency matters for how much that check is worth.

---

## 17. Things Future Developers Must Not Accidentally Break

Each of these is load-bearing, and each fails quietly.

1. **`registerRazorpayWebhook` must stay above `express.json()`** (`server.js:161` / `:164`). Below
   it, every delivery fails signature verification and the only symptom is a 400 that reads like a
   wrong secret.
2. **`publicCors` on `/api/billing` and `/api/play` must stay above the allowlist CORS**
   (`:143-144` / `:146`).
3. **The 404 handler must stay after all four `register*Routes` calls** (`:2561-2564` / `:2573`).
4. **`PLAYTIME_RESET_HOUR` must not be set to 0, 1, 2, 3, 22 or 23** without fixing `period.js` first.
   4 and 5 are the only values that collide with no zone's DST transition. Verified empirically; the
   reasoning is in §6.
5. **All billing time must come from `serverNow(tx)`.** Introducing `Date.now()` into billing
   arithmetic reintroduces multi-instance clock skew, and it will not show up in any test.
6. **`state` and `activeKey` on `PlaySession` must always be written together.** All three close paths
   do. A fourth path that sets `state = 'CLOSED'` without `activeKey = null` **permanently locks that
   user out of playing** — `openSession`'s `findFirst({state: ACTIVE})` finds nothing, proceeds, and
   collides on the index forever. Nothing in the schema prevents this; it is convention only.
7. **`@@unique([source, externalRef])` on `Entitlement` is the anti-double-credit guarantee.** Not the
   `findUnique` above it — that is an optimisation.
8. **Play uses one `purchaseToken` across renewals; Razorpay uses a new `payment_id` per charge.**
   Reversing either silently drops renewals or creates entitlements that never expire, and neither is
   visible for a full billing cycle.
9. **The two Razorpay signature formulas are reversed relative to each other and must stay two
   functions.** Merging them behind a boolean is how this gets confused.
10. **`RAZORPAY_WEBHOOK_SECRET` is not `RAZORPAY_KEY_SECRET`.**
11. **`listVoidedPurchases` must keep `type=1`.** Without it, refunded subscriptions are invisible.
12. **`grantEntitlement` must never store a `FREE` row.** It throws today; keep it throwing.
13. **The client must never gain a field that sets a duration.** `clientSeconds` is a *total* that can
    only increase the bill, and `reconcileClientTotal` is the only thing that reads it.
14. **`prisma db push` with no migrations** means every schema change is a live `ALTER`. Any new
    partial-uniqueness requirement needs the `activeKey`-style trick, not an index.
15. **`Plan` rows are never edited for price — they are versioned.** (Which is currently broken after
    the first change — C4 — but the *rule* is right and must survive the fix.)
16. **`reapExpired` must keep capping at the grace window.** Removing the cap to close C8 would bill a
    three-hour network partition as three hours played.

---

## 18. Architecture Scorecard

Honest, not generous.

| Area | Assessment | Confidence | Notes |
|---|---|---|---|
| **Architecture** | **Strong** | High | Clean separation, acyclic module graph, one source of truth for policy. The append-only + read-time-expiry design is the right answer and is applied consistently. Would pass review at a much larger company. |
| **Data model** | **Good** | High | Well-normalised, correct constraints, semantically meaningful nullables. Two specific defects: the `Plan` uniqueness (C4) and no group indirection for family/enterprise. |
| **Billing correctness** | **Needs work** | High | Razorpay callback path is correct. Play one-time path is broken end to end (C2), the Razorpay webhook skips the amount check (C5), and the daily limit is not actually enforced (C7). |
| **Concurrency** | **Weak** | High | Correct *intent* everywhere, and the constraints genuinely hold. But the `P2002` recovery mechanism is used systematically and does not work on the production engine (C1). Reproduced locally. |
| **Security** | **Fair** | Medium-High | Auth, ownership, timing safety and CORS all handled well. Three real holes: unauthenticated revocation (C9), client-chosen Play product (C3), unchecked webhook amount (C5). No rate limiting in billing. |
| **Time handling** | **Strong** | **Very High** | Empirically verified across all 418 IANA zones over two years at the configured hour: zero failures. Better than most production billing systems. Only fragile at reset hours nobody currently uses. |
| **Scalability** | **Fair** | Medium | Stateless and horizontally scalable in principle. In practice C1 breaks at the second instance, every instance runs every sweep, and long interactive transactions will exhaust the pool first. |
| **Provider integration** | **Mixed** | High | Razorpay is close to exemplary — signatures, secrets, raw body, re-fetch, receipt limits all right. Play has the state-parsing bug, the productId trust bug, and no renewal backstop. |
| **Test coverage** | **Fair** | High | Good breadth and genuinely well-chosen assertions on pure logic (~360 of them). Structurally blind to transaction semantics, and provider fixtures are invented rather than captured — which is exactly why C1 and C2 survived. |
| **Maintainability** | **Excellent** | High | The best thing about this codebase. Comments explain *why*, name the failure mode, and are accurate. The design doc and the code agree. A new developer could be productive here in a day. |

**Overall: a strong design with an implementation that is not yet production-ready.** The distance
between the two is smaller than the issue count suggests — C1 is one mechanism repeated six times, and
C2/C3 are one file. Neither requires an architectural change.

---

## 19. Current Architecture Baseline

*Say "use the GamepadOS backend baseline" in a future conversation and this is what I will assume.*

### Stack and shape
Node ≥20 (running 22), Express 5, Prisma 5.21 → PostgreSQL (Supabase direct, port 5432), deployed on
Railway. Plain CommonJS, zod for validation, **zero billing-specific npm dependencies** — Razorpay and
Google Play are reached with `fetch`, the Play service-account JWT is signed with `crypto`. No
TypeScript. No routers — every route is `app.get`/`app.post` on one app in `server.js`.
**No migration files**; `prestart` runs a non-fatal `prisma db push`. A parallel SQLite schema for
local dev forbids Prisma enums and `Json` columns.

### Product model
| Plan | Price | Daily limit | Term | Priority |
|---|---|---|---|---|
| FREE | ₹0 | 1 h/day | forever | 0 |
| THREE_DAY | ₹19 | unlimited | 72 h | 80 |
| QUARTERLY | ₹99 | 6 h/day | 3 months | 60 |
| LIFETIME | ₹400 | unlimited | forever | 100 |

`LIFETIME > THREE_DAY > QUARTERLY > FREE`. Prices in the `Plan` table in paise, never in code. No
monthly, no yearly — both dropped deliberately. THREE_DAY sits above QUARTERLY because it is unlimited
and cannot be farmed (30 passes = ₹570 vs ₹99). Reset at 04:00 `Asia/Kolkata`, server-decided.

### Modules
`plans.js` policy · `period.js` boundaries · `entitlement.js` clock + resolver ·
`grant.js` payment→entitlement · `playtime.js` ledger/sessions · `providers/{razorpay,googleplay}.js` ·
`routes{,.razorpay,.googleplay,.admin}.js` · `reconcile.js` sweeps · `seed.js`.

### Endpoints
```
GET  /api/billing/plans                  public, channel-aware (PURCHASABLE = direct, playstore)
GET  /api/billing/me                     entitlement + today's usage + serverTime
POST /api/play/session/{start,heartbeat,stop}
POST /api/billing/razorpay/{order,verify}
POST /api/webhooks/razorpay              express.raw, ABOVE express.json
POST /api/billing/google/purchase
POST /api/webhooks/google/rtdn           optional shared secret
POST /api/billing/promo/redeem
GET/POST /api/admin/billing/*            requireAdmin (+ requireOwner on grant/revoke/price/promo)
```

### The rules that define the system
1. Entitlements are append-only; nothing is deleted on purchase.
2. Highest priority wins; expiry is a read-time fact, never a cron.
3. `@@unique([source, externalRef])` — an external reference is credited exactly once, ever.
4. FREE is never a row; it is the fallback.
5. Same-plan purchases stack (queue), never overlap.
6. We compute duration for what we sell; we mirror it for what a provider sells.
7. All billing time is `serverNow(tx)` = `SELECT CURRENT_TIMESTAMP`.
8. Boundaries are absolute and immutable mid-period; a zone change applies at the next one.
9. One active session per user, enforced by a unique index on nullable `activeKey`.
10. The client sends a running *total*, never a duration; the server takes `max(server, client)`.
11. Reaping is capped at the grace window (30s); a clean close bills uncapped.
12. Money is integer paise.

### Known state as of this review
**Backend complete, client side not started.** Not built: PC server 2.0.2 (Ed25519 tickets + mDNS),
Android `HeartbeatService`/Play Billing/Razorpay checkout, controller-ui panels, admin portal UI.

**Broken or unenforced right now:** the `P2002`-in-transaction mechanism (C1); Play one-time purchases
(C2/C3); the second price change per plan (C4); the webhook amount check (C5); webhook failure
recovery (C6); mid-session quota enforcement and the entire ticket mechanism (C7); the heartbeat-drop
multiplier (C8); unauthenticated revocation (C9). Per-user timezones designed but unwired (R6).

**Verified correct:** `period.js` across all 418 IANA zones at reset hour 4; `activeKey` uniqueness on
PostgreSQL 16; both Razorpay signature formulas and their application; `addMonths` including leap
years; middleware ordering as documented; ownership checks on all eight user-authenticated billing routes.

---

## 20. Recommended Future Review Priorities

In the order I would take them, with the reasoning:

**1. Fix C1 — the transaction mechanism.** Everything else is downstream of this. It is six call sites
and one decision (native `ON CONFLICT` writes, or move the collision-prone statement outside the
transaction, or a savepoint wrapper). Do it before adding a second instance, because that is when it
stops being intermittent.

**2. Make the tests able to see C1.** A stand-in that models transaction abortion, or — better — one
integration suite against a real PostgreSQL. Without this, the fix cannot be verified and the pattern
will come back.

**3. Fix C2 and C3 together.** Play one-time purchases cannot work today, and fixing only the state
parsing opens the ₹19-for-Lifetime path. Write both against a captured real `productsv2` response
(V2).

**4. Close C7/C8 — actual playtime enforcement.** This is the largest gap between BILLING_DECISIONS
and the code. It needs a product decision first: whether the backend refuses to extend a lease past
zero, and whether the Ed25519 ticket mechanism is built now or the paid tier ships on the honour
system too. C8's arithmetic (6× via not heartbeating) is worth deciding on explicitly, because the
accepted-risk argument in §2.2b was written about APK modification, not about dropping requests.

**5. C5 and C9 — the two provider security holes.** Both are small, and V1 should be tested regardless
of what it shows.

**6. C4 and C6 — the two silent-failure bugs.** Price versioning that works once, and webhook events
that vanish. Neither is urgent today; both become expensive later, and C6 specifically becomes
expensive at exactly the moment volume makes it likely.

**7. C10/C11/C12 and the operational risks** — `.env.example`, the two unguarded creates, sweep leader
election, rate limiting on promo redemption.

**8. Then, before scale:** ledger archival, connection pooling strategy, moving `reapExpired` out of
user-facing transactions, and wiring the per-user timezone (R6) — the only user-visible promise in the
design document that the backend does not currently keep.

One process suggestion that is worth more than any single fix: **the two most serious bugs in this
review (C1, C2) are both cases where a test asserted against an invented model of an external system
— Prisma's transaction semantics in one case, Google's response shape in the other — and the model was
wrong.** The code is otherwise so carefully reasoned that this is the pattern most likely to bite
again. One real database in CI and one captured response fixture per provider endpoint would close
most of that surface.
