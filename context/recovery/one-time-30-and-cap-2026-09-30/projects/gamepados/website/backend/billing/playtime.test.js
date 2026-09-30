// Plain-node tests for playtime accounting: node billing/playtime.test.js
//
// Covers the arithmetic that decides how much a user is charged. Everything
// here is pure — the database operations in playtime.js are thin wrappers
// around these, so getting these right is most of the battle.
//
// Blueprint §14 cases 21-22 (disconnect/crash), 27 (clock change) and 28
// (frontend tampering) are the ones being pinned down.

const assert = require('assert');
const {
  secondsBetween, heartbeatDelta, reapDelta, reapDeltaFor, reconcileClientTotal, remainingSeconds,
  HEARTBEAT_SECONDS, LEASE_SECONDS, REAP_GRACE_SECONDS, MAX_COMPENSATION_SECONDS,
  PRE_HEARTBEAT_LEASE_SECONDS,
} = require('./playtime');

const T = (s) => new Date(1_700_000_000_000 + s * 1000);

// ── The timing constants relate as designed ────────────────────────────────
{
  assert.strictEqual(LEASE_SECONDS, HEARTBEAT_SECONDS * 3, 'lease is 3 heartbeats');
  assert.strictEqual(REAP_GRACE_SECONDS, HEARTBEAT_SECONDS / 2,
    'grace is HALF a heartbeat — this is what keeps the reap error symmetric');
}

// ── secondsBetween never goes backwards ────────────────────────────────────
{
  assert.strictEqual(secondsBetween(T(0), T(60)), 60);
  assert.strictEqual(secondsBetween(T(0), T(0)), 0);
  assert.strictEqual(secondsBetween(T(60), T(0)), 0, 'a backwards clock bills zero, never negative');
  assert.strictEqual(secondsBetween(T(0), new Date(T(0).getTime() + 1999)), 1, 'partial seconds round down');
}

// ── A clean heartbeat bills the whole interval ─────────────────────────────
{
  assert.strictEqual(heartbeatDelta(T(0), T(60)), 60);
  assert.strictEqual(heartbeatDelta(T(0), T(179)), 179,
    'a late-but-live heartbeat bills all of it — the request arriving proves presence');
}

// ── Reaping is CAPPED. This is the anti-overcharge rule. ───────────────────
{
  // Session dropped somewhere in the last interval: bill at most the grace.
  assert.strictEqual(reapDelta(T(0), T(20)), 20, 'short gap bills exactly what elapsed');
  assert.strictEqual(reapDelta(T(0), T(30)), 30, 'at the grace boundary');
  assert.strictEqual(reapDelta(T(0), T(31)), 30, 'beyond it, capped');

  // The case this cap exists for: a three-hour network partition must NOT
  // charge the user three hours they did not play.
  assert.strictEqual(reapDelta(T(0), T(3 * 3600)), REAP_GRACE_SECONDS,
    'a 3-hour partition bills 30 seconds, not 3 hours');
}

// ── The fairness property, stated as a test ────────────────────────────────
// Maximum over-charge on an abandoned session: 30s. Maximum free time on a
// crash: 30s. Symmetric by construction.
{
  const worstOvercharge = reapDelta(T(0), T(3600)) - 0;          // played 0, billed grace
  const worstFreeTime = HEARTBEAT_SECONDS - REAP_GRACE_SECONDS;  // played HB, billed grace
  assert.strictEqual(worstOvercharge, 30);
  assert.strictEqual(worstFreeTime, 30);
  assert.strictEqual(worstOvercharge, worstFreeTime, 'the error is symmetric in both directions');
}

// ── Client-reported totals: the max() rule ─────────────────────────────────
{
  const PERIOD = 24 * 3600;

  // Online and in agreement — nothing changes.
  assert.strictEqual(reconcileClientTotal(600, 600, PERIOD), 600);

  // The app counted offline time the server never saw: the app's figure wins.
  assert.strictEqual(reconcileClientTotal(600, 1800, PERIOD), 1800,
    'offline play is folded in on reconnect');

  // THE ATTACK: clear app data to reset the counter. The server remembers.
  assert.strictEqual(reconcileClientTotal(3000, 0, PERIOD), 3000,
    'wiping the local counter restores nothing');
  assert.strictEqual(reconcileClientTotal(3000, null, PERIOD), 3000);
  assert.strictEqual(reconcileClientTotal(3000, undefined, PERIOD), 3000);

  // Nonsense from a tampered or broken client cannot exceed the period itself,
  // so a client bug can never lock someone out for longer than today.
  assert.strictEqual(reconcileClientTotal(600, 999999999, PERIOD), PERIOD);
  assert.strictEqual(reconcileClientTotal(600, -50, PERIOD), 600, 'negative claims are ignored');
  assert.strictEqual(reconcileClientTotal(600, NaN, PERIOD), 600);
  assert.strictEqual(reconcileClientTotal(600, 'lots', PERIOD), 600, 'non-numeric is ignored');

  // Inflating your own usage is allowed — it only costs the claimant.
  assert.strictEqual(reconcileClientTotal(100, 5000, PERIOD), 5000);
}

// ── Remaining time, per plan ───────────────────────────────────────────────
{
  // Free: one hour.
  assert.strictEqual(remainingSeconds(0, 3600, false), 3600);
  assert.strictEqual(remainingSeconds(1200, 3600, false), 2400);
  assert.strictEqual(remainingSeconds(3600, 3600, false), 0, 'exactly spent');
  assert.strictEqual(remainingSeconds(9999, 3600, false), 0, 'never negative');

  // Quarterly: six hours.
  assert.strictEqual(remainingSeconds(0, 21600, false), 21600);
  assert.strictEqual(remainingSeconds(15120, 21600, false), 6480);

  // Unlimited plans report null, not a big number — the UI shows no limit at
  // all rather than a countdown from something arbitrary.
  assert.strictEqual(remainingSeconds(50000, null, true), null);
  assert.strictEqual(remainingSeconds(0, 3600, true), null, 'unlimited overrides any cap');

  // Admin compensation drives used NEGATIVE, which hands out extra time on top
  // of the daily allowance. That is the intent, not a bug.
  assert.strictEqual(remainingSeconds(-3600, 3600, false), 7200,
    'an hour of compensation gives two hours today');
}

// ── The compensation guard rail ────────────────────────────────────────────
{
  assert.strictEqual(MAX_COMPENSATION_SECONDS, 24 * 3600,
    'a single grant is capped at a day — a fat-finger limit, not a policy one');
}

// ── The heartbeat-suppression hole (found in review) ──────────────────────
// Blocking the heartbeat request needs no patched APK — a proxy rule does it.
// With a 180s lease and a 30s reap cap, 180 seconds of play cost 30 seconds of
// quota, and reopening was free because openSession reaps the old session
// first. That is a 6x multiplier on every tier, paid ones included.
{
  assert.strictEqual(PRE_HEARTBEAT_LEASE_SECONDS, 90,
    'a session that has not heartbeated yet holds a 90s lease, not 180s');

  const t0 = T(0);
  const silent = { hbSeq: 0, lastBilledAt: t0 };
  const healthy = { hbSeq: 7, lastBilledAt: t0 };

  // A session that never heartbeated is billed for the time it actually held.
  assert.strictEqual(reapDeltaFor(silent, T(90)), 90,
    'holding the slot silently for 90s costs 90s, not 30s');
  assert.strictEqual(reapDeltaFor(silent, T(45)), 45, 'and 45s costs 45s');

  // A genuine mid-session drop keeps the symmetric grace.
  assert.strictEqual(reapDeltaFor(healthy, T(3600)), REAP_GRACE_SECONDS,
    'a session that WAS heartbeating is still capped at the 30s grace');

  // The multiplier is gone.
  const playedSilently = 90;
  assert.strictEqual(reapDeltaFor(silent, T(playedSilently)) / playedSilently, 1,
    'billed seconds now equal played seconds — the 6x multiplier is closed');
}

console.log('billing/playtime.test.js — all assertions passed');
