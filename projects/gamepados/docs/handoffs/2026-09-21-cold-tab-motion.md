# Cold-launch tab transition repair - 2026-09-21

Owner reproduced missing page transitions until visiting Connect, after earlier motion work. Root cause: root AnimatePresence initial=false for Android propagates presenceContext.initial=false to all descendants of its first child, including later keyed tab mounts. Dashboard local entered ref could not override it. Connect replaces the presence child, explaining recovery.

Fix: root presence no longer suppresses initial animation. Native first dashboard alone receives skipEntrance and explicit settled opacity/y values (not initial=false). Subsequent routes retain fade-through. Only two production UI files touched; byte-preserving unique replacements, backed up under context/recovery/cold-tab-motion-2026-09-21/.

Evidence: cold-tab-motion.test.mjs samples real frame opacity through first Settings/Account/Home transitions BEFORE Connect, then after Connect and with reduced motion. Restoring the original root setting makes it fail (all opacity samples 1); fixed setting passes. Earlier tests checked startup and Connect but failed to sample first tab transitions. startup-back.test.mjs and motion-polish.test.mjs pass, confirming stable startup, Back behavior, reduced motion and single route layer. TypeScript and Vite build pass. New UI synced to Android assets.

ADB empty; physical device animation smoothness remains unverified. No upload/push. Play external account purchase link remains pending enrollment/country details from previous request.


## 2026-09-21 cold-start tab animation correction

Root presence initial=false was suppressing ALL first-dashboard tab entrances until Connect replaced it. Reproduced original all-1 opacity samples; repaired with root initial enabled and explicit settled first-native-Home values. New frame-sampling test before/after Connect and reduced motion passes; startup/back, motion regression and TypeScript/Vite pass. Direct test APK built and signature/UI/3ABIs verified: releases/test-builds/GamepadOS-1.4.5-cold-tab-motion-TEST-direct.apk SHA256 5cd0905772cc0d7a3645866d5d53951fd9a88b4b92a1f425052c2a7d44940f9e. Prior Play/Uptodown candidates do NOT include this newest fix; rebuild before distribution. ADB empty. Handoff projects/gamepados/docs/handoffs/2026-09-21-cold-tab-motion.md.
