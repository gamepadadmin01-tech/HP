//! The launch gift: 3 days of unlimited playtime, granted automatically.
//!
//! WHY THIS EXISTS
//! The app has been telling people since the plans release that they can "claim
//! free premium", and there was never anything to claim. `LaunchNotice.tsx` says
//! outright that it grants nothing and the entitlement is written server-side by
//! `grant-launch-bonus.js` — a manual one-shot that requires `--apply`, is
//! imported by nothing, and had never been run: the entitlement table contained
//! zero launch-bonus rows. So every user who read the notice and went looking for
//! their gift found no button, because none existed.
//!
//! The fix is to stop making it a thing anyone has to run. This grants lazily on
//! the next billing check, which covers both cases in one mechanism:
//!   * a new account gets the gift the first time the app asks for its plan;
//!   * an existing account with no plan gets it on their next check, with no
//!     script run and no backfill step that someone has to remember.
//!
//! IDEMPOTENCE is the whole design. `externalRef` is unique per user and the
//! entitlement table has a `@@unique([source, externalRef])` constraint, so the
//! database itself refuses a second grant — not application logic that could be
//! raced by two requests from the same phone. `grantEntitlement` checks that
//! constraint first and returns `created: false` rather than throwing.
//!
//! Reuses the ref prefix from `grant-launch-bonus.js` deliberately: if that
//! script is ever run it will see these rows and skip them, and vice versa. The
//! two paths cannot double-credit each other.

const { PLAN, ENT_SOURCE } = require('./plans');
const { grantEntitlement } = require('./grant');

/** Must match grant-launch-bonus.js exactly, or the two paths can double-grant. */
const REF_PREFIX = 'launch-bonus-v1:';

/** 3 days, as the in-app notice promises. */
const GIFT_DAYS = 3;
const GIFT_MS = GIFT_DAYS * 24 * 3600 * 1000;

/**
 * Only accounts that existed when this shipped are eligible.
 *
 * THIS CUTOFF IS THE WHOLE DIFFERENCE between a launch gift and a permanent free
 * trial. The in-app notice says "Everyone ALREADY USING GamepadOS" — it is a
 * thank-you to people who were promised something and could never claim it, not
 * an ongoing offer. Without a cutoff every future signup would get 3 days of
 * unlimited play automatically, which would also make the paid 3-Day Pass (₹19)
 * pointless: nobody buys what arrives free on registration.
 *
 * Override with LAUNCH_BONUS_BEFORE (ISO date) to re-run it for a later cohort.
 */
const CUTOFF = new Date(process.env.LAUNCH_BONUS_BEFORE || '2026-09-04T00:00:00Z');

/**
 * Give `userId` the launch gift if they have never had it and are not already
 * on a paid plan.
 *
 * Never throws: a failure here must not break the billing check the app depends
 * on to know whether it may play. A user who misses the gift because of a
 * transient database error simply gets it on their next check.
 *
 * @returns {Promise<boolean>} true only when a NEW entitlement was written.
 */
async function ensureLaunchBonus(prisma, userId, now) {
  if (!userId) return false;
  try {
    // Eligibility first — it is the cheapest check and rules out every account
    // created after the launch, which over time is nearly all of them.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });
    if (!user || user.createdAt >= CUTOFF) return false;

    // Someone already on a paid plan needs nothing. Skipping them also avoids
    // writing a 3-day row for a LIFETIME holder, where the stacking rule would
    // schedule it to start when their lifetime ends — i.e. never.
    const paid = await prisma.entitlement.findFirst({
      where: { userId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (paid) return false;

    const startsAt = now instanceof Date ? now : new Date();
    const out = await prisma.$transaction((tx) => grantEntitlement(tx, {
      userId,
      planCode: PLAN.THREE_DAY,
      source: ENT_SOURCE.PROMO,
      externalRef: REF_PREFIX + userId,     // idempotent: one per user, ever
      // Explicit endsAt rather than the plan's own duration, so the gift is
      // exactly the 3 days the notice promises even if the paid 3-Day Pass is
      // ever repriced or its duration changed.
      endsAt: new Date(startsAt.getTime() + GIFT_MS),
      meta: { reason: 'launch gift — granted automatically on first billing check', days: GIFT_DAYS },
    }));
    return !!(out && out.created);
  } catch (e) {
    console.warn('launch bonus grant skipped for ' + userId + ': ' + e.message);
    return false;
  }
}

module.exports = { ensureLaunchBonus, REF_PREFIX, GIFT_DAYS };
