# GamepadOS 1.4.5 (59): Uptodown / Play candidates

Only these two channels were built; nothing uploaded or published.

Play: guest allowance remains 30 minutes daily, plan purchase buttons hidden, new Play purchases blocked in purchase service. Plans show "Google Play billing will be available soon." Existing paid access and purchase restoration preserved. Signed-in FREE allowance remains server governed; this change does not rewrite entitlement limits. Other flavours retain their existing quota behavior.

OPEN: requested website account purchase link is not implemented. Waiting for owner to identify eligible Google Play external-links program and countries; question sent in task. Account destination verified in website source: https://gamepad.space/account. This candidate has no external purchase button.

Uptodown: existing plan/payment behavior preserved. APK is the Uptodown artifact. Play AAB is the upload artifact; Play APK is for local testing.

Verification: TypeScript/Vite and focused Play-channel browser test passed. APK signatures match known signer; version 1.4.5/59 and generated channel constants checked. APKs omit REQUEST_INSTALL_PACKAGES. All three artifacts embed the exact new UI and all 3 native engine ABIs. Bundletool validate passed. Jarsigner reports jar verified, with self-signed/no-timestamp and archive entry-order/JarInputStream warnings; no claim of Play Console acceptance. ADB has no device; real-device/store purchase/restore testing not performed.

Includes preceding manual-pairing, resume/transport, Back navigation and motion fixes. Current PC server test build limitations are separate and unchanged.

Artifacts: releases/1.4.5-candidates-2026-09-21/; checksums in manifest.json.
