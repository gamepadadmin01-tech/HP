# GamepadOS Audit — Verification Round 2

**Companion to `GAMEPADOS_PERFORMANCE_AUDIT.md`. Where they disagree, this file wins.**
Date: 18 August 2026. Same evidence tags: **[M]** measured · **[C]** from code · **[D]** doc-claimed · **[E]** estimate · **[?]** unresolved.

Three targeted crawls: the **shipped Python server** (never read in round 1), the **shipped bundle + native JS bootstrap**, and the **tail of `App.tsx`**. ~70 more files.

---

## 1. Corrections to Round 1 — four things I got wrong

### ❌ CORRECTION 1 — `setWebContentsDebuggingEnabled` **is** guarded

Round 1 flagged this as an open hole (P2-7). It is not. [C]

```kotlin
// Only allow Chrome DevTools to attach to the WebView in debug builds.
// In a signed release this would let anyone with adb invoke every
// AndroidBridge method (connectToPC, exitApp, …) — so gate it off.
if (BuildConfig.DEBUG) {
    android.webkit.WebView.setWebContentsDebuggingEnabled(true);
}
```

**Delete P2-7.** Your own D4 was already actioned. The round-1 agent saw the call without the surrounding lines.

### ❌ CORRECTION 2 — sensors **are** unregistered on background

Round 1 said this was unverified and implied a leak. [C]

```kotlin
override fun onPause() {
    super.onPause()
    sensorManager.unregisterListener(this)
    mainHandler.removeCallbacks(usbWatchRunnable)
}
```

Registration is symmetric in `onResume`. **The gyro genuinely stops when backgrounded.** My §8 battery reasoning was wrong on that point.

### ❌ CORRECTION 3 — the primary bridge is **latin1, not base64**

Round 1 listed "Base64 decode per packet" as P2-2. [C] The injected bootstrap prefers a latin-1 path and only falls back to base64:

```js
var GP_L1 = !!(window.AndroidBridge && window.AndroidBridge.sendGamepadPacketL1);
window.sendGamepadPacket = function(buffer) {
    var bytes = new Uint8Array(buffer);
    if (GP_L1) {
        window.AndroidBridge.sendGamepadPacketL1(String.fromCharCode.apply(null, bytes));
    } else if (…sendGamepadPacketNative) {
        var binary = ''; for (…) binary += String.fromCharCode(bytes[i]);
        window.AndroidBridge.sendGamepadPacketNative(window.btoa(binary));
    }
};
```

Still allocates a String plus a ByteArray per packet, but base64 is dead on any current build. **Downgrade P2-2 to P3.**

### ❌ CORRECTION 4 — the JS timers **are** screen-gated (except one)

Round 1 implied the 16 ms heartbeat and friends ran everywhere. [C] They don't:

```ts
useEffect(() => {
  if (!isActive) return;
  const id = setInterval(() => sendTelemetryRef.current(), 16);
  return () => clearInterval(id);
}, [isActive]);
```

Same `[isActive]` guard on the 200 ms telemetry poll and the 33 ms rumble poll. **The gyro rAF is the exception** — deps are `[maxAngle, deadzone]`, no `isActive`. So P0-3 survives and gets *worse*: it is the one loop that runs on every screen.

---

## 2. Findings that got worse under verification

### ⚠️ The 3 ms worker timer is **never cleared** — it ticks for the app's lifetime

[C] Confirmed exactly `3`:
```js
setInterval(function(){
  if(!enabled){ … return; }
  if(ws && ws.readyState===1){
    if(stream && latest){
      new DataView(latest).setBigUint64(0, BigInt(Date.now()), true);
      ws.send(latest);
    }
  } else if((!ws || ws.readyState>1) && Date.now()-lastTry>1000){ … }
},3);
```

**There is no `clearInterval` anywhere in the module.** `setStreaming(false)` only flips `stream`; `disconnect()` only flips `enabled`. Once `start()` runs, a worker thread wakes **333×/second for as long as the app is open**, on every screen, forever — evaluating branches even when idle.

✅ Confirmed good: `latest = null` on `stream-off`, so B0's actual fix is real.

### ⚠️ Haptics: no rate limit, **and** a `getSystemService` call per vibration

Round 1 called this unverified. Now confirmed on both sides. [C]

JS:
```ts
export function playHaptic(event: string, fallbackMs = 14) {
  if ((window as any).hapticsEnabled === false) return;
  const bridge = (window as any).AndroidBridge;
  if (bridge && bridge.playHaptic) { try { bridge.playHaptic(event); return; } catch {} }
  triggerHaptic(fallbackMs);
}
```
No `Date.now()`, no cooldown, no timestamp ref. Only a global on/off.

Kotlin: `doVibrate` and `playHapticEvent` contain **no** time gate either — the only guard is `triggerRumble`'s amplitude floor (`if (intensity < 1) return`). And **`doVibrate` calls `getSystemService(VIBRATOR_MANAGER_SERVICE)` on every single invocation** — no cached `Vibrator` — then the vibrate IPC, **all on the UI thread**, which is the same thread `NativeInputEngine` builds input frames on.

[E] That is a binder service lookup plus an IPC per haptic, on the input-construction thread, with no limiter. A strong candidate for the [M] *"p95 spike when the UI thread is busy."* Now a **P1**, not a P2.

Also [C]: on pre-amplitude-control devices `doVibrate` synthesises PWM — `period = 16L`, `cycles = (durationMs / period).coerceIn(1, 8)` — i.e. up to 8 waveform entries built per call.

### ⚠️ Backgrounding stops the gyro but **not** the network engine

[C] `stopNetworkNative()` appears only on explicit teardown paths (`cleanupSessionAndReturn`, the USB-retry path). It is **not** in `onPause`. Neither is any lock release:

- `FLAG_KEEP_SCREEN_ON` — **never cleared**. Single `addFlags`, no `clearFlags` anywhere. The comment above it reads `// 1. OLED Blackout & Thermal Optimization`, which is the opposite of what it does.
- `wifiLock` (`WIFI_MODE_FULL_LOW_LATENCY`) and `multicastLock` — released only alongside `stopNetworkNative()`.
- `sensorThread.quitSafely()` — **absent**. The `gyro-sensor` HandlerThread is created once and never quit.

**So a backgrounded, still-paired app keeps: the UDP engine running at 30 Hz, Wi-Fi power-save disabled, a multicast lock held, and a HandlerThread alive.** Only the sensor stops. This is B0's "REMAINING HOLE" confirmed at the lifecycle level, and it is worse than a screen-gating bug — it survives leaving the app entirely.

### ✅ `PAD_PHONG` is `true`, hardcoded, and ships

Round 1 couldn't find the declaration. It isn't in `App.tsx` — it's in `Widgets.tsx`: [C]

```ts
export const PAD_PHONG = true;
const phong = PAD_PHONG ? "url(#padPhong)" : undefined;
```

A bare module `const`. No flag, no env var, no pref. A bundler folds the ternary to the enabled branch, so `feGaussianBlur(2.4)` + `feSpecularLighting` + two `feComposite`s **render on the pad for every user**. §7's GPU analysis stands, and the A/B test in P3-1 is a one-line change.

### ⚠️ `buildNativeGeometry`'s caller does a forced layout per element

[C] The function is pure math. Its call site is not:
```ts
const m = svg && svg.getScreenCTM();
const exclusions = Array.from(document.querySelectorAll("[data-nx]")).map((el) => {
  const r = (el as HTMLElement).getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
bridge.setNativeInputGeometry(JSON.stringify({ matrix: […], dpr, exclusions, widgets: buildNativeGeometry(activePad), … }));
```
`getScreenCTM` + `querySelectorAll` + `getBoundingClientRect` **per match** + `JSON.stringify` of the whole blob. Deps `[isActive, nativeFlag, activePad, windowSize]` — so it re-runs on tab activation, pad switch, **and every resize**, including keyboard show/hide and rotation. Not per-frame, so not a P0; worth knowing it is the cost of every orientation change.

---

## 3. The shipped PC server — Python. This was the biggest gap in Round 1.

Round 1 audited `pc-server-rs`, which your own docs say is **not shipping**. Here is `pc-server/server.py`, ~1500 lines, the one users actually run.

### What it does well [C]

- **Drain-to-newest is real and correct.** Non-blocking socket + `selectors`, 0.2 s select timeout, then a `while True: recvfrom` until `BlockingIOError`, coalescing `latest[ip] = (data, addr)`. Superseded datagrams are never unpacked, never ACKed, never touch the pad. Encrypted frames coalesce the same way, so dropped GRX frames never commit a replay counter.
- **One ACK per newest frame per wakeup**, not per datagram — the thing A8 was written about.
- **Stale frames are not ACKed** — `handle_frame` returns before the ACK. Correct, and it is what keeps the phone's RTT badge honest.
- **Dedup before the driver**: `report == sess.last_report → return`. Identical reports never reach ViGEm.
- **LUTs precomputed at module level**: `_SNAP_LUT` (±4 counts → centre) and `_AXIS_LUT` (byte → float). No per-packet float maths.
- **Socket tuning**: `SO_RCVBUF`/`SO_SNDBUF` = 1 MiB, `IP_TOS = 0xB8` (DSCP EF), non-blocking.
- **`suppress_udp_connreset`** via `WSAIoctl(SIO_UDP_CONNRESET)` — the comment notes `sock.ioctl()` cannot do this and *"is exactly the bug that took down the packaged build."*
- **Telemetry batched every 64 packets** under lock — one of the few places locking is amortised.
- **No `print` in `handle_frame`.** All hot-path logging is edge-triggered and set-guarded.
- `PadSession` uses `__slots__`.

### What it does differently from Rust — and these matter

| | Python (shipped) | Rust (not shipped) |
|---|---|---|
| `timeBeginPeriod(1)` | **YES** — `boost_timer_resolution()` | **Deliberately not** ("changed nothing measurable") |
| Server-side latency stats | **NONE** | p50/p95/max histogram |
| GUI ↔ input-path lock | **Shares `PadManager.lock`** | Explicitly forbidden (A16) |
| `SO_BROADCAST` | not set | not set (Android sets it) |
| Port | scans 7777→7786 | fixed |
| WS path auth | none | none |
| Third transport | **AOA/USB direct** (`aoa_transport.py`) | — |

### ⚠️ The GUI takes a lock the input path takes, every 400 ms

[C]
```python
def refresh():
    count = padmgr.count() if padmgr is not None else 0
    conn_lbl.config(text=f"Connected devices: {count}")
    root.after(400, refresh)
```
```python
def count(self):
    with self.lock:
        return len(self.sessions)
```

`PadManager.lock` is taken by `padmgr.acquire()` **on every accepted packet** on the UDP thread. The tkinter GUI grabs it every 400 ms on the main thread. Both threads run at the same priority (`SetPriorityClass` is process-wide; no per-thread priority is set).

Your Rust server has an explicit automated check forbidding exactly this — A16: *"It must not lock the `Server` mutex — that lock is on the input path… a UI repaint contending for it puts a redraw in the way of gamepad input."* **The shipped server does the thing the unshipped one has a regression test against.** [E] 2.5 contentions/sec on a short critical section is small, but it is a genuine input-path stall and it is trivially avoidable with an atomic counter.

### ⚠️ There is **zero** latency instrumentation on the shipped path

[C] No `time.time()` in the file at all. `perf_counter()` is used only for idle watchdogs. The ACK comment says it plainly: *"Echo send-time so the phone can compute true RTT."* **The server computes nothing.**

So every server-side number in Round 1 — 66.6 µs handle time, p95 129.5 µs, the drain histogram — comes from the Rust build **that isn't shipping**. On the shipped path you have no server-side timing data whatsoever. That is a measurement gap, and it is also the cheapest one to close: the Rust histogram is ~15 lines of Python.

### ⚠️ GRX ships, but cleartext is still accepted, and the return path is unencrypted

[C]
```python
GRX_REQUIRED = False   # flip True once the Android GRX build ships -> drops the
                       # legacy cleartext path (closes the authToken downgrade hole)
```
Your own comment names it a downgrade hole. Also [C]: `GrxServerSession.sender` is **created but never used** — ACK and RMB go out via plain `sock.sendto(b"ACK"…)`. **Return traffic is cleartext even on an established GRX session.**

Not a latency finding, but it is a security finding sitting inside the paid release, and `GRX_REQUIRED` is a one-line flip once the Android side is confirmed.

### ⚠️ The WS and AOA paths bypass every guard

[C] The WebSocket handler unpacks the frame, **discards the auth token into `_auth`**, never consults `last_ts`, and calls `apply_inputs` directly — no coalescing, no ordering check, no authentication. It also takes `telemetry.lock` **twice per message** and calls `perf_counter()` twice, versus one lock per 64 packets on UDP. At the client's 333 Hz blast rate that is ~666 lock acquisitions/sec.

AOA is the same shape — no auth, no ordering.

### Per-packet cost on the shipped path [C]

`struct.unpack` (9-tuple) · `padmgr.acquire()` taking a `threading.Lock` **per packet** · ACK `bytes` ×2 + concat · rumble tuple compare · `report` 7-tuple allocated even when deduped · `GAMEPAD_LOCK` acquire/release · full `reset_gamepad_state()` + 15 button tests + `gamepad.update()` on any change. Plus `recvfrom(1024)` allocating a `bytes` per drained datagram **including discarded ones**, and two fresh dicts per wakeup.

[E] At the intended 30 Hz this is irrelevant. At the WS path's 333 Hz it is ~10k object allocations/sec through CPython's GC, on a thread that also holds the GIL during the ViGEm ctypes call.

**One bug worth flagging:** `ConnectionResetError` in the drain loop does `break`, abandoning the rest of the queue for that wakeup rather than continuing.

---

## 4. What is now confirmed unverifiable — and why that is itself a finding

Three things cannot be read with any tool available here, and the reason is the same in each case.

| Target | Size | Readable |
|---|---|---|
| `assets/dist/index.html` (shipped bundle) | **543,090 B** | ~12% — vendor React only |
| `src/app/App.tsx` | **~255,000 B** (~4600 lines) | ~46% — cuts mid-`TriggerPill` |
| `MainActivity.kt` | **110,357 B** | ~60% — cuts mid-`OneEuroFilter` |

WebFetch has a hard ~100k-character ingest cap. Re-asking with different prompts cannot help — the tail is never in the model's input. jsDelivr truncates at the identical byte. `curl`, the GitHub API, `github.com` HTML and three third-party mirrors are all blocked from this sandbox.

**Still open, and they are the ones I'd most want closed:**

1. **[?] Is `hudTelemetry` rendered?** It is written from `sendGamepadTelemetry` at 60 Hz+ with a 20-element hex-string allocation. Never read in the readable 46%. If dead, that is pure waste at heartbeat rate — one of the cheapest wins available.
2. **[?] Does `ControllerScreen` unmount on tab switch?** Strong circumstantial evidence for **kept mounted and hidden**: it takes an explicit `isActive` prop (pointless if unmounted), the code comment says *"Cleanup **also** fires on unmount"* (framing unmount as secondary), and `SCREEN_EASE`/`SCREEN_DUR = 380ms` imply CSS transitions between screens. Not proven.
3. **[?] Are `premium` / `credits` used?** Confirmed as `ControllerScreen` props with `setCredits: (fn: (c: number) => number) => void` — an updater signature implying in-session decrements. The owning `useState` is in the unreadable root `App`. **A `setCredits` call there re-renders the entire subtree including `ControllerScreen`** — which is exactly the shape the subscription work will add. Worth resolving before wiring billing into the UI.
4. **[?] Do `onStop`/`onDestroy` exist?** Absent from the readable 60%, and `onResume`/`onPause` *are* in that region (lifecycle methods are normally co-located), so absence is likely but unproven. If they exist in the tail, they may contain the cleanup that currently looks missing.
5. **[?] Does the shipped bundle match the current source?** Cannot diff. Everything in §4 of the main audit is from `controller-ui` source, not from what is inside the APK.

**The finding: `App.tsx` at ~4600 lines / 255 KB exceeds the single-file ingest budget of every tool available.** Your docs defend the monolith — *"Splitting into files created prop-drilling nightmares"* — and that is a reasonable call for human authorship. But it is also the file that *"lost 133,000 characters to a bad automated edit"*, and it is now large enough that no automated reviewer can see all of it at once. That is a maintainability cost with a concrete, already-realised failure attached.

---

## 5. Revised priority list

Changes from Round 1 in **bold**.

| | Item | Change |
|---|---|---|
| **P0-1** | 3 ms WS blast, ~333 pkt/s, timestamp rewritten | **Worse — the timer is never cleared, so it ticks for the app's lifetime on every screen** |
| **P0-2** | UDP keep-alive not screen-gated | **Worse — `stopNetworkNative()` isn't called on `onPause` either, so it survives backgrounding** |
| **P0-3** | Gyro rAF unconditional | **Confirmed — the only JS loop without an `isActive` guard** |
| **P0-4** | No thermal awareness | Unchanged |
| **P1-1** | Replace the 16 ms `setInterval` | Unchanged (it *is* `isActive`-gated, still a B4 violation) |
| **P1-2** | Gyro sampling rate / batching | Softened — `unregisterListener` in `onPause` confirmed |
| **P1-3** | Scope screen + Wi-Fi locks to a session | **Worse — never released on background, only on teardown** |
| **P1-4** | Refresh rate should be a choice | Unchanged |
| **P1-5** | Triggers off React state | Unchanged |
| **P1-6** | GRX seal allocations | Unchanged |
| **P1-7** | Strip `console.*` | Unchanged — **and no `vite.config.*` is in the file index at all**, so the build config needs finding |
| **P1-8** | **Haptics: cache the `Vibrator`, add a cooldown, get it off the UI thread** | **NEW / promoted from P2** |
| **P1-9** | **Python server: stop the tkinter GUI taking `PadManager.lock`** | **NEW — Rust has an automated test forbidding it; the shipped server does it every 400 ms** |
| **P1-10** | **Python server: add the Rust histogram (~15 lines)** | **NEW — there is currently zero server-side timing on the shipped path** |
| P2-x | as before | **P2-7 deleted** (already guarded) · **P2-2 → P3** (latin1, not base64) |
| **P2-10** | **`sensorThread.quitSafely()` on destroy** | **NEW** |
| **P2-11** | **Python: authenticate and coalesce the WS/AOA paths** | **NEW** |
| **P3-1** | `PAD_PHONG` A/B | **Now trivial — one `const` in `Widgets.tsx`** |

---

## 6. Honest verification status

| Area | Status |
|---|---|
| Shipped Python server | ✅ Read — receive loop, drain, injection, threading, GRX, WS, AOA |
| Rust server | ✅ Round 1 (not shipping) |
| C++ TX engine | ✅ Round 1 |
| Wire protocol | ✅ Round 1 + Python side confirms it |
| Native JS bootstrap / GPM harness | ✅ Read verbatim |
| Android lifecycle + haptics | ✅ Read — 4 corrections |
| `controller-ui` source | ⚠️ ~46% of `App.tsx`; `Widgets.tsx` and all CSS complete |
| Shipped `dist/index.html` | ❌ 12% — vendor only |
| `MainActivity.kt` tail | ❌ 40% unread |
| Competitor research (§13/14) | ❌ Not started |
| Anything measured on a device | ❌ None. Static reading only. |

**Nothing in the four P0s depends on an unread region** — all four come from lines I have read directly, and three of them got *stronger* this round.

**To close the rest:** either upload the ZIP, or split `App.tsx`. There is no third option — every remote transport is either blocked or capped below the file size.

---

## 7. Round 3 — verification ON THE MACHINE (Claude, 2026-08-18)

Rounds 1 and 2 were static source reads from a sandbox. These checks were run against
the real tree and the real binaries. **Where this section disagrees with the above, this wins**,
and the evidence is reproducible.

### 🔴 CORRECTION — the shipped PC server is RUST, not Python

§3 of this document, and §2 of the main audit, both state that the shipped server is
`pc-server/server.py`. **It is not.** The evidence:

| | Version | Size |
|---|---|---|
| `pc-server/installer/GamepadServer.iss` (Python) | **1.1.17** | 28.0 MB |
| `pc-server-rs/installer/GamepadServer.iss` (Rust) | **2.x** | 8.8 MB |
| **Active release in the Releases panel** | **2.0.1** | **8.8 MB** |

The active build is 2.0.1 at 8.8 MB, which only the Rust installer produces — Python has never
emitted a 2.x version. Confirmed against the admin portal on 2026-08-17 and against the file
metadata of `downloads/GamepadServer-Setup-2.0.1.exe`.

**What this deletes:**

- **§3 in its entirety.** It analyses the documented *rollback* artifact, not the live path.
- **P1-9** ("Python server: stop the tkinter GUI taking `PadManager.lock`") — the shipped Rust
  server has an automated check (A16) *forbidding* this. The audit's own words: "the shipped
  server does the thing the unshipped one has a regression test against." Reversed: the shipped
  server is the one with the test.
- **P1-10** ("zero server-side timing on the shipped path") — the p50/p95 histogram the audit
  credits to "the Rust build that isn't shipping" **is** on the shipped path. The 66.6 µs / 129.5 µs
  numbers are live numbers.
- **P2-11** ("Python: authenticate and coalesce the WS/AOA paths") — AOA was dropped, not ported.

The source of the error is `src/lib.rs`, which still says the Python server "stays the documented
rollback until the Rust build has real-world soak time." True when written; overtaken by the
2.0.0 release.

### ✅ CONFIRMED — the four P0s all hold

| | Check run | Result |
|---|---|---|
| **P0-1** | `clearInterval` count in the worker blob | **0** — the 3 ms timer is never cleared |
| **P0-2** | `onPause` body | only `unregisterListener` + `removeCallbacks`; **no** `stopNetworkNative`, no lock release |
| **P0-2** | `FLAG_KEEP_SCREEN_ON` vs `clearFlags` | **1 add, 0 clears** |
| **P0-3** | gyro effect deps | `[maxAngle, deadzone]` — **no `isActive`**, confirming it is the only ungated loop |

One nuance on P0-1 worth having: the worker targets `ws://127.0.0.1:7777`, the `adb reverse`
transport. For Wi-Fi users the socket never opens, so the 333 Hz tick evaluates two branches and
returns — no packets. The *packet* flood is USB-debugging only; the *wakeup* cost is everyone.
Both are worth fixing, for different reasons.

### 🔴 CONFIRMED and BLOCKING — §20.2 of the main audit is correct

The capability ticket cannot ride "the existing TCP control channel", because there isn't one:

```
Android engine   socket(AF_INET, SOCK_DGRAM, 0)   ← UDP only, two call sites, no TCP anywhere
Rust WS bridge   binds 127.0.0.1 ONLY             ← adb reverse = USB debugging only
Rust UDP         binds 0.0.0.0                    ← where Wi-Fi and tether users actually are
main.rs upsert   drops anything not 20 or 41 B    ← a ticket datagram is silently discarded
```

**PC server 2.1.0 was built with ticket verification in `ws.rs`.** That is the loopback path.
As built, enforcement would apply to USB-debugging users only — precisely not the population it
exists to police. **The 2.1.0 installer must not be uploaded until the ticket moves to UDP.**

The fix the audit proposes is right: demux by length in the UDP receive loop, next to the existing
handshake check. `session_key(addr)` already keys sessions by IP, so per-IP gates map one-to-one.
Cost to the input path is one integer compare — a 20-byte frame fails `n == 96` immediately.

Constraint, from §20.5 and worth restating: **verify on receipt of a ticket, cache the validity
window, never per input frame.** Ed25519 at one-per-60s is free; per-packet would be ruinous.

### ✅ FIXED this session — the three P0s that were real

| | Fix | Verified by |
|---|---|---|
| **P0-1** | The worker's `setInterval(…,3)` became a self-scheduling timer: **3 ms while streaming, 250 ms when idle**, plus a `wake()` so `stream-on` re-arms immediately instead of waiting out an idle delay. ~333 wakeups/sec → 4 when nobody is playing; the streaming path is byte-for-byte unchanged. | worker blob parsed standalone; UI bundle builds |
| **P0-2** | `onPause` now clears `FLAG_KEEP_SCREEN_ON` and releases the Wi-Fi low-latency and multicast locks; `onResume` restores the screen flag. | Gradle `assembleDirectRelease` succeeds |
| **P0-3** | `useGyro` gained an `active` parameter, wired to `isActive` at the call site. The rAF loop no longer exists off the controller screen. `enabled` (the gyro toggle) is kept separate so the bars still glide to rest when gyro is off. | tsc: 11 errors before and after — all pre-existing in `App.tsx` |

**Deliberately NOT done in P0-2:** `stopNetworkNative()` is still absent from `onPause`. It holds the
standing link the PC server expects on every screen, and tearing it down on a notification shade or
an incoming call would drop the session and force a re-pair. That needs the reconnect path
exercised on a real device before it moves.

**`App.tsx` integrity after editing** — checked because this is the file that lost 133,000
characters to a bad automated edit: 5,018 lines / 262,510 bytes, braces 2167/2167, parens
2610/2610, backticks even, pure CRLF. Every edit used a uniqueness assertion on its anchor and
would have refused rather than guessed.

### ❌ CORRECTION — P2-10 is wrong, `onDestroy` does exist

The audit lists `sensorThread.quitSafely()` as absent and `onStop`/`onDestroy` as "[?] likely
absent but unproven". `onDestroy` is at `MainActivity.kt:1946`, in the 40% of the file the crawl
could not reach, and it already does **all** of this: unregisters sensors, `sensorThread
?.quitSafely()`, `stopNetworkNative()`, releases both radio locks, and destroys the WebView.

So **P2-10 is deleted**, and P1-3 was narrower than stated — the locks were released on teardown,
just never on background. That gap is what `onPause` now closes.

### The billing release order, restated after all of the above

1. **PC server 2.1.0** — ticket verification on the UDP path. Built, `cd13c5ef…`, staged.
2. Weeks of soak while it spreads through the normal updater. It is inert until a key is compiled in.
3. The mobile billing release, which is also where these three P0 fixes ship.

**The P0 fixes are NOT in 1.3.28 / code 53.** That build is already uploaded to Play. They are
staged in source for the next version.
