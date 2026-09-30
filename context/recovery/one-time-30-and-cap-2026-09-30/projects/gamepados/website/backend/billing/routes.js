// Billing + playtime HTTP routes.
//
// Registered onto the existing app rather than an express.Router(), because
// this codebase has no routers — every route is app.get/app.post in server.js.
// Keeping that shape means the middleware order stays obvious. This lives in
// its own file only so server.js does not grow by another 200 lines.
//
// NOTE ON PATHS: the blueprint proposes /api/v1/*. This project has no API
// versioning anywhere (/api/account, /api/support, /api/pads), so introducing
// it for billing alone would be inconsistent. These sit at /api/billing/* and
// /api/play/* to match. Both prefixes get publicCors in server.js, ABOVE the
// allowlist CORS, because the Android WebView calls them from a different
// origin with a bearer token and no cookie.
//
// NONE of these are on a latency-sensitive path. The gameplay loop never awaits
// anything here: one call before play, one per minute during, one after.

const { z } = require('zod');
const { resolveEffective, serverNow } = require('./entitlement');
const { PLAN, PLAN_POLICY, ON_SALE_PLANS, policyFor, ENT_STATUS, ENT_SOURCE } = require('./plans');
const { AD_REWARD_SECONDS, availableFor, spendFor, remainingWithBank } = require('./adtime');
const { ensureLaunchBonus } = require('./launchBonus');
const { purchaseOptionsFor } = require('./eligibility');
const {
  PlaytimeError, openSession, heartbeat, stopSession,
  ensureBilling, usedSecondsFor, remainingSeconds,
  HEARTBEAT_SECONDS, UNLIMITED_HEARTBEAT_SECONDS,
} = require('./playtime');
const rzp = require('./providers/razorpay');

// Channels that may show a purchase button at all. On amazonstore, aptoide,
// uptodown, indusstore and apkpure the store's own billing is mandatory (or, on
// uptodown, merely unconfirmed), so those builds show plan STATUS with no
// price, no button and no link — a single "manage your plan at gamepad.space"
// is already a policy breach on Amazon.
//
// 2026-09-30 (owner's call): uptodown now sells Lifetime through the same
// Razorpay checkout as the website build, and PLAYSTORE SELLS NOTHING — the
// Play build's only way to more time is a rewarded ad, and it no longer even
// carries the Play Billing library. Removing it here too means an older Play
// build still in the field can never show a buy button either.
const PURCHASABLE_CHANNELS = new Set(['direct', 'uptodown']);
// Channels whose price WE set (Razorpay), where an upgrade credit can apply.
const OWN_PRICE_CHANNELS = new Set(['direct', 'uptodown']);

const startSchema = z.object({
  deviceId: z.string().min(1).max(128),
  deviceLabel: z.string().max(64).optional(),
  takeover: z.boolean().optional(),
});

const heartbeatSchema = z.object({
  sessionId: z.string().min(1).max(64),
  fence: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  // The app's running TOTAL for the period, never a duration. It can only ever
  // increase what the user is billed — see reconcileClientTotal.
  clientSeconds: z.number().int().nonnegative().optional(),
});

const stopSchema = z.object({
  sessionId: z.string().min(1).max(64),
  fence: z.number().int().nonnegative(),
});

/** Turn a PlaytimeError into its HTTP response; rethrow anything unexpected. */
function sendPlaytimeError(res, err, label) {
  if (err instanceof PlaytimeError) {
    const body = { success: false, error: err.message, code: err.code };
    for (const k of ['plan', 'resetsAt', 'deviceLabel', 'startedAt']) {
      if (err[k] !== undefined) body[k] = err[k];
    }
    return res.status(err.status).json(body);
  }
  console.error(label, err);
  return res.status(500).json({ success: false, error: 'Something went wrong.' });
}

function badRequest(res, parsed) {
  return res.status(400).json({
    success: false,
    error: 'Invalid request.',
    code: 'bad_request',
    detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  });
}

/**
 * @param app      the express app
 * @param deps.prisma       PrismaClient
 * @param deps.requireUser  (req,res) => user | null  — already sends 401 itself
 */
function registerBillingRoutes(app, { prisma, requireUser, optionalUser }) {
  // ── Catalogue ────────────────────────────────────────────────────────────
  // Public: the plan list and prices are shown before sign-in.
  app.get('/api/billing/plans', async (req, res) => {
    try {
      const channel = String(req.query.channel || 'direct');
      const currency = String(req.query.currency || 'INR').toUpperCase();

      // `purchasable` answers "can this user buy, right now" -- not merely
      // "is this channel allowed to sell". Both have to hold.
      //
      // The second half matters at launch. Until Razorpay is linked, an order
      // request answers 503 provider_unconfigured, so a Buy button would be a
      // button that always fails, sitting under a banner that says plans are
      // still coming. Gating on the provider hides the whole upgrade surface
      // until payments genuinely work, and reveals it the moment the keys are
      // set -- with no app update, because the client renders whatever this
      // flag says.
      // Every channel that can sell does so through Razorpay (see PURCHASABLE_CHANNELS).
      const providerReady = rzp.isConfigured();
      const purchasable = PURCHASABLE_CHANNELS.has(channel) && providerReady;

      // Signed in? Then what is on sale depends on what they already own. A
      // signed-out visitor still sees the full catalogue at list price — this
      // page is public and the prices are public.
      const viewer = optionalUser ? await optionalUser(req) : null;

      const rows = await prisma.plan.findMany({
        where: { active: true, currency },
        orderBy: { sortOrder: 'asc' },
      });

      const effective = viewer ? await resolveEffective(prisma, viewer.id) : null;
      // Credit only where WE set the price. On a store channel the amount is
      // the store's SKU and our discount cannot reach it.
      const eligibility = purchaseOptionsFor(rows, effective, { allowCredit: OWN_PRICE_CHANNELS.has(channel) });

      // Only what is ON SALE is listed — see ON_SALE_PLANS. Filtered AFTER the
      // eligibility pass on purpose: an old Quarterly holder's upgrade credit
      // towards Lifetime is priced from the Quarterly row, which must still be
      // in the set the rules see. Filtering here, not by deactivating Plan
      // rows, means taking a plan off sale touches no data.
      const plans = rows.filter((p) => ON_SALE_PLANS.includes(p.code)).map((p) => {
        const policy = PLAN_POLICY[p.code] || null;
        // Two independent gates, and BOTH must hold. `purchasable` (above) is
        // about the channel — whether this storefront may sell at all. `rule`
        // is about this person — whether this plan is worth anything to them.
        const rule = eligibility[p.code] || null;
        const allowed = purchasable && (rule ? rule.purchasable : true);
        return {
          code: p.code,
          displayName: p.displayName,
          currency: p.currency,
          priceMinor: p.priceMinor,
          unlimited: policy ? policy.unlimited : false,
          dailySeconds: policy ? policy.dailySeconds : null,
          durationHours: policy ? policy.durationHours : null,
          durationMonths: policy ? policy.durationMonths : null,
          purchasable: allowed,
          // What they would actually pay, after any upgrade credit, and why the
          // card is closed when it is. The UI renders `reason` verbatim — a
          // greyed-out button with no explanation is what makes a store feel
          // broken rather than deliberate.
          effectivePriceMinor: rule ? rule.priceMinor : p.priceMinor,
          creditMinor: rule ? rule.creditMinor : 0,
          isUpgrade: rule ? rule.isUpgrade : false,
          reason: rule ? rule.reason : null,
          // On Play the authoritative price lives in Play Console. The client
          // MUST render ProductDetails and never this number — showing a price
          // that differs from Play's own UI is a policy violation.
          priceFromStore: channel === 'playstore',
          playProductId: channel === 'playstore' ? p.playProductId : undefined,
        };
      });

      res.json({
        success: true,
        channel,
        currency,
        purchasable,
        // The plan in force for whoever asked, so the UI can label the card
        // they are on without a second call. Null when signed out.
        currentPlan: effective ? effective.planCode : null,
        plans,
      });
    } catch (e) {
      console.error('billing/plans', e);
      res.status(500).json({ success: false, error: 'Could not load plans.' });
    }
  });

  // ── The dashboard's only call ────────────────────────────────────────────
  // Effective entitlement plus today's usage. serverTime is included so the
  // client can render a countdown without ever trusting its own clock: it
  // captures the offset once and then ticks from a monotonic timer.
  //
  // WHY THIS ONE IS NOT IN A TRANSACTION, when everything below it is.
  //
  // It used to be, and it cost roughly eight round trips to the database in
  // strict sequence: requireUser, BEGIN, serverNow, ensureBilling, serverNow
  // AGAIN (inside resolveEffective), the entitlement read, the usage read,
  // COMMIT. At the 250-400ms per query measured through the Supabase pooler
  // that is two to three seconds to draw a plan name and a progress bar, and it
  // is the single biggest reason the account page felt broken.
  //
  // An interactive transaction pins one pooled connection for its whole life
  // AND serialises everything inside it, so queries that do not depend on each
  // other still could not overlap. Dropping it lets the independent reads run
  // together: three waits instead of eight.
  //
  // The trade is honest and small. This endpoint GRANTS NOTHING and CHARGES
  // NOTHING — it is a display read. The write it does perform (ensureBilling
  // creating a first row, or rolling an ended period) is an upsert that already
  // handles the concurrent-first-touch race on its own, by its own comment. The
  // only thing the transaction was buying is that `used` cannot be read against
  // a periodStart that a parallel request rolled a millisecond earlier; the
  // cost of losing it is one page load showing a fresh day's allowance a moment
  // early, self-correcting on the next load.
  //
  // The endpoints that actually gate play — session/start and heartbeat below —
  // keep their transactions. Those decide whether someone may play, and they
  // must stay atomic.
  app.get('/api/billing/me', async (req, res) => {
    try {
      // Independent: the session lookup does not need the clock, and the clock
      // does not need the user. They were simply written one after the other.
      const [user, now] = await Promise.all([
        requireUser(req, res),
        serverNow(prisma),
      ]);
      if (!user) return;

      // Both take `now` and neither reads the other's result, so they overlap.
      // resolveEffective is handed `now` rather than fetching its own — that
      // duplicate SELECT CURRENT_TIMESTAMP was a whole round trip spent asking
      // the database for a value already in a local variable.
      let [billing, effective] = await Promise.all([
        ensureBilling(prisma, user.id, now),
        resolveEffective(prisma, user.id, now),
      ]);

      // The launch gift. Granted here rather than by a script someone has to
      // remember to run — the app promised users a free premium they could
      // "claim", and there was never anything to claim.
      //
      // Only attempted for a user who resolves to FREE, so a paying customer
      // costs nothing extra. For a FREE user it is one indexed lookup on the
      // unique (source, externalRef) key, which short-circuits for everyone who
      // has already had it — including after the 3 days lapse, so the gift
      // cannot be farmed by waiting for it to expire.
      if (!effective.unlimited && effective.planCode === PLAN.FREE) {
        if (await ensureLaunchBonus(prisma, user.id, now)) {
          effective = await resolveEffective(prisma, user.id, now);   // once per user, ever
        }
      }

      // Genuinely dependent — they need the period ensureBilling just settled.
      // Read-only on purpose: this endpoint displays the bank, the session
      // endpoints are what charge it.
      const [used, bankAvailable] = await Promise.all([
        usedSecondsFor(prisma, user.id, billing.periodStart),
        availableFor(prisma, user.id, billing.periodStart),
      ]);
      const bankSpentToday = effective.unlimited ? 0 : spendFor(used, effective.dailySeconds, bankAvailable);

      const policy = policyFor(effective.planCode);

      res.json({
        success: true,
        plan: effective.planCode,
        unlimited: effective.unlimited,
        startsAt: effective.startsAt,
        endsAt: effective.endsAt,
        autoRenew: effective.autoRenew,
        source: effective.source,
        today: {
          limitSeconds: policy.dailySeconds,
          usedSeconds: used,
          // How long they can play RIGHT NOW: the rest of today's free time
          // plus the ad bank. Apps already gate "can I start?" on this number,
          // so banked time works even in builds that predate the bank.
          remainingSeconds: remainingWithBank(used, effective.dailySeconds, effective.unlimited, bankAvailable),
          // Today's free allowance alone, for the progress bar.
          freeRemainingSeconds: remainingSeconds(used, effective.dailySeconds, effective.unlimited),
        },
        adTime: {
          bankSeconds: Math.max(0, bankAvailable - bankSpentToday),
          rewardSeconds: AD_REWARD_SECONDS,
          // Lifetime never needs an ad; the app hides the button.
          canEarn: !effective.unlimited,
        },
        resetsAt: billing.periodEnd,
        resetTimezone: billing.resetTz,
        heartbeatSeconds: effective.unlimited ? UNLIMITED_HEARTBEAT_SECONDS : HEARTBEAT_SECONDS,
        serverTime: now,
      });
    } catch (e) {
      console.error('billing/me', e);
      // requireUser now runs alongside serverNow, so it can have already
      // answered 401 by the time something else in the pair rejects. Writing a
      // second response there throws ERR_HTTP_HEADERS_SENT from inside this
      // catch, which escapes as an unhandled rejection — the 401 the client
      // needs was already sent, so there is nothing left to say.
      if (res.headersSent) return;
      res.status(500).json({ success: false, error: 'Could not load your plan.' });
    }
  });

  // ── Cancelling a subscription ────────────────────────────────────────────
  //
  // WHAT CANCELLING MEANS, because getting this wrong is how a support ticket
  // becomes a chargeback: it stops the NEXT charge. It does not end the period
  // already paid for and it is not a refund.
  //
  // Someone who paid on 1 September for three months and cancels on 15 October
  // keeps their 6 hours a day until 1 December, is not charged on 1 December,
  // and drops to Free after that. Cutting access on the 15th would be taking
  // days they have already bought — the same shape of mistake as selling a
  // Quarterly to a Lifetime owner.
  //
  // So `endsAt` is deliberately NOT touched here. Only `autoRenew` changes, and
  // resolveEffective keeps returning the plan until its own expiry passes. The
  // subscription.cancelled webhook was already written never to claw back a
  // paid period; this endpoint is simply the button that was missing.
  app.post('/api/billing/subscription/cancel', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;

      const rows = await prisma.entitlement.findMany({
        where: { userId: user.id, status: ENT_STATUS.ACTIVE, autoRenew: true },
      });
      if (!rows.length) {
        return res.status(409).json({
          success: false,
          error: 'You do not have a renewing subscription.',
          code: 'no_subscription',
        });
      }

      // A store subscription is the store's to cancel — we hold no mandate for
      // it and calling Razorpay would do nothing. Say where the switch actually
      // is rather than failing silently or pretending it worked.
      const ours = rows.filter((r) => r.source === ENT_SOURCE.RAZORPAY);
      if (!ours.length) {
        const where = rows[0].source === ENT_SOURCE.PLAY ? 'Google Play' : 'the store you bought it from';
        return res.status(409).json({
          success: false,
          error: `This subscription is billed by ${where}. Cancel it there and it will stop renewing.`,
          code: 'external_subscription',
        });
      }

      const failures = [];
      for (const row of ours) {
        let subscriptionId = null;
        try {
          subscriptionId = row.meta ? (JSON.parse(row.meta).subscriptionId || null) : null;
        } catch { /* unparseable meta is not a reason to abandon the rest */ }

        if (subscriptionId) {
          try {
            // At cycle end, not immediately: the customer keeps what they paid
            // for and simply is not billed again.
            await rzp.cancelSubscription(subscriptionId, { atCycleEnd: true });
          } catch (e) {
            // Already cancelled or completed answers 400, and that IS the goal.
            if (!/already|cancelled|canceled|completed/i.test(String(e && e.message))) {
              failures.push({ id: row.id, subscriptionId, err: e.message });
              continue;   // the flag stays true — it is still going to bill
            }
          }
        }
        await prisma.entitlement.update({ where: { id: row.id }, data: { autoRenew: false } });
      }

      if (failures.length === ours.length) {
        console.error('billing/subscription/cancel: nothing could be cancelled', {
          userId: user.id, failures,
        });
        return res.status(502).json({
          success: false,
          error: 'We could not reach the payment provider. Nothing has changed — please try again shortly.',
          code: 'provider_error',
        });
      }
      if (failures.length) {
        console.error('billing/subscription/cancel: SOME SUBSCRIPTIONS STILL LIVE', {
          userId: user.id, failures,
        });
      }

      const effective = await resolveEffective(prisma, user.id);
      res.json({
        success: true,
        plan: effective.planCode,
        // What they keep, and until when. The UI states this back to them so
        // "cancelled" never reads as "and it is gone now".
        endsAt: effective.endsAt,
        autoRenew: effective.autoRenew,
      });
    } catch (e) {
      console.error('billing/subscription/cancel', e);
      res.status(500).json({ success: false, error: 'Could not cancel the subscription.' });
    }
  });

  // ── Session lifecycle ────────────────────────────────────────────────────
  // Everything here runs inside a transaction so the entitlement cannot change
  // between being checked and being acted on.

  // Pre-flight gate. Blocking is acceptable — gameplay has not started yet.
  app.post('/api/play/session/start', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const parsed = startSchema.safeParse(req.body || {});
      if (!parsed.success) return badRequest(res, parsed);

      let out;
      try {
        out = await prisma.$transaction((tx) => openSession(tx, {
          userId: user.id,
          deviceId: parsed.data.deviceId,
          deviceLabel: parsed.data.deviceLabel,
          takeover: !!parsed.data.takeover,
        }));
      } catch (e) {
        // The activeKey unique index is the REAL guarantee of one session per
        // user; the findFirst inside openSession is only an optimisation for a
        // friendly message. When two devices open at the same instant both pass
        // that check and the database refuses the loser.
        //
        // This is the one collision that must NOT become an upsert: we want the
        // insert to fail and the whole transaction to roll back. It is caught
        // out here, AFTER the rollback, because nothing can be queried on a
        // poisoned transaction — then answered as the 409 the user deserves
        // rather than a bare "something went wrong".
        if (!(e && e.code === 'P2002')) throw e;
        const existing = await prisma.playSession.findFirst({
          where: { userId: user.id, state: 'ACTIVE' },
        });
        return res.status(409).json({
          success: false,
          error: 'Already playing on another device',
          code: 'SESSION_EXISTS',
          deviceLabel: (existing && existing.deviceLabel) || 'another device',
          startedAt: existing && existing.startedAt,
        });
      }
      res.status(201).json({ success: true, ...out });
    } catch (e) {
      sendPlaytimeError(res, e, 'play/session/start');
    }
  });

  // One request per minute, from a background coroutine. Never on the input path.
  app.post('/api/play/session/heartbeat', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const parsed = heartbeatSchema.safeParse(req.body || {});
      if (!parsed.success) return badRequest(res, parsed);

      const out = await prisma.$transaction((tx) => heartbeat(tx, {
        userId: user.id,                       // ownership check, not just id lookup
        ...parsed.data,
      }));
      // The transaction has committed — the time played was billed and the
      // session closed — and only now is the refusal reported.
      if (out.quotaExhausted) {
        return res.status(402).json({
          success: false,
          error: 'Daily playtime used up',
          code: 'QUOTA_EXHAUSTED',
          ...out,
        });
      }
      res.json({ success: true, ...out });
    } catch (e) {
      sendPlaytimeError(res, e, 'play/session/heartbeat');
    }
  });

  // Clean close. Bills uncapped, because the request arriving proves the user
  // was still there — unlike a reap, which is capped at the grace window.
  app.post('/api/play/session/stop', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const parsed = stopSchema.safeParse(req.body || {});
      if (!parsed.success) return badRequest(res, parsed);

      const out = await prisma.$transaction((tx) => stopSession(tx, {
        userId: user.id,
        ...parsed.data,
      }));
      res.json({ success: true, ...out });
    } catch (e) {
      sendPlaytimeError(res, e, 'play/session/stop');
    }
  });
}

module.exports = { registerBillingRoutes, PURCHASABLE_CHANNELS, startSchema, heartbeatSchema, stopSchema };
