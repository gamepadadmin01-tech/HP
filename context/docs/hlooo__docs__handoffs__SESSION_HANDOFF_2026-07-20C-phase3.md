# SESSION HANDOFF — 2026-07-20 (C: Phase 3 — native touch input path; ON-DEVICE MEASURED, GAMEPLAY-VERDICT PENDING)

Supplements `SESSION_HANDOFF_2026-07-20.md` (morning, latency plan) and
`SESSION_HANDOFF_2026-07-20B-gyrofix.md` (evening, gyro rAF fix). Everything in
those stands except where updated here.

---

## 1. What this session did

**Implemented Phase 3 from the morning handoff §3: input is taken off the
JS/WebView path entirely.** Measured motivation: touch→JS dispatch was ~6.8 ms
avg / 15 ms p95 = 78% of the one-way input path.

**Status: code complete, builds green, INSTALLED + MEASURED ON THE PHONE.**
The native path activated and ran clean (`native input path ACTIVE (widgets=14)`)
and measured **~2.9 ms avg / 6 ms p95 touch→handle vs the old ~6.8 ms / 15 ms JS
dispatch** — average roughly halved, jitter tail cut ~2.5×. A second window read
`avg=3.83 p50=2.00 p95=14.00 max=18.00` (median better still, occasional tail
spike — see §7). **What is STILL missing: the real gameplay feel verdict** (play
a game, judge buttons/sticks/triggers/d-pad/gyro) — the user never got to it.
Two bugs were found and fixed on-device tonight; see §6.

### Architecture (as built)

- **Kotlin, not C++.** The payload builder moved to a new
  `NativeInputEngine.kt` (android-client). The 20-byte wire format,
  `injectNativePayload` JNI and the whole C++ TX thread (change-detect memcmp,
  ×3 redundancy, ~30 Hz keep-alive, GRX seal) are **byte-for-byte untouched** —
  zero C++ changes.
- **Touch:** an invisible full-screen overlay `View` sits above the WebView in
  `gameContainer`. While active it hit-tests touches against pad geometry and
  keeps button/stick/trigger state natively; per-pointer streams that *start*
  on empty space or on a HUD exclusion rect are declined → the WebView gets
  them natively. Extra pointers force-merged mid-gesture that hit nothing are
  replayed into the page as a synthetic tap on release (HUD taps work mid-play).
- **Geometry:** JS (`buildNativeGeometry` in App.tsx, right after
  CUSTOM_LABEL_MAP) flattens `activePad.buttons` into design-space (1280×570)
  hit shapes with **pre-resolved button bits + haptic tier strings**, publishes
  them with `svg.getScreenCTM()` + devicePixelRatio + `[data-nx]` HUD rects via
  `AndroidBridge.setNativeInputGeometry`. Kotlin inverts the matrix and
  hit-tests in design space — same numbers as the JS widgets (stick maxR 60,
  8%-of-60 radial deadzone, dpad inner 0.28r strict 4-way, hair-trigger 0.85,
  abxy spread r·0.71 / btnR r·0.40, ltrt pill expansion).
- **Gyro merged natively** (this is most of Phase 3a delivered early, in Kotlin
  instead of C++): `MainActivity.onSensorChanged` (~200 Hz, sensor thread) now
  calls `nativeInput.onGyroSample()` → rebuild+inject. Same formula/signs as
  the JS builder (racing lsX−gx / throttle lsY−gy; 3d rsX−gx / rsY+gy), zero
  captured natively on CALIBRATE (`nativeGyroCalibrate`), config pushed from JS
  on every change (`setNativeGyroConfig`). Gyro cadence is now decoupled from
  BOTH the WebView and display Hz while the flag is on.
- **JS while native is active:** `sendGamepadTelemetry` early-returns
  (`nativeActiveRef`); the gyro rAF pump keeps running for the visual bar only.
  Native pushes pressed-state back once per frame (Choreographer-coalesced
  `window.__nvis`) → held sets (`effHeldCustom`/`effHeldStd` override), trigger
  fills via setLt/RtFill, stick knobs imperative transform, stick-mode sync.
- **Haptics:** `doVibrate`/`vib`/`playHaptic` body moved from the bridge object
  to MainActivity level (`playHapticEvent`) so native fires the IDENTICAL
  tiers. Press tier strings computed in JS export; release = "buttonRelease" on
  up (never on cancel); stick rim tick; gyro full-lock tick — all replicated.
- **Feature flag:** localStorage `gp_native_input` — **default ON** when absent;
  `"0"` disables. Runtime toggle `window.__setNativeInput(true|false)` (re-runs
  activation without reload). With the flag off, or no bridge (browser/old
  shell), or on the **USB-debugging WebSocket transport** (a 500 ms watcher
  yields/reclaims), behaviour is exactly pre-Phase-3.

### Files touched (apps/ has NO VCS — backups listed)

| File | Change | Backup |
|---|---|---|
| `apps/android-client/.../NativeInputEngine.kt` | **NEW** — whole engine | n/a |
| `apps/android-client/.../MainActivity.kt` | bridge methods, overlay add, sensor hook, haptics moved to class level, `injectNativePayload`/`fused*Deg` → internal, session-cleanup deactivate | `MainActivity.kt.bak-20260720-phase3` |
| `apps/controller-ui/src/app/App.tsx` | geometry export, send gate, activation/config/__nvis effects, effHeld wiring, `data-nx` tags, native calibrate call | `App.tsx.bak-20260720-phase3` |

App.tsx EOL note: the file is now **uniformly CRLF** (B-handoff's "useGyro
region is LF" is stale). NBSP zones unchanged at ~2649–3505; all this session's
edits were outside them, via Edit-tool unique anchors.

## 2. Build state

- `controller-ui` vite build + `tsc --noEmit` clean; dist **copied to android
  assets** (the mandatory step) before the final APK build.
- **Clean release APK** (1.3.22/46, release-signed):
  `apps/android-client/app/build/outputs/apk/direct/release/app-direct-release.apk`
- **Test APK for the A/B** (same code + `setWebContentsDebuggingEnabled(true)`
  unconditional, so CDP can reach `__setNativeInput` on a release-signed build):
  `apps/android-client/testbuilds/GamepadOS-1.3.22-phase3-debugwebview.apk`
  The source was reverted to `if (BuildConfig.DEBUG)` after stashing it.
- Store artifacts in `releases/store/1.3.22/` remain UNTOUCHED/STALE (still
  missing gyro fix + memo work + phase 3). Same rule as before: no store
  rebuild until the user says so.
- Browser smoke test: dashboard + controller screen render clean, `__nvis` /
  `__setNativeInput` registered, 3 `[data-nx]` rects, JS path ungated without a
  bridge.

## 3. Known gaps / design notes (review before judging on-device feel)

1. **Touch ripples don't spawn in native mode** — they're internal to
   BtnBase's own pointer handlers. Held glow/tint/scale all work (driven by
   held sets). If the loss is noticeable, thread a ripple trigger through
   __nvis later.
2. **Stick grab-tint** (knob fill #e0e0e0 while held) isn't replicated — knob
   position + widget held ring are.
3. Second finger on the same stick/d-pad is ignored (matches JS pid guard);
   Hybrid stick resolves L/R at press time.
4. Buttons don't release on slide-off (matches JS pointer-capture behaviour).
5. Overlay hit shapes ignore rounded rect corners of pills/rect buttons
   (hit = full rect; JS clipped at corners — sub-pixel difference).
6. Portrait mode: `getScreenCTM` under the CSS-rotate wrapper is untested —
   irrelevant on the phone (SENSOR_LANDSCAPE) but don't trust native input in
   the browser-portrait layout.
7. On deactivation both sides neutralize (native injects a neutral frame; JS
   resets knobs/fills and resumes sending).
8. GPM: while native is on, the JS "touch->JS dispatch" stat only sees
   non-widget touches; the native replacement logs
   `GPM: native touch->handle: n=… avg=… p50=… p95=… max=…` every 5 s, plus
   "native input path ACTIVE/inactive" transitions.

## 4. NEXT — finish the on-device verdict (phone was UNPLUGGED mid-session; plug in first)

> Install + latency measurement are DONE (see §1). What remains is the gameplay
> feel pass + the one-pad confirmation after the §6.2 fix. The fixed APK is
> staged but **NOT yet installed** — the phone was unplugged before it could be.
> First: `adb install -r apps/android-client/testbuilds/GamepadOS-1.3.22-phase3-debugwebview.apk`,
> connect, and confirm the server log shows exactly ONE `Controller session`.


```bash
# 1. install the DEBUG-WEBVIEW test build (in-place, pads preserved)
F:/hlooo/tools/platform-tools/adb.exe -s DAIFEYGEKB89V4QG install -r \
  F:/hlooo/apps/android-client/testbuilds/GamepadOS-1.3.22-phase3-debugwebview.apk

# 2. GPM harness
adb -s DAIFEYGEKB89V4QG logcat -c && adb -s DAIFEYGEKB89V4QG logcat -s GPM:I
# expect on entering the controller: "native input path ACTIVE (widgets=N)"
# then "native touch->handle: …" summaries every 5s while playing.

# 3. A/B toggle via CDP (app foreground! Android 16 freezes cached procs):
adb shell "cat /proc/net/unix | grep -a devtools_remote"
adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>
node F:/hlooo/tools/webview-cdp.mjs "window.__setNativeInput(false)"   # JS path
node F:/hlooo/tools/webview-cdp.mjs "window.__setNativeInput(true)"    # native path
```

Verify checklist (from morning handoff + this build):
- [ ] native ACTIVE log appears on controller entry; input works in a game
- [ ] GPM native touch->handle ≪ the old ~6.8 ms JS dispatch (expect ≤1–2 ms)
- [ ] RTT badge still live; buttons/sticks/triggers/d-pad all function
- [ ] D-pad strict 4-way (no diagonals/opposites)
- [ ] analog trigger feathers 1:1; digital trigger instant 100%
- [ ] gyro steers during button mashing (the B-fix scenario) AND with flag on
- [ ] gyro toggle + CALIBRATE + BACK tappable, including WHILE holding a stick
- [ ] haptics: one tick per press + release tick, rim tick, full-lock tick
- [ ] custom pads incl. macros/abxy/hybrid+L-Mod/R-Mod widgets
- [ ] `__setNativeInput(false)` cleanly returns to the JS path mid-session
- [ ] USB-debugging (WebSocket) transport: native yields automatically
- then: install the CLEAN apk (no debug webview) as the daily build, or fold
  the flag decision into the 1.3.23 cycle.

## 6. TWO BUGS FOUND + FIXED ON-DEVICE (2026-07-20 late) — read before touching either area

### 6.1 🚨 JNI CRASH: `internal` on an `external fun` is FATAL (Kotlin name mangling)
**Symptom:** app force-closed the instant the controller screen opened —
`java.lang.UnsatisfiedLinkError: No implementation found for void
MainActivity.injectNativePayload$GamepadClient_app_directRelease(byte[])`,
thrown on the `gyro-sensor` thread. **Compiles perfectly; only fails at runtime.**

**Cause:** to let NativeInputEngine call it, `injectNativePayload` was changed
from `private external fun` to `internal external fun`. Kotlin **name-mangles
`internal` members** with a `$module` suffix, so the JNI symbol the C++ side
exports (`Java_com_gamepad_client_MainActivity_injectNativePayload`) no longer
matches the mangled Kotlin declaration.

**Fix (shipped):** the `external fun` is `private` again; a plain Kotlin wrapper
`internal fun injectPayload(data)` delegates to it (wrappers are safe to mangle).
The call site also catches **`Throwable`, not `Exception`** — a linkage failure
raises an `Error`, which must never kill the sensor/touch threads.
**RULE: never mark an `external fun` `internal`. Use private + a wrapper.**

### 6.2 🚨 DOUBLE VIRTUAL GAMEPAD — pre-existing coordinator hole (NOT Phase 3)
**Symptom:** the PC's gamepad detector showed **two** controllers for one phone.
Server log proved it: `+10.66.39.130 (active=1)` (phone UDP over tether) AND
`+usb:1 (active=2)` (same phone over the USB-debug WebSocket).

**Cause chain:**
1. `server.py` `start_adb_reverse_watcher` (called from `main`, ~line 2003)
   re-creates the `adb reverse tcp:7777` tunnel **on every server start**.
2. The phone's `usbWS` worker only stops retrying when `disconnect()` clears its
   internal `enabled` flag. The coordinator called it as
   **`if (w.isOpen()) w.disconnect();`** — gated on the socket ALREADY being open.
3. So a worker that is *enabled but not yet connected* (tunnel down, retrying
   every 1 s in its own loop) slips past that guard forever.
4. Server restarts → tunnel returns → the zombie worker connects → the server
   grants a pad for **every open WS** (`padmgr.acquire`, server.py ~1155) → 2nd pad.

Trigger sequence: WS enabled (auto-mode fallback while no engine/tether — e.g.
right after a crash) → tunnel disappears → tunnel returns while native is live.
That is exactly what the crash-and-restart cycle produced. This is the June
"device connects twice" bug's remaining hole — the coordinator was added then,
but with this gate.

**Fix (shipped):** `w.disconnect()` is now called **unconditionally** in all
three coordinator branches (wireless-protection, `tether`, `auto`) in App.tsx.
It is idempotent and cheap (one worker postMessage per 1.5 s reconcile), so a
zombie worker can never survive to claim a second pad.
**RULE: gate `connect()`, never `disconnect()` — `isOpen()` ≠ `enabled`.**

### 6.3 PC server state
The morning's from-source server (PID 84112, up since 18:28) is gone. A fresh
one runs **detached** from `F:\hlooo\apps\pc-server` (`python -u server.py`),
logging to
`C:\Users\akhil\AppData\Local\Temp\claude\F--\664c6c96-...\scratchpad\gpserver.log`
— watch `Controller session +/-` lines there to count pads live. It came up with
**zero** sessions. Restart it the same way after a reboot; the installed
`GamepadServer.exe` is still the OLDER pre-Phase-1 build.

## 7. Open question for the next session
The second GPM window showed `p95=14.00 max=18.00 ms` while the median improved
to 2 ms — occasional tail spikes when the UI thread is busy. If gameplay reveals
a stray hitch, the first lever is thinning the per-frame `__nvis` visual mirror
(it currently rebuilds a JSON string + `evaluateJavascript` every frame that
state changes); making it diff-only or dropping it to ~30 Hz would cut UI-thread
work on the same thread that dispatches touches.

## 5. After that (unchanged order)

1. Phase 2 — Rust PC server (wire-conformance test first; morning §4.1).
2. Phase 4 — default USB tether.
3. Store rebuild + uploads when green-lit (artifacts stale), website must serve
   the `-direct.apk`, resizeableActivity decision.
4. Phase 3a (C++ gyro atomics) is now LARGELY REDUNDANT — Kotlin already owns
   gyro→payload. Only revisit if profiling shows the Kotlin sensor-thread build
   path itself matters.
