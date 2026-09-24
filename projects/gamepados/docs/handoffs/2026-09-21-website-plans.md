# Website plans redirect and sign-in handoff

User explicitly requested www.gamepad.space/account purchase redirection from Play Plans and automatic browser sign-in for app accounts. Live account page verified; existing website purchase flow kept. Implemented button, guest redirect, signed-in one-use grant and explicit normal-sign-in fallback on API failure. App login token never goes in URL.

Website repo: new backend website-login.js, WebsiteLoginGrant schema relation/table, route registration, account.js grant exchange/history removal/wrong-account clearing. App: api/account.ts helper, store/websitePlans.ts and PlayBillingNotice button/state. Backups context/recovery/website-plans-handoff-2026-09-21/ (core originals). No other flavour purchase behavior changed.

Local backend security/transaction tests and auth tests pass; browser test covers app guest/signed/unavailable and real website scripts for guest/success/expired handoff. TypeScript, Prisma validation and frontend builds pass. Initial UI build hit hidden-file EPERM; cleared Hidden/ReadOnly only on the two generated index.html artifacts and rebuilt successfully. Browser test caught missing success flag in new API response; corrected and reran.

NOT DEPLOYED. No git push, no production schema change or website/backend publication. Automatic sign-in requires BOTH backend/schema and website frontend deployment before distributing app. Deployment instructions: website/WEBSITE_LOGIN_HANDOFF.md. Existing normal website sign-in/purchase works via fallback meanwhile. Google Play external-link eligibility remains unconfirmed; adding requested code is not store approval.

Play TEST APK: releases/test-builds/GamepadOS-1.4.5-website-plans-TEST-playstore.apk SHA256 792d4595bc28b674a8f621334f92e6ebbe23805adb335c698362f0f5a83b2425. Build, signature, exact embedded UI and 3ABIs verified. Auto sign-in requires website/backend deployment; no physical test (ADB empty).
