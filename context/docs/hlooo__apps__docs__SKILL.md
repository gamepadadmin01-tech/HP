---
name: remotegamepad
description: >
  Workspace reference for the RemoteGamepad project — an Android phone turned into a
  low-latency virtual DualShock 4 for Windows games. Load this when working in F:\hlooo
  on the controller UI (React/TS), the Android WebView+NDK client, or the Python PC server.
  Covers file layout, the 20-byte UDP packet contract, exact build/deploy/verify commands,
  hard-won gotchas, every architectural decision + fix, and launch/distribution status.
---

# RemoteGamepad — Project Skill

Phone (Android) → Wi-Fi/USB UDP → Windows PC → virtual DualShock 4 → any game.
Goal everywhere: **ultra-low input latency** (real-world ~6–18 ms).

```
[Touch / Gyro] → [React App.tsx in WebView] → [gamepad-engine.cpp NDK, SCHED_FIFO UDP thread]
   → UDP 20B over LAN → [server.py] → [ViGEmBus virtual DS4] → game
```

---

## 1. Workspace layout (only the files that matter)

| Path | What it is |
|---|---|
| `controller-ui/` | **Active** React/TS + Tailwind v4 + Vite frontend (the controller UI). |
| `controller-ui/src/app/App.tsx` | Single-file monolith (~3800 lines): all UI, state, packet build, screens `scanner`/`dashboard`/`controller`. |
| `controller-ui/src/app/components/CustomPadEditor.tsx` | Drag-and-drop layout editor (fluid toolbar, resize, delete). |
| `controller-ui/src/app/components/GamepadWidgets.tsx` | Premium modular SVG widgets (face cluster, D-pad, sticks, triggers, bumpers). |
| `controller-ui/dist/index.html` | Vite **single-file** build output (JS+CSS inlined). This is what ships into the APK. |
| `android-client/` | Kotlin WebView shell + C++ NDK engine. |
| `android-client/app/src/main/cpp/gamepad-engine.cpp` | UDP socket + real-time `pthread` (SCHED_FIFO), packet dedup, gyro fusion. |
| `android-client/app/src/main/assets/dist/` | Where the built React `dist/` is copied so the app runs offline. |
| `android-client/build_apk.bat` | The working APK build (sets JAVA_HOME, runs `gradle assembleRelease`). |
| `pc-server/server.py` | Python UDP listener + Tkinter GUI + ViGEmBus driver + self-install + firewall. |
| `pc-server/GamepadServer.spec` | PyInstaller spec (onefile, UPX off, bundles vgamepad + web + icon). |
| `pc-server/SETUP.md` | End-user setup doc shipped with the exe. |
| `output package/` | Ship artifacts: `RemoteGamepad.apk`, `RemoteGamepad-PC-Server.zip`, `PC-Server/GamepadServer.exe`. |
| `support-website/` | Marketing/support site (frontend + backend) for distribution. |
| `ARCHITECTURE.md` / `CLAUDE_CONTEXT.md` / `LOW_LATENCY_GUIDE.md` | Deep-dive docs; read for "why". |
| `Old_Gamepad_Client/`, `source_export/`, `_app_backups/` | Old/decompiled/backup copies — **not** the live source. Don't edit. |

> The live frontend is `controller-ui/`. The root `App Interface Design/` referenced in
> older docs is the historical name — current work is under `controller-ui/src/app/`.

---

## 2. The 20-byte UDP packet contract (both sides MUST agree)

C++ `#pragma pack(1)` struct ↔ Python `struct.unpack("<QHBBBBBBI", ...)`. Port **7777**.

```
Off  Size  Type        Field         Notes
 0   8 B   uint64 LE   timestamp     ms since epoch; out-of-order packets rejected
 8   2 B   uint16 LE   buttons       bitmask (see below)
10   1 B   uint8       leftTrigger   0=released 255=full
11   1 B   uint8       rightTrigger  0=released 255=full
12   1 B   uint8       leftStickX    0=left 128=CENTER 255=right
13   1 B   uint8       leftStickY    0=up   128=CENTER 255=down
14   1 B   uint8       rightStickX   same
15   1 B   uint8       rightStickY   same
16   4 B   uint32 LE   authToken     0xABCD1234 default / QR key; 0 = USB/unauth
Total: 20 bytes (static_assert enforces it at compile time)
```

Button bits (`BTN_MAP` in App.tsx):
```
0 A/Cross   1 B/Circle   2 X/Square   3 Y/Triangle
4 LB/L1     5 RB/R1      6 Options    7 Share/Back
8 L3        9 R3        10 DpadUp    11 DpadDown   12 DpadLeft   13 DpadRight
```

---

## 3. Build / deploy / verify — the commands that actually work

### Frontend (React → single-file dist)
```bash
cd /f/hlooo/controller-ui
npm install            # first time only
npm run build          # = vite build; emits dist/index.html (JS+CSS inlined, ~500 KB)
```
Then copy the built `dist/` into the Android assets:
```bash
cp -r controller-ui/dist/* android-client/app/src/main/assets/dist/
```

### Android APK (release)
```bash
cd /f/hlooo/android-client
./build_apk.bat        # sets JAVA_HOME (JDK 17) + runs: gradle-8.9\bin\gradle assembleDirectRelease
```
Install + launch on a connected device:
```bash
F:/hlooo/platform-tools/adb.exe install -r app/build/outputs/apk/release/app-release.apk
F:/hlooo/platform-tools/adb.exe shell monkey -p <pkg> 1
```

### PC server (run from source)
```bash
cd /f/hlooo/pc-server
pip install -r requirements.txt   # vgamepad
python server.py
```

### PC server (ship as exe)
```bash
cd /f/hlooo/pc-server
pyinstaller GamepadServer.spec     # onefile, UPX off, bundles vgamepad+web+icon
# → dist/GamepadServer.exe  →  copy into "output package/PC-Server/"
```

### Verify after a build
1. Frontend: `npx tsc --noEmit` MUST be clean before building (see gotchas).
2. After **native (.cpp) changes**: confirm the engine thread is actually alive on device —
   `adb shell pidof <pkg>` and check logcat for the UDP thread start, not just "app launched".
3. Server: watch the Tkinter window flip to **CONNECTED** and the in-app telemetry show a
   real round-trip ms (the ACK path), not a frozen estimate.

---

## 4. Critical gotchas (these bit us repeatedly)

1. **CRLF breaks `Edit`.** Many files are CRLF. An `old_string` copied with the wrong line
   endings won't match. If an Edit "should" match but fails, suspect line endings — re-read the
   exact bytes, or use a smaller unique anchor. Do **not** rewrite the whole file to dodge it.
2. **Always tsc-check.** Run `npx tsc --noEmit` before every `npm run build`. The monolith is
   big; a type error can silently ship a stale/last-good `dist` and you'll chase a ghost.
3. **Verify `pidof` / logcat after native changes.** A green Gradle build does **not** mean the
   NDK thread runs. Confirm the process and the SCHED_FIFO send loop on-device.
4. **Stick center is 128, not 127.** `0xFF/2 = 127.5`; 127 leaves the stick fractionally
   off-center → games read drift → the OS keeps the pad "active" → mouse stutter / phantom input.
   Phone sends 128 as neutral; server snaps anything within ±4 of 128 back to exactly 128.
5. **`linkAlive` ≠ `packetCount`.** "Connected" is driven by a recent-ACK / liveness flag
   (`linkAlive`), not by the raw received-packet counter. Don't gate UI/connection state on
   `packetCount` — a stale counter showed "connected" after the phone had actually dropped.
6. **Drain to newest packet.** The server reads ALL queued UDP datagrams and only applies the
   latest — never process the backlog, or input lag accumulates under load.
7. **UPX off in the exe.** UPX-packed onefile exes get AV-quarantined ("it just won't start").
   Keep `upx=False` in the spec.

---

## 5. Architectural decisions + fixes (the 16 that define the system)

1. **Single-file `App.tsx` monolith** — controller state is deeply interconnected; splitting
   caused prop-drilling. Colocate UI + state + packet logic.
2. **Pixel coords, not %** — custom-pad widgets live in a fixed landscape virtual canvas
   (~1263×540) so rendering is deterministic across screens.
3. **C++ NDK UDP on a SCHED_FIFO `pthread`** — bypasses JVM GC pauses that cause packet jitter.
4. **UDP over TCP** — for realtime input a dropped packet beats a delayed one; no head-of-line
   blocking. Server only cares about the latest packet anyway.
5. **Auth token in every packet** (`0xABCD1234` default, QR-issued key, `0` = USB/unauth) —
   stops other devices on the LAN from injecting input.
6. **`#pragma pack(1)` + `static_assert(sizeof==20)`** — guarantees the wire format regardless
   of compiler padding; compile-time safety net.
7. **Hair-trigger rescaling** (default 15% threshold → full 0–255) — partial pulls still reach
   full throttle.
8. **Circular deadzone** (~8%) on sticks — avoids diagonal drift a square deadzone causes.
9. **`localStorage` custom pads** — tiny JSON, no backend, survives restarts.
10. **Stick neutral = 128 with ±4 snap on the server** — fixes Windows phantom input / mouse
    stutter from a never-quite-centered stick (the 127→128 fix).
11. **Drain-to-newest + 500 ms watchdog** — newest-only apply prevents lag buildup; if no packet
    for >500 ms, reset the virtual pad to neutral so inputs never stick.
12. **ACK path = unicast lock + real RTT** — first valid packet gets `b"ACK"+<8B timestamp>`;
    phone stops broadcasting and locks unicast, and the round-trip becomes the measured latency
    shown in-app (replaced the fake estimate).
13. **Independent LS/RS routing in custom mode** — each thumbstick widget drives its own
    `posRef`; standard mode shares one touch area with a mode toggle. Don't cross-wire them.
14. **Radio + QoS latency stack** — `WIFI_MODE_FULL_LOW_LATENCY` lock (API 29+), DSCP-EF /
    IP_TOS tagging on every packet, unbuffered touch dispatch + historical-sample replay,
    1000 Hz native send thread pinned to big cores.
15. **Self-installing ViGEmBus driver** — server runs the MSI that `vgamepad` bundles via
    `ShellExecuteW(..,"runas",..)` (UAC), then asks the user to relaunch. Nothing to download.
16. **Auto firewall rule + AV-safe exe** — server adds an inbound UDP allow-rule on port 7777
    (`netsh advfirewall`, elevated) on first run; PyInstaller onefile with **UPX off** and
    vgamepad/web/icon bundled. `navigateTo` curtain hides the WebView resize flash on rotation.

---

## 6. Distribution / launch status

**Ships today:** `output package/RemoteGamepad.apk`, `output package/PC-Server/GamepadServer.exe`
(+ `SETUP.md`), zipped as `RemoteGamepad-PC-Server.zip`. Server self-installs ViGEmBus + firewall.
`support-website/` exists for hosting downloads + support.

**Open launch blockers (verify current status before claiming done):**
1. **Code signing** — exe is unsigned → SmartScreen "unknown publisher". APK is debug/self-signed.
2. **Play Store / store listing** — not published; no signed release keystore flow finalized.
3. **iOS** — none; Android-only.
4. **Onboarding edge cases** — guest/AP-isolated Wi-Fi blocks device-to-device; USB tethering is
   the documented fallback but needs clearer in-app guidance.
5. **Monetization** — plan exists (see below) but not wired (no paywall/license/IAP).

**App identity:** "RemoteGamepad". **Monetization plan:** free core + one-time unlock / pro tier
for advanced custom-pad features; sell via the support website with the signed exe to clear
SmartScreen friction. Keep the PC server frictionless (self-install driver) to reduce churn.

---

## 7. When you pick this up

- Edit the **live** source in `controller-ui/src/app/` — not the backups/exports.
- Frontend loop: edit → `tsc --noEmit` → `npm run build` → copy `dist` → `build_apk.bat` → install → verify on device.
- Touching the packet? Change **both** `gamepad-engine.cpp` and `server.py` together and keep 20 bytes.
- For deeper "why", read `ARCHITECTURE.md`; for latency tuning, `LOW_LATENCY_GUIDE.md`;
  for the full session history, `FULL_CHAT_LOG.txt`.

═══════════════════════════════════════════════════════════════════════════════
SESSION UPDATE — 2026-06-04  (support website live · USB-debugging wired · Xbox)
═══════════════════════════════════════════════════════════════════════════════

## SUPPORT WEBSITE (support-website/) — LIVE
- Stack: Vercel (frontend, Vite multi-page) → Railway (Express+Prisma backend) → Supabase (Postgres).
- Domain: **gamepad.space** (Namecheap→Vercel; apex 308-redirects to **www**, and canonical/sitemap/robots all say www since 2026-08-13). Backend: **9zov5h5e.up.railway.app** behind the custom domain **supportportal.gamepad.space** — that hostname is compiled into the shipped PC server and APK, so it must follow the backend to any new host. Brand: "Gamepad Controllers".
  - 2026-08-13: migrated to a NEW Railway account (old service deleted, trial exhausted). Dead now: gamepad-production.up.railway.app, admin.gamepad.space, the -9351 host. Brevo's inbound webhook was still posting replies to admin.gamepad.space and was repointed to supportportal.
- Email: **Brevo HTTP API** (Railway blocks SMTP; Gmail-SMTP and Resend abandoned). Railway vars: BREVO_API_KEY, ADMIN_EMAIL_USER(sender), EMAIL_FROM_NAME. For inbox delivery: verify gamepad.space in Brevo + set EMAIL_FROM_ADDRESS=support@gamepad.space.
- Admin = served by BACKEND at <backend>/admin behind **HTTP Basic Auth** (user "admin" / ADMIN_PASSWORD). NOT on public site. Helpdesk: search, Open/In-Progress/Resolved tabs, reply(emails user), delete, live auto-refresh, auto-in-progress on open, "Test email" diagnostic.
- CORS = multi-origin allowlist (gamepad.space, www, gamepad-flax.vercel.app) + FRONTEND_URL (comma-sep) in backend/server.js.
- Railway BUILD = `cd backend && npx prisma generate` ONLY. **NEVER put `prisma db push` in build or Pre-Deploy** — Railway's build/deploy env can't reach Supabase → P1001 fails the deploy. Table exists; run db push manually only on schema change.

## ⚠️ GIT/DEPLOY — CRITICAL (an external tool "antigravity" tangled it)
- DEPLOYED website repo = github.com/gamepadadmin01-tech/**gamepad** (root = backend/ frontend/ package.json). Railway+Vercel deploy from it.
- antigravity restructured LOCAL F:\hlooo to hlooo-root and repointed its remote to **gamepad-client-and-server** (DIFFERENT repo) + made bad edits (schema→sqlite, fallback→localhost — reverted).
- To edit the live site: `git clone .../gamepad.git` to a TEMP dir, edit, push to its main. DON'T push the F:\hlooo tree to gamepad (structure mismatch).

## CONTROLLER APP — this session
- PC server now emulates **Xbox 360 (XInput)** not DS4 (A/B/X/Y match F1). server.py: VX360Gamepad, XUSB_BUTTON, left_joystick_float (Y inverted), dpad=button flags.
- New WIRED mode = **USB debugging** (no tethering): app opens ws://127.0.0.1:7777 tunneled by `adb reverse tcp:7777 tcp:7777` (server runs it via bundled adb). AUTO-connects, no button. Manifest: usesCleartextTraffic + MIXED_CONTENT_ALWAYS_ALLOW.
- WS runs in a **Web Worker** + send-time timestamp stamp → ~5ms (was 50ms = main-thread jitter + stale-timestamp bug). adb tunnel ~3ms floor; true 3ms = AOA(Plan B) or RNDIS tethering.
- **Gyro = STEERING** (roll/tilt L-R → LEFT stick X). Was wrongly on right stick. JS path only (native C++ still right-stick for Wi-Fi mode). Gyro persists (localStorage) + defaults ON; "● GYRO ON" chip + top bar. Gyro no longer gated on isEngineRunning (MainActivity.kt) so it works in WS mode.

## SERVER EXE
- Latest = **F:\hlooo\pc-server\dist\GamepadServer.exe** (windowed). Bundles websockets+adb+vgamepad. Xbox + WS bridge + adb auto-reverse + TCP_NODELAY. Rebuild: `python -m PyInstaller GamepadServer.spec --noconfirm` (spec: collect_submodules('websockets') + adb datas). Old exes stale.

## PLAN B (AOA direct-USB ~1-2ms) — see AOA_REQUIREMENTS.md
- User accepted shipping a WinUSB driver in the zip. Do Milestone 1 (PyUSB AOA handshake + bulk-echo PoC) first. Native engine can write to accessory fd (reuse 1000Hz thread).

═══════════════════════════════════════════════════════════════════════════════
SESSION UPDATE — 2026-06-05  (repo de-tangle · website perf · publish workflow)
═══════════════════════════════════════════════════════════════════════════════

## WEBSITE PERFORMANCE FIX (scroll lag)
- Root cause: homepage runs an always-on full-screen WebGL "liquid glass" blob
  (`frontend/js/webgl.js`, MeshPhysicalMaterial transmission:0.96 = per-frame
  full-scene re-render) behind everything; the fixed nav + every `.card` used
  `backdrop-filter: blur()` OVER that animating canvas → re-blur every scroll
  frame. Plus Lenis + GSAP scrub triggers.
- Fix shipped (kept the 3D engine as-is per user): dropped live backdrop-blur on
  `.nav` (now rgba .92 opaque) and `.card` (--bg-card 0.4→0.82), GPU-promoted
  parallax images, lazy/async the one homepage img. See `frontend/css/style.css`.
- NOT done (offered, declined for now): pause WebGL rAF when tab hidden/off-screen.

## ⚠️ REPO STATE — UPDATED (supersedes the 2026-06-04 GIT/DEPLOY note)
- **`gamepad-client-and-server` was DELETED** by the user (2026-06-05). The local
  `F:\hlooo` monorepo's `origin` pointed there → now a DEAD remote (removed).
  The monorepo currently has **NO GitHub remote** — backed up locally only.
- DEPLOY repo is unchanged: **github.com/gamepadadmin01-tech/gamepad** (website at
  root: backend/ frontend/ package.json). Vercel=frontend, Railway=backend/.
  Verified by matching live built CSS to that repo's source.
- The old note "antigravity made bad edits (schema→sqlite … reverted)" was
  MISLEADING. Reality: the *committed* history (c4a394c) baked in sqlite; the
  *working tree* had the correct postgres + multi-origin CORS (matching prod) but
  uncommitted. Reconciled this session.
- LANDMINE caught: monorepo root `support-website/package.json` still had
  `build: … && npx prisma db push` (the P1001-causing command). The fix lived
  ONLY in the gamepad repo (commit eeaad5d), never back-ported. Now removed
  locally too, so publishing can't re-break Railway.

## DEPLOY WORKFLOW — use the script, not manual clone
- **`support-website/publish.ps1`** = one-command deploy. Clones the gamepad repo
  to a temp dir, robocopy-syncs support-website/ in (HARD-excludes .env,
  node_modules, dist, *.db, tickets.json), shows the diff, confirms, commits,
  pushes to gamepad `main` → triggers Vercel+Railway redeploy.
  Run: `powershell -ExecutionPolicy Bypass -File support-website\publish.ps1`
- Edit the website HERE (F:\hlooo\support-website), then run publish.ps1 to ship.
- Pushing to gamepad `main` is gated by Claude Code's safety classifier (direct
  prod push) — expect to approve a permission prompt when you run it.

═══════════════════════════════════════════════════════════════════════════════
SESSION UPDATE — 2026-06-08  (app icon · rumble · gyro overhaul · settings cleanup)
═══════════════════════════════════════════════════════════════════════════════

## ANDROID APP IDENTITY & BUILD (read before touching the app)
- **Package = `com.gamepad.client`** (applicationId in android-client/app/build.gradle;
  namespace too). `com.remotegamepad` was an OLD build — uninstalled this session. Use
  `com.gamepad.client` for adb launch/install.
- compileSdk=34, minSdk=24, targetSdk=34. JDK 21 at the antigravity path (see build_apk.bat).
- **Build the APK (the reliable recipe — plain gradle keeps hitting a resource-merge file
  lock):** stop daemon → wipe build/ → `--no-daemon`:
  ```
  gradle.bat --stop
  Remove-Item -Recurse -Force F:\hlooo\android-client\app\build   # retry 2-3x if locked
  cd F:\hlooo\android-client; gradle.bat assembleRelease --no-daemon
  ```
  Output: app/build/outputs/apk/release/app-release.apk. NDK (.cxx) cache is separate from
  build/ so it survives the wipe (only the changed .cpp recompiles).
- **PowerShell cwd DRIFTS between calls** — always use ABSOLUTE paths (Set-Location F:\hlooo
  first, or full paths), or Push-Location lands in the wrong dir.
- Install+launch: `adb install -r <apk>` then
  `adb shell monkey -p com.gamepad.client -c android.intent.category.LAUNCHER 1`.
- Frontend loop unchanged: edit controller-ui/src/app/App.tsx → `npm run build` →
  `cp -r dist/* android-client/app/src/main/assets/dist/` → rebuild APK.
- ⚠️ The **F: drive intermittently disconnects** ("working directory deleted"). It WILL drop
  mid-build/commit — re-check `Test-Path F:\hlooo`, and back up to D: if it keeps dropping.
- Edit-tool gotcha: it FAILS to match lines containing **emoji** (📳 etc.) or multi-line
  blocks that span **blank lines**. Use short single-line anchors, or a Node script
  (`fs.readFileSync.split('\n')…`) for surgical line edits.

## APP ICON
- Launcher icon source = `android-client/app/src/main/res/drawable/app_icon.png` (512×512),
  drawn inset 16% on `@color/icon_bg` (#0C0C0C) via the adaptive icon. Replaced the old
  desk-photo with a clean blue→cyan gamepad. Original photo backed up in `_iconwork/`.
  Play-Store 512 icon (flat) also in `_iconwork/play_store_icon_512.png`.

## RUMBLE (PC game force-feedback → phone vibrates) — NOW WORKING, USB/WS mode only
- **server.py**: `_on_rumble(client, target, large_motor, small_motor, led_number, user_data)`
  — vgamepad here needs the **6-arg** signature (incl. `user_data`); 5 args throws and the
  try/except silently swallowed it → no rumble (the original bug). Registered via
  `gamepad.register_notification(callback_function=_on_rumble)`. The WS handler runs a
  concurrent `_rumble()` task that streams `b"RMB"+large+small` (5 bytes) to the phone while
  non-zero. UDP/Wi-Fi rumble NOT done (native C++ Rx thread still a TODO).
- **WS worker (App.tsx)** parses `RMB` (bytes 82,77,66) → postMessage{t:'rmb'} → main thread
  calls `window.onRumblePacket(l,r,0,0)`.
- **MainActivity.kt** `triggerRumble` + shared `doVibrate(durationMs, amplitude)`:
  VibratorManager on API≥31 else legacy; amplitude only if `hasAmplitudeControl()` else
  DEFAULT_AMPLITUDE (Redmi Note 7 Pro has NO amplitude control → custom amplitude is ignored).
- **Intensity fix**: onRumblePacket scales PULSE DURATION (20–100ms) by strength, so the
  Intensity slider is felt even on no-amplitude phones (amplitude alone did nothing there).
- vgamepad notification VERIFIED firing via XInputSetState test (see _iconwork/rumble_test.py).

## GYRO STEERING — FINAL MODEL (lots of churn; THIS is the settled logic)
- **Sensitivity = the full-lock TILT ANGLE in degrees (1–90°)**: tilt the phone `sensitivity`°
  → full steering. Lower = more sensitive. `rx = clamp(gate(tiltDeg)/sensitivity, ±1)`.
  (Do NOT reintroduce a "gain"/percent model — user rejected it.)
- **Range = a DEGREE deadzone**: tilts below it are ignored; past it the ABSOLUTE angle is
  read (range 10, tilt 11° ⇒ reads 11°, no re-normalization).
- **STEERING SOURCE = SENSOR FUSION, not the accelerometer (2026-06-09 rewrite).** An
  accelerometer reads only the gravity direction, so it has a BLIND SPOT: when the phone is
  held steep/vertical (steering axis ≈ aligned with gravity) it physically CANNOT sense roll —
  the signal collapses to noise that flails to both full locks, and any pitch toward the face
  flips `z` sign → tiny pitch = full steer. No `atan2(...)` variant fixes this (all three of
  `atan2(y,z)`, `atan2(y,sqrt(x²+z²))`, `atan2(y,|z|)` were tried on-device and fail at steep
  holds). Proven by live probe: pitch-only motion drove steering ±100% (`sd=44`).
- **The fix (reverse-engineered from the competitor "Remote Gamepad v1.13.6", classes3.dex):**
  the Kotlin layer (MainActivity) now does the textbook fused-orientation pipeline:
  1. `getDefaultSensor(TYPE_GAME_ROTATION_VECTOR)` (id 15; fallback `TYPE_ROTATION_VECTOR` 11) —
     gyro+accel fused in HW → no drift, no gravity blind-spot.
  2. `SensorManager.getRotationMatrixFromVector(R, event.values)`.
  3. `SensorManager.remapCoordinateSystem(R, axisX, axisY, R2)` switched on the **Display
     rotation** (all 4 cases) — this RELOCATES the Euler gimbal singularity OUT of the steering
     range, which is why it stays correct whether the phone faces you or is rotated.
  4. `SensorManager.getOrientation(R2, o)` → **steering = `o[1]` (the asin pitch axis, cleanly
     decoupled); forward/back = `o[2]` (roll) and is IGNORED.** Verified on device: phone
     propped at 70° forward → steering rests at ~0 (the 70° sits in `o[2]`), signal `sd=0.0`.
  - Published as degrees via the SAME bridge contract `getGyroscopeDataJson()` → `{nx,ny}`
    (`nx`=steering `o[1]`, `ny`=`o[2]`), so the JS steering/indicator layer is UNCHANGED.
  - ⚠️ If the car steers the WRONG way, flip the sign of `fusedRollDeg` (one line) — the JS
    already negates once for the on-screen car. Registered at `SENSOR_DELAY_GAME` (50 Hz).
  - The native `gamepad-engine.cpp` `injectNativeSensorData` accel→atan2 path is now DEAD
    (kotlin no longer injects accel; the extern is left but unused). Don't resurrect it.
- **Indicator** = the steering value, negated for visual direction (`bx = -rx`), tracked
  DIRECTLY (no JS smoothing — that added ~140ms lag and felt slow).
- Steering = LEFT stick X (JS path). gyroHaptic gates the full-lock haptic bump.
- **Decompile recipe (for parity research):** no jadx/apktool here, but build-tools has
  `dexdump.exe` + `aapt`. Extract the apk via .NET `ZipFile`, grep the dex string pool with
  .NET latin1 read for framework calls (`getRotationMatrixFromVector`, `remapCoordinateSystem`,
  `getOrientation`, `getDefaultSensor`) — framework refs survive R8 obfuscation. `dexdump -d`
  then shows the `const v,#int 15` before `getDefaultSensor` = the sensor type.

## SETTINGS UI CLEANUP (controller-ui System tab)
- Removed DUPLICATE haptics toggle (both bound to gyroHaptic) — one "App Vibration" toggle
  remains in the Vibration & Rumble section.
- De-jargoned user-facing labels: "Tilt Steering", "Tilt Controls", "Vibration & Rumble",
  "App Vibration", plain-English range/deadzone help. Advanced/About now states the REAL
  connection methods (Wi-Fi QR or USB cable + USB debugging — NOT "USB tethering").

## WIRED PAIRING (audited — no code bug)
- WS path: phone dials `ws://127.0.0.1:7777`, tunneled by `adb reverse tcp:7777 tcp:7777`
  (server's start_adb_reverse_watcher re-applies every 2s; adb bundled in the exe).
  `websockets==16.0` — `websockets.serve(handler, …)` with single-arg `handler(ws)` works.
  If wired fails it's environmental: USB-debugging not authorized, or running a STALE exe.

## REFERENCE APP (a working competitor/old build, for parity research)
- Decompiled at **F:\downloads\sources** (+ resources). Package `com.remotegamepad`, native
  Kotlin/Jetpack-Compose, heavily R8-obfuscated. Its vibrator helper (defpackage/C1394a) =
  VibratorManager + hasAmplitudeControl (we copied that approach). The accel listener found
  (C9622a) is the Google Ads SDK shake-detector, NOT its steering — steering math is compiled
  away, not readable. Don't waste time trying to grep its gyro formula.
- The PREMIUM apk ("Remote Gamepad v1.13.6") recovered at **F:\hlooo\_refapk\ref.apk** —
  its classes3.dex is where the GAME_ROTATION_VECTOR steering pipeline was decoded from.
- COMPETITOR PC SERVER at **F:\hlooo\Remote Gamepad\Remote Gamepad.exe** (8.4 MB, Kotlin/
  Native: Ktor + libui-ng GUI + ViGEmClient/ViGEm Bus Driver + bundled adb, per
  notices/notices.json). Both their exe and ours are UNSIGNED (Get-AuthenticodeSignature
  = NotSigned) → SmartScreen is NOT the difference. Their smooth UX = permission-needing
  setup (driver) happens ONCE at first run, never on later launches.

## PC SERVER FIRST-RUN SETUP GATE (2026-06-10 — match competitor's "ask once" UX)
- Was: `ensure_firewall_rule()` ran every launch; if the rule was missing (declined/failed)
  it re-UAC-prompted EVERY launch. ViGEmBus install was already one-time (driver-present
  check). Spec has NO uac_admin, so no whole-process elevation.
- Now: firewall is attempted ONLY when `is_first_run()` (no %LOCALAPPDATA%\GamepadServer\
  setup_done marker) OR when already admin (self-heals silently). `mark_setup_done()` after
  the driver inits. → first run asks once ("starting phase"); every later launch is silent.
  Re-run setup by deleting the setup_done marker. Helpers: `_gp_config_dir`, `is_first_run`,
  `mark_setup_done` (same %LOCALAPPDATA%\GamepadServer dir as the pairing key).
- Still unsolved (costs money): code signing → removes SmartScreen "unknown publisher".

═══════════════════════════════════════════════════════════════════════════════
SESSION UPDATE — 2026-06-10  (latency 120Hz path · indicator glide · pairing persistence)
═══════════════════════════════════════════════════════════════════════════════

## GYRO DATA PATH = 120 Hz, RENDER = rAF + LIGHT GLIDE (App.tsx useGyro, bridge branch)
- Bottleneck found: sensor 200 Hz but JS read the bridge once per rAF (60 Hz) → steering
  up to 16.7 ms stale. Now SPLIT: an 8 ms setInterval reads the bridge, updates tiltRef
  and fires the packet send (~120 Hz); a separate rAF loop renders the bar.
  120 Hz NOT 250 — each bridge read is a sync JNI hop; 250 Hz risks WebView jank.
- Indicator: rAF render glides `dispBx += (target-dispBx)*0.45` (τ≈25 ms, snap <0.004).
  VISUAL ONLY — steering stays raw. This is NOT the rejected ~140 ms smoothing; do not
  raise τ above ~40 ms or the bar lags the car.
- Staleness probe: bridge JSON now includes `age` (ms since last sensor event, Kotlin,
  Locale.US-formatted — comma-locales would break JSON.parse). JS logs avg every 5 s:
  `[gyro] sensor→read staleness avg X ms` (view via logcat/CDP console).

## PAIRING PERSISTENCE (both sides — fixed "re-scan after every restart")
- SERVER (server.py): pairing key now persists at %LOCALAPPDATA%\GamepadServer\
  pairing_key.txt (load-or-create, validates 8-hex; falls back to session key on disk
  error). Before: `secrets.token_hex(4)` EVERY launch → phone's saved key rejected.
- PHONE: `last_server` in localStorage = {ip,port,key}; saved by the QR overlay ONLY
  after linkAlive confirms (Dialogs.tsx) and by manual connect (App.tsx). ScannerScreen
  wireless tab shows a green "Last PC … ↻ Reconnect" card → one-tap reconnect with the
  same linkAlive verify (16×250 ms timeout → honest "failed" hint).
- Kotlin serverIp/serverKey were and remain in-memory only — persistence lives in JS.

## PC SERVER CONNECTION CLARITY (run_gui, same session morning)
- telemetry.ws_linked = WS (USB) link lifecycle: set True on handler entry, False on
  close — server shows CONNECTED as soon as cable+app are up, NOT only when the
  controller screen streams input. UDP watchdog no longer clears the display state
  (only resets the pad). transport = "USB (Wired)" | "Wi-Fi".
- GUI: USB CABLE / WI-FI pills light per transport; status line distinguishes
  "linked — open the controller" vs "receiving input (N packets)". Window 400x680.
- USB auth audit: keyless token-0 + loopback whitelist (is_offlan_client 127.*) is
  correct by design — no key needed on the wired path.
