// The plan catalogue — the single source of truth for what each plan ALLOWS.
//
// PRICES ARE DELIBERATELY NOT HERE. They live in the Plan table so the admin
// portal can change them without a deploy, and because for the playstore
// flavour the authoritative price lives in Play Console, not in our database at
// all — rendering our own number next to a Play SKU is a policy violation.
//
// Nothing outside this file may hardcode a limit or a priority. If a number
// below is wrong, this is the only place it is wrong.
//
// The reasoning behind every value: docs/research/BILLING_DECISIONS.md

const HOUR = 3600;

const PLAN = {
  FREE:      'FREE',
  THREE_DAY: 'THREE_DAY',
  QUARTERLY: 'QUARTERLY',
  LIFETIME:  'LIFETIME',
};

// priority decides which entitlement wins when a user holds several at once.
// It is the whole reason buying a plan can never take something away: a new
// purchase inserts a row, the highest priority applies, and when it expires the
// next one takes over by itself. No cron, no migration, no destructive write.
//
//   LIFETIME (100) > THREE_DAY (80) > QUARTERLY (60) > FREE (0)
//
// THREE_DAY sits ABOVE QUARTERLY on purpose: it is unlimited, so a quarterly
// subscriber who buys a pass gets the better deal for 72h and drops back
// afterwards. That cannot cannibalise the subscription — covering a quarter
// with passes costs ~₹570 against ₹99.
const PLAN_POLICY = {
  FREE: {
    priority: 0,
    dailySeconds: 1 * HOUR,
    unlimited: false,
    neverExpires: true,   // FREE is the fallback, not a row — it cannot lapse
    durationHours: null,
    durationMonths: null,
  },
  THREE_DAY: {
    priority: 80,
    dailySeconds: null,   // null = no daily cap
    unlimited: true,
    neverExpires: false,
    durationHours: 72,
    durationMonths: null,
  },
  QUARTERLY: {
    priority: 60,
    dailySeconds: 6 * HOUR,
    unlimited: false,
    neverExpires: false,
    durationHours: null,
    durationMonths: 3,
  },
  LIFETIME: {
    priority: 100,
    dailySeconds: null,
    unlimited: true,
    neverExpires: true,   // endsAt stays null forever
    durationHours: null,
    durationMonths: null,
  },
};

// FREE is never stored as an Entitlement row. It is what resolveEffective()
// returns when nothing else matches, so a user who deletes and recreates state
// cannot end up with no plan at all.
const PAID_PLANS = [PLAN.THREE_DAY, PLAN.QUARTERLY, PLAN.LIFETIME];

// What can be BOUGHT. Narrower than PAID_PLANS on purpose (owner's decision,
// 2026-09-28): the ₹19 3-Day Pass and ₹99 Quarterly are no longer sold —
// Lifetime is the only plan, and rewarded ads are the free way to play longer
// (see adtime.js). The other two stay in PAID_PLANS because they still WORK:
// promo codes and the launch gift grant THREE_DAY, and old payment and
// entitlement rows must keep resolving. Taking a plan off sale is this list,
// nothing else — no database rows are touched.
const ON_SALE_PLANS = [PLAN.LIFETIME];

const ENT_SOURCE  = { PLAY: 'PLAY', RAZORPAY: 'RAZORPAY', AMAZON: 'AMAZON', PROMO: 'PROMO', MANUAL: 'MANUAL' };
const ENT_STATUS  = { PENDING: 'PENDING', ACTIVE: 'ACTIVE', EXPIRED: 'EXPIRED', REVOKED: 'REVOKED', SUPERSEDED: 'SUPERSEDED' };
const PAY_STATUS  = { CREATED: 'CREATED', PENDING: 'PENDING', CAPTURED: 'CAPTURED', FAILED: 'FAILED', REFUNDED: 'REFUNDED' };
const SESSION_STATE = { ACTIVE: 'ACTIVE', CLOSED: 'CLOSED', REAPED: 'REAPED' };

function isPlanCode(code) {
  return Object.prototype.hasOwnProperty.call(PLAN_POLICY, code);
}

/** Policy for a plan code. Throws rather than silently granting the wrong thing. */
function policyFor(code) {
  if (!isPlanCode(code)) throw new Error(`unknown plan code: ${code}`);
  return PLAN_POLICY[code];
}

function isPaidPlan(code) {
  return PAID_PLANS.includes(code);
}

/**
 * Add whole months, clamping the day rather than rolling into the next month.
 *
 * 31 Jan + 3 months must be 30 Apr, not 1 May. Naive date arithmetic overflows
 * because April has no 31st, and Date silently rolls it forward — which would
 * hand out an extra day roughly four times a year, forever.
 */
function addMonths(date, months) {
  const d = new Date(date.getTime());
  const targetMonth = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  d.setUTCDate(1);                    // avoid the overflow before it can happen
  d.setUTCMonth(targetMonth);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/**
 * When a freshly granted entitlement should end.
 *
 * Returns null for plans that never expire (LIFETIME). Only used for grants we
 * compute ourselves — PROMO, MANUAL and one-time purchases. For a Play or
 * Razorpay SUBSCRIPTION the provider owns the renewal clock and endsAt is
 * MIRRORED from their API response, never computed here.
 */
function computeEndsAt(planCode, startsAt) {
  const p = policyFor(planCode);
  if (p.neverExpires) return null;
  if (p.durationHours) return new Date(startsAt.getTime() + p.durationHours * 3600 * 1000);
  if (p.durationMonths) return addMonths(startsAt, p.durationMonths);
  throw new Error(`plan ${planCode} has no duration and is not marked neverExpires`);
}

/** What a user with no entitlement at all is allowed. */
function freeEffective() {
  return {
    planCode: PLAN.FREE,
    unlimited: false,
    dailySeconds: PLAN_POLICY.FREE.dailySeconds,
    entitlementId: null,
    startsAt: null,
    endsAt: null,
    autoRenew: false,
    source: null,
  };
}

module.exports = {
  HOUR,
  PLAN,
  PLAN_POLICY,
  PAID_PLANS,
  ON_SALE_PLANS,
  ENT_SOURCE,
  ENT_STATUS,
  PAY_STATUS,
  SESSION_STATE,
  isPlanCode,
  policyFor,
  isPaidPlan,
  addMonths,
  computeEndsAt,
  freeEffective,
};
