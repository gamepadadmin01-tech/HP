---
name: play-production-access
description: "GamepadOS cleared Google Play's closed-testing gate on 2026-08-12 — Apply for production is unlocked"
metadata: 
  node_type: memory
  type: project
  originSessionId: 13594470-b05f-404b-93bf-c400b2c33d31
  modified: 2026-08-12T13:53:10.548Z
---

**2026-08-12 — GamepadOS passed all three Google Play production-access requirements.**
Play Console dashboard (app id 4975116516883424245, dev 7837927679688642500) shows all three struck through:
1. Publish a closed testing release ✓
2. Have at least 12 testers opted in to the closed test ✓
3. Run the closed test with 12+ testers for 14 days from the review date ✓

**Apply for production** button is now live. This closes the loop on the 2026-07-16 mailing-list
broadcast ("GamepadOS is coming to Google Play — you're on the early access list") sent to 25
addresses including the tester100260-267 Play-tester accounts — see [[downloads-feedback-platform]].

## What still needs checking before/after applying
- **Which build goes to production.** Older notes had Play serving 1.3.0/code 24 (the broken-feedback
  build) while the live direct/website Android is 1.3.24/code 48 — verify what's actually in the
  closed track and promote the right AAB, not a stale one. See [[project-grx-crypto]].
- Applying opens a Google questionnaire about the closed test (what was tested, feedback gathered,
  what changed as a result) — it's a human review, not an instant flip.
- **targetSdk 36 is DONE** (verified in source 2026-08-12): `compileSdk = 36` / `targetSdk = 36` in
  `apps/android-client/app/build.gradle.kts`, on **AGP 9.3.1** (the notes' "AGP 8.13" plan was
  superseded — 9.x was taken instead), source at **1.3.27 / versionCode 51**. The Aug 31 2026
  targetSdk deadline is NOT a blocker.
- Source tree is 1.3.27/code 51, but that is NOT proof of what's in the Play closed track — check the
  track itself before promoting.
- Play uses its own In-App Update API, so the per-channel version gating doesn't affect it.
