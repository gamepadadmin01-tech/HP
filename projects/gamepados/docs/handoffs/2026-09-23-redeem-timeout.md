# Redeem codes failing + missing WebsiteLoginGrant table — 2026-09-23

## Redeem codes: "Could not redeem that code."

Cause: Railway backend runs in Tokyo (`hnd1`), Supabase DB in Mumbai (`ap-south-1`, pooler :6543).
Redeem is ~14 sequential queries inside one interactive transaction; that crossed Prisma's
default 5s transaction timeout -> P2028 -> rollback -> generic 500. Reproduced against
production with a rolled-back dry run + 250ms simulated latency per query.

Fix: website commit `d04284cc` — `new PrismaClient({ transactionOptions: { maxWait: 10000, timeout: 20000 } })`
in `backend/server.js`. Covers every billing transaction (Razorpay, Play, playtime). Pushed by Akhil.
AKHILGOD (THREE_DAY, 6 days, 1 use) was still 0/1 afterwards — real redemption not yet confirmed.

## WebsiteLoginGrant table was never created

Akhil's `G1` commit (website sign-in handoff) added the model, but `prestart`'s `prisma db push`
did not apply on Railway and the server started anyway (by design, it only logs).
Likely because DATABASE_URL is the transaction pooler (:6543), which Prisma's schema engine
cannot use. **Every future schema change will hit this.**

Applied manually: `prisma migrate diff` (session pooler :5432) showed ONLY the additive
CREATE TABLE + 2 indexes + FK to UserSession; executed with `prisma db execute`; re-diff exit 0.
Verified: rolled-back dry run of issue -> exchange -> reuse-refused on prod; live exchange
endpoint now returns 401 invalid_link (reads the table) instead of 503.

Permanent fix: website commit `32242790` adds `directUrl = env("DIRECT_URL")` (session pooler
:5432) to the datasource; local `backend/.env` has DIRECT_URL. Verified: db push through it reports
"already in sync"; the app runs fine with DIRECT_URL absent; db push without it exits 1, which
prestart tolerates. **Railway must have DIRECT_URL set** or schema changes stay silently unapplied.

Other notes: promo codes default to 1 use; the portal has no re-enable for disabled codes
(NEWUSERS3, HELPBENIFIT are disabled). Windows marks some `.git` files Hidden
(COMMIT_EDITMSG, FETCH_HEAD) which makes git fail with "Permission denied" — clear Hidden on that file.
