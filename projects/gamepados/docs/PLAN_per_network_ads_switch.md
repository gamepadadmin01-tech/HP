# Plan: one ads On/Off switch per ad network (AdMob for Play, Unity for the rest)

Written 2026-10-31 for another AI to implement. The owner (Akhil) wants to control the two ad networks separately from the admin portal's **App control** page.

> **Status: IMPLEMENTED 2026-10-31** (website repo, backend `appcontrol.js`, `billing/plans.js`, `admin.html`). Option A was used for accounts. Per-network player messages were left out: both networks share the one "ads down" message.

## Read first: house rules (they override your defaults)

- Work **directly in the real folders** with absolute paths. No worktree, no scratch copy.
- **Never `git push`.** Commit locally only. Author must be `gamepadadmin01@gmail.com`. **No `Co-Authored-By` line.**
- Use the Edit tool with a large unique context block. **Never** do automated text edits on a non-unique anchor (it destroyed `App.tsx` once). Do not use PowerShell `Set-Content` on build files.
- Do not delete anything under `D:\AKHIL\HP` without asking.
- Explain in plain English. The owner is not fluent in code mechanics.
- Backend repo is separate: `D:\AKHIL\HP\projects\gamepados\website` (remote `gamepadadmin01-tech/gamepad`). The HP repo holds the app.
- Run tests with plain node, e.g. `node appcontrol.test.js` from `website/backend`.

## Where things stand today

Two networks, one switch.

| Build (`channel`) | Ad network | Set in |
|---|---|---|
| `playstore` | AdMob | `BuildConfig.AD_NETWORK = "admob"` |
| `direct` (website APK), `uptodown` | Unity Ads (added 2026-10-30) | `AD_NETWORK = "unity"` |
| aptoide, amazonstore, indusstore, apkpure | no ads | `src/noads` |

The ads switch (all in `website/backend`):
- `billing/plans.js` ~lines 148-170: in-memory `adsSwitch` (`'adsOn' | 'adsOff' | null`), `setAdsSwitch`, `getAdsSwitch`, `openPlayUntil()`. `null` means follow the Railway variable `OPEN_PLAY_UNTIL`. While "down", FREE accounts resolve as unlimited ("open play").
- `appcontrol.js`: `loadAdsSwitch()` reads Setting `adsSwitch` every 60 s; `adsDown()` (~line 51); `GET /api/app-config` (~line 109) returns `ads: { available: !down, message }` and `guest.freeTime.enabled = down`; `POST /api/guest/free-time` refuses with 409 when `!adsDown()`; admin routes `GET /api/admin/app-control` (~215) and `PUT /api/admin/app-control/ads` (~240).
- `admin.html`: `openAppControl()` (~line 2291) draws the ads card; `setAdsSwitch(mode)` (~line 2372) calls the PUT.

The app already sends `?channel=<DISTRIBUTION_CHANNEL>&versionCode=N` to `/api/app-config`, so the server can answer per build with **no new app build**.

## Goal

Two independent switches, each On / Off / Follow-Railway:
1. **Play Store build (AdMob)**: controls `channel=playstore`.
2. **Website + Uptodown builds (Unity)**: controls `channel=direct` and `channel=uptodown`.

When a network is Off, only its builds show the "Get free time" button and grey out the ad button, with that network's own message.

## Steps

### 1. Storage and helpers (`billing/plans.js`, `appcontrol.js`)
- Keep `adsSwitch` as the **starting value for both networks** (migration: no data change, nothing flips on deploy). Add new Settings `adsSwitchAdmob` and `adsSwitchUnity`, each `{ mode, at, by }`. If a new row is missing, fall back to the old `adsSwitch` row, then to `OPEN_PLAY_UNTIL`.
- Add `networkOf(channel)`: `playstore` -> `'admob'`; `direct`, `uptodown` -> `'unity'`; other channels -> `null` (no ads).
- Change `adsDown()` into `adsDown(network)`. Keep a no-argument form working for old callers while you convert them (search every use first: `grep -n "adsDown\|openPlayUntil\|getAdsSwitch" -r website/backend --include=*.js`).
- Keep the in-memory copies refreshed by `loadAdsSwitch()` every 60 s, as today.

### 2. Public routes (`appcontrol.js`)
- `GET /api/app-config`: use `networkOf(channel)`. `ads.available = !adsDown(network)`, `guest.freeTime.enabled = adsDown(network)`. A channel with no network keeps today's behaviour (ads never shown there).
- `POST /api/guest/free-time`: it has no channel today. Accept an optional `channel` in the body (default `direct`) and use `adsDown(networkOf(channel))` for the 409 check. Old apps send none, so they get the Unity answer: say so in a comment. (Recommended default for old apps: refuse only if **both** networks are up, so nobody gets stuck.)
- Optional but nice: add per-network messages next to `adsDownPlans`: `adsDownPlansAdmob`, `adsDownPlansUnity` (fall back to the old one). Keep the existing 6/day free-time limit.

### 3. Admin routes (`appcontrol.js`)
- `GET /api/admin/app-control`: return `ads: { admob: {down, switch, ...}, unity: {...} }` and keep the old top-level `adsDown` / `adsSwitch` keys for the old admin page until step 5 lands.
- `PUT /api/admin/app-control/ads`: accept `{ network: 'admob'|'unity', mode: 'adsOn'|'adsOff'|'auto' }`. Owner-only, written to the audit log like today. Reject unknown networks (400).
- Validate with the same style of checks the file already uses.

### 4. The decision that needs the owner (ask him, do not guess)
Account **open play** (FREE accounts become unlimited while ads are down) is decided in `resolveEffective` and the plan code, which do **not** know the player's build. Options:
- **A (recommended, simplest):** accounts get open play only when **both** networks are down. A single-network outage is covered by the guest "Get free time" button. Signed-in players on the failing network have no button, so the owner should know.
- **B:** pass the build through (`X-App-Channel` header or query on `/api/billing/me` and the playtime heartbeat) and decide per build. More correct, many more call sites. Do this only if the owner asks.
Implement A unless told otherwise, and write the choice down in a comment at `openPlayUntil()`.

### 5. Admin page (`admin.html`)
Redesign the ads part of `openAppControl()`:
- Two cards side by side (stacked on a phone): "Play Store build · AdMob" and "Website & Uptodown builds · Unity". Each shows a status pill (Ads working / Ads down), the three buttons (Turn on / Turn off / Follow Railway), who set it and when, and the player-facing message editor.
- A one-line note under the cards listing which builds each card controls.
- Keep the existing look (reuse the current CSS classes; check light/dark and a narrow phone width).
- Update the demo data block near line 769 (the `if (url === '/api/admin/app-control')` mock) so the preview shows both cards.
- Rewrite `setAdsSwitch(mode)` to take the network.

### 6. Tests (`appcontrol.test.js`, plus anything that fails)
Add cases, keeping the existing ones:
- Default (no rows): both networks follow the old switch.
- AdMob off, Unity on: `channel=playstore` shows `ads.available=false` and `freeTime.enabled=true`; `channel=direct` and `channel=uptodown` show available and free-time disabled; `channel=aptoide` is unaffected.
- And the reverse.
- `PUT .../ads` with a bad network -> 400; non-owner -> 403.
- `POST /api/guest/free-time` with `channel=playstore` while only Unity is down -> 409.
- Old payload (`{ mode }` with no network) still works if you keep it (sets both).
Run: `node appcontrol.test.js`, `node billing/admin.test.js`, `node billing/adtime.test.js`, and the other test files in `website/backend` (all must still pass).

### 7. Rollout and verification
- Commit in the website repo only. The owner pushes; Railway redeploys.
- After deploy, check by hand: `GET https://supportportal.gamepad.space/api/app-config?channel=playstore&versionCode=66` and the same with `channel=direct`. Flip one switch in the portal and confirm only that channel changes (allow up to 60 s).
- Do **not** change the app. No new APK is needed.

## Do not touch
- The Unity claim route `POST /api/ads/unity/claim` and the AdMob callback in `billing/routes.ads.js`.
- The 30-minute ad cap (`AD_CAP_SECONDS` in `billing/adtime.js`).
- Prices, Razorpay and anything under `keys/`.

## Done means
Two switches in the admin portal; Play and the other builds react independently; old installed apps keep working; every test passes; one local commit per repo changed; nothing pushed.
