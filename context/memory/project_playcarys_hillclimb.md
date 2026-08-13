---
name: project-playcarys-hillclimb
description: "PlayCarys FFSD project — Hill Climbing game overhaul + match history fixes; what's done and what's pending"
metadata: 
  node_type: memory
  type: project
  originSessionId: a5d230f5-f4b2-40b8-98c8-230d89dd0662
  modified: 2026-08-10T12:16:34.665Z
---

Project at `D:\AKHIL\ACADEMIC\ALL sub\FFSD\codes\playcarys_updated` (FFSD college project).

## Review-4 requirements — VERIFIED STATUS (checked 2026-08-10 against `codes/Review–4 Requirements.txt`)

| # | Requirement | Status |
|---|---|---|
| 1 | NestJS, modular (Modules/Controllers/Services) | ✅ 15 modules, 13 controllers, services + repositories |
| 2 | In-memory data reflecting ER, full CRUD | ✅ `data/store.ts` arrays mirroring the 12-table schema |
| 3 | RBAC via role in header, Guards/Middleware | ✅ global `RolesGuard` (`roles/roles.guard.ts`) |
| 4 | REST APIs, consistent formats | ✅ 80 routes: 37 GET / 21 POST / 14 PATCH / 8 DELETE |
| 5 | DTOs, validation, status codes | ✅ 10 DTO files + global `ValidationPipe` (whitelist+transform) in `main.ts` |
| 6 | Frontend–backend integration, **all CRUD backend-driven** | ⚠️ **PARTIAL — weakest item** |
| 7 | Swagger reflecting **all** APIs (req/res schema + role header) | ⚠️ **PARTIAL** |
| 8 | Clean modular structure | ✅ |

**Gap 6:** only `pages/player/dashboard.html` really uses `window.API`. Every admin/moderator/player page still reads and writes the local `DB` (`live_database.json`) and syncs wholesale through `POST /db-import`. So CRUD is *not* backend-driven per operation, which is what the spec asks for.

**Gap 7:** Swagger IS wired up in `main.ts` (DocumentBuilder, `role` apiKey header declared, `swagger.json` dumped to `back-end/docs/`), but only **2 of 13 controllers** carry `@ApiTags`/`@ApiOperation` (achievement, game) and only **3 of 10 DTOs** carry `@ApiProperty` (achievement, auth, game). Routes appear in the UI; request/response schemas mostly do not.

**Extras built with AI that the spec never asked for** (beyond the UI work Akhil drove himself): signed HMAC-SHA256 session tokens (`auth/token.util.ts` — spec explicitly says "no authentication required"); the privilege-escalation fix + `PRIVILEGED` role gating in RolesGuard; global `PersistenceInterceptor` + shutdown flush; socket.io gateway with matchmaking queues and single-session device handoff; the game upload scan/approval gate (`scan.service.ts`, `zip.util.ts`, `bundle.service.ts`); achievements + `active_title`; notifications; 25 MB body limit + CORS; `purge-accounts.js`; `start-playcarys-universal.ps1`.

**🚨 SECURITY HOLE Akhil found himself during the 2026-08-10 quiz (real, unfixed):** the single-session device handoff has two paths — old device live → ask it to approve; old device unreachable → *let the new device straight in*. Someone with a stolen email+password just uses path 2 while the victim's PC is off. Worse: there is **no forgot-password flow**, but a signed-in user *can* change the password — so the attacker changes it immediately and the real owner is permanently locked out. The handoff was designed to stop two people playing one account at once, never as a security control. Fix the missing password-reset path first.
Run with `npm start` in `front-end/` (http-server on :8080). Game lives at
`front-end/games/hill_climbing/`.

**Done (all verified in-browser, 2026-07-29/30):**
- Physics/terrain overhaul: gradient-derived feature sizing, real brake (not reverse gear),
  inverted-crash rule, spawn-drop fix, anti-wheelie retune (wheelieRate is the decisive number).
- Perf: pixelDensity cap, collinear edge merge (~75% fewer static bodies), noise lattice cache.
- Bike rebuilt to real KTM 250 SX-F ratios (wheelbase 4.35r, clearance 1.00r, travel 0.89r).
- Fuel: burn curve x3, cans every ~126m vs ~396m range. **Pickup.respawn()/Ground.resetPickups()**
  fixed restart leaving the track stripped of fuel.
- Rider: 2-bone IK limbs attached to real bar/peg points; scaled to 0.88 of seat height;
  restyled to HCR's Bill (red cap, curly brown hair, big nose, plain red shirt, ink outlines).
- Rider hip joint got angle limits — NOTE Box2D measures the joint as bodyB-bodyA and the
  torso is bodyA, so the limits read INVERTED from the rider's point of view.
- Match history: three separate bugs found — (1) summary counters stuck at 0 because rAF
  count-up had no fallback, (2) 44/50 seed rows dated in 2027 so real matches sorted to page 3
  (repairFutureMatchDates migration in db.js), (3) **playing while signed out silently discarded
  the run while the results card still said "+PCP EARNED"** — now says "NOT SAVED — SIGN IN".

- Match-history page redesign DONE: insights row (recent-form pills + win streak, per-game
  record bars, personal bests) and inline expandable match detail (click a row, stats open in
  place; "Open full report" still links to match-details.html). Verified in browser.
  GOTCHA: the games table stores the icon slug as `img`, but getPlayerMatchHistory renames it to
  `game_image` on returned rows — reading `game_image` off DB.games gives undefined.

- 🚨 DATA SCHEMA TRAP: `match_results.score` is the IN-GAME score (per DB.recordMatchResult).
  The game's tournament path used to write `score: pcpEarned` — the opposite — so the column held
  a game score on some rows and a Carys amount on others. Also `_computeCarys()` fell back to
  `r.score`, so 15 seed rows with no carys_earned reported their game score as Carys (4200 Carys
  for a 100-Carys match). Both fixed; `backfillMatchAwards()` migration in db.js now freezes
  carys_earned/xp_gained onto every legacy row and un-swaps the damaged ones.
- Hill Climbing PCP was `min(30, floor(score/50))` — capped at 30 from score 1500, so every decent
  run paid exactly 30. Now `runReward()` = score^0.75/12, ONE function feeding both the results
  card and the save path (it used to be duplicated and could drift).

**Pending / next session:**
- Verify the signed-out warning banner renders (added to game index.html, not yet eyeballed).

**Gotchas:**
- The preview tab is usually `document.hidden` → rAF frozen; drive `draw()` manually with
  `window.deltaTime=16.7; window.frameCount++` to test, and stub the draw functions for speed.
- Do NOT start my own server on :8080 — the user runs `npm start` there and I once blocked it.

**CRITICAL — match-history data loss (found 2026-07-30 by verifier agents, evidence-backed):**
Runs WERE always being saved correctly, then destroyed afterwards. Four causes:
1. `utils.js` global_db_update handler did `Object.keys(data).forEach(k=>DB[k]=data[k])` — ANY
   tab's DB.save() broadcast wiped fresh matches in every other tab. Measured 59->58 rows.
2. `db.js` boot hydrate (`GET /db-export`) overwrote localStorage with the backend copy, no
   merge. Measured 61 rows -> reload -> 58, match history rendering 0 items. Backend loads its
   store ONLY at boot and dies on TS compile errors under `nest start --watch`.
3. Backend `importDb` did `arr.length=0; arr.push(...)` — a stale tab's whole-DB POST deleted
   server rows too.
4. `attachUserCompat` (db.js) assigned user_id BEFORE the `_compatUser` early-return while the
   `id` getter returns String(u.user_id) -> user_id permanently became the STRING "undefined".
   Live data has an account in this state (akhilpitchuka@gmail.com, 358 carys, 0 match rows).
FIX APPLIED: APPEND_ONLY tables (match_results/sessions/telemetry/highlights) are UNIONED by
identity on every sync path (DB.mergeRemoteState in db.js, used by utils.js + hydrate + backend).
NOT YET FULLY VERIFIED — verifiers were cut off by a session limit mid-test.

**Flip/death rule:** flips must be possible; ONLY head contact kills. Two bugs fixed: a 145°
instant-death made flips impossible by definition, and raw `GetAngle()` ACCUMULATES so after one
rotation the vehicle counted as permanently inverted. Stuck-detector must gate on the OBSERVED
angle delta — `GetAngularVelocity()` reports a steady ~1.2 rad/s on a body wedged against terrain
whose angle is frozen (contact constraint cancels it positionally).

**run.bat:** the LAN-IP `for /f ('powershell ... ^| ...')` passed `^|` literally -> PowerShell
error -> the "On other laptops: http://IP:8080" line NEVER printed. Fixed.

**Multiplayer:** real and server-mediated (socket.io gateway, proven over LAN IP). Backend binds
0.0.0.0. BUT only chess is two-player — Hill Climbing is single-player by construction
(`sketch.js` session is maxPlayers:1). `front-end/server.js` also binds port 3000 = collides with
the NestJS backend.

**PCP:** was `min(30, floor(score/50))` — capped at 30 from score 1500, so every decent run paid
exactly 30. Now `score^0.75/12` via a single shared `runReward()`. Also: `score` in match_results
is the GAME score, never Carys — `computeCarys` used to fall back to it, reporting 4200 Carys.

**Air control direction (SETTLED — changed 3x, do not re-invert):** THROTTLE = ANTICLOCKWISE (nose up), BRAKE = CLOCKWISE (nose down). Derived from conservation of angular momentum (spinning the rear wheel forward throws the frame backward) and matches real HCR. Canvas y points down so negative torque = anticlockwise. Same sense as the ground reaction (throttle = wheelie), so controls no longer invert when tyres leave the ground. Measured: bike -70/+71 deg, truck -59/+58 deg over a clean 34-frame airborne window.

**run.bat works** — launch it normally (double-click or from a cmd prompt). Do NOT launch via PowerShell Start-Process without -WorkingDirectory; %~dp0 misresolves and it silently does nothing.

**Accounts restored 2026-07-30:** Akhil/abcchaka/jagan/kailesh were deleted by the same overwrite bug; restored from backup, Akhil user_id repaired "undefined" -> 1785437301793. users+player_profiles are now APPEND_ONLY (keyed on email). Safety copy: front-end/live_database.pre-restore.json

**PLATFORM BUG SWEEP 2026-08-02 (friends' bug list `codes/problems with playcarys.txt`) — root causes worth remembering:**
- `navigateTo(href)` was **referenced 25+ times across 6 pages and never defined** (only listed in
  .eslintrc.js globals). Every "Back to Dashboard", join/create-room and the host's START threw
  ReferenceError and did nothing. Now implemented in utils.js next to `navigate()`; it awaits
  `DB.whenSynced()` before leaving so the write lands first.
- **Mixed user_id types**: seeded accounts are numbers, registered ones were strings. The app
  compares ids with `===` everywhere (`n.toUser === parseInt(session.userId,10)`), so real accounts
  saw no friend requests/DMs/badges. Fixed at source in `attachUserCompat` (coerce numeric-string
  user_id -> number) + a `sameId()` helper in utils.js + a migration for notification refs.
- **`global_db_update_received` had no listener** — the client emitted the broadcast but never
  subscribed, so `mergeRemoteState` only ran at boot. Added `PlayCarysLive.pull()` (socket + 5s
  visible-tab poll) which merges and then **re-dispatches a synthetic `storage` event**: room-lobby /
  join-session / chess all listen for `storage`, which the browser only fires between tabs of the
  SAME browser — never across two laptops. That single bridge is what makes cross-device work.
- `mergeRemoteState` now updates rows **in place** (skipping accessor-only compat getters) so live
  references like room-lobby's `currentSession` don't detach on every pull.
- **users were keyed on `email` in APPEND_ONLY** (both db.js and back-end app.controller.ts). Email is
  user-editable, so every profile edit that changed it FORKED the account into two rows and the stale
  twin still answered to the old username/password — that was "profile changes don't reflect" AND
  "password system not working". Now keyed `id:<user_id>`. A `dedupeForkedAccounts()` migration cleans
  existing twins.
- **Backend `tables` list was missing `tournament_matches`, `tournament_results`,
  `deleted_tournaments`, `favorites`, `reviews`** → absent from /db-export → wiped on every page load.
  That is why a generated bracket vanished ("Bracket not generated yet"). Added to store.ts + both
  db-export and db-import.
- `notifications` is now APPEND_ONLY (keyed by id) on both ends — a routine save from a stale client
  was deleting friend requests/chats. "Clear All" therefore tombstones with `cleared:true`, never splices.
- **p5 in hill_climbing is an OLD build**: `key = String.fromCharCode(e.which)`, so `key === 'Escape'`
  can never be true. Use `keyCode === 27`. (Same trap for any non-printable key.)
- `view-transition-name` must be UNIQUE: `.tab-content`/`.page-content` matched 4 and 2 elements, so
  the API aborted with "invalid state" and nothing animated. Scoped to `:not(.hidden)`.
  NOTE: the API also legitimately aborts when `document.hidden` — don't mistake that for the bug.
- `navigate()` played a 220ms `pageLeave` but jumped after 80ms → visible cut-off. Now driven by
  `animationend` with a timeout fallback; the mid-animation `DB.saveLocal()` (full JSON.stringify)
  was removed since `beforeunload` already does it.
- Player tournament register/unregister never called `DB.save()` → the row died on next hydrate.
- `buildPrizeBreakdown` printed the whole pool for every tier (60%/25%/10% all showed "$100").

**🚨 DESTRUCTIVE FOOTGUN — `POST /api/v1/db-import` (hit it 2026-08-02, cost a restore):**
`importDb` ends with `fs.writeFileSync(live_database.json, JSON.stringify(body))` — it writes the
**raw request body**, not the store. POSTing a partial body like `{games:[...]}` therefore leaves
live_database.json containing ONLY that key; users/sessions/match_results/notifications are gone
from disk (they survive in the running process's memory until it restarts). Never POST a subset.
To test one table, send the full `/db-export` payload with that table swapped. Recovery when it
happens: `GET /db-export` from any still-running backend instance and write that to the file —
in-memory state is the only surviving copy. Also: never run a second backend instance against the
same repo, both write that same absolute path regardless of PORT/GAMES_DIR. Isolate by copying
`dist/` to a scratch tree (path is `dist/data/../../../front-end/live_database.json`) with
`NODE_PATH` pointed at the real node_modules.

**🚨 PHANTOM COMPILE ERRORS — this folder is LIVE-SYNCED by Google Drive (learned 2026-08-03):**
`playcarys_updated/` contains a `.tmp.driveupload/` staging dir (1000+ files) — Google Drive Desktop
writes source files in **arbitrary order**, so the tree is regularly in a torn half-synced state.
Observed: `nest start --watch` reported 5 hard errors (`Property 'reviewer_id' does not exist on
type 'ApproveGameDto'`) at 00:34:56 because `game.service.ts` (new) was on disk but `game.dto.ts`
(declaring those fields) did not land until 00:35 — four seconds later. A whole feature
(bundle.service/scan.service/zip.util + game_reviews in store.ts) materialised file-by-file across
the session; the initial `find src` listing did not even show those files.
**Before believing any TS error here, re-run `npx tsc --noEmit -p tsconfig.json` and check `ls -la`
mtimes.** A clean exit means the earlier error was a sync artifact, not a defect — do NOT "fix" the
code to match a stale DTO. Corollary: an external edit can also clobber your own in-flight changes,
so after a long editing session grep your markers back out of the files to confirm they survived.

**GAME REVIEW GATE (built 2026-08-02, `back-end/src/game/scan.service.ts` + `pages/admin/game-review.html`):**
Publisher zips are scanned on upload; approval binds to `approved_bundle_hash`, so a re-upload or a
`game_url` edit auto-revokes approval and takes the listing offline (R-REVIEW-* rules in
game.service.ts). Calibration note: HexGL/Open Panzer/2048/Hextris all scan `warn`, never `fail` —
`fail` is reserved for certainties (reading `playcarys_session`, miners, script-bearing SVG).
KNOWN GAP left in place deliberately: hosted bundles still run **same-origin** in play.html (the
other agents documented it), so a bundle can still read localStorage — the real fix is serving
`games/` from a separate port/origin.
