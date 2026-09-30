// Rewarded-ad callback — where watched ads become banked play time.
//
// GET /api/ads/admob/reward is called by GOOGLE, not by the app. It is the
// "Server-side verification" callback URL set on the AdMob rewarded ad unit.
// The app sets its signed-in user's id on the ad (ServerSideVerificationOptions
// .setUserId) and Google echoes it back here, signed.
//
// RESPONSE CODES MATTER: AdMob retries a callback that does not answer 200. So
//   * a bad or missing signature -> 403 (not from Google; nothing to retry)
//   * a VALID callback we choose not to credit -> 200 (no user id because the
//     player was signed out, AdMob's own "test URL" button, an unknown account)
//     — answering an error there would only make Google retry it for nothing
//   * a server fault -> 500, so Google DOES retry and the reward is not lost
//
// Signed-out players are rewarded on the phone by the app itself; there is no
// account to credit here, so their callbacks are acknowledged and dropped.

const { createVerifier } = require('./providers/admobssv');
const { AD_REWARD_SECONDS, creditAdReward } = require('./adtime');

// Optional hardening: if set (comma-separated AdMob ad unit ids, e.g.
// "1234567890" or the full "ca-app-pub-…/1234567890"), only those units credit.
function allowedUnits() {
  return String(process.env.ADMOB_REWARDED_AD_UNITS || '')
    .split(',').map((s) => s.trim().split('/').pop()).filter(Boolean);
}

function registerAdRoutes(app, { prisma, verifier = createVerifier() }) {
  app.get('/api/ads/admob/reward', async (req, res) => {
    try {
      // The RAW query string. Express's parsed req.query has already decoded
      // and re-ordered nothing we can trust byte-for-byte; the signature covers
      // the exact bytes Google sent.
      const url = req.originalUrl || req.url || '';
      const q = url.indexOf('?');
      const rawQuery = q >= 0 ? url.slice(q + 1) : '';

      const v = await verifier.verify(rawQuery);
      if (!v.ok) {
        console.warn('admob reward: rejected —', v.reason);
        return res.status(403).json({ success: false, error: 'Invalid signature.' });
      }

      const p = v.params;
      const transactionId = p.get('transaction_id') || '';
      const userId = p.get('user_id') || '';
      const adUnit = p.get('ad_unit') || '';

      if (!transactionId) return res.json({ success: true, credited: false, reason: 'no transaction id' });
      const units = allowedUnits();
      if (units.length && !units.includes(adUnit)) {
        console.warn('admob reward: ad unit not ours —', adUnit);
        return res.json({ success: true, credited: false, reason: 'ad unit not configured' });
      }
      if (!userId) return res.json({ success: true, credited: false, reason: 'signed-out player' });

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return res.json({ success: true, credited: false, reason: 'unknown account' });

      const out = await creditAdReward(prisma, {
        userId, transactionId, adUnit, seconds: AD_REWARD_SECONDS,
      });
      if (out.credited) {
        console.log(`admob reward: +${AD_REWARD_SECONDS}s to ${userId} (tx ${transactionId})`);
      }
      res.json({ success: true, credited: out.credited });
    } catch (e) {
      console.error('admob reward', e);
      res.status(500).json({ success: false, error: 'Could not record the reward.' });
    }
  });
}

module.exports = { registerAdRoutes };
