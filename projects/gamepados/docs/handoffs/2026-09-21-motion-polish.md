# Motion polish — 2026-09-21

User reported abrupt controller selection, double-looking Connect return and jitter/double startup.

Changed:
- Both preset/custom selection badges now stay mounted and reserve their space, fading/scaling in without changing title width. Border, inset highlight and Play-button colors transition over 180–220ms. Header selection no longer competes with delegated press scaling. Reduced motion disables these transitions.
- Root screen transitions use wait mode: outgoing screen fades for 100ms, incoming screen fades/translates 5px over 240ms. No simultaneous duplicate route layer or large opposite-direction slide. Connect's initial inner content and Home's initial inner content no longer replay separate entrances. Switching tabs still animates.
- Supersedes the previous delayed-entrance startup fix: Home is mounted and painted BEFORE onUiReady, with no 380ms deferred mount/second entrance on Android. Native splash performs one 240ms fade, with no separate icon zoom. Browser-only startup retains an entrance. Fonts/two-frame paint readiness retained. Existing one-time legacy WebView-storage migration is unchanged.

Validation: TypeScript/Vite passed. motion-polish.test.mjs checks title geometry before/after selecting a different controller and three Connect round trips with at most one route layer and no secondary Home transform. Updated startup-back.test.mjs passes stable native startup, all previous Back behavior including gameplay/custom editor, and reduced motion. Android unit suite: 8 passed. No ADB phone; physical frame pacing and actual native splash still require device verification.

Backups: context/recovery/motion-polish-2026-09-21/. Direct Android test build only, same 1.4.5/code59. No PC/store build or release, deletion, commit or push. Existing manual pairing, redemption and Back fixes retained.

Final build passed: releases/test-builds/GamepadOS-1.4.5-motion-polish-TEST-direct.apk. Signer matched prior APK; package 1.4.5/code59, embedded UI and 3 ABIs verified. SHA256 6607FD130D0B8399A46D06F7918AE5F75C55F8BA62CDC9C287CC02D5F0177EDC.
