# GamepadOS — Latency, Thermal & Sustained-Performance Audit

**Date:** 18 August 2026 · **Basis:** source crawl of `gamepadadmin01-tech/HP` (controller-ui, android-client, pc-server-rs) + the repo's own measurement docs.

**Evidence tags used throughout — nothing is stated without one:**

| Tag | Meaning |
|---|---|
| **[M]** | **Measured** on-device by you, with a date and a source doc |
| **[C]** | **From code** — I read the line; it says what it says |
| **[D]** | **Doc-claimed** — asserted in your docs, not independently verified |
| **[E]** | **Engineering estimate** — my reasoning, explicitly not a measurement |
| **[?]** | **Not determined** — needs work to answer |

**No latency number in this document was invented.** Where I had no number, I say so.

**Not covered:** §13 and §14 (competitor research and the comparative benchmark table). You stopped that work twice, so it wasn't run. Everything else is here.

---

## 1. Executive Summary

Your input path is genuinely well engineered at the bottom and leaky at the top. The C++ TX thread, the wire protocol and the Rust server are tight, deliberate and in several places better than they need to be. Almost every remaining problem is in the WebView layer and in things that run *regardless of whether anyone is playing*.

**The five findings that matter:**

**1. Your own measurements already located the bottleneck, and the fix is only half-deployed.** [M] The WebView hop was 6.8 ms avg / 15 ms p95 / 25.8 ms max — 78% of a ~8.75 ms one-way path, and 2.7× the entire network round trip. Phase 3's native overlay cut that to 1.6–1.9 ms avg / 3–5 ms p95. But the native path **has never been played on**: *"nobody has played a game on it"* — release gate since 2026-07-21. Two input paths now exist, both live, and the fast one is unvalidated.

**2. Three timers send packets nobody asked for, and one of them fires ~333 times a second.** [C] The `usbWS` Blob worker re-blasts the latched 20-byte frame on a **3 ms `setInterval`** — that is your "~250 pkt/s" ghost, and the code says 333/s. It also **rewrites the timestamp on every blast**, which defeats the server's staleness check and poisons the RTT badge. B0 fixed the *screen gate* for this path in 1.3.23; your own checklist records the **UDP path still has the same hole ungated** — Wi-Fi users hold a virtual pad from every screen.

**3. The controller UI violates your own rule B4, in the file B4 was written about.** [C] `setInterval(() => sendTelemetryRef.current(), 16)` is the JS heartbeat. B4 states the rule — *"nothing latency-critical on `setInterval`/`setTimeout` in the controller UI"* — and backs it with a measurement: [M] Chromium defers DOM timers **90–160 ms around each tap, 399 holes in 762 taps**. So the heartbeat has holes precisely when the user is tapping.

**4. The gyro `requestAnimationFrame` loop never stops, and it sends a packet every frame.** [C] It runs unconditionally for the effect's lifetime, does a `JSON.parse` of a bridge string per frame, and calls `sendTelemetry` per frame. On a 120 Hz panel — which the app **pins itself to** via `preferredDisplayModeId` [C] — that is 120 JSON parses and 120 extra sends per second, whether or not the phone is moving. Idle detection suppresses the gyro's *contribution* but does not stop the loop.

**5. Nothing in the codebase looks at thermals.** [C] No `getCurrentThermalStatus`, no `addThermalStatusListener`, no `getThermalHeadroom`, anywhere. The only thermal-driven decision on record is a negative one: *"NO CPU-core pinning (deliberately removed for thermals — do not add)"* [D]. For a product whose selling point is long sessions on a phone that is simultaneously running a 120 Hz display, a full-rate gyro, a Wi-Fi low-latency lock and a WebView, that is the single largest blind spot in this audit.

**And one that will bite the subscription release specifically:** the capability-ticket design in BILLING_DECISIONS §2.4 says the phone forwards the ticket *"over the existing TCP control channel"*. [C] **There is no TCP control channel on the Wi-Fi path.** The Android native engine creates exactly one socket, `SOCK_DGRAM`. The only TCP is a loopback WebSocket reachable via `adb reverse` — USB-debug only. The ticket design as written cannot ship to the users it is meant to police. Details in §19.

**What is genuinely good, and should not be "optimised":** the C++ TX thread is event-driven off a condition variable with a 2 ms ceiling and sends only on change — no fixed-rate spin [C]. The plain-UDP send path does **zero heap allocation** [C]. `SCHED_FIFO` with a `nice -19` fallback, DSCP-EF tagging and `SO_PRIORITY` are all correct [C]. Sticks bypass React entirely and write the knob transform straight to the DOM [C]. The Rust server coalesces to the newest frame per source, dedups identical reports before touching ViGEm, and carries its own p50/p95 histogram [C] — handle time avg 66.6 µs, p95 129.5 µs [M].

---

## 2. Current Input-to-Game Pipeline

Your diagram was close but wrong in three ways: there are **two** input paths, **three** transports, and the shipped PC server is **Python, not Rust**.

### Path A — native overlay (default ON since Phase 3) [C]

```
Finger
  → NativeInputEngine.kt  (invisible overlay View above the WebView)
       hit-test against pad geometry published by JS
       state + gyro merge in Kotlin
       build 20-byte payload into a REUSED ByteArray          ← UI thread
  → MainActivity.injectPayload → JNI injectNativePayload
       lock(payloadMutex) → copy into single-slot currentPayload → notify CV
  → txThreadLoop (pthread, SCHED_FIFO min+1)                  ← dedicated RT thread
       stamp timestamp + authToken, LE-convert
       gate: changed || heartbeat || redundant
       [optional] JNI upcall → Kotlin grxSeal → AES-128-GCM → 41 bytes
       send()/sendto() MSG_DONTWAIT
  → UDP :7777
  → pc-server (Python, SHIPPED) or pc-server-rs (Rust, NOT shipped)
       drain-to-newest per source IP → decode/decrypt → dedup → ViGEm
  → ViGEmBus → virtual Xbox 360 pad → game
```

### Path B — JS/WebView (legacy, still live, escape hatch `__setNativeInput(false)`) [C]

```
Finger
  → React onPointerDown/Move (synthetic pointer events, touch-action:none)
  → useStick / useHeld / setLtFill → write ref → sendTelemetryRef.current()
  → sendGamepadTelemetry(): fill a REUSED 20-byte ArrayBuffer via DataView
  → usbWS.send(buffer)  [WebSocket path]   or   window.sendGamepadPacket(buffer)  [JSI]
  → @JavascriptInterface sendGamepadPacketNative(base64) → Base64.decode → injectNativePayload
  → (same TX thread from here)
```

### The three transports [C]

| Transport | Socket | Auth | Coalesced server-side? | Measured RTT |
|---|---|---|---|---|
| **UDP / Wi-Fi** | `SOCK_DGRAM` :7777, broadcast → unicast lock-on | authToken, or GRX AES-128-GCM | Yes (`upsert`, newest per IP) | ~10 ms [M] |
| **UDP / USB tether** | same | same | Yes | 2.5 ms [M] |
| **WebSocket via `adb reverse`** | TCP loopback :7777 | **none** (trusts loopback) | **No** — every frame hits `apply_packet` | 5–6 ms [M] |
| *(AOA accessory)* | `write()` on fd | none, no GRX | n/a | rejected, ~1–2 ms gain [D] |

**Frame:** 20 bytes, `<Q H B B B B B B I` little-endian — ts(8) buttons(2) lt(1) rt(1) lsX lsY rsX rsY(4) authToken(4). GRX wraps it as version(1) + counter_low32(4) + ciphertext(20) + tag(16) = 41 bytes [D, byte-exact spec].

**Send cadence** [C, corroborated D]: event-driven. Input change → CV wake → send **within microseconds**, repeated **3×** (`CHANGED_PACKET_REDUNDANCY`) at ~2 ms spacing. Idle keep-alive **33 ms (~30 Hz)**; **16 ms (62.5 Hz)** while rumble is active. RX drained every ≤2 ms.

> ⚠️ **The "1000 Hz native send thread" in `LOW_LATENCY_GUIDE.md` is false.** Your own memory doc says so explicitly: *"**Not 1000 Hz / SCHED_FIFO despite what ARCHITECTURE.md says**"* [D]. Three docs still repeat it, including the user-facing one. It is ~30 Hz idle / send-on-change. **This is a marketing-claim risk as well as a documentation bug.**

---

## 3. Latency Breakdown

### 3.1 What has actually been measured [M]

Instrumented via `adb logcat -s GPM:I`, toggle `window.GPM.on`, device `DAIFEYGEKB89V4QG`, app 1.3.22/code 46.

| Segment | avg | p95 | max | Date |
|---|---|---|---|---|
| touch → JS dispatch (Path B) | **6.8 ms** | 15 ms | 25.8 ms | 2026-07-20 |
| JS → native bridge | 0.71 ms | 1.8 ms | 11.2 ms | 2026-07-20 |
| **native touch → handle (Path A)** | **1.6–1.9 ms** | **3–5 ms** | — | 2026-07-21 |
| network RTT, USB tether | 2.5 ms round trip | | | |
| network RTT, USB debugging (WS) | 5–6 ms | | | |
| network RTT, wireless | ~10 ms | | | |
| Rust server handle time | 66.6 µs | 129.5 µs (p95) | — | |
| Rust RTT after drain fix | median ~2.57 ms, floor 1.95 ms | | | |
| Python RTT | ~3.3 ms (2.64–3.85) | | | |

Derived one-way, Path B: **≈8.75 ms**, of which the WebView hop is **78%** [M].

### 3.2 ⚠️ The 3.7× figure is not stable across your own documents

| Source | "After" figure | Implied ratio |
|---|---|---|
| `context/memory/project_realtime_latency_stack.md` | 1.6–1.9 ms avg / p95 tail cut ~3× | **3.7×** |
| `REGRESSION_CHECKLIST.md` C1 | avg≈1.6–1.9 ms, p95≈3–5 ms | 3.7× |
| `SESSION_HANDOFF_2026-07-20C-phase3.md` | **~2.9 ms avg / 6 ms p95**; one window `avg=3.83 p50=2.00 p95=14.00 max=18.00`; called *"approximately a 50% reduction"* | **2.3×** |

Same phone, consecutive days. The 3.7× is the **second-day re-measurement**; day one gave 2.3×. **Do not put 3.7× in marketing.** It is one number from one session on one unnamed device, and your own handoff from the previous day disagrees with it. §15 proposes what to do instead.

### 3.3 The full model, with what is and isn't measurable today

| # | Stage | Path A | Path B | Measurable now? |
|---|---|---|---|---|
| 1 | Digitiser → MotionEvent | included in "touch→handle" | included in "touch→JS" | ✗ — needs external hardware |
| 2 | Android input dispatch → overlay | ↑ | — | ✗ separately |
| 3 | WebView → JS handler | — | **the 6.8 ms** [M] | ✓ GPM |
| 4 | Handler → payload built | **1.6–1.9 ms** [M] | ~0.7 ms bridge [M] | ✓ GPM |
| 5 | Inject → CV wake → TX thread | [?] | [?] | ✗ — no instrumentation |
| 6 | GRX seal | [?] | [?] | ✗ |
| 7 | `sendto` → wire | \_\_\_\_\_\_ | \_\_\_\_\_\_ | ✗ |
| 8 | Network | 2.5 / 5–6 / 10 ms RTT [M] | same | ✓ ACK RTT (but see below) |
| 9 | PC receive → decode → inject | 66.6 µs avg [M] | same | ✓ Rust histogram |
| 10 | ViGEm → XInput → game poll | [?] | [?] | ✗ |
| 11 | Game render → photons | [?] | [?] | ✗ — needs a camera |

**Stages 5, 6, 7, 10 and 11 have never been measured.** Stage 8's RTT is a round trip on one clock, which is the right way to do it — but it is **not** input latency, and two things corrupt it today: [C] the WS worker rewrites the timestamp on every 3 ms re-blast so the RTT reflects blast age not input age; and [D] A7 notes ACKing a stale frame *"reports its queue time and poisons the badge"*.

**[E] Engineering estimate of the honest end-to-end today**, Path A over 5 GHz Wi-Fi, stated as a range because stages 1/10/11 are unmeasured: touch→handle 1.6–1.9 ms [M] + network one-way ~5 ms [M, half of 10] + server ~0.07 ms [M] + digitiser, ViGEm, XInput poll and render **unknown**. XInput and render alone are plausibly 8–20 ms. **So "finger to photons" is very likely 15–30 ms, and nobody has measured it.** Your own `LOW_LATENCY_GUIDE` quotes 10–18 ms for tuned 5 GHz — that is a target, not a measurement, and it likely excludes stages 10–11.

---

## 4. UI / WebView Performance Analysis

This is where the cost is. Entry is `src/main.tsx` → `src/app/App.tsx` (~4600 lines, deliberate monolith).

### 4.1 What is right

- **All input is React synthetic Pointer Events with `setPointerCapture`** — no touch/pointer double-binding [C].
- **No `preventDefault` in handlers**; default suppression is declarative via `touch-action: none` in CSS and `index.html` [C]. Correct — it keeps handlers cheap and avoids passive-listener warnings.
- **Zero throttle/debounce/rAF batching between pointer event and send** [C]. The chain is fully synchronous: `onPointerDown` → ref write → `sendTelemetry` → 20-byte DataView → transport. That is exactly right for latency.
- **The 20-byte `ArrayBuffer` + `DataView` is allocated once and reused** [C]. No JSON in the input path at all.
- **Sticks trigger zero React re-renders** [C] — all `useRef`, knob moved by direct `knobRef.current.style.transform`. This is the single best decision in the UI.
- **framer-motion is not used on the controller screen** [C] — it is imported in `App.tsx` but appears only in `FeatureIntroOverlay` and `Dialogs`.
- All four widgets are `React.memo` with hand-written comparators that check `held.has(id)` rather than `Set` identity [C].

### 4.2 What costs

**(a) Triggers re-render React on every pointermove.** [C]
```js
const setLtFill = useCallback((v) => { ltFillRef.current = v; sendTelemetryRef.current(); setLtFillState(v); }, []);
```
`TriggerPillBase.onPointerMove` calls this unconditionally while held. An analog trigger drag drives a **full `ControllerScreen` render pass per move event** — 60–120+ Hz. `TriggerPill`'s memo comparator includes `p.fill === n.fill`, so the moving trigger itself always re-renders too. Sticks got the ref treatment; triggers did not.

**(b) Buttons allocate a new `Set` per press and per release.** [C] `setHeld(new Set(heldRef.current))` — new identity every time, `held` passed to every widget. The memo comparators absorb it, but `ControllerScreen`'s own render function still runs top-to-bottom on every press *and* every release.

**(c) `setHudTelemetry` allocates a 20-element hex-string array per send.** [C]
```js
Array.from(bytes).map(b => b.toString(16))   // inside sendGamepadTelemetry
```
Guarded by `!jsiSend` — so it is off when the native bridge exists, on in browser/preview. [?] I could not find JSX consuming `hudTelemetry` in the readable region; if it is dead state, this is pure waste at 62.5 Hz+.

**(d) A forced layout read on every stick move.** [C] `useStick.onMove` → `toSVG()` → `svg.createSVGPoint()` + `svg.getScreenCTM()` + `m.inverse()` + `matrixTransform`. `getScreenCTM()` is a layout read. Per pointermove, per stick. The CTM only changes on resize/orientation.

**(e) `console.error` inside the send path.** [C]
```js
try { jsiSend(buffer); } catch (err) { console.error("Native sendGamepadPacket failed:", err); }
```
A persistently failing bridge logs at full send rate. And [C] `vite.config.ts` has **no `esbuild.drop`, no `drop_console`** — console statements ship to production. Your own B9 notes JS logs don't reach logcat without the GPM bridge, so these cost the string formatting and give you nothing.

**(f) The gyro rAF loop is the largest continuous JS cost.** [C] Detailed in §11.

### 4.3 Do UI rendering and input processing compete? Yes, and you have measured the symptom

They share the WebView's main thread. Two documented consequences:

1. [M] **B4**: Chromium defers DOM timers **90–160 ms around each tap** — 399 holes in 762 taps. rAF is not deferred. Your 16 ms heartbeat is a DOM timer.
2. [M] **Known residual on Path A**: *"occasional p95 spike (~14–18 ms) when the UI thread is busy — the first lever is thinning the per-frame `__nvis` visual mirror."* The native overlay builds input off the WebView thread, but it still pushes visuals **back into JS every frame**, and that push is what spikes p95.

So even on the native path, UI work still contaminates input latency — via the visual mirror, not the input itself.

### 4.4 Does the glassy UI cost meaningful performance?

**On the controller screen: less than you would fear, but not nothing — and one rule has a hole.**

- [C] `liquid-glass-trial.css` sets `--lg-blur: 22px`, applies `backdrop-filter: blur(22px) saturate(180%)` to fixed chrome and `blur(30px)` to modals.
- [C] **Explicit gameplay carve-outs exist** and are well written: `absolute` and `pointer-events-none` descendants inside a `fixed inset-0` container get `backdrop-filter: none !important`, plus a `prefers-reduced-transparency` kill switch. Someone thought about this.
- ⚠️ [C] **The carve-out has a gap.** `ControllerScreen`'s root **is** `fixed inset-0`, and the modal rule matches *direct rounded children* of any `fixed inset-0` container. A direct `rounded-*` child of the controller root would get `blur(30px)` — a full-screen-adjacent backdrop blur on the gameplay surface. [?] Whether such a child exists needs a DevTools check on a real device.

**The real GPU cost on the pad is SVG filters, not CSS glass.** [C]
```xml
<filter id="padPhong" x="-25%" y="-25%" width="150%" height="150%">
  <feGaussianBlur stdDeviation="2.4"/>
  <feSpecularLighting surfaceScale="3.2" specularConstant="0.9" specularExponent="24">
    <fePointLight x="-30" y="-60" z="110"/>
  </feSpecularLighting>
  <feComposite .../><feComposite operator="arithmetic" .../>
</filter>
```
Plus six inline `filter: blur()` layers on gameplay widgets: `blur(12px)` button glow, `blur(6px)` held shimmer, `blur(3px)` stick neon ring, `blur(14px)` trigger glow, `blur(3px)` and `blur(4px)` trigger wave crests.

⚠️ [C] **`ripple` transitions animate SVG `r`** — `transition: r 0.5s ..., opacity 0.54s`. Your own **B7 says: *"Never CSS-transition SVG geometry — `x/y/width/height` for a finger-tracked value lags/sticks on the phone WebView."*** `r` is geometry. It is not finger-tracked, so it is not the exact B7 case, but it is the same class: a non-compositable property animated on the gameplay surface, up to 4 concurrent ripples, each with two nested rAFs and a 540 ms cleanup timer, spawned **per button press**.

**[C] No `will-change`, no `contain`, no `isolation` anywhere** — so the compositor has no hints about which layers are dynamic.

**A stale document to ignore:** `performance-optimization-notes.md` claims *"Glow filters on button presses consumed 30-40% GPU"*. It describes a **952-line single file with Material-UI, Recharts and React DnD** — none of which exist in the current `package.json` (React 18.3.1, framer-motion, lucide-react, Tailwind 4, Vite 6.3.5). **That audit is of a different, older variant. Its numbers do not apply.** [E] I flag it because it is the kind of document that gets cited later as if it were current.

---

## 5. Frame Pacing

### What the app does [C]

```kotlin
lp.preferredDisplayModeId = best.modeId
lp.preferredRefreshRate  = best.refreshRate     // maximum available mode
window.addFlags(FLAG_KEEP_SCREEN_ON)
setLayerType(View.LAYER_TYPE_HARDWARE, null)
```

It **pins the window to the phone's maximum refresh mode, unconditionally**, and keeps the screen on for the whole Activity — not just during a session.

### Why that is a double-edged decision

Higher refresh reduces the display's own contribution to latency. But **the gyro rAF loop runs at display rate** [C], so pinning 120 Hz means 120 `JSON.parse` calls and 120 `sendTelemetry` calls per second instead of 60. **The refresh-rate choice directly multiplies the app's CPU, packet and battery cost.** Nothing in the code trades this off.

| Target | Frame budget | Feasible for this UI? |
|---|---|---|
| 60 FPS | 16.67 ms | [E] Yes comfortably — the pad is static SVG between events |
| 90 FPS | 11.11 ms | [E] Likely, on mid-range and up |
| 120 FPS | 8.33 ms | [?] Unverified. The rAF loop's per-frame `JSON.parse` + 2 transform writes + a packet send must fit in 8.33 ms **alongside** React renders from trigger drags |

**Average FPS is the wrong metric here and you already have the evidence.** [M] B4's 399 timer holes in 762 taps and the [M] 14–18 ms p95 spikes are both tail events invisible in an average. The number that matters for a controller is **P99 frame time and the frequency of >2-frame stalls**, because a single 33 ms stall during a fight is what a user reports as "it lagged".

**[?] Never measured:** dropped frames, long frames, P90/P95/P99 frame time, jank rate, frame-time variance. No `JankStats`, no `FrameMetrics`, no `dumpsys gfxinfo` capture anywhere in the repo.

---

## 6. CPU Analysis

### Continuous CPU consumers during a session

| Period | Component | Work per tick | Essential? |
|---|---|---|---|
| **3 ms (~333/s)** | `usbWS` Blob worker `setInterval` [C] | rewrite timestamp + `ws.send(41B)` | ❌ **No** — see §17 P0-1 |
| **≤2 ms (500/s)** | C++ `txThreadLoop` CV timeout [C] | wake, check flags, drain RX | ⚠️ Partly — 2 ms is for RX drain; sends are gated |
| **every frame (60–120/s)** | gyro rAF [C] | `JSON.parse` + 2 DOM writes + `sendTelemetry` | ❌ Not when gyro is idle or off |
| **16 ms (62.5/s)** | JS heartbeat `setInterval` [C] | build + send 20 bytes | ⚠️ Redundant with the native 33 ms keep-alive |
| **33 ms (30/s)** | native keep-alive [C] | send 20 bytes | ✅ Yes |
| **33 ms (30/s)** | rumble poller [C] | `getRumbleState()` string split/parse | ⚠️ Could be push |
| **hardware rate** | gyro `SENSOR_DELAY_FASTEST` [C] | rotation matrix, remap, atan2, asin, 2 filters, → packet build | ❌ Over-sampled — see §11 |
| **50 ms** | Rust WS rumble pump [C] | poll atomics | ✅ |
| **100 / 150 / 500 ms** | Dialogs ad tick, network telemetry poll, latency HUD [C] | `JSON.parse` + setState | ⚠️ Should not run on the controller screen |
| **500 ms** | native-input `transportPoll` [C] | activate/deactivate check | ✅ |
| **1500 ms** | USB tether watcher [C] | `isUsbTetherActive` + `evaluateJavascript` | ⚠️ Runs app-wide, forever |
| **1 s / 5 s** | Rust idle tick / tether detect [C] | takes the server mutex | ⚠️ Contends with the input path |

### Unnecessary CPU wakeups — the summary

[C] On the WS/USB path, with a finger completely still, the phone performs **~333 socket sends + ~120 JSON parses + ~62 heartbeat sends per second**. The native engine's own design target is 30 Hz. **The JS layer is doing roughly 15× the work the native layer was designed to need.**

### Allocation churn on hot paths [C]

- **JSI bridge:** `Base64.decode(...)` allocates a fresh 20-byte array **per packet**, on the WebView JavaBridge thread. `sendGamepadPacketL1` allocates via `toByteArray(ISO_8859_1)` likewise.
- **GRX seal, per sent frame, on the SCHED_FIFO thread:** nonce array + AAD array + `GCMParameterSpec` + `doFinal` output (36 B) + `ByteBuffer.allocate(41)` + `.array()` + two JNI `jbyteArray`s. That is ~8 allocations per frame **on a real-time-priority thread**. Your docs already flag the class of problem — *"Do NOT seal on ticks that don't send (that was a fixed perf bug — sealing is AES-GCM + allocations)"* [D] — but the per-send allocations remain.
- **`NativeInputEngine.buildAndInjectLocked`:** `radialDeadzone` returns a `Pair<Float,Float>`, destructured twice → **two `Pair` allocations per built frame** on the UI thread.
- **Rust, per input packet:** `addr.ip().to_string()` in `handle_datagram`, then `key.to_string()` again in `apply_packet` — **two `String` heap allocations per packet**, plus `aead.decrypt()` returning a fresh `Vec`. At 30 Hz irrelevant; at 333 Hz from the WS path it is ~1000 allocations/sec on the receive thread.
- **Rust, per batch:** `set_nonblocking(true)` then `(false)` — two `ioctlsocket` syscalls per received batch.

### Thread priority [C]

Only **one** priority call exists in the whole Android client: `SCHED_FIFO` min+1 on `txThread`, falling back to `nice -19`. **`Process.setThreadPriority` appears nowhere.** The `gyro-sensor` HandlerThread runs at default priority and, when the native path is active, **builds and injects packets** — so packet production for gyro sits on a default-priority thread while transmission sits on a real-time one.

---

## 7. GPU Analysis

[C] Confirmed on the gameplay surface: the `padPhong` SVG filter chain (`feGaussianBlur` 2.4 + `feSpecularLighting` + 2× `feComposite`), three gradients, six CSS `blur()` layers (3–14 px), animated SVG `r` on ripples, and inline transitions on `transform`/`opacity`/`stroke`/`fill`.

[C] Confirmed *off* the gameplay surface by explicit carve-out: `backdrop-filter` on `absolute` and `pointer-events-none` descendants.

⚠️ [C] Confirmed *at risk*: direct `rounded-*` children of the `fixed inset-0` controller root still match the `blur(30px)` modal rule.

**Do I recommend removing the visual quality? No — not yet, and not on this evidence.** [E] The pad is largely static between input events; an SVG filter on a static subtree is rasterised once and reused unless the subtree invalidates. The cost only becomes continuous if something forces repaint every frame — and something does: the ripples, the trigger re-renders, and the gyro's DOM writes. **The right experiment is to measure the filter's cost while those are active, not to delete it blind.** §18 gives the exact method. `PAD_PHONG` is already a boolean [C], so it is an A/B flip, not a rewrite.

**[?] Never measured:** GPU time per frame, overdraw, layer count, repaint regions. No capture exists.

---

## 8. Battery Analysis

**No battery measurement exists anywhere in this repo.** [?] I will not invent numbers. What I can give you is the ranked list of what is drawing, from code, and the one defect that dominates.

### Ranked contributors [E, reasoned from code]

1. **Screen.** `FLAG_KEEP_SCREEN_ON` at Activity level [C] — not scoped to a session — at **maximum refresh rate**, pinned [C]. On any modern phone the display at max brightness and 120 Hz is the largest single consumer, and this app guarantees both for as long as it is open.
2. **Wi-Fi radio.** `WIFI_MODE_FULL_LOW_LATENCY` [C] explicitly disables Wi-Fi power save. Acquired in `connectToPC` **unconditionally — including the USB/accessory path where Wi-Fi is not used at all** [C]. Held for the whole session.
3. **Gyro at `SENSOR_DELAY_FASTEST` with `HIGH_SAMPLING_RATE_SENSORS` and no batching** [C]. This removes the 200 Hz cap on Android 12+; the sensor and its per-sample math run at full hardware rate whenever registered.
4. **The 3 ms WS re-blast** [C] — ~333 radio/loopback transmissions per second, plus a worker thread that never sleeps more than 3 ms.
5. **WebView compositing** at pinned max refresh, with the filter stack above.
6. **CPU wakeups** — the ~2 ms CV timeout keeps the TX thread waking 500×/s even when idle [C].

### The defect that dominates all of them

⚠️ [D, your own checklist B0] **Wi-Fi and tether users still transmit ~30 Hz from every screen.** 1.3.23 gated only the WebSocket path. Verbatim:

> **⚠️ REMAINING HOLE:** the **native UDP engine** (Wi-Fi/tether users) has the same pattern — a ~30 Hz keep-alive resending the last input frame, gated by the transport coordinator, not screen state. **Until then, Wi-Fi users still hold a pad from every screen.**

So for the majority of users, a phone sitting on the dashboard with the app open is: screen on at 120 Hz, Wi-Fi power-save disabled, gyro at full rate, and 30 packets/second going out. **Nobody has measured what that costs.**

### Session model — what to measure, not what I claim

| Session | [?] What is unknown | [E] What is structurally true |
|---|---|---|
| 5 min | drain % | Dominated by screen-on + radio wake |
| 30 min | drain %, whether temperature has risen | Steady-state reached; all consumers constant by design |
| 1 h | first thermal event? | Nothing in the app reduces work as heat rises |
| 2 h | throttle onset | If the SoC downclocks, scheduler jitter rises → p95 input latency rises → **and the app cannot detect it** |
| 4 h | sustained-throughput floor | Free-tier users hit the 1 h quota long before this; Lifetime users do not |

**§16 gives the exact protocol. This is the single biggest measurement gap in the product.**

---

## 9. Thermal / Overheating Analysis

### Current state: nothing [C]

No `PowerManager.getCurrentThermalStatus()`. No `addThermalStatusListener()`. No `getThermalHeadroom()`. No ADPF, no `PerformanceHintManager`. Grepped across the Android client — zero hits.

The only thermal decision on record is a negative one [D]: *"NO CPU-core pinning (deliberately removed for thermals — do not add)."* That was the right call, and it is the only one.

### Why this matters more for GamepadOS than for a normal app

[E] The phone is simultaneously: driving a pinned-max-refresh display, compositing a WebView with a filter stack, running a gyro at full hardware rate, holding Wi-Fi out of power save, and — very often — **charging**, because people plug in during long sessions. That is close to a worst-case thermal profile, sustained for hours, on a device held in two hands that block airflow.

When the SoC throttles, the user does not see "throttled". They see the p95 input spike that your docs already record as *"~14–18 ms when the UI thread is busy"* [M] getting worse, and they report it as lag.

### Recommended ladder — responsiveness protected at every rung

The rule: **never touch the input path.** Everything below trims work that is *not* input.

| `getCurrentThermalStatus()` | Response — none of which touches input |
|---|---|
| `THERMAL_STATUS_NONE` / `LIGHT` | Nothing. |
| `THERMAL_STATUS_MODERATE` | Drop `preferredRefreshRate` to 60. Suspend the gyro rAF when `idle` is true. Stop the ripple spawns. Disable `PAD_PHONG`. |
| `THERMAL_STATUS_SEVERE` | Additionally: reduce gyro sampling from `FASTEST` to `GAME`. Halt all non-input timers (HUD, telemetry poll, ad tick). Consider dimming. |
| `THERMAL_STATUS_CRITICAL`+ | Surface a user-visible notice. Do **not** silently degrade input. |

**Explicitly do NOT:** raise the keep-alive interval, drop `CHANGED_PACKET_REDUNDANCY`, deprioritise `txThread`, or add any conditional to the send gate. Those are the input path.

[E] `getThermalHeadroom(forecastSeconds)` is the more useful of the two APIs here because it lets you act *before* throttling, which is the difference between a smooth ramp-down and a visible stutter. [?] Availability and accuracy vary by OEM and needs device testing.

---

## 10. Sensor / Gyro Analysis

### The configuration [C]

```kotlin
sensorThread = HandlerThread("gyro-sensor").apply { start() }
sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_FASTEST, sensorHandler)
```
Plus `<uses-permission android:name="android.permission.HIGH_SAMPLING_RATE_SENSORS" />`, which **removes the 200 Hz cap on Android 12+**. Sensors: `TYPE_GAME_ROTATION_VECTOR` and `TYPE_ROTATION_VECTOR`. **No `maxReportLatencyUs`** → no batching → every sample is an individual wakeup. Thread priority: **default**.

Per sample: `getRotationMatrixFromVector`, `remapCoordinateSystem`, `atan2`, `asin`, two filter updates, then `nativeInput.onGyroSample()` → takes the coarse `NativeInputEngine.lock` → `buildAndInjectLocked()` → JNI inject.

**So the gyro sample rate is the packet production rate when gyro is on** [C]. `SENSOR_DELAY_FASTEST` on a flagship can be 400–1000 Hz.

### Is idle detection actually reducing workload? Partially — and less than it looks

[C] The Kotlin side computes `gyroRestingFlat` and `buildAndInjectLocked` skips the gyro *contribution*. But:
- The listener is **never unregistered** — the sensor keeps sampling at full rate, and all the per-sample math still runs.
- The **JS rAF loop keeps scheduling** — when `enabledRef.current` is false, `pumpGyro` early-returns but the loop continues, still calling `sendTelemetry` every frame.

**Idle detection suppresses the output. It does not reduce the work.** That is the opposite of what an idle detector is for.

### The JS gyro loop [C]

```js
const render = (ts) => {
  pumpGyro();                                   // JSON.parse(bridge.getGyroscopeDataJson())
  const k = 1 - Math.exp(-dt / GLIDE_TAU_MS);   // GLIDE_TAU_MS = 11
  leftBarRef.current.style.transform  = `scaleX(...)`;
  rightBarRef.current.style.transform = `scaleX(...)`;
  onGyroChangeRef.current();                    // → sendTelemetry, EVERY FRAME
  reqId = requestAnimationFrame(render);
};
```

Three problems, all [C]:
1. **A `JSON.parse` per frame** to move two bars.
2. **A packet send per frame**, on top of the 16 ms heartbeat and the native 33 ms keep-alive.
3. **No gate on the loop itself.**

✅ Correct: `k = 1 - Math.exp(-dt / GLIDE_TAU_MS)` is delta-time based, satisfying your rule B8 (*"A fixed per-frame lerp is a 120 Hz bug"*). Note `GLIDE_TAU_MS = 11` here vs B8's stated 28 ms — [?] worth confirming which is intended.

⚠️ [C] The **web fallback** path registers `deviceorientation` **without an options object, so not passive**, and writes `leftBarRef.current.style.width = ...%` — a **layout-triggering** property, unlike the native path's `scaleX`. And its effect deps are `[maxAngle, deadzone]`, so changing gyro sensitivity tears down and rebuilds the listener and the rAF loop.

### Documented gyro hazard, still open [D]

**B10:** a phone left flat with gyro on measured `roll = -41.2°` against a 45° lock → *"the virtual pad's left stick sat pegged ~92% in one direction, continuously."* Open by design; the framing in your docs is right — *"the condition is not 'bad orientation', it is 'nobody is playing but the pad is still driving Windows'"* — and it is the same root cause as B0.

---

## 11. Haptics Analysis

### Structure [C]

JS `triggerHaptic(strength)` tiers at 30 and 65 → bridge `playHaptic(event)`, else `triggerHaptic(ms)` with 8/12/16 ms, else `navigator.vibrate(ms)`.

Native: `triggerHaptic`, `triggerRumble`, `playHapticWaveform` all marshal to the **UI thread** via `runOnUiThread`. ⚠️ **`playHaptic(event)` does not** — it runs directly on the JavaBridge thread. Inconsistent, and `playHaptic` is the one the hot paths use.

### Rate limiting: none [C]

There is **no cooldown or timestamp gate** on `triggerHaptic`. All limiting is structural (edge-triggering), which mostly works:

- ✅ Button press/release — genuinely once per edge.
- ✅ `TriggerPill` — a comment records the fix: the press haptic fires on pointer-down only, because firing per fill step *"buzzed the whole pull and felt like a vibration, not a button touch."* Matches your rule B6.
- ⚠️ **Stick rim**: `if (onRim && !atRim.current) playHaptic("tick")` is edge-gated but **evaluated inside `onMove`**. A finger oscillating across the 59.5-unit rim boundary re-fires at pointermove rate.
- ⚠️ **Gyro max-angle**: `if (isMax && !lastGyroHitMax.current.x) triggerHaptic(15)` — evaluated **inside `sendGamepadTelemetry`**, i.e. up to 62.5 Hz plus every input event. Edge-latched, but a value dithering at the clamp boundary re-fires.
- ⚠️ `playHapticWaveform` re-parses two CSV strings and allocates two arrays **per call** [C].

### Could haptics cause input delay? [E]

Not through the send path — that is on the TX thread. But `playHapticWaveform` and the `runOnUiThread` variants execute on the **UI thread**, which is also where `NativeInputEngine.handleTouch` builds packets. Vibrator calls are IPC to `system_server`. [E] A burst of haptics during rapid input contends for the same thread that is building input frames — a plausible contributor to the [M] *"p95 spike when the UI thread is busy."* [?] Unmeasured; §18 T4 tests it.

---

## 12. Network Analysis

### Socket configuration — this part is done well [C]

```c
fcntl(O_NONBLOCK); setsockopt(SO_BROADCAST, 1);
setsockopt(IPPROTO_IP, IP_TOS, 0xB8);    // DSCP EF (46) → WMM Voice
setsockopt(SOL_SOCKET, SO_PRIORITY, 6);  // Linux skb prio → WMM AC_VO
// all sends MSG_DONTWAIT
```
DSCP-EF + `SO_PRIORITY` 6 puts frames in the Wi-Fi Voice access category — the correct and often-missed optimisation. Broadcast discovery then **unicast lock-on** with `connect()` so the hot path uses `send()` instead of `sendto()` [C]. No `TCP_NODELAY` needed because **there is no TCP socket natively** — Nagle is not in the picture at all.

Rust side [C]: `SO_RCVBUF`/`SO_SNDBUF` = 1 MiB, `IP_TOS` 0xB8, `SetPriorityClass(HIGH_PRIORITY_CLASS)`. Notably, `winperf.rs` records that **`timeBeginPeriod(1)` was deliberately excluded** because it *"changed nothing measurable"* — correct, since the receive loop is a blocking `recv_from` with no sleep to quantise.

### Packet economics [C]

| State | Frames/sec | Bytes/sec (41 B GRX) |
|---|---|---|
| Idle, native only | 30 | ~1.2 kB/s |
| Idle, + JS heartbeat | ~92 | ~3.8 kB/s |
| Idle, + gyro rAF @120 Hz | ~212 | ~8.7 kB/s |
| **Idle, WS path (3 ms blast)** | **~333** | **~13.7 kB/s** |
| Active input | +3 per change | — |

Bandwidth is trivial in every case. **The cost is wakeups, not bytes** — radio wake, thread wake, and on the Rust side two `String` allocations plus an AES-GCM decrypt per packet.

### Loss, ordering, recovery [C]

- **Redundancy 3× at ~2 ms** — an input change survives two consecutive losses. Good design for UDP; triples packet rate on activity.
- **Ordering by phone timestamp**, not sequence number. `accept_ordering`: `ts >= last_ts` accepted; backwards jump accepted only if > 1 s (clock reset). ⚠️ Interaction: the WS worker **rewrites the timestamp on every 3 ms blast**, so stale re-blasts always look fresh and the staleness guard never fires on that path.
- **GRX replay window** — `u128` mask, tag verified *before* the window advances (correct — a forged high counter would otherwise cause an input blackout).
- **Coalescing**: `upsert` keeps only the newest frame per source IP per drain batch. ⚠️ Intermediate button edges inside one batch are dropped without decode. [D] Docs say `batches drained: avg=` should be ~1.00 at normal load, so this is normally a no-op — but it is the mechanism by which a burst becomes a lost press.
- ⚠️ **The WS path is not coalesced at all** — no `upsert` equivalent, every frame reaches `apply_packet`, and it **skips the auth check**.
- **Recovery**: socket rebuild at 50 ms → ×2 → 1000 ms cap. Pads neutralised at >0.5 s idle, freed at >3 s.
- **No teardown packet, deliberately** — *"an unauthenticated teardown lets any LAN host spoof-kill the session"* [D]. Correct.

### Realistic operating envelope [M where marked, otherwise E]

| Condition | RTT | Verdict |
|---|---|---|
| USB tether | **2.5 ms** [M] | Best available. Wired-class. |
| USB debugging (WS) | **5–6 ms** [M] | Works, but this is the 333 Hz path |
| 5 GHz clean | **~10 ms** [M] | The realistic default |
| 2.4 GHz / congested | [?] | Untested. [E] WMM VO helps, but expect 3–10× worse and heavily jittered |
| Weak signal / retries | [?] | Untested. [E] Redundancy 3× helps loss; nothing helps latency |
| PC on Wi-Fi | [?] | [E] Adds a second contended hop — should be strongly discouraged in the UI |

**[?] The entire poor-network envelope is unmeasured.** For a paid product this is the gap most likely to generate refund requests, because it is exactly the condition a user cannot diagnose themselves.

---

## 13. Competitor Research

**Not performed.** You stopped this twice. Nothing here is invented to fill the gap.

What it would need to establish, when you want it: for each of Monect / DroidJoy / PlayTow / Gamepad++ / Steam Link / open-source equivalents — transport, send rate, injection method, and any published or measured latency, each recorded with what it actually measures, the test environment, the source, and a confidence rating. Plus the physical-controller baseline (gamepadla's measured polling rates, XInput's actual poll behaviour, ViGEm's added cost), which is the bar you are really being judged against.

---

## 14. Competitive Latency Benchmark Table

**Not produced** — see §13. Producing one from unverified numbers would be worse than having none, and mixing metrics that measure different quantities is exactly the error your brief warned about.

---

## 15. Recommended GamepadOS Performance Targets

### Evidence-backed (your own measurements)

| Metric | Value | Source |
|---|---|---|
| Native touch → handle, avg | 1.6–1.9 ms | [M] 2026-07-21 |
| Native touch → handle, p95 | 3–5 ms | [M] 2026-07-21 |
| JS touch → dispatch, avg / p95 / max | 6.8 / 15 / 25.8 ms | [M] 2026-07-20 |
| Network RTT: tether / WS / Wi-Fi | 2.5 / 5–6 / 10 ms | [M] |
| Server handle, avg / p95 | 66.6 / 129.5 µs | [M] |

### Engineering targets — proposed, explicitly not measured

**Touch → handle (phone-side, GPM-measurable today):**

| Band | Median | P95 | P99 |
|---|---|---|---|
| Excellent | ≤ 2 ms | ≤ 4 ms | ≤ 8 ms |
| Good | ≤ 3 ms | ≤ 6 ms | ≤ 12 ms |
| Acceptable | ≤ 5 ms | ≤ 10 ms | ≤ 20 ms |
| Poor | > 5 ms | > 10 ms | > 20 ms |

[E] Anchored on the achieved 1.6–1.9 / 3–5 ms, with P99 set to catch the [M] 14–18 ms UI-thread spike as a *failure*, which it currently is not.

**Network RTT, by transport** — Excellent / Good / Acceptable: tether ≤3 / ≤5 / ≤8 ms; 5 GHz ≤10 / ≤16 / ≤25 ms; 2.4 GHz [?] no basis to set one until measured.

**Frame time on the controller screen:** [E] P95 ≤ 1 frame budget, P99 ≤ 2 frame budgets, zero frames > 4 budgets in a 60 s window.

**End-to-end (touch → photons):** **[?] Set no target until it is measured once.** §18 B3 tells you how. Your `LOW_LATENCY_GUIDE`'s 6–12 ms tether / 10–18 ms Wi-Fi figures are **targets, and almost certainly exclude XInput poll and game render** — publishing them as measurements is the single most likely way to get called out.

### Two documentation fixes that are also risk fixes

1. **Delete "1000 Hz native send thread"** from `LOW_LATENCY_GUIDE.md`, and "SCHED_FIFO 1000 Hz" from `ARCHITECTURE.md`. Your own memory doc contradicts both [D]. It is ~30 Hz idle, send-on-change.
2. **Stop quoting 3.7×.** It is one session, one unnamed device, and the previous day's measurement on the same phone said 2.3×. Quote the absolute numbers with the date instead — they are more impressive and defensible than the ratio.

---

## 16. Current Bottlenecks

Ranked by expected impact on a paying user.

| # | Bottleneck | Layer | Evidence |
|---|---|---|---|
| 1 | 3 ms WS re-blast → ~333 pkt/s, timestamp rewritten each blast | controller-ui worker | [C] |
| 2 | UDP keep-alive not screen-gated — Wi-Fi users hold a pad from every screen | native engine | [D] B0 |
| 3 | Gyro rAF loop unconditional: `JSON.parse` + send per frame | controller-ui | [C] |
| 4 | 16 ms `setInterval` heartbeat — violates B4, deferred 90–160 ms around taps | controller-ui | [C] + [M] |
| 5 | Gyro at `SENSOR_DELAY_FASTEST`, unbatched, idle detect doesn't unregister | android-client | [C] |
| 6 | Max refresh pinned unconditionally, multiplying all rAF work | android-client | [C] |
| 7 | No thermal awareness of any kind | android-client | [C] |
| 8 | Trigger drag = full React re-render per pointermove | controller-ui | [C] |
| 9 | GRX seal: ~8 allocations per frame on the SCHED_FIFO thread | android-client | [C] |
| 10 | `FLAG_KEEP_SCREEN_ON` + `WIFI_MODE_FULL_LOW_LATENCY` unscoped (incl. USB) | android-client | [C] |
| 11 | Base64 decode per packet on the JSI bridge | android-client | [C] |
| 12 | `getScreenCTM()` forced layout read per stick move | controller-ui | [C] |
| 13 | Rust: 2 `String` allocs + `Vec` per packet; 2 syscalls per batch | pc-server-rs | [C] |
| 14 | WS path uncoalesced and unauthenticated on the server | pc-server-rs | [C] |
| 15 | `console.*` ships to production (no `drop_console`), one inside the send path | controller-ui | [C] |
| 16 | Ripples animate SVG `r`; 4 concurrent, 2 nested rAFs each | controller-ui | [C] |
| 17 | `pthread_join` on the UI thread in `stopEngine` | android-client | [C] |
| 18 | `setWebContentsDebuggingEnabled(true)` apparently ungated | android-client | [C] + [D] D4 |
| 19 | Dialogs' 100/150 ms timers can run during gameplay | controller-ui | [C] |
| 20 | `blur(30px)` can reach direct rounded children of the controller root | CSS | [C] |

---

## 17. P0 / P1 / P2 / P3 Priorities

Format per your brief. **Nothing here sacrifices responsiveness for CPU** — where a change could, I say so under Risk.

---

### P0-1 — The 3 ms WebSocket re-blast

**Problem** [C] The `usbWS` Blob worker runs `setInterval(..., 3)` and re-sends the latched 20-byte frame ~333×/s, rewriting the timestamp each time.
**Evidence** Worker source in `App.tsx`; corroborated by [D] A18 (~240 neutral frames/s from a stale preview page) and B0 (~250 identical pkt/s from the dashboard).
**Layer** controller-ui → WS transport → Rust `apply_packet` (uncoalesced).
**Impact** [E] ~10× the intended packet rate; ~1000 allocations/s on the Rust receive thread; continuous radio/CPU wake; **and it corrupts the RTT badge and defeats the server's staleness guard**, because every blast carries a fresh timestamp.
**Verify** Server telemetry `ok=` count with a still finger; expect ~30/s, currently ~333/s. Rust `batches drained: avg=` should stay ~1.00.
**Fix** Blast only on change plus a keep-alive at the native cadence (33 ms), and stop rewriting the timestamp on a re-blast — a resend is the *same* input, and the server is entitled to know that.
**Risk** Low. Redundancy already covers loss. Do not drop below the native keep-alive rate or the pad will neutralise at 500 ms.

### P0-2 — UDP keep-alive is not screen-gated

**Problem** [D] B0's own "REMAINING HOLE": 1.3.23 gated the WS path only. Wi-Fi/tether users transmit ~30 Hz from every screen and hold a virtual pad permanently.
**Evidence** B0 verbatim. Confirmed in code: `inputStreaming` defaults to **`true`** [C], and the log line says *"input streaming OFF — payload latched neutral (keep-alive continues)"*.
**Layer** `gamepad-engine.cpp` + the JS transport coordinator.
**Impact** Battery and thermal cost on every screen for the majority of users; plus the security/UX problem B0 was raised for (Game Bar, Steam overlay reacting to a latched pad).
**Verify** Server telemetry with the app on the dashboard over Wi-Fi: expect no `Controller session +`, no `sessions=`.
**Fix** Gate the keep-alive on `isActive` via the existing JNI pause call. ⚠️ **Mind your own B2 gotcha — never mark an `external fun` `internal`.**
**Risk** Medium. If the gate is wrong, the pad neutralises mid-game at 500 ms. Test the resume path explicitly.

### P0-3 — Gyro rAF loop runs unconditionally and sends per frame

**Problem** [C] The loop never stops; `pumpGyro` does a `JSON.parse` per frame; `onGyroChangeRef.current()` sends a packet per frame.
**Layer** controller-ui.
**Impact** [E] At 120 Hz: 120 JSON parses + 120 sends/s, for two indicator bars. Third-largest continuous consumer after the WS blast and the display.
**Verify** Chrome DevTools Performance over `adb` with gyro on/off and phone still; count rAF callbacks and `JSON.parse` self-time.
**Fix** Cancel the rAF when gyro is disabled or `idle` is true; restart on the next non-idle sample. Decouple the send from the frame — let the native gyro path own packet production (it already does) and let rAF own only the bars. **Keep rAF for the bars — B4 forbids putting them on a timer.**
**Risk** Low if the wake condition is a sensor sample rather than a timer. Do not gate on a `setTimeout`.

### P0-4 — No thermal awareness

**Problem** [C] Zero use of thermal APIs.
**Impact** [E] Sustained sessions throttle silently; the user experiences it as growing input lag, and the app cannot distinguish it from network jitter or explain it.
**Verify** §16 thermal protocol below.
**Fix** The ladder in §9. Non-input work only.
**Risk** Low if you follow the "never touch the input path" rule. **High if you don't** — a thermal handler that throttles the send rate would be worse than no handler.

---

### P1-1 — Replace the 16 ms `setInterval` heartbeat

[C] Violates your own B4, whose evidence is [M] 399 timer holes in 762 taps, deferred 90–160 ms *around each tap*. The native layer already keep-alives at 33 ms, so this JS timer is largely redundant. **Fix:** delete it and rely on the native keep-alive; if JS must re-send, drive it from the existing rAF. **Risk:** low — verify the pad does not neutralise on the JS-only path (`__setNativeInput(false)`).

### P1-2 — Gyro sampling rate and batching
[C] `SENSOR_DELAY_FASTEST` + `HIGH_SAMPLING_RATE_SENSORS`, unbatched, listener never unregistered on idle. **Fix:** measure the delivered rate first (`adb shell dumpsys sensorservice`), then choose the lowest rate that keeps gyro aiming smooth — likely `SENSOR_DELAY_GAME`. Unregister on sustained idle; re-register on resume. **Risk:** medium — gyro *feel* is subjective and this is a paid feature. A/B it; do not ship blind.

### P1-3 — Scope the screen and Wi-Fi locks to an active session
[C] `FLAG_KEEP_SCREEN_ON` is Activity-wide; `WIFI_MODE_FULL_LOW_LATENCY` is acquired even in USB/accessory mode where Wi-Fi is unused. **Fix:** acquire both on controller-screen entry, release on exit; skip the Wi-Fi lock entirely when `key == "usb"`. **Risk:** low. Verify the screen does not sleep mid-game.

### P1-4 — Refresh rate should be a choice, not a constant
[C] Max mode pinned unconditionally, multiplying all rAF work. **Fix:** default to max, drop to 60 under thermal pressure or on a user setting. **Risk:** low. Never let it affect the send path.

### P1-5 — Move triggers off React state
[C] Full `ControllerScreen` render per pointermove during an analog pull. **Fix:** the pattern already in `useStick` — ref + direct DOM write for the fill visual. **Risk:** low; it is a proven pattern in this same file.

### P1-6 — Cut allocations in `GrxCrypto.seal`
[C] ~8 allocations per frame on the SCHED_FIFO thread. **Fix:** preallocate the nonce/AAD buffers and the 41-byte output; use `cipher.doFinal(in, inOff, inLen, out, outOff)` to write in place. `Cipher.init` per frame must stay (GCM nonce uniqueness). **Risk:** medium — this is crypto. **Do not change nonce or counter semantics.** Your GRX test vectors and the 81 conformance tests are the safety net; run them.

### P1-7 — Strip console output from production builds
[C] No `drop_console`; one `console.error` sits inside the send path. **Fix:** `esbuild.drop: ['console','debugger']` in `vite.config.ts`, keeping the GPM bridge for real metrics. **Risk:** none. Verify the GPM channel still logs.

---

### P2 — worth doing after the above

- **P2-1** Cache `getScreenCTM()`; invalidate on resize/orientation only [C].
- **P2-2** Avoid the per-packet `Base64.decode` on the JSI bridge — the native path already avoids the bridge entirely, so this only matters while Path B exists [C].
- **P2-3** Rust: pass `&str`/`IpAddr` instead of two `to_string()` per packet; decrypt into a reused buffer; hoist the `set_nonblocking` pair [C].
- **P2-4** Coalesce and authenticate the WS path server-side [C].
- **P2-5** Remove the two `Pair` allocations in `buildAndInjectLocked` [C].
- **P2-6** Stop `Dialogs`' 100/150 ms timers when the controller screen is active [C].
- **P2-7** Re-gate `setWebContentsDebuggingEnabled` behind `BuildConfig.DEBUG` — your own D4 [C][D].
- **P2-8** Move `pthread_join` off the UI thread in `stopEngine` [C].
- **P2-9** Add an explicit carve-out so no `backdrop-filter` can reach a child of the controller root [C].

### P3 — measure before touching

- **P3-1** `PAD_PHONG` SVG filter — A/B with the flag that already exists; it may be nearly free when the subtree is static.
- **P3-2** The six CSS `blur()` layers — same.
- **P3-3** Ripple `r` transitions — replace with `transform: scale()` only if measurement shows they cost.
- **P3-4** `will-change`/`contain` hints — cheap, but unmeasured benefit.
- **P3-5** `cacheMode = LOAD_NO_CACHE` + `clearCache(true)` — a cold-start cost, not a steady-state one.

---

## 18. Recommended Benchmark Methodology

### A. Phone-side, available today

**A1 — GPM touch→handle.** `adb logcat -s GPM:I`, toggle `window.GPM.on`. Already your only latency instrument. **Change:** log the full distribution (median, P90, P95, P99, max, n) rather than avg/p95. Run ≥1000 taps per condition.

**A2 — Fill in the missing stages.** [?] Stages 5–7 are unmeasured. Add `clock_gettime(CLOCK_MONOTONIC)` marks at: `injectNativePayload` entry, TX-thread wake, post-seal, post-`sendto`. All on one clock, so the deltas are exact. Guard behind a build flag — this is the input path.

**A3 — Frame timing.** `adb shell dumpsys gfxinfo com.gamepad.client framestats` before/after each run; report P90/P95/P99 frame time and count frames > 2 budgets. Optionally add `JankStats`.

**A4 — CPU/memory.** `adb shell top -H -p <pid>` for per-thread CPU (you care specifically about `txThread`, `gyro-sensor`, and the WebView threads), plus `dumpsys meminfo` for allocation growth over an hour.

### B. End-to-end — needs external hardware

**B1 — Packet arrival on the PC.** Wireshark/npcap on the receive interface, or use the Rust server's existing `handle_ns` histogram (already p50/p95/max). This is exact **on the PC's clock only**.

**B2 — Never subtract two clocks.** [E] Phone and PC clocks are not synchronised to millisecond accuracy; NTP on a LAN is not good enough for a 2 ms measurement. Your ACK design is already correct — the phone stamps, the server echoes, the phone computes RTT **on its own clock**. Keep it. But note that RTT ÷ 2 assumes a symmetric path, which Wi-Fi is not, so **report RTT as RTT** and never call it one-way latency.

**B3 — Touch → photons (the number you don't have).** The only defensible method:
1. Point a high-speed camera at the phone screen and the game monitor **in one frame**.
2. Tap a button that produces an immediate, unambiguous on-screen change in-game.
3. Count frames between finger contact and the game's response.
4. ≥100 trials per condition; report median and P95.

[E] Frame rate sets your resolution: 240 fps → 4.17 ms per frame, 1000 fps → 1 ms. **At 240 fps you cannot resolve a 2 ms difference** — adequate for a 20 ms end-to-end number, useless for comparing two builds that differ by 3 ms. Use the phone-side instrumentation for build-to-build deltas and the camera for the absolute headline number.

**B4 — Trigger the touch mechanically** if you want tight variance: a solenoid or a relay-driven conductive contact removes human timing spread. Otherwise expect the finger to dominate the variance.

### C. Fixed test matrix — vary one thing at a time

| Axis | Levels |
|---|---|
| Input path | native (default) · JS (`__setNativeInput(false)`) |
| Transport | USB tether · USB debugging (WS) · 5 GHz · 2.4 GHz |
| PC link | Ethernet · Wi-Fi |
| Gyro | off · on-still · on-active |
| UI | `PAD_PHONG` on/off · glass on/off |
| Refresh | 60 Hz · max |
| Thermal | cold (≥30 min idle) · after 60 min play |

Always report: median, P90, P95, P99, n, device, app version, thermal status at start and end.

---

## 19. Thermal Benchmark

**Protocol.** Same device, same room temperature (record it), same brightness (fixed, not auto), same game, controller screen active throughout. Two runs: **on battery** and **charging** — charging is the realistic long-session case and the worse thermal one.

**Sample at t = 0, 5, 15, 30, 60, 90, 120 min:**

| Signal | How |
|---|---|
| Battery % and current | `dumpsys battery`, `/sys/class/power_supply/battery/current_now` |
| Battery/SoC temperature | `dumpsys battery` (temp), thermal zones under `/sys/class/thermal/` |
| Thermal status | `adb shell cmd thermalservice override-status` to *test* the ladder; read real status via the API once implemented |
| Frame time P90/P95/P99 | `dumpsys gfxinfo … framestats` |
| Per-thread CPU | `top -H -p <pid>` — `txThread`, `gyro-sensor`, WebView |
| Packet rate | server telemetry `ok=` per interval |
| Input latency | GPM run (A1) at each checkpoint |
| Clocks | `/sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq` |

**The number you are looking for:** the first checkpoint at which **GPM P95 rises by >50% over the t=5 baseline**, or CPU frequencies drop below nominal. That is your throttle onset, and it is the number that should drive the §9 ladder's thresholds.

**Also record the do-nothing baseline** — app open on the dashboard, 60 min. Given P0-2, [E] that may not be far below the playing case, and quantifying the gap is the strongest possible justification for fixing it.

---

## 20. Subscription-System Performance Isolation Review

I have the billing backend, so this section is code-based, not speculative.

### 20.1 What billing will actually cost the phone

[C, billing backend] Per session: **one** `POST /api/play/session/start`, **one** `POST /api/play/session/heartbeat` per 60 s (300 s on unlimited plans), **one** `POST /api/play/session/stop`. Payloads are tiny JSON to `supportportal.gamepad.space` — a different host, a different socket, and a different network path from the LAN PC link.

[E] Additive cost: ~1 HTTPS request/minute. Against the ~333 pkt/s the app currently emits on the WS path, this is **noise**. Billing is not going to be your latency problem — the existing timers already are.

### 20.2 ⚠️ The capability-ticket design assumes a channel that does not exist

BILLING_DECISIONS §2.4:
> the phone forwards it over the **existing TCP control channel** (never the UDP input channel)

[C] **There is no TCP control channel on Android.** `gamepad-engine.cpp` creates exactly one socket:
```c
udpSocket = socket(AF_INET, SOCK_DGRAM, 0);
```
The only TCP anywhere is the Rust server's **loopback** WebSocket on 127.0.0.1:7777, reachable only through `adb reverse` — i.e. **USB-debugging users only**. Wi-Fi and tether users have no TCP path at all.

**Consequences:**
- The ticket cannot ride "the existing TCP control channel" for the users it is meant to police.
- Options are: (a) a new frame type on the existing UDP socket — GRX already has `0xE1/0xE2/0xE3` control types and the engine accepts seal output of 1–64 bytes, so a `0xE4` ticket frame fits the existing demux cleanly; or (b) a real TCP control connection, which is new code on both sides and a new failure mode.
- (a) is clearly better. But note [C] the RX drain already dispatches GRX control frames **on the TX thread** via a JNI upcall — adding Ed25519 verification there puts signature verification on the real-time thread. At one ticket per 60–180 s that is fine; it must never become per-packet.

**This needs deciding before PC server 2.0.2 ships**, because §2.5's whole rollout plan depends on 2.0.2 already understanding tickets when the mobile billing release lands.

### 20.3 Where the billing heartbeat can live — and the blocker

[C] **`AndroidManifest.xml` contains no `<service>` element at all.** No foreground service, no `foregroundServiceType`, no `FOREGROUND_SERVICE*` permission. The entire engine lives in the Activity and dies with it.

So the billing heartbeat has nowhere to live today. And per the earlier blueprint work, the service must be type **`connectedDevice`**, not `dataSync` — Android 15+ caps `dataSync` at **6 hours per 24 h**, which is *exactly* your Quarterly daily limit. The wrong type would kill the service at the precise moment the billing logic hits its cap, and the bug would look like a billing fault.

[E] Adding a foreground service is also a **latency-neutral improvement in its own right** — it keeps the app in the Active standby bucket, which protects the existing network path.

### 20.4 Isolation rules the current code already satisfies

✅ Different host, different socket from the LAN link [C].
✅ The billing backend is not on any input path [C].
✅ Existing `fetch` usage is already well-behaved — layout sync is debounced 12 s idle with `[60s, 300s, 900s]` backoff plus jitter; feedback is event-driven on `"online"` [C].
✅ Pre-flight gating happens before gameplay starts, where blocking is acceptable [C].

### 20.5 Isolation risks to design against

| Risk | Why it matters | Rule |
|---|---|---|
| Heartbeat on the UI thread | UI thread already builds input frames (`NativeInputEngine`) | Dedicated IO dispatcher; never main, never `txThread` |
| Entitlement check inside the send gate | Would put an atomic read — or worse — in the hot loop | The gate is `changed \|\| heartbeat \|\| redundant`. **Nothing else may enter it.** |
| Ticket verification per packet | Ed25519 on the RT thread at 30–333 Hz | Verify on receipt of a *ticket*, cache the validity window, never per input frame |
| Billing failure freezing gameplay | Backend down ≠ user cheating | Offline grace, then a graceful end. **Never block input on an HTTP response** |
| Session-start latency | [C] `openSession` does 8–10 round trips in one interactive transaction | Hard timeout (~2 s); fail open into a short grace rather than blocking PLAY |
| Analytics/telemetry added later | The easiest way to undo all of this | Same rule as billing: off the input path, off the UI thread, batched |

---

## 21. Long-Term Performance Architecture

### The boundary, and whether the code respects it

```
REAL-TIME PATH                          NON-REAL-TIME PATH
  digitiser → NativeInputEngine           auth / bearer token
  → JNI single-slot payload                subscription + entitlement
  → txThread (SCHED_FIFO)                  playtime accounting
  → GRX seal → UDP                         billing UI
  → Rust recv → ViGEm → game               layout cloud sync
                                           feedback, analytics
```

**Does the current app respect it? Mostly on the native path, not on the JS path.**

| Boundary rule | Status |
|---|---|
| Input never waits on HTTP | ✅ [C] |
| Input off the UI thread | ⚠️ [C] Transmission yes (`txThread`); **construction is on the UI thread** (`NativeInputEngine`) or the JavaBridge thread |
| No allocation in the hot path | ⚠️ [C] Plain UDP yes; GRX seal ~8 allocs/frame; JSI Base64 per packet |
| No timers driving input | ❌ [C] Three do: 3 ms WS blast, 16 ms JS heartbeat, per-frame gyro rAF |
| Visuals don't contaminate input | ⚠️ [M] The `__nvis` per-frame mirror is the named cause of the 14–18 ms p95 spikes |
| Billing off the input path | ✅ by construction [C] — but see §20.2 |

### Five invariants to hold going forward

1. **The send gate stays `changed || heartbeat || redundant`.** Nothing else is ever added to it — not entitlement, not analytics, not thermal.
2. **Input construction moves off the UI thread**, joining transmission on a dedicated thread. This is the remaining structural fix from Phase 3 and it is what would close the p95 spike.
3. **Nothing latency-relevant runs on a DOM timer** — your rule B4, with 399 measured timer holes behind it. Audit for this on every release.
4. **Every continuous loop has an off switch tied to `isActive`.** The WS blast, the gyro rAF, the sensor listener, the HUD timers. B0 is the same bug three times over.
5. **Thermal and billing may only remove non-input work.** Neither may ever touch the send path, the sensor rate that affects aiming, or thread priorities.

### What "done" looks like

A release you can defend has: one input path (native, gameplay-verified), one keep-alive cadence (30 Hz, screen-gated on all transports), a gyro loop that stops when the phone is still, a thermal ladder that trims visuals rather than input, and a measured touch→photons number with a date and a device next to it.

---

## Final Verdict

**The engineering underneath is better than the numbers you are publishing about it.** The C++ TX thread, the wire protocol, the DSCP/WMM tagging, the Rust server's coalescing and dedup, and the sticks-bypass-React decision are all things most products in this category do not do. Phase 3 was the right call and your own data proves it — 6.8 ms → 1.6–1.9 ms on the segment that was 78% of the problem.

**What is left is not hard, and it is concentrated in one place: things that run when nobody is playing.** A 3 ms timer blasting 333 packets/s, a keep-alive that never learned about screens, a gyro loop that never stops, a screen lock and a Wi-Fi lock that outlive the session, and no thermal awareness at all. Those are the battery and heat story, and none of them requires touching the input path to fix.

**Two things to do before the paid release, in this order.** First, close P0-1 through P0-4 — they are the difference between a phone that gets warm and a phone that gets hot, and a paying user judges that harshly. Second, **play a game on the native path**. It has been the release gate since 21 July, it is default-ON, it replaces the entire input path, and nobody has used it. Every number in this document is downstream of a path that has never been validated in the thing it exists to do.

**And fix the docs.** "1000 Hz native send thread" is in your user-facing guide and is contradicted by your own memory file. The 3.7× is one session on one unnamed device that the previous day's measurement disagrees with. You are about to charge money; the absolute numbers with dates attached are both more honest and more impressive than the round figures currently being quoted.
