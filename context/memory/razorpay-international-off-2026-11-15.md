---
name: razorpay-international-off-2026-11-15
description: Razorpay refuses foreign cards (Individual account); buyers abroad are sent to Google Play; RAZORPAY_INTERNATIONAL=on re-enables $0.50
metadata:
  node_type: memory
  type: project
  originSessionId: f2cc66f0-40fc-4245-a9ac-8892ce06f6a6
  modified: 2026-11-15T03:57:16.110Z
---

Since 2026-11-15, Razorpay takes **Indian payments only** for GamepadOS. The account is registered as an Individual, and international payments need a registered business. The plan is Udyam registration, then switching to a sole proprietorship and applying again; PayPal also needs GST or Udyam.

What the product does meanwhile:
- When a buyer is outside India (the client asks for prices in USD) on the website, direct or uptodown channels, `/api/billing/plans` returns `purchasable:false` plus `buyOnGooglePlay:true` and `playStoreUrl`.
- A dollar Razorpay order is refused with 403 `international_off`.
- The website (`account.js` `renderGooglePlayCard`) and the app (`PlanPanel.tsx` `GooglePlayCard`, also used by `GuestPlans`) show a "Lifetime on Google Play" card in place of $0.50.
- India keeps ₹19 with UPI and card. Optional contact (no phone field) is on: Razorpay ticket #21819918.

**Why:** a foreign card always failed in Razorpay's window, which looked broken or like a scam.

**How to apply:** once Razorpay approves international payments, set `RAZORPAY_INTERNATIONAL=on` in the backend environment (Railway). Dollars come back with no app update. Don't remove the Google Play card code.

Related: [[feedback-users-dont-pay-price-low]], [[gamepados-release-signing-2026-11-04]]
