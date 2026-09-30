// Plain-node tests for ad-earned play time: node billing/adtime.test.js
//
// Pins down the owner's rules (2026-09-28): 30 minutes per ad, stacks, never
// expires, free allowance used first, Lifetime untouched — plus the two things
// that must never happen: an ad credited twice, or a reward Google did not sign.

// A test signing key, set BEFORE ticket.js loads (it reads the key once), so
// heartbeats issue real permission slips — as ticket.test.js does.
process.env.SESSION_TICKET_ED25519_PRIVATE_KEY = '07'.repeat(32);

const assert = require('assert');
const crypto = require('crypto');
const { createTestDb, BILLING_SPEC } = require('./testdb');
const {
  AD_REWARD_SECONDS, overflowSeconds, spendFor, remainingWithBank, creditAdReward, availableFor,
} = require('./adtime');
const { openSession, heartbeat, stopSession, appendUsage, ensureBilling, grantCompensation } = require('./playtime');
const { createVerifier, splitSignedQuery, parseKeys } = require('./providers/admobssv');
const { registerAdRoutes } = require('./routes.ads');
const { ON_SALE_PLANS, PAID_PLANS } = require('./plans');

const HOUR = 3600;

// ── Pure arithmetic ─────────────────────────────────────────────────────────
{
  assert.strictEqual(AD_REWARD_SECONDS, 30 * 60, 'one ad is 30 minutes');

  assert.strictEqual(overflowSeconds(1800, HOUR), 0, 'inside the free hour: nothing past it');
  assert.strictEqual(overflowSeconds(4000, HOUR), 400);
  assert.strictEqual(overflowSeconds(99999, null), 0, 'no daily cap: nothing to cover');

  assert.strictEqual(spendFor(4000, HOUR, 1800), 400, 'bank covers the overflow');
  assert.strictEqual(spendFor(9000, HOUR, 1800), 1800, 'never more than the bank holds');
  assert.strictEqual(spendFor(9000, HOUR, -50), 0, 'a negative figure is treated as empty');

  assert.strictEqual(remainingWithBank(0, HOUR, false, 0), HOUR, 'no ads: just the free hour');
  assert.strictEqual(remainingWithBank(0, HOUR, false, 1800), HOUR + 1800, 'free hour + bank');
  assert.strictEqual(remainingWithBank(HOUR, HOUR, false, 1800), 1800, 'free hour gone: bank remains');
  assert.strictEqual(remainingWithBank(HOUR + 1800, HOUR, false, 1800), 0, 'both gone');
  assert.strictEqual(remainingWithBank(HOUR + 5000, HOUR, false, 1800), 0, 'never negative');
  assert.strictEqual(remainingWithBank(123, HOUR, true, 1800), null, 'unlimited: no number at all');
}

// ── Only Lifetime is on sale; the others still WORK ─────────────────────────
{
  assert.deepStrictEqual(ON_SALE_PLANS, ['LIFETIME']);
  for (const p of ['THREE_DAY', 'QUARTERLY', 'LIFETIME']) {
    assert.ok(PAID_PLANS.includes(p), p + ' still resolves for promos and old records');
  }
}

// ── A test database with a clock we can move ────────────────────────────────
function world(seed = {}) {
  const prisma = createTestDb(BILLING_SPEC, seed);
  let nowMs = Date.parse('2026-09-28T06:00:00Z');       // 11:30 in Asia/Kolkata
  prisma.$queryRaw = async () => [{ now: new Date(nowMs) }];
  return { prisma, advance: (s) => { nowMs += s * 1000; } };
}
const tx = (prisma, fn) => prisma.$transaction(fn);

// Play like a real phone: one heartbeat a minute. (Jumping the clock by more
// than the lease between heartbeats is, correctly, an abandoned session.)
async function playFor(prisma, advance, userId, s, seconds, seqStart = 1) {
  let seq = seqStart, last;
  for (let t = 0; t < seconds; t += 60) {
    advance(Math.min(60, seconds - t));
    last = await tx(prisma, (x) => heartbeat(x, { userId, sessionId: s.sessionId, fence: s.fence, seq: seq++ }));
    if (last.quotaExhausted) break;
  }
  return { last, nextSeq: seq };
}

async function useFreeHour(prisma, userId) {
  await tx(prisma, async (t) => {
    const b = await ensureBilling(t, userId, (await t.$queryRaw())[0].now);
    await appendUsage(t, {
      userId, sessionId: 'seed', periodStart: b.periodStart, periodEnd: b.periodEnd,
      seconds: HOUR, reason: 'heartbeat', idemKey: 'seed:' + userId,
    });
  });
}

(async () => {
  // ── Free hour used, no ads: locked out, exactly as before ────────────────
  {
    const { prisma } = world();
    await useFreeHour(prisma, 'u1');
    await assert.rejects(
      tx(prisma, (t) => openSession(t, { userId: 'u1', deviceId: 'd1' })),
      (e) => e.code === 'QUOTA_EXHAUSTED',
      'no bank, no free time: refused',
    );
  }

  // ── The whole life of a bank ─────────────────────────────────────────────
  {
    const { prisma, advance } = world();
    await useFreeHour(prisma, 'u1');

    // Two ads = one hour banked. The SAME ad replayed by Google credits once.
    const a = await creditAdReward(prisma, { userId: 'u1', transactionId: 'tx-1', adUnit: '111' });
    const again = await creditAdReward(prisma, { userId: 'u1', transactionId: 'tx-1', adUnit: '111' });
    const b = await creditAdReward(prisma, { userId: 'u1', transactionId: 'tx-2', adUnit: '111' });
    assert.ok(a.credited && b.credited, 'two different ads both credit');
    assert.strictEqual(again.credited, false, 'a replayed callback is NOT credited again');
    assert.strictEqual(prisma._store.adReward.length, 2);

    // Free hour is gone, so the whole hour of remaining play is the bank.
    const s = await tx(prisma, (t) => openSession(t, { userId: 'u1', deviceId: 'd1' }));
    assert.strictEqual(s.remainingSeconds, 2 * AD_REWARD_SECONDS, 'bank lets them start');
    assert.strictEqual(s.bankSeconds, 2 * AD_REWARD_SECONDS);

    // One minute of play comes out of the bank, not out of nowhere.
    advance(60);
    const h = await tx(prisma, (t) => heartbeat(t, { userId: 'u1', sessionId: s.sessionId, fence: s.fence, seq: 1 }));
    assert.strictEqual(h.bankSeconds, 2 * AD_REWARD_SECONDS - 60, 'played minute charged to the bank');
    assert.strictEqual(h.remainingSeconds, 2 * AD_REWARD_SECONDS - 60);
    assert.ok(h.ticket, 'still has time: the PC keeps getting permission slips');

    // A replayed heartbeat does not charge the bank twice.
    const h2 = await tx(prisma, (t) => heartbeat(t, { userId: 'u1', sessionId: s.sessionId, fence: s.fence, seq: 1 }));
    assert.strictEqual(h2.bankSeconds, 2 * AD_REWARD_SECONDS - 60, 'replay is free');

    await tx(prisma, (t) => stopSession(t, { userId: 'u1', sessionId: s.sessionId, fence: s.fence }));

    // Next day: the bank is still there (NEVER expires) and the free hour is
    // back, used first.
    advance(26 * HOUR);
    const d2 = await tx(prisma, (t) => openSession(t, { userId: 'u1', deviceId: 'd1' }));
    assert.strictEqual(d2.bankSeconds, 2 * AD_REWARD_SECONDS - 60, 'banked time survived midnight');
    assert.strictEqual(d2.remainingSeconds, HOUR + 2 * AD_REWARD_SECONDS - 60, 'free hour + bank');

    const { last: d2h } = await playFor(prisma, advance, 'u1', d2, 30 * 60);
    assert.strictEqual(d2h.bankSeconds, 2 * AD_REWARD_SECONDS - 60, 'inside the free hour: bank untouched');

    // The balance is always sum(rewards) - sum(spends), and never below zero.
    const spent = prisma._store.adTimeSpend.reduce((t, r) => t + r.secondsSpent, 0);
    const earned = prisma._store.adReward.reduce((t, r) => t + r.seconds, 0);
    assert.strictEqual(earned - spent, d2h.bankSeconds, 'balance = earned - spent');
  }

  // ── Running the bank dry ends the session like running out of free time ──
  {
    const { prisma, advance } = world();
    await useFreeHour(prisma, 'u1');
    await creditAdReward(prisma, { userId: 'u1', transactionId: 'tx-9', adUnit: '1' });
    const s = await tx(prisma, (t) => openSession(t, { userId: 'u1', deviceId: 'd1' }));
    let seq = 0, last;
    for (let i = 0; i < 40; i++) {
      advance(60);
      last = await tx(prisma, (t) => heartbeat(t, { userId: 'u1', sessionId: s.sessionId, fence: s.fence, seq: ++seq }));
      if (last.quotaExhausted) break;
    }
    assert.ok(last.quotaExhausted, 'out of bank: session closed');
    assert.strictEqual(last.ticket, null, 'and no more permission slips');
    assert.strictEqual(last.bankSeconds, 0, 'bank shows empty, never negative');
    const available = await availableFor(prisma, 'u1', new Date(0));
    assert.ok(available >= 0, 'nothing ever owed');
  }

  // ── Compensation refunds banked time that a bad evening used up ──────────
  {
    const { prisma, advance } = world();
    await useFreeHour(prisma, 'u1');
    await creditAdReward(prisma, { userId: 'u1', transactionId: 'tx-c', adUnit: '1' });
    const s = await tx(prisma, (t) => openSession(t, { userId: 'u1', deviceId: 'd1' }));
    const { last: h, nextSeq } = await playFor(prisma, advance, 'u1', s, 600);
    assert.strictEqual(h.bankSeconds, AD_REWARD_SECONDS - 600);
    await tx(prisma, (t) => grantCompensation(t, { userId: 'u1', seconds: 600, adminId: 'a1' }));
    advance(1);
    const h2 = await tx(prisma, (t) => heartbeat(t, { userId: 'u1', sessionId: s.sessionId, fence: s.fence, seq: nextSeq }));
    assert.strictEqual(h2.bankSeconds, AD_REWARD_SECONDS - 1, 'the 600s went back into the bank');
  }

  // ── Lifetime never touches the bank ──────────────────────────────────────
  {
    const { prisma, advance } = world({
      entitlement: [{ id: 'e1', userId: 'u2', planCode: 'LIFETIME', source: 'MANUAL', externalRef: 'm1',
        status: 'ACTIVE', startsAt: new Date('2026-01-01T00:00:00Z'), endsAt: null, autoRenew: false }],
    });
    await creditAdReward(prisma, { userId: 'u2', transactionId: 'tx-l', adUnit: '1' });
    const s = await tx(prisma, (t) => openSession(t, { userId: 'u2', deviceId: 'd1' }));
    assert.strictEqual(s.remainingSeconds, null, 'unlimited');
    const { last: h } = await playFor(prisma, advance, 'u2', s, 5 * HOUR);
    assert.strictEqual(h.bankSeconds, AD_REWARD_SECONDS, 'five hours on Lifetime: bank untouched');
    assert.strictEqual(prisma._store.adTimeSpend.filter((r) => r.secondsSpent > 0).length, 0);
  }

  // ── Signature verification (the reward's only trust anchor) ──────────────
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const sign = (data) => crypto.sign('sha256', Buffer.from(data), { key: privateKey, dsaEncoding: 'der' }).toString('base64url');
  const callback = (fields, keyId = '42') => {
    const data = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join('&');
    return `${data}&signature=${sign(data)}&key_id=${keyId}`;
  };
  const verifier = createVerifier({ fetchKeys: async () => new Map([['42', publicKey]]) });
  const fields = {
    ad_network: '5450213213286189855', ad_unit: '1234567890', custom_data: 'a%20b',
    reward_amount: '30', reward_item: 'minutes', timestamp: '1507770365237823',
    transaction_id: '18fa792de1bca816048293fc71035638', user_id: 'u1',
  };
  {
    const ok = await verifier.verify(callback(fields));
    assert.ok(ok.ok, 'a correctly signed callback verifies');
    assert.strictEqual(ok.params.get('user_id'), 'u1');

    const good = callback(fields);
    const forged = good.replace('user_id=u1', 'user_id=u9');
    assert.strictEqual((await verifier.verify(forged)).ok, false, 'changing the user breaks the signature');
    assert.strictEqual((await verifier.verify(good.replace('reward_amount=30', 'reward_amount=99'))).ok, false);
    assert.strictEqual((await verifier.verify(callback(fields, '7'))).ok, false, 'unknown key id refused');
    assert.strictEqual((await verifier.verify('transaction_id=1&user_id=u1')).ok, false, 'unsigned refused');

    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const data = 'transaction_id=1&user_id=u1';
    const wrongKeySig = crypto.sign('sha256', Buffer.from(data), { key: other.privateKey, dsaEncoding: 'der' }).toString('base64url');
    assert.strictEqual((await verifier.verify(`${data}&signature=${wrongKeySig}&key_id=42`)).ok, false,
      'signed by someone else refused');

    assert.deepStrictEqual(splitSignedQuery('a=1&signature=xyz&key_id=5'), { data: 'a=1', signature: 'xyz', keyId: '5' });
    assert.strictEqual(splitSignedQuery('a=1&signature=xyz'), null, 'no key_id');

    // Google's key JSON shape (numeric keyId, pem + base64) parses.
    const pem = publicKey.export({ format: 'pem', type: 'spki' });
    const b64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const parsed = parseKeys({ keys: [{ keyId: 3335741209, pem, base64: b64 }] });
    assert.ok(parsed.get('3335741209'), 'keyId normalised to a string');
  }

  // ── The callback route, end to end ───────────────────────────────────────
  {
    const { prisma } = world({ user: [{ id: 'u1', email: 'a@example.invalid' }] });
    let handler;
    registerAdRoutes({ get: (path, h) => { assert.strictEqual(path, '/api/ads/admob/reward'); handler = h; } }, { prisma, verifier });
    const call = async (query) => {
      const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
      await handler({ originalUrl: '/api/ads/admob/reward?' + query }, res);
      return res;
    };

    const first = await call(callback(fields));
    assert.strictEqual(first.code, 200);
    assert.strictEqual(first.body.credited, true, 'signed callback credits 30 minutes');
    assert.strictEqual(prisma._store.adReward[0].seconds, AD_REWARD_SECONDS);

    const replay = await call(callback(fields));
    assert.strictEqual(replay.code, 200, 'a retry is acknowledged…');
    assert.strictEqual(replay.body.credited, false, '…but not credited twice');

    const forged = await call(callback(fields).replace('user_id=u1', 'user_id=u2'));
    assert.strictEqual(forged.code, 403, 'forged callback refused');

    const { user_id, ...signedOut } = fields;
    const guest = await call(callback({ ...signedOut, transaction_id: 'guest-1' }));
    assert.strictEqual(guest.code, 200, 'signed-out player acknowledged (no retry storm)');
    assert.strictEqual(guest.body.credited, false);

    const stranger = await call(callback({ ...fields, transaction_id: 'x-2', user_id: 'nobody' }));
    assert.strictEqual(stranger.body.credited, false, 'unknown account credits nothing');
    assert.strictEqual(prisma._store.adReward.length, 1, 'exactly one reward recorded in total');

    process.env.ADMOB_REWARDED_AD_UNITS = 'ca-app-pub-1/999';
    const wrongUnit = await call(callback({ ...fields, transaction_id: 'x-3' }));
    assert.strictEqual(wrongUnit.body.credited, false, 'another ad unit does not credit when units are pinned');
    delete process.env.ADMOB_REWARDED_AD_UNITS;
  }

  console.log('billing/adtime.test.js — all assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
