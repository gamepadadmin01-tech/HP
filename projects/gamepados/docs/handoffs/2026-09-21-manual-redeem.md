# Manual pairing and redeem fixes — 2026-09-21

User paused all-store distribution builds, then requested manual Wi-Fi pairing repair and TEST builds. Do not build/publish the store flavours without a new request. Android version had already been bumped to 1.4.5/code59 for the planned release; retained for this direct test build.

## Fixes

- CalmConnect asked for IP/port but App.tsx always sent key `manual` (parsed as zero natively). Wi-Fi authentication requires the actual PC pairing key. Added an 8-character hexadecimal key input, validation, and lowercase normalization; App passes and remembers that real key. Port remains 7777 by default and editable.
- PC compact window now displays IP, actual port from its QR payload, and pairing key together. Auth rules are unchanged.
- PlanPanel had a globally applied focus-visible outline on the inner promo input, producing a rectangular ring inside its rounded wrapper. Focus now outlines the wrapper; keyboard focus remains visible.
- Lifetime entitlement no longer renders the promo redemption section. Other plans retain it, including temporary promotional entitlements.

## Evidence

TypeScript and Vite passed. `apps/controller-ui/manual-redeem.test.mjs` passed missing/invalid-key rejection, correct bridge arguments, rounded focus behavior, Lifetime hiding and zero runtime errors. Thirteen existing transport cases passed. Browser test screenshots are 1236x2745 in `docs/manual-redeem-2026-09-21/`.

These images are QA captures, not a complete store screenshot pack: account data is synthetic, plans were offline, and the native camera is not represented. Do not call this every page or actual device verification. The older request for quality screenshots of every page remains open.

ADB reported no phone. No physical pairing, native camera, store purchase or production distribution was performed. PC test binaries still lack the build-time SESSION_TICKET_PUBLIC_KEY and must not be released as production subscription-enforcing builds. Existing running server is untouched.

Backups: `context/recovery/redeem-release-2026-09-21/`. No deletes, commit or push.

Final direct APK and Rust release builds passed. APK signature verified and previous signer matched (5b5537c6375e2373029be69ecdc27cd85b41c48482c74941312886f10367b7cc); package 1.4.5/code59, embedded UI and three native ABIs verified. APK SHA256 84B06CCA1E1960DB4F64E208C2DDA086DA5B3421C9C46AA15AA52D8FB689BDB4. Artifacts: releases/test-builds/GamepadOS-1.4.5-manual-redeem-TEST-direct.apk and GamepadServer-2.1.2-manual-pairing-TEST.zip.
