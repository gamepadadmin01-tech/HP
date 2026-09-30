// HTTP-level tests for the billing routes: node billing/routes.test.js
//
// Runs the REAL express app and the REAL handlers against an in-memory stand-in
// for Prisma, so the whole request path is exercised — auth, validation, status
// codes, error mapping, JSON shape — without needing a database.
//
// The arithmetic these routes sit on top of is covered by playtime.test.js and
// entitlement.test.js. What is being pinned down here is the wiring: that an
// unauthenticated call is refused, that a second device is refused, and that
// one user cannot touch another user's session.

const assert = require('assert');
const express = require('express');
const { registerBillingRoutes } = require('./routes');
// Shared in-memory Prisma stand-in with REAL transaction semantics: a failed
// statement poisons the transaction and a failed transaction rolls back, as
// PostgreSQL does. The hand-rolled fakes these replaced had none of that, which
// is why the P2002-inside-a-transaction bug was invisible to every suite.
const { createTestDb, BILLING_SPEC } = require('./testdb');

// ── A minimal Prisma stand-in ──────────────────────────────────────────────
// Only the handful of operations the billing code actually performs. Enough to
// drive the real handlers; deliberately not a general-purpose fake.
// The fake database's clock is frozen -- see testdb.js, whose $queryRaw always
// answers with this instant. Every date in this file is built RELATIVE TO IT
// rather than from Date.now(), because serverNow() reads the database clock:
// mixing the two makes a test that quietly starts failing on a later calendar
// day, which is exactly what happened to the unlimited-plan case below.
const DB_NOW = new Date('2026-08-18T12:00:00Z');
const DAY = 86400000;

function makeDb() {
  const prisma = createTestDb(BILLING_SPEC);
  return { db: prisma._store, prisma };
}

// ── Harness ────────────────────────────────────────────────────────────────
let CURRENT_USER = { id: 'u1', email: 'a@example.com' };

// `register` is injectable so a case can re-require the routes module with
// different provider env and get a server built from THAT copy.
function startServer(prisma, register = registerBillingRoutes) {
  const app = express();
  app.use(express.json());
  register(app, {
    prisma,
    requireUser: async (req, res) => {
      if (!req.headers.authorization) {
        res.status(401).json({ success: false, error: 'Sign in to continue.', code: 'unauthenticated' });
        return null;
      }
      return CURRENT_USER;
    },
  });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function call(server, method, path, { body, auth = true } = {}) {
  const url = `http://127.0.0.1:${server.address().port}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: 'Bearer test' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

(async () => {
  const { db, prisma } = makeDb();
  db.plan.push(
    { code: 'THREE_DAY', currency: 'INR', priceMinor: 1900, displayName: '3-Day Pass', active: true, sortOrder: 1, playProductId: 'gpos_3day' },
    { code: 'QUARTERLY', currency: 'INR', priceMinor: 9900, displayName: 'Quarterly', active: true, sortOrder: 2, playProductId: 'gpos_q' },
    { code: 'LIFETIME', currency: 'INR', priceMinor: 40000, displayName: 'Lifetime', active: true, sortOrder: 3, playProductId: 'gpos_life' },
  );
  const server = await startServer(prisma);

  // ── Auth is required ─────────────────────────────────────────────────────
  {
    const r = await call(server, 'GET', '/api/billing/me', { auth: false });
    assert.strictEqual(r.status, 401, 'billing/me requires sign-in');
    const s = await call(server, 'POST', '/api/play/session/start', { auth: false, body: { deviceId: 'd1' } });
    assert.strictEqual(s.status, 401, 'starting a session requires sign-in');
  }

  // ── The catalogue, and the store-channel rules ───────────────────────────
  {
    // No payment provider is configured in the test environment, so a channel
    // that is ALLOWED to sell still reports that it cannot -- there is nothing
    // behind the button. This is the launch state: plan status visible, no
    // purchase surface, until Razorpay keys are set.
    const direct = await call(server, 'GET', '/api/billing/plans?channel=direct');
    assert.strictEqual(direct.status, 200);
    assert.strictEqual(direct.json.purchasable, false,
      'direct is allowed to sell, but no provider is configured');
    // Since 2026-09-28 only Lifetime is on sale (ON_SALE_PLANS).
    assert.strictEqual(direct.json.plans.length, 1);
    assert.strictEqual(direct.json.plans[0].code, 'LIFETIME', 'Lifetime is the only plan listed');
    assert.strictEqual(direct.json.plans[0].unlimited, true, 'Lifetime is unlimited');

    const play = await call(server, 'GET', '/api/billing/plans?channel=playstore');
    assert.strictEqual(play.json.purchasable, false,
      'playstore likewise: allowed, but Play is not configured here');
    assert.strictEqual(play.json.plans[0].priceFromStore, true,
      'on Play the client MUST use ProductDetails, not our number');
    assert.strictEqual(play.json.plans[0].code, 'LIFETIME');

    // ...and it flips on once a provider IS configured, which is the whole
    // point of gating on it: linking Razorpay is a server-side change.
    {
      const prevId = process.env.RAZORPAY_KEY_ID;
      const prevSecret = process.env.RAZORPAY_KEY_SECRET;
      process.env.RAZORPAY_KEY_ID = 'rzp_test_dummy';
      process.env.RAZORPAY_KEY_SECRET = 'dummy_secret';
      delete require.cache[require.resolve('./providers/razorpay')];
      delete require.cache[require.resolve('./routes')];
      const fresh = require('./routes').registerBillingRoutes;
      const configured = await startServer(prisma, fresh);
      const r = await call(configured, 'GET', '/api/billing/plans?channel=direct');
      assert.strictEqual(r.json.purchasable, true,
        'direct sells once Razorpay is configured');
      assert.ok(r.json.plans.every((p) => p.purchasable === true),
        'every plan becomes purchasable with it');

      // 2026-09-30: uptodown sells through the same Razorpay checkout...
      const up = await call(configured, 'GET', '/api/billing/plans?channel=uptodown');
      assert.strictEqual(up.json.purchasable, true, 'uptodown sells Lifetime via Razorpay');
      assert.strictEqual(up.json.plans[0].code, 'LIFETIME');
      // ...while Play sells NOTHING, and the other stores stay closed, even with
      // Razorpay live. Checked here, with a provider configured, because with
      // none configured every channel is closed and the test would prove nothing.
      for (const ch of ['playstore', 'amazonstore', 'aptoide', 'indusstore', 'apkpure']) {
        const c = await call(configured, 'GET', `/api/billing/plans?channel=${ch}`);
        assert.strictEqual(c.json.purchasable, false, `${ch} must not offer a purchase surface`);
        assert.ok(c.json.plans.every((p) => p.purchasable === false), `${ch}: no plan is purchasable`);
      }
      if (prevId === undefined) delete process.env.RAZORPAY_KEY_ID;
      else process.env.RAZORPAY_KEY_ID = prevId;
      if (prevSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
      else process.env.RAZORPAY_KEY_SECRET = prevSecret;
      // Each startServer() binds its own port; leaving this one open
      // holds the event loop and the test never exits.
      configured.close();
      delete require.cache[require.resolve('./providers/razorpay')];
      delete require.cache[require.resolve('./routes')];
    }

    // With no provider configured, no store channel offers a purchase.
    for (const ch of ['amazonstore', 'aptoide', 'uptodown', 'indusstore', 'apkpure']) {
      const r = await call(server, 'GET', `/api/billing/plans?channel=${ch}`);
      assert.strictEqual(r.json.purchasable, false, `${ch} must not offer a purchase surface`);
      assert.ok(r.json.plans.every((p) => p.purchasable === false), `${ch}: no plan is purchasable`);
      assert.ok(r.json.plans.every((p) => p.playProductId === undefined), `${ch}: no Play SKU leaks`);
    }
  }

  // ── A brand-new user is on the free tier, with a full hour ───────────────
  {
    const r = await call(server, 'GET', '/api/billing/me');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.plan, 'FREE');
    assert.strictEqual(r.json.unlimited, false);
    assert.strictEqual(r.json.today.limitSeconds, 3600);
    assert.strictEqual(r.json.today.usedSeconds, 0);
    assert.strictEqual(r.json.today.remainingSeconds, 3600);
    assert.ok(r.json.serverTime, 'serverTime is sent so the client never trusts its own clock');
    assert.ok(r.json.resetsAt, 'and knows when the hour comes back');
  }

  // ── Validation ───────────────────────────────────────────────────────────
  {
    const bad = await call(server, 'POST', '/api/play/session/start', { body: {} });
    assert.strictEqual(bad.status, 400, 'deviceId is required');
    assert.strictEqual(bad.json.code, 'bad_request');

    const hb = await call(server, 'POST', '/api/play/session/heartbeat',
      { body: { sessionId: 'x', fence: 1, seq: 1, clientSeconds: -5 } });
    assert.strictEqual(hb.status, 400, 'a negative client total is rejected outright');
  }

  // ── Starting a session ───────────────────────────────────────────────────
  let session;
  {
    const r = await call(server, 'POST', '/api/play/session/start',
      { body: { deviceId: 'phone-1', deviceLabel: 'Redmi Note 13 Pro' } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.plan, 'FREE');
    assert.strictEqual(r.json.remainingSeconds, 3600);
    assert.strictEqual(r.json.nextHeartbeatMs, 60000, 'metered plans heartbeat every 60s');
    assert.ok(r.json.sessionId && r.json.fence >= 1);
    session = r.json;
  }

  // ── A second device is refused, and told where the first one is ──────────
  {
    const r = await call(server, 'POST', '/api/play/session/start',
      { body: { deviceId: 'phone-2', deviceLabel: 'OnePlus 8 Pro' } });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.code, 'SESSION_EXISTS');
    assert.strictEqual(r.json.deviceLabel, 'Redmi Note 13 Pro',
      'the user is told which device is already playing');
  }

  // ── ...unless they explicitly take over ──────────────────────────────────
  {
    const r = await call(server, 'POST', '/api/play/session/start',
      { body: { deviceId: 'phone-2', deviceLabel: 'OnePlus 8 Pro', takeover: true } });
    assert.strictEqual(r.status, 201, 'an explicit takeover is allowed');
    assert.ok(r.json.fence > session.fence, 'and bumps the fence so the old session is a zombie');

    // The superseded session can no longer bill anything.
    const stale = await call(server, 'POST', '/api/play/session/heartbeat',
      { body: { sessionId: session.sessionId, fence: session.fence, seq: 1 } });
    assert.ok(stale.status === 410 || stale.status === 409,
      `a superseded session is rejected (got ${stale.status})`);
    session = r.json;
  }

  // ── One user must not be able to touch another's session ────────────────
  {
    const other = CURRENT_USER;
    CURRENT_USER = { id: 'u2', email: 'b@example.com' };
    const r = await call(server, 'POST', '/api/play/session/heartbeat',
      { body: { sessionId: session.sessionId, fence: session.fence, seq: 1 } });
    assert.strictEqual(r.status, 410, 'another user gets GONE, not access');
    assert.strictEqual(r.json.code, 'SESSION_GONE');

    const s = await call(server, 'POST', '/api/play/session/stop',
      { body: { sessionId: session.sessionId, fence: session.fence } });
    assert.strictEqual(s.status, 410, 'and cannot stop it either');
    CURRENT_USER = other;
  }

  // ── Heartbeat, and the offline total being folded in ─────────────────────
  {
    const r = await call(server, 'POST', '/api/play/session/heartbeat',
      { body: { sessionId: session.sessionId, fence: session.fence, seq: 1, clientSeconds: 900 } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.usedSeconds, 900, 'time counted offline is folded in on contact');
    assert.strictEqual(r.json.remainingSeconds, 2700);

    // Replaying the same heartbeat must not bill twice.
    const replay = await call(server, 'POST', '/api/play/session/heartbeat',
      { body: { sessionId: session.sessionId, fence: session.fence, seq: 1, clientSeconds: 900 } });
    assert.strictEqual(replay.json.usedSeconds, 900, 'a replayed heartbeat is a no-op');

    // A client that "forgets" its total cannot claw time back.
    const wiped = await call(server, 'POST', '/api/play/session/heartbeat',
      { body: { sessionId: session.sessionId, fence: session.fence, seq: 2, clientSeconds: 0 } });
    assert.strictEqual(wiped.json.usedSeconds, 900, 'clearing app data restores nothing');
  }

  // ── Quota exhausted: no new session, and the client is told when it returns
  {
    await call(server, 'POST', '/api/play/session/heartbeat',
      { body: { sessionId: session.sessionId, fence: session.fence, seq: 3, clientSeconds: 3600 } });
    await call(server, 'POST', '/api/play/session/stop',
      { body: { sessionId: session.sessionId, fence: session.fence } });

    const r = await call(server, 'POST', '/api/play/session/start', { body: { deviceId: 'phone-1' } });
    assert.strictEqual(r.status, 402, 'out of time');
    assert.strictEqual(r.json.code, 'QUOTA_EXHAUSTED');
    assert.strictEqual(r.json.plan, 'FREE');
    assert.ok(r.json.resetsAt, 'and is told when the next quota arrives');
  }

  // ── An unlimited plan lifts the limit with no other change ───────────────
  {
    db.entitlement.push({
      id: 'e1', userId: 'u1', planCode: 'LIFETIME', source: 'RAZORPAY', status: 'ACTIVE',
      startsAt: new Date(+DB_NOW - DAY), endsAt: null, autoRenew: false,
    });
    const me = await call(server, 'GET', '/api/billing/me');
    assert.strictEqual(me.json.plan, 'LIFETIME');
    assert.strictEqual(me.json.unlimited, true);
    assert.strictEqual(me.json.today.remainingSeconds, null, 'no countdown is shown at all');
    assert.strictEqual(me.json.heartbeatSeconds, 300, 'unlimited plans heartbeat 5x less often');

    const r = await call(server, 'POST', '/api/play/session/start', { body: { deviceId: 'phone-1' } });
    assert.strictEqual(r.status, 201, 'the same user who was blocked a moment ago can now play');
    assert.strictEqual(r.json.unlimited, true);
    assert.strictEqual(r.json.remainingSeconds, null);
  }

  server.close();
  console.log('billing/routes.test.js — all assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
