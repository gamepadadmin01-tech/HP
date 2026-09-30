// Playtime accounting — the ledger.
//
// WHAT COUNTS: time with the controller open. Deliberately NOT conditional on
// the PC being connected. Home / System / Account are never counted.
//
// THREE INVARIANTS:
//
//  1. The ledger is append-only and idempotent. UsagePeriod.secondsUsed is a
//     materialised fold of UsageLedger and can be rebuilt from it at any time.
//
//  2. All billing time comes from the DATABASE clock inside the transaction,
//     never Date.now() in a Node process. With more than one instance running,
//     clock skew between them would enter billing silently.
//
//  3. The client never sends a DURATION. There is no API field for "I played
//     5000 seconds". It reports its running TOTAL for the period, and the
//     server takes whichever total is larger — see reconcileClientTotal below.
//
// Decisions: docs/research/BILLING_DECISIONS.md §2.2, §2.2b, §6.3

const { randomUUID } = require('crypto');
const { serverNow, resolveEffective } = require('./entitlement');
const { periodFor, isValidTimeZone, DEFAULT_TZ, DEFAULT_RESET_HOUR } = require('./period');
const { SESSION_STATE } = require('./plans');
const { issueTicketBase64 } = require('./ticket');
const { settleBank, remainingWithBank } = require('./adtime');

const HEARTBEAT_SECONDS = Number(process.env.PLAYTIME_HEARTBEAT_SECONDS || 60);
const LEASE_MULTIPLIER = Number(process.env.PLAYTIME_LEASE_MULTIPLIER || 3);
const LEASE_SECONDS = HEARTBEAT_SECONDS * LEASE_MULTIPLIER;

// Grace is deliberately HALF the heartbeat, not equal to it.
//
// If grace == HB, reaping an abandoned session always bills a full extra
// interval while the user actually stopped somewhere inside [0, HB) — a
// guaranteed over-charge of up to 60s and never any under-charge. At HB/2 the
// error is symmetric: at most 30s billed that wasn't played, at most 30s played
// that wasn't billed. That is the difference between "fair" and "we quietly
// take a minute off everyone whose connection drops".
const REAP_GRACE_SECONDS = Number(
  process.env.PLAYTIME_REAP_GRACE_SECONDS || Math.floor(HEARTBEAT_SECONDS / 2),
);

// Unlimited plans have no quota to count, so their heartbeat exists only to
// hold the session lock and refresh the PC's permission slip. It can run far
// slower — the most committed customers become the cheapest to serve.
const UNLIMITED_HEARTBEAT_SECONDS = Number(
  process.env.PLAYTIME_UNLIMITED_HEARTBEAT_SECONDS || 300,
);

// A SHORTER lease until the first heartbeat arrives, and this closes a real
// hole rather than tidying anything.
//
// The reap grace is capped at 30s so a dropped connection is never overcharged.
// But with a 180s lease, a client that simply never heartbeats — blocking the
// request at a proxy, no patched APK needed — plays 180 seconds, gets billed 30,
// then reopens (openSession reaps the old one first, so the slot is free). That
// is a 6x multiplier: the free hour becomes six, and Quarterly's six become
// thirty-six.
//
// Until a session proves it is a healthy client by heartbeating once, its lease
// is one heartbeat plus the grace. A well-behaved client heartbeats at 60s and
// is never affected. A silent one is reaped at 90s and billed for what it held.
const PRE_HEARTBEAT_LEASE_SECONDS = HEARTBEAT_SECONDS + REAP_GRACE_SECONDS;

// Guard rail on a single admin compensation grant, so a typo cannot hand out a
// year of playtime. Not a policy limit — a fat-finger limit.
const MAX_COMPENSATION_SECONDS = 24 * 3600;

class PlaytimeError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;      // HTTP status the route should return
    this.code = code;          // stable machine-readable code for the client
    if (extra) Object.assign(this, extra);
  }
}

// ── Pure helpers. All the arithmetic that can be wrong lives here. ──────────

/** Seconds between two instants, floored at zero and rounded down. */
function secondsBetween(from, to) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
}

/**
 * What a clean heartbeat bills: everything since the last one.
 *
 * Uncapped on purpose — the request arriving IS proof the user was there, and
 * the lease already bounds how stale this can get (a gap longer than the lease
 * is rejected as expired before it reaches here).
 */
function heartbeatDelta(lastBilledAt, now) {
  return secondsBetween(lastBilledAt, now);
}

/**
 * What reaping an abandoned session bills: the gap, CAPPED at the grace window.
 *
 * Never bill the full now - lastBilledAt here. A three-hour network partition
 * would otherwise charge a user for three hours they did not play.
 */
function reapDelta(lastBilledAt, now, graceSeconds = REAP_GRACE_SECONDS) {
  return Math.min(secondsBetween(lastBilledAt, now), graceSeconds);
}

/**
 * What reaping bills, given whether the session ever heartbeated.
 *
 * A session that heartbeated and then went quiet is a genuine drop: it lost at
 * most one interval, so the symmetric 30s grace is right.
 *
 * A session that NEVER heartbeated is different. We cannot tell a connection
 * that died in the first second from one that deliberately stayed silent for
 * the whole lease — but we can stop the second case from being free. It is
 * billed for the time it actually held the slot, capped at the short
 * pre-heartbeat lease. Worst case for an honest user whose link dies instantly
 * is 90 seconds of a 3600-second free tier; worst case for someone suppressing
 * heartbeats is that they are billed every second they played.
 */
function reapDeltaFor(session, now) {
  const everHeartbeat = Number(session.hbSeq) > 0;
  return everHeartbeat
    ? reapDelta(session.lastBilledAt, now, REAP_GRACE_SECONDS)
    : reapDelta(session.lastBilledAt, now, PRE_HEARTBEAT_LEASE_SECONDS);
}

/**
 * How much of a client-reported total to trust.
 *
 * The app counts locally so the countdown works offline. On reconnect it
 * reports its running total for the period and the server takes the LARGER of
 * the two, which is what makes clearing app data useless: wiping the local
 * counter restores nothing, because the server still remembers its own number.
 *
 * Taking the max is safe in the other direction too — a client that inflates
 * the figure only burns its own quota. The clamp exists so a client BUG cannot
 * lock someone out for a day; the period length is the ceiling, since no one
 * can play more seconds than the period contains.
 */
function reconcileClientTotal(serverSeconds, clientSeconds, periodLengthSeconds) {
  const claimed = Number.isFinite(clientSeconds) ? Math.floor(clientSeconds) : 0;
  const sane = Math.max(0, Math.min(claimed, periodLengthSeconds));
  return Math.max(serverSeconds, sane);
}

/** Seconds left today. null means unlimited. */
function remainingSeconds(usedSeconds, dailySeconds, unlimited) {
  if (unlimited || dailySeconds == null) return null;
  return Math.max(0, dailySeconds - usedSeconds);
}

// ── Database operations ────────────────────────────────────────────────────

/**
 * The user's billing row, creating it on first sight.
 *
 * Also rolls the period when the current one has ended, and applies a pending
 * timezone change AT that boundary — never mid-period, or the window would
 * move under a session that is already being billed against it.
 */
async function ensureBilling(tx, userId, now) {
  let billing = await tx.userBilling.findUnique({ where: { userId } });

  if (!billing) {
    const tz = DEFAULT_TZ;
    const p = periodFor(now, tz, DEFAULT_RESET_HOUR);
    // Upsert, not create: two first-touch requests for a brand-new user (say
    // /billing/me and /session/start fired together on first launch) both find
    // no row and both insert. A raw create would hand one of them an uncaught
    // P2002 — a 500 on the very first request a new user ever makes — and would
    // poison that transaction besides.
    billing = await tx.userBilling.upsert({
      where: { userId },
      create: { userId, resetTz: tz, periodStart: p.start, periodEnd: p.end },
      update: {},
    });
    return billing;
  }

  if (now >= billing.periodEnd) {
    const tz = billing.pendingTz && isValidTimeZone(billing.pendingTz)
      ? billing.pendingTz
      : billing.resetTz;
    // Recompute from `now` rather than chaining off the old end: a server that
    // was down for a week must land in the CURRENT period, not replay six.
    const p = periodFor(now, tz, DEFAULT_RESET_HOUR);
    billing = await tx.userBilling.update({
      where: { userId },
      data: { resetTz: tz, pendingTz: null, periodStart: p.start, periodEnd: p.end },
    });
  }

  return billing;
}

/** Seconds already recorded for a period, as the server sees them. */
async function usedSecondsFor(tx, userId, periodStart) {
  const row = await tx.usagePeriod.findUnique({
    where: { userId_periodStart: { userId, periodStart } },
  });
  return row ? row.secondsUsed : 0;
}

/**
 * Add to the ledger and fold it into the period total, exactly once.
 *
 * The unique constraint on (sessionId, idemKey) is the whole mechanism: a
 * replayed heartbeat collides, we swallow it, and the period total is NOT
 * touched. Returns whether this call was the one that counted.
 */
async function appendUsage(tx, { userId, sessionId, periodStart, periodEnd, seconds, reason, idemKey, note }) {
  if (!seconds) return false;

  // UPSERT, NOT create-and-catch. This is the single most important line in the
  // file to get right, and it was wrong.
  //
  // On PostgreSQL a unique violation aborts the WHOLE transaction: every later
  // statement fails with 25P02 and the COMMIT silently becomes a ROLLBACK.
  // Prisma 5.x issues no per-query savepoints. So `create` + `catch (P2002)`
  // meant that a RETRIED heartbeat — the ordinary case on a flaky mobile
  // connection, and the exact thing the idempotency key exists to make safe —
  // poisoned the transaction, the following playSession.update never ran, the
  // route returned 500 and THE LEASE WAS NOT EXTENDED. Enough repeats and the
  // session is reaped out from under someone who is still playing.
  //
  // `upsert` compiles to INSERT ... ON CONFLICT, so the collision is resolved
  // inside the database and the transaction stays usable. The freshly minted id
  // tells us which branch ran.
  const freshId = randomUUID();
  const row = await tx.usageLedger.upsert({
    where: { sessionId_idemKey: { sessionId, idemKey } },
    create: { id: freshId, userId, sessionId, periodStart, secondsDelta: seconds, reason, idemKey, note: note || null },
    update: {},   // no-op: a replay must never bill twice
  });
  if (row.id !== freshId) return false;   // already recorded

  await tx.usagePeriod.upsert({
    where: { userId_periodStart: { userId, periodStart } },
    create: { userId, periodStart, periodEnd, secondsUsed: seconds },
    update: { secondsUsed: { increment: seconds } },
  });
  return true;
}

/**
 * Close sessions whose lease has expired, billing the capped grace.
 *
 * Runs both from a sweeper AND lazily whenever any request touches the user,
 * which is what makes correctness independent of the sweeper being alive. A
 * backend restart cannot lose time.
 */
async function reapExpired(tx, now, userId = null) {
  const stale = await tx.playSession.findMany({
    where: {
      state: SESSION_STATE.ACTIVE,
      leaseExpiresAt: { lt: now },
      ...(userId ? { userId } : {}),
    },
    take: 200,
  });

  for (const s of stale) {
    const billing = await tx.userBilling.findUnique({ where: { userId: s.userId } });
    const period = billing
      ? { start: billing.periodStart, end: billing.periodEnd }
      : periodFor(now, DEFAULT_TZ, DEFAULT_RESET_HOUR);

    await appendUsage(tx, {
      userId: s.userId,
      sessionId: s.id,
      periodStart: period.start,
      periodEnd: period.end,
      seconds: reapDeltaFor(s, now),
      reason: 'reap',
      idemKey: `${s.id}:reap`,
    });

    // The reap bills the grace AFTER the last heartbeat settled the bank, so
    // settle again — otherwise that tail would come out of nobody's allowance.
    const effective = await resolveEffective(tx, s.userId, now);
    await settleBank(tx, {
      userId: s.userId,
      periodStart: period.start,
      usedSeconds: await usedSecondsFor(tx, s.userId, period.start),
      dailySeconds: effective.dailySeconds,
      unlimited: effective.unlimited,
    });

    await tx.playSession.update({
      where: { id: s.id },
      data: {
        state: SESSION_STATE.REAPED,
        activeKey: null,              // frees the one-active-session slot
        closedAt: now,
        closeReason: 'lease expired',
      },
    });
  }
  return stale.length;
}

/**
 * Open a session. The pre-flight gate.
 *
 * Refuses when the daily allowance is already spent, and refuses when another
 * session is already live for this user — the database enforces that second
 * rule through the unique index on activeKey, so it holds across however many
 * Node instances are running.
 */
async function openSession(tx, { userId, deviceId, deviceLabel, takeover = false }) {
  const now = await serverNow(tx);
  await reapExpired(tx, now, userId);

  const billing = await ensureBilling(tx, userId, now);
  const effective = await resolveEffective(tx, userId, now);

  const used = await usedSecondsFor(tx, userId, billing.periodStart);
  // Free allowance first, then ad-earned time — see adtime.js.
  const bank = await settleBank(tx, {
    userId,
    periodStart: billing.periodStart,
    usedSeconds: used,
    dailySeconds: effective.dailySeconds,
    unlimited: effective.unlimited,
  });
  const remaining = remainingWithBank(used, effective.dailySeconds, effective.unlimited, bank.available);
  if (remaining !== null && remaining <= 0) {
    throw new PlaytimeError(402, 'QUOTA_EXHAUSTED', 'Daily playtime used up', {
      plan: effective.planCode,
      resetsAt: billing.periodEnd,
    });
  }

  const existing = await tx.playSession.findFirst({
    where: { userId, state: SESSION_STATE.ACTIVE },
  });
  if (existing) {
    if (!takeover) {
      throw new PlaytimeError(409, 'SESSION_EXISTS', 'Already playing on another device', {
        deviceLabel: existing.deviceLabel || 'another device',
        startedAt: existing.startedAt,
      });
    }
    // Explicit takeover: bill what the old session owes, close it, move on.
    await appendUsage(tx, {
      userId,
      sessionId: existing.id,
      periodStart: billing.periodStart,
      periodEnd: billing.periodEnd,
      seconds: reapDeltaFor(existing, now),
      reason: 'close',
      idemKey: `${existing.id}:takeover`,
    });
    await tx.playSession.update({
      where: { id: existing.id },
      data: { state: SESSION_STATE.CLOSED, activeKey: null, closedAt: now, closeReason: 'taken over' },
    });
  }

  // The fence makes a paused-then-resumed session detectable: anything carrying
  // an older fence is a zombie and is rejected by both this backend and the PC
  // server. A lease TTL alone is not enough — a GC pause longer than the lease
  // would otherwise leave two legitimate-looking holders.
  const updated = await tx.userBilling.update({
    where: { userId },
    data: { fenceCounter: { increment: 1 } },
  });

  const session = await tx.playSession.create({
    data: {
      userId,
      activeKey: userId,               // NULL once closed; see schema comment
      fence: updated.fenceCounter,
      state: SESSION_STATE.ACTIVE,
      deviceId,
      deviceLabel: deviceLabel || null,
      planCodeAtStart: effective.planCode,
      unlimited: effective.unlimited,
      lastBilledAt: now,
      leaseExpiresAt: new Date(now.getTime() + PRE_HEARTBEAT_LEASE_SECONDS * 1000),
    },
  });

  return {
    sessionId: session.id,
    fence: session.fence,
    plan: effective.planCode,
    unlimited: effective.unlimited,
    remainingSeconds: remaining,
    bankSeconds: bank.balance,
    resetsAt: billing.periodEnd,
    nextHeartbeatMs: (effective.unlimited ? UNLIMITED_HEARTBEAT_SECONDS : HEARTBEAT_SECONDS) * 1000,
    serverTime: now,
    // The first ticket, so the PC server is armed before play begins rather
    // than a heartbeat later.
    ticket: issueTicketBase64({ sessionId: session.id, fence: session.fence, seq: 0 }),
  };
}

/**
 * Bill the elapsed interval and extend the lease.
 *
 * clientSeconds is the app's own running total for the period. It cannot make
 * the bill smaller — see reconcileClientTotal.
 */
async function heartbeat(tx, { userId, sessionId, fence, seq, clientSeconds }) {
  const now = await serverNow(tx);
  const session = await tx.playSession.findUnique({ where: { id: sessionId } });

  if (!session) throw new PlaytimeError(410, 'SESSION_GONE', 'Session not found');
  // Ownership, not just existence. Without this a caller could heartbeat — or
  // stop — a stranger's session by guessing an id, billing time to them or
  // ending their game. Reported as GONE rather than FORBIDDEN so the endpoint
  // cannot be used to probe which session ids exist.
  if (userId && session.userId !== userId) {
    throw new PlaytimeError(410, 'SESSION_GONE', 'Session not found');
  }
  if (session.state !== SESSION_STATE.ACTIVE) {
    throw new PlaytimeError(410, 'SESSION_CLOSED', 'Session already closed');
  }
  if (Number(fence) < session.fence) {
    throw new PlaytimeError(409, 'FENCE_STALE', 'Superseded by a newer session');
  }
  if (session.leaseExpiresAt < now) {
    await reapExpired(tx, now, session.userId);
    throw new PlaytimeError(410, 'LEASE_EXPIRED', 'Session lease expired, open a new one');
  }

  const billing = await ensureBilling(tx, session.userId, now);
  const effective = await resolveEffective(tx, session.userId, now);

  await appendUsage(tx, {
    userId: session.userId,
    sessionId: session.id,
    periodStart: billing.periodStart,
    periodEnd: billing.periodEnd,
    seconds: heartbeatDelta(session.lastBilledAt, now),
    reason: 'heartbeat',
    idemKey: `${session.id}:${seq}`,
  });

  // Fold in anything the app counted while it could not reach us.
  if (!effective.unlimited && clientSeconds != null) {
    const serverSeconds = await usedSecondsFor(tx, session.userId, billing.periodStart);
    const periodLength = secondsBetween(billing.periodStart, billing.periodEnd);
    const target = reconcileClientTotal(serverSeconds, clientSeconds, periodLength);
    if (target > serverSeconds) {
      await appendUsage(tx, {
        userId: session.userId,
        sessionId: session.id,
        periodStart: billing.periodStart,
        periodEnd: billing.periodEnd,
        seconds: target - serverSeconds,
        reason: 'offline',
        // Keyed on the claimed total, so re-reporting the same figure is a no-op.
        idemKey: `${session.id}:offline:${target}`,
      });
    }
  }

  await tx.playSession.update({
    where: { id: session.id },
    data: {
      lastBilledAt: now,
      leaseExpiresAt: new Date(now.getTime() + LEASE_SECONDS * 1000),
      hbSeq: Number(seq) || session.hbSeq,
    },
  });

  const used = await usedSecondsFor(tx, session.userId, billing.periodStart);
  // Free allowance first, then ad-earned time. Settling here, every minute, is
  // what moves time out of the bank as it is played.
  const bank = await settleBank(tx, {
    userId: session.userId,
    periodStart: billing.periodStart,
    usedSeconds: used,
    dailySeconds: effective.dailySeconds,
    unlimited: effective.unlimited,
  });
  const left = remainingWithBank(used, effective.dailySeconds, effective.unlimited, bank.available);

  // OUT OF TIME ENDS THE SESSION. The limit used to be checked only when a
  // session opened, so a client that ignored `remainingSeconds` played forever
  // and the server billed it. Close the session here and stop issuing tickets:
  // the PC server tears down on its own within a ticket TTL.
  if (left !== null && left <= 0) {
    await tx.playSession.update({
      where: { id: session.id },
      data: {
        state: SESSION_STATE.CLOSED,
        activeKey: null,
        closedAt: now,
        closeReason: 'daily limit reached',
      },
    });
    // Returned, NOT thrown. Throwing here would roll the transaction back and
    // undo both the time just billed and the close itself — the caller must
    // still commit, so the refusal travels as state and the route turns it into
    // a 402.
    return {
      quotaExhausted: true,
      remainingSeconds: 0,
      bankSeconds: bank.balance,
      unlimited: false,
      plan: effective.planCode,
      usedSeconds: used,
      resetsAt: billing.periodEnd,
      serverTime: now,
      ticket: null,          // issuance stops here: the PC tears down on its own
    };
  }

  // THE ENFORCEMENT MECHANISM, and it is deliberately this passive: while the
  // user has time we hand out a fresh capability ticket, and when they run out
  // we simply stop. The PC server tears the session down on its own once no new
  // ticket arrives — nothing here has to reach out and kill anything, so a
  // backend that goes down cannot leave a session stuck in a killed state.
  const ticket = (left === null || left > 0)
    ? issueTicketBase64({ sessionId: session.id, fence: session.fence, seq: Number(seq) || 0 })
    : null;

  return {
    remainingSeconds: left,
    bankSeconds: bank.balance,
    unlimited: effective.unlimited,
    plan: effective.planCode,
    usedSeconds: used,
    resetsAt: billing.periodEnd,
    nextHeartbeatMs: (effective.unlimited ? UNLIMITED_HEARTBEAT_SECONDS : HEARTBEAT_SECONDS) * 1000,
    serverTime: now,
    ticket,
  };
}

/**
 * Close a session cleanly.
 *
 * Bills the full interval uncapped, unlike a reap: the request arriving proves
 * the user was still there at `now`.
 */
async function stopSession(tx, { userId, sessionId, fence }) {
  const now = await serverNow(tx);
  const session = await tx.playSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new PlaytimeError(410, 'SESSION_GONE', 'Session not found');
  if (userId && session.userId !== userId) {          // ownership — see heartbeat
    throw new PlaytimeError(410, 'SESSION_GONE', 'Session not found');
  }
  if (session.state !== SESSION_STATE.ACTIVE) {
    return { ok: true, alreadyClosed: true };       // idempotent
  }
  if (Number(fence) < session.fence) {
    throw new PlaytimeError(409, 'FENCE_STALE', 'Superseded by a newer session');
  }

  const billing = await ensureBilling(tx, session.userId, now);
  await appendUsage(tx, {
    userId: session.userId,
    sessionId: session.id,
    periodStart: billing.periodStart,
    periodEnd: billing.periodEnd,
    seconds: heartbeatDelta(session.lastBilledAt, now),
    reason: 'close',
    idemKey: `${session.id}:close`,
  });
  await tx.playSession.update({
    where: { id: session.id },
    data: { state: SESSION_STATE.CLOSED, activeKey: null, closedAt: now, closeReason: 'client stop' },
  });

  const used = await usedSecondsFor(tx, session.userId, billing.periodStart);
  // The closing interval may have run into the bank — charge it now, while the
  // period is still the current one.
  const effective = await resolveEffective(tx, session.userId, now);
  const bank = await settleBank(tx, {
    userId: session.userId,
    periodStart: billing.periodStart,
    usedSeconds: used,
    dailySeconds: effective.dailySeconds,
    unlimited: effective.unlimited,
  });
  return { ok: true, usedSeconds: used, bankSeconds: bank.balance, resetsAt: billing.periodEnd };
}

/**
 * Give a user playtime back — the compensation control for the admin portal.
 *
 * Implemented as a NEGATIVE ledger row, which is why it needs no new table and
 * cannot corrupt anything: the period total is a fold of the ledger, so
 * subtracting is exactly as safe as adding, and the grant shows up in the same
 * audit trail as everything else. Granting more than was used is allowed and
 * deliberate — it hands the user extra time on top of the daily allowance,
 * which is the point when a bug cost them an evening.
 */
async function grantCompensation(tx, { userId, seconds, adminId, note }) {
  const amount = Math.floor(Number(seconds));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PlaytimeError(400, 'BAD_AMOUNT', 'Compensation must be a positive number of seconds');
  }
  if (amount > MAX_COMPENSATION_SECONDS) {
    throw new PlaytimeError(400, 'AMOUNT_TOO_LARGE',
      `Single grant is capped at ${MAX_COMPENSATION_SECONDS / 3600}h`);
  }

  const now = await serverNow(tx);
  const billing = await ensureBilling(tx, userId, now);

  await appendUsage(tx, {
    userId,
    sessionId: `admin:${adminId || 'unknown'}`,
    periodStart: billing.periodStart,
    periodEnd: billing.periodEnd,
    seconds: -amount,
    reason: 'adjust',
    idemKey: `adjust:${randomUUID()}`,
    note: note || null,
  });

  const used = await usedSecondsFor(tx, userId, billing.periodStart);
  return { usedSeconds: used, resetsAt: billing.periodEnd, grantedSeconds: amount };
}

module.exports = {
  HEARTBEAT_SECONDS,
  LEASE_SECONDS,
  REAP_GRACE_SECONDS,
  UNLIMITED_HEARTBEAT_SECONDS,
  MAX_COMPENSATION_SECONDS,
  PlaytimeError,
  secondsBetween,
  heartbeatDelta,
  reapDelta,
  reapDeltaFor,
  PRE_HEARTBEAT_LEASE_SECONDS,
  reconcileClientTotal,
  remainingSeconds,
  ensureBilling,
  usedSecondsFor,
  appendUsage,
  reapExpired,
  openSession,
  heartbeat,
  stopSession,
  grantCompensation,
};
