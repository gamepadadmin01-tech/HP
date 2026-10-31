# Plan for the morning of 2026-11-01 (after the usage limit resets)

Written 2026-10-31. Owner: Akhil. Read `CLAUDE.md` rules first (no push, commit as gamepadadmin01, no Co-Authored-By, edit real folders only, unique anchors for edits, explain in plain English).

## Where we stopped (all committed locally, NOTHING pushed)

- Server: 30-minute ad cap, `POST /api/ads/unity/claim`, per-network ads switches, per-network ads-down messages. 15 backend test files pass.
- App: Unity rewarded ads in `direct` and `uptodown` (Play stays AdMob). Only a **debug test APK** exists: `D:\DOWNLOADS\GamepadOS-1.4.12-unity-test.apk` (Unity test ads only).
- Admin portal: two ad cards + per-network message boxes. Not yet seen on screen.
- Build tools are installed again (JDK 17.0.19, Gradle 9.6.1, Android SDK), so builds work.

## Step 0 — before anything (owner does this)

1. Push the website repo (about 6 commits) and the HP repo. Railway redeploys the server.
2. Open the admin portal -> App control. Look at both ad cards and the message boxes. Tell Claude anything that looks wrong.
3. Report what the Watch an ad button did in the test APK (video played? +30 min? error name?).

## Step 1 — customer requests (the two reviews from the support portal)

Both users get an "in progress" reply (texts in the chat). Build order:

**1a. Right-stick sensitivity slider (small).**
- Add a "Right stick sensitivity" slider in Settings (`CalmSettings.tsx`, prefs in `store/prefs.ts`).
- Today the app has only a hidden stick curve (`stickFeel.ts`, `gp_stick_curve`, 1-3) and a fixed 8% dead zone. Decide with the owner: a gain (0.3-1.0, default 1.0 = unchanged) is the simplest and matches "too fast even at the lowest in-game setting".
- MUST change both places in the same commit: the JS packet builder (`App.tsx` / `Widgets.tsx` / `stickFeel.ts`) and the native engine `NativeInputEngine.kt`, which mirrors it exactly (a drift between them caused bug 26d5368). Default must reproduce today's behaviour exactly.
- Test: unit tests where they exist, then a phone check with a game.

**1b. Touchpad that moves the right stick (bigger).**
- A new on-screen area: sliding a finger pushes the right stick like a laptop trackpad. Needs design answers first: how far one swipe moves the stick, how it returns to centre, where it sits in the layout editor, and whether it replaces or sits beside the right stick.
- Do not start before the owner answers.

## Step 2 — decisions to ask the owner (one line each)

1. Build only the slider, or slider + touchpad?
2. Signed-in players when only THEIR network's ads are down: leave as is (guests get free time, accounts do not), or give them unlimited play per build (Option B; needs a small app change to send the build name with account requests)?
3. Add a USB-tethering line to the website setup page (`frontend/support.html` near line 91; today it only explains USB debugging, but the app also supports tethering and direct USB)?
4. Dollar pricing: Lifetime ₹19 India / $0.50 elsewhere is decided. Needs: Razorpay international payments switched on, the USD price added in the portal (+ Currency), and an app change to ask for the right currency. Do it now or later?

## Step 3 — releases (needs decisions, do not rush)

- Release builds need the signing key, which was lost with the deleted HP folder. Options: Play upload-key reset (Play build), a new key for the website/Uptodown builds (existing installs cannot update over a different key). Ask the owner.
- Before any release: copy `apps/controller-ui/dist/index.html` to `apps/android-client/app/src/main/assets/dist/`, run `projects/gamepados/docs/REGRESSION_CHECKLIST.md`, build with `-PtestAds=false` semantics (a release build turns Unity test mode off).
- Re-create the two commits lost with the folder: (1) AdMob error wording in `AdsBridge.kt` (`loadProblem(code)` for NO_FILL / NETWORK_ERROR / other, plus the "ad could not play" error code); (2) the test-ads build button (`testAdsBuild()` in the bridge, `native.ts`, `AdRewardButton.tsx`). Details are in memory file `incident-hp-folder-deleted-2026-10-28.md`.

## Step 4 — smaller open items

- Play 1.4.12 guests "Get free time" was reported missing, then working: keep an eye on it.
- AdMob: match rate was ~1%; follow up with the AdMob contact if serving stays near zero.
- Rotate secrets after the Railway incident (memory: `railway-incident-rotate-secrets-2026-10.md`). Never paste secrets in chat.
- Monetag was dropped (2026-10-30): do not add its `sw.js`.

## Rules that stay true

- Ad cap: ads only while a player holds under 30 minutes, no per-day ad limit (server `adtime.js`, app defaults, `GuestQuota.kt` move together).
- Prices: keep them tiny; users do not like paying (memory `feedback-users-dont-pay-price-low.md`).
- Never say publicly that development has slowed down (memory `gamepados-maintenance-mode-2026-10-23.md`); promise no dates to users.
