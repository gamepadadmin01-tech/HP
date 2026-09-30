// Ad-earned play time — the "bank".
//
// THE RULES (owner's decisions, 2026-09-28):
//   * One rewarded ad = AD_REWARD_SECONDS (30 minutes).
//   * Anyone can watch, as often as they like. No daily cap on ads.
//   * Earned time STACKS and NEVER EXPIRES.
//   * Each day's free allowance is used first; the bank covers what goes past
//     it. Using the expiring allowance before the permanent bank is the only
//     order in which nobody ever loses minutes.
//   * Unlimited plans (Lifetime) never touch the bank. It simply waits.
//
// HOW IT IS STORED, and why it can never go negative:
//
//   AdReward      +seconds per confirmed ad        (append-only, unique per ad)
//   AdTimeSpend   seconds the bank covered, per reset period
//
//   balance = SUM(AdReward.seconds) - SUM(AdTimeSpend.secondsSpent)
//
// A period's spend is always written as its CURRENT figure — an upsert of
//   min(overflow, available)   where   overflow  = max(0, used - dailySeconds)
//                                      available = rewards - spend of OTHER periods
// so recomputing it is idempotent, and because each period can only take what
// the other periods left, the spends can never add up to more than was earned.
// A compensation grant (a negative usage row) shrinks `used`, the overflow
// shrinks with it, and the bank is refunded on the next settle — no special
// case needed.
//
// Signed-out players have no server identity; their bank lives on the phone
// (app side), exactly like their free 30 minutes. Nothing here serves them.

const { randomUUID } = require('crypto');

const AD_REWARD_SECONDS = 30 * 60;

// ── Pure helpers ────────────────────────────────────────────────────────────

/** How much of this period's play went past the free allowance. */
function overflowSeconds(usedSeconds, dailySeconds) {
  if (dailySeconds == null) return 0;          // no daily cap → nothing to cover
  return Math.max(0, Math.floor(usedSeconds) - dailySeconds);
}

/** What the bank should be charged for a period, given what it can afford. */
function spendFor(usedSeconds, dailySeconds, availableSeconds) {
  return Math.min(overflowSeconds(usedSeconds, dailySeconds), Math.max(0, availableSeconds));
}

/**
 * Seconds of play left right now, counting the bank. null means unlimited.
 *
 * `availableSeconds` is what the bank held BEFORE this period's spend — so the
 * free allowance and the bank are simply added together and today's use comes
 * off the top.
 */
function remainingWithBank(usedSeconds, dailySeconds, unlimited, availableSeconds) {
  if (unlimited || dailySeconds == null) return null;
  return Math.max(0, dailySeconds + Math.max(0, availableSeconds) - Math.floor(usedSeconds));
}

// ── Database operations ────────────────────────────────────────────────────

/**
 * Seconds the bank can put towards `periodStart`: everything earned, minus what
 * every OTHER period already spent. Sums in JS rather than aggregate(): a user
 * has a handful of rows, and it keeps the test database honest.
 */
async function availableFor(tx, userId, periodStart) {
  const [rewards, spends] = await Promise.all([
    tx.adReward.findMany({ where: { userId } }),
    tx.adTimeSpend.findMany({ where: { userId } }),
  ]);
  const earned = rewards.reduce((s, r) => s + r.seconds, 0);
  const key = periodStart.getTime();
  const spentElsewhere = spends
    .filter((s) => new Date(s.periodStart).getTime() !== key)
    .reduce((s, r) => s + r.secondsSpent, 0);
  return Math.max(0, earned - spentElsewhere);
}

/**
 * Record what the bank covers for this period and return the numbers the
 * callers need. Safe to call as often as you like — it writes the current
 * figure, never an increment.
 *
 * For an unlimited plan nothing is charged and nothing is written.
 */
async function settleBank(tx, { userId, periodStart, usedSeconds, dailySeconds, unlimited }) {
  const available = await availableFor(tx, userId, periodStart);
  if (unlimited || dailySeconds == null) {
    return { available, spent: 0, balance: available };
  }
  const spent = spendFor(usedSeconds, dailySeconds, available);
  // Only write when there is something to say — a user who never watched an ad
  // and never went over costs no extra write on every heartbeat.
  if (spent > 0 || available > 0) {
    await tx.adTimeSpend.upsert({
      where: { userId_periodStart: { userId, periodStart } },
      create: { userId, periodStart, secondsSpent: spent },
      update: { secondsSpent: spent },
    });
  }
  return { available, spent, balance: available - spent };
}

/**
 * Credit one confirmed ad, exactly once.
 *
 * UPSERT, not create-and-catch — the same PostgreSQL rule as grant.js: a unique
 * violation aborts the whole transaction. Google retries a callback it thinks
 * failed, so the collision is the NORMAL case here. The freshly minted id tells
 * us whether this call was the one that counted.
 */
async function creditAdReward(tx, { userId, transactionId, adUnit, seconds = AD_REWARD_SECONDS }) {
  const freshId = randomUUID();
  const row = await tx.adReward.upsert({
    where: { transactionId },
    create: { id: freshId, userId, transactionId, adUnit: adUnit || '', seconds },
    update: {},
  });
  return { credited: row.id === freshId, reward: row };
}

module.exports = {
  AD_REWARD_SECONDS,
  overflowSeconds,
  spendFor,
  remainingWithBank,
  availableFor,
  settleBank,
  creditAdReward,
};
