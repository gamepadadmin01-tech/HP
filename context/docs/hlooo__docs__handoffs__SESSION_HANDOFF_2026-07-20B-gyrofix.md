# SESSION HANDOFF — 2026-07-20 (B: gyro-freeze root cause + fix)

Supplements `SESSION_HANDOFF_2026-07-20.md` (same day, latency-optimisation session).
Everything in that doc still stands except where updated here.

---

## 1. What this session did

**User bug:** "pressing any button makes the gyro lag/freeze; tapping FAST makes it
smooth again." Reported on phone `DAIFEYGEKB89V4QG` running 1.3.22/46.

**Outcome: ROOT-CAUSED WITH MEASUREMENT, FIXED, USER-CONFIRMED ON DEVICE.**

### Root cause (measured, not guessed)
CDP probe injected into the live WebView (762 taps, ~2 min of play):

| Signal | Result |
|---|---|
| 8ms-timer gaps | **399 holes of ~90–160 ms — one per discrete tap**, each starting ~10–20 ms *before* the JS pointerdown handler ran |
| rAF through the same taps | p95 = **8.4 ms** (120 Hz, untouched) |
| Long tasks | **ZERO** |

→ This device's WebView (Chromium renderer scheduler, `touchstart` use-case)
**defers DOM-timer queues ~100 ms around every discrete tap**. rAF (compositor
BeginFrame–driven) is not deferred. The old gyro data pump was an 8 ms
`setInterval` and it was the ENTIRE gyro→packet path — the C++ TX thread only
re-sends `currentPayload`, so the PC received *frozen stick bytes at full rate*
(perfect RTT, frozen steering). Fast tapping keeps the scheduler in a
continuous-gesture state where per-tap deferral windows stop dominating.

**Exonerated by the zero-long-task result:** React commits, SVG blur/ripple/GPU,
CPU clock boost. (The earlier React.memo theory was wrong as a cause; see §2.)

### The fix (shipped to phone)
`controller-ui/src/app/App.tsx` → `useGyro`: the bridge read + steering compute +
packet send moved from `setInterval(8)` onto the **rAF tick** — `pumpGyro()`
called at the top of the existing render loop. Same ~8.3 ms cadence on this
120 Hz panel; immune to touch timer-deferral by construction. Big comment block
in the code records the measured numbers — **do NOT move it back to a timer.**

Also this session (kept, but NOT the cause — hygiene only):
`Widgets.tsx`: `Btn`/`Dpad`/`RightStick`/`TriggerPill` wrapped in `React.memo`
with custom comparators (per-widget held-state, geometry; function-prop identity
deliberately ignored — see comments). A press now re-renders only the touched
widget. Comparators handle: Hybrid-stick L↔R swap (via `knobRef` ref-compare),
analog trigger `fill`, icon labels.

---

## 2. Current state

- **Phone `DAIFEYGEKB89V4QG`:** 1.3.22/46 direct-release with BOTH changes,
  installed in-place ~19:45, custom pads preserved. **User confirmed the freeze
  is gone.** NOTE: this installed build has `setWebContentsDebuggingEnabled(true)`
  unconditionally (was needed for the CDP probe) — harmless locally, and the
  **source has already been reverted** to `if (BuildConfig.DEBUG)`; any future
  build/install wipes it.
- **Store artifacts `releases/store/1.3.22/`: UNTOUCHED and STALE** — they contain
  neither the gyro fix nor the memo work. User said **do not build store releases
  until they say so**. When they do: rebuild all 6 variants (same 1.3.22/46 is
  fine — nothing was ever uploaded) and re-verify.
- **App.tsx backups made this session:** `App.tsx.bak-20260720-194500` (pre-rAF-fix).
  Earlier backup `App.tsx.bak-20260720-103345` also exists.
- Website/Play distribution state unchanged from the morning handoff
  (website 1.3.21/45, Play 1.3.0/24, nothing from 1.3.22 uploaded).

## 3. Diagnostic tooling built (reusable)

- **CDP loop for the on-phone WebView** (needs a build with WebView debugging on):
  ```
  adb shell "cat /proc/net/unix | grep -a devtools_remote"   # find socket + pid
  adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>
  node F:/hlooo/tools/webview-cdp.mjs "<js expr>"            # node ≥22, global WebSocket
  ```
  `tools/webview-cdp.mjs` = minimal Runtime.evaluate driver (persisted this session).
  **GOTCHA:** the app must be FOREGROUND — Android 16 freezes cached processes
  and the CDP call hangs silently until it's fronted (`adb shell am start …`).
- **`window.__diag` probe** (injected JS, not in the repo): records 8ms-timer
  gaps, rAF gaps, long tasks, each tagged with ms-since-last-touch. Re-inject
  from the conversation/memory pattern if needed again.

## 4. Next up (user's call, in this order)

1. **Longer play-testing** of the current phone build (nothing else pending on the bug).
2. **Phase 3a — native gyro injection** (queued for the 1.4 cycle, design agreed):
   - Kotlin `onSensorChanged` (already on its own HandlerThread) → new JNI
     `nativeUpdateGyro(rollDeg, pitchDeg)` → two `std::atomic<float>` in
     gamepad-engine.cpp (~200 Hz).
   - JS pushes gyro CONFIG only on change (on/off, mode racing/3d, sensitivity,
     deadzone, tilt-throttle, calibrate zero) via a new bridge method.
   - C++ TX thread applies gyro→stick math (same formula as App.tsx ~line 1016,
     incl. sign conventions: racing lsX = clamp(lsX − gx), throttle lsY − gy;
     3d rsX − gx / rsY + gy) at send time **before** the changed-detection memcmp
     so tilt alone triggers sends.
   - JS keeps reading tilt only for the visual bar + full-lock haptic; must STOP
     applying gyro to the packet when native mode is active (double-apply guard).
     USB-debug WebSocket mode bypasses the native engine → JS keeps applying
     gyro there.
   - Behind a feature flag; A/B with the GPM harness. Wire format/PC untouched.
   - Why still worth it: the rAF fix depends on scheduler behaviour we don't
     control (varies by Chromium/OEM), ties gyro cadence to display Hz (16.7 ms
     on 60 Hz panels), and Phase 3a decouples input from the WebView entirely —
     same separation as Phase 3 (native touch) in the morning handoff.
3. **Store rebuild + uploads** when the user green-lights (see §2 stale-artifact note).
4. Everything else from the morning handoff §6 (resizeableActivity, Phase 2 scope,
   website must serve the `-direct.apk`).

## 5. Gotchas confirmed/added this session

- All morning-handoff §4 gotchas still apply (wire format, App.tsx CRLF/NBSP zone
  ~2660–3478, asset copy before APK builds, no VCS in apps/, D-pad 4-way, etc.).
- `useGyro` region (App.tsx ~527–730) is CLEAN (LF, no NBSP) — Edit tool safe there.
- Chromium defers DOM timers ~100 ms around taps **on this device** — never put
  anything latency-critical on `setInterval`/`setTimeout` in the controller UI.
  rAF survived (p95 8.4 ms) and is the acceptable JS-side scheduling primitive;
  native is the real answer.
- `React.memo` comparators in Widgets.tsx intentionally ignore function-prop
  identity — if a widget ever captures per-render state in `dn`/`up` closures,
  revisit those comparators.
