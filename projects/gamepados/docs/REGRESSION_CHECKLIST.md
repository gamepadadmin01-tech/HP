# GamepadOS — Regression Checklist & Bug Register

**Run this after every big change.** Each entry is a bug that ACTUALLY happened,
what caused it, and the exact way to prove it hasn't come back.

## Why this exists

`F:\hlooo\apps\` is **not a git repository** — no version control, no cloud
history, no File History on F:. Timestamped `.bak-` copies are the only rollback.
On top of that, this project's worst bugs are invisible to compilers:

* the JNI crash **compiled cleanly** and only died on the phone,
* the deleted Rust server **built fine** and dropped every packet,
* the double-pad bug needed a specific *sequence* to appear.

So "it builds" proves almost nothing here. This register is the memory that
survives between sessions.

**Rule: when a new bug is found and fixed, add it here in the same session.**
An entry costs two minutes and saves a re-debug later.

---

## Quick run

```bash
# Tier 1 — always. Fast, no hardware needed.
bash F:/hlooo/tools/regression-check.sh --fast

# Tier 2 — adds APK build + PC-server protocol tests.
bash F:/hlooo/tools/regression-check.sh --full

# Tier 3 — on-device, needs the phone attached. Prints a manual checklist.
bash F:/hlooo/tools/regression-check.sh --device
```

Tier 3 items cannot be automated (they are about *feel*). Do not skip them for
input-path changes — that is exactly where automation is blind.

---

# A. PC server (Python and Rust)

### A1. Wire format must match byte-for-byte 🤖
**What broke:** a previous Rust server (`pc-server-rust/`, ~3.1 GB) invented its
own format (HMAC + i16 sticks + 16-char key) and therefore dropped **every**
packet. It compiled and ran; nothing worked. It was deleted.
**Contract:** `<Q H B B B B B B I` LE, 20 bytes — defined in **three** files that
must agree: `controller-ui/src/app/App.tsx`, `android-client/.../gamepad-engine.cpp`,
`pc-server/server.py`.
**Check:** `cd apps/pc-server-rs && python tools/gen_golden.py && cargo test`
(vectors are AST-extracted from the real `server.py`, so drift fails loudly).

### A2. Stick Y axes are NEGATED 🤖
**What breaks:** every stick inverted in every game.
**Cause:** `server.py` calls `left_joystick_float(y_value_float=-_AXIS_LUT[ls_y])`.
**Check:** `cargo test pad_axes_match_including_negated_y`. Proven to have teeth —
removing the negation fails with `left_y = 1, python = -1`.

### A3. Thumb i16 conversion (banker's rounding trap) 🤖
**Cause:** vgamepad uses `round(v * 32767)`; Python's `round()` is half-to-even,
Rust's is half-away-from-zero.
**Check:** `cargo test thumb_i16_conversion_matches_vgamepad_for_all_256`
(all 256 inputs, both normal and negated).

### A4. Triggers are RAW BYTES 🤖
No scaling — `server.py` passes the wire byte straight to `left_trigger()`.
**Check:** covered by A3's test.

### A5. Two virtual gamepads ⚠️ **classic**
**What broke:** the PC showed two controllers for one phone; games read player 1
and ignored the real pad.
**Cause (June):** the USB-debug WebSocket auto-connected forever, and the server
grants a pad per open socket.
**Cause (2026-07-21, the remaining hole):** the transport coordinator called
`if (w.isOpen()) w.disconnect()` — but `disconnect()` is the only thing that
clears the worker's `enabled` flag, so an enabled-but-not-yet-connected worker
survived and grabbed a pad as soon as the adb tunnel returned.
**Rule: gate `connect()`, never `disconnect()` — `isOpen()` ≠ `enabled`.**
**Check:** connect the phone, then in the server log confirm **exactly one**
`Controller session +…` and **zero** `+usb:` entries at the same time:
```bash
grep -E "Controller session" <server log>   # exactly 1 active
```
Also force the trigger: with the phone on tether, run
`adb reverse tcp:7777 tcp:7777` and confirm no second pad appears within 20 s.

### A6. Pad-creation failure must NOT be ACKed 🤖
**Why:** an ACK makes the phone show "connected" while driving nothing. A device
that cannot get a pad must look unconnected.
**Check:** `cargo test pad_creation_failure_means_no_session_and_no_ack`,
`cargo test fifth_device_gets_no_pad_and_no_ack`.

### A7. Stale frames must NOT be ACKed 🤖
**Why:** the phone recomputes its RTT average on **every** ACK; ACKing a stale
frame reports its queue time and poisons the badge.
**Check:** `cargo test stale_frame_is_dropped_and_not_acked`.

### A8. Drain-to-newest (latency) 🤖 + 📱
**What broke:** RTT read ~3.5 ms with bumps to 4.6 ms vs Python's solid ~2.45 ms.
**Cause:** ACKing *every* queued datagram instead of keeping only the newest per
source (`server.py`: `latest[ip] = (data, addr)`).
**Check:** on-device RTT median should sit ~2.4–2.6 ms over USB tether. The
server's own `batches drained: avg=` line should be ~1.00 at normal load.

### A8b. 🚨 WebSocket GHOST PAD — half-open adb tunnel holds a pad forever
**Found 2026-07-21 on the Rust server, during the GRX on-device test.**
**Symptom:** phone app force-stopped → the UDP session was correctly reaped, but
the `usb:1` WebSocket session and **its virtual pad stayed alive indefinitely**.
Windows showed 2 pads with no phone running.
**Cause:** an `adb reverse` tunnel can leave the server's socket **Established**
after the phone is gone — the FIN never arrives. The reader thread was doing a
plain blocking read with **no timeout**, so it parked forever and the teardown
path (which frees the pad) never ran.
**Why it matters:** a lingering pad squats an XInput slot and pushes the next
real phone to player 2 — games only read player 1.
**Fix:** 250 ms read timeout + a 5 s `WS_IDLE_TIMEOUT` backstop that closes the
connection when no input frame has arrived, plus a bounded (5 s) handshake read
so a peer that connects and says nothing can't park a thread either.
**Check:** 🤖 `python tools/ws_ghost_test.py --port <p>` — connects, handshakes,
sends one frame, then goes silent while HOLDING the socket open. (Also covered by
`regression-check.sh --full`.)

**⚠️ REVISED 2026-07-21 (same day, second pass) — the first fix over-corrected.**
The blanket 5 s idle-close ALSO killed the phone's legitimate **standing link**:
the app keeps its WS open on EVERY screen (the contract Python documents at
`server.py:1143-1146`) and only streams input from the controller screen. Result:
connect → idle 5 s → close → reconnect, forever (`usb:1` … `usb:17` in one
sitting), and the window's device count flickered 0 with a phone attached.

The protected property is **no ghost PAD, not no lingering socket**. Current
semantics (`ws.rs` idle branch):
* Idle **with a session (pad held)** → close and free the pad (the A8b ghost).
  In practice the 3 s session reaper usually frees the pad first.
* Idle **without a session** → this is the phone parked on a non-controller
  screen. KEEP the socket; probe it with a WS ping (payload `lnk`) every 5 s. A
  live client's WS stack auto-pongs; a dead adb tunnel eventually fails the
  write, and the write error runs the normal teardown. Writes are bounded by
  `set_write_timeout(5 s)` so a peer that stops reading cannot park the thread
  in `write_all` (the A8b thread-park again, just slower).
* The **device count** shown in the window is `sessions.udp_count() +
  ws::live_links()` — a wired phone is its standing connection, with or without
  a session. Counting WS *sessions* too would double-count a streaming phone
  (`cargo test udp_count_excludes_ws_transport_sessions`).

The ghost test's PASS is therefore: server **closes** the connection OR **pings**
it during the silence — a ping is only ever sent after the server verified the
session (and its pad) is gone. Verified 2026-07-21: ping at 5.2 s, and the real
phone's link held one TCP connection for 20+ s with zero churn.

### A9. Ghost pads squat XInput slots
**Why:** a lingering pad pushes the next real phone to player 2, which games
ignore. Pads are freed at **>3.0 s** idle; neutralised at **>0.5 s** (anti-stuck,
so a dropped link can't leave a throttle latched).
**Check:** disconnect the phone → the Xbox 360 device disappears within ~3 s:
```powershell
Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match 'Xbox 360' }
```

### A10. Tether adapters are matched by DESCRIPTION, never name 🤖
**What broke (June):** USB tethering silently never connected. OEM tether
adapters get generic names ("Ethernet 5"), so name-matching found nothing.
**Rule:** match the *description* against `NDIS|NCM|Tether|Internet Sharing`.
**Check:** `cargo test tether_descriptions_match_real_adapter_names`, and the
server's startup line must show your real tether subnet (e.g. `["10.66.39"]`).

### A11. QR LAN IP must beat a VPN tunnel 🤖
**What broke:** with a VPN connected, the QR pointed down the tunnel — "USB works
but QR doesn't".
**Rule:** 192.168.x (100) outranks 10.x (60); VirtualBox 192.168.56 is 20.
**Check:** `cargo test lan_score_prefers_home_lan_over_vpn_tunnel`.

### A12. Pairing key must persist 🤖
**Why:** a fresh key per launch forces a QR re-scan after every restart. Both
servers read `%LOCALAPPDATA%\GamepadServer\pairing_key.txt` (8 lowercase hex).
**Check:** `cargo test existing_key_on_this_machine_loads_and_parses`.

### A13. Source change ≠ shipped
`pc-server/dist/GamepadServer.exe` is a PyInstaller build. **Editing `server.py`
does nothing until the exe is rebuilt.** Also: Pillow ≥ 12 needs
`PIL.ImageFont`/`_imagingft` bundled or the exe crashes.

### A14. 🚨 The singleton mutex name is an INSTALLER CONTRACT
**Found 2026-07-21 while scoping the Rust server for shipping.** The Rust server
had **no single-instance guard at all** — it would have shipped without one.
**The name `RemoteGamepadServerSingleton` is referenced in three places that must
agree**, and a mismatch fails silently in each:
* `installer/GamepadServer.iss:44` — `AppMutex=` + `CloseApplications=force`. This
  is how an upgrade closes the **running** server before overwriting its files. A
  server that doesn't create this mutex is **invisible to the installer**, which
  then hits a file-in-use error mid-upgrade — after the exe may already be partly
  replaced.
* `apps/pc-server/server.py:611` — the Python server. Sharing the name is
  deliberate: during migration a user can have both builds on disk and exactly one
  must win. It also stops the two from fighting over udp/7777 and creating **two
  virtual pads** (A5).
* `apps/pc-server-rs/src/singleton.rs` — the Rust server.

**Semantics that must match:** session-local namespace (**no** `Global\` prefix —
that's what `AppMutex` checks), `bInitialOwner=FALSE`, handle **never closed**
(Windows releases it on process exit, so a crash never permanently blocks the next
launch), and a failed guard must **not** block startup.

**Gotcha:** `CreateMutexW` returns a **valid handle even when the mutex already
exists** — the handle alone tells you nothing. Only `GetLastError() == 183`
(`ERROR_ALREADY_EXISTS`) distinguishes "created it" from "opened someone else's".

**Check:** 🤖 `cargo test claim_is_exclusive_within_the_process` (note: cargo runs
tests as threads in ONE process, so the same-process repeat claim and the first
claim **must stay in a single test** or they race).
Cross-process is live-only — verified 2026-07-21 both ways:
1. Two Rust instances on **different** ports (7999/7998, so a port collision can't
   be the cause): the second printed "already running" and exited **0** (not an
   error — a non-zero code would make the installer's post-install launch look
   like a failed install).
2. Python holding the mutex (`CreateMutexW` via ctypes, exactly as `server.py`
   does) turned the Rust server away. **This is the migration path** — do not
   change the name without re-running it.

### A15. Closing the server window must kill the PROCESS
**This is the 1.1.17 fix, and the singleton made it worse if broken.** The server
runs on a detached worker thread, so returning from the egui event loop is NOT
enough — the process stays alive holding udp/7777 **and the singleton mutex**,
which now blocks the next launch outright instead of merely confusing the user.
`main.rs` therefore calls `std::process::exit(0)` after `ui::run` returns.
**Check:** live — close the window, then confirm all three:
```powershell
Get-Process pc-server-rs -ErrorAction SilentlyContinue   # must be empty
Get-NetUDPEndpoint -LocalPort 7777 -ErrorAction SilentlyContinue  # must be empty
```
then start a fresh instance; it must not report "already running".
Verified 2026-07-21: all three pass.

### A16. The GUI must never take the server's lock
The window reads `status.rs` **atomics only**. It must not lock the `Server`
mutex — that lock is on the input path, taken once per drained batch, and a UI
repaint contending for it puts a redraw in the way of gamepad input. The device
count is published from the existing 1 Hz idle tick, so the window adds **zero**
hot-path work.
**Check:** 🤖 `cargo test values_cross_threads`, plus `grep -n "lock()" src/ui.rs`
must return nothing.

### A17. GUI defaults and the test-mode exemption
* The window is **ON by default** (the shipped exe is launched from a shortcut,
  with no console).
* `--dry-run` **forces it off**, regardless of flag order — every automated test
  drives dry-run, and a suite that opens windows (or blocks on an event loop on a
  headless box) is useless.
* `--no-gui` for a headless real-pad run.
**Gotcha, cost me a false alarm:** launching via PowerShell
`Start-Process -RedirectStandardOutput` makes the window come up **minimized and
off-screen** — `GetWindowRect` reports `-25600,-25600` (that's the classic
minimized `-32000` divided by the 1.25 display scaling). That is an artifact of
the launch harness, **not a bug**: launched the way a user launches it
(`cmd /c start ""  …exe`, or a shortcut) the window is at 128,128 at full size.
Do not "fix" it. Test window placement with a real launch.

### A18. 🚨 A WEB PAGE must not be able to claim a gamepad (Origin check)
**Found 2026-07-21.** The WS bridge listens on loopback and used to trust
**anything** that completed a handshake — no token, no origin check. Browsers
allow WebSocket connections to `127.0.0.1` from any site, so **any web page a
user visited could open `ws://127.0.0.1:7777`, be handed a virtual Xbox 360 pad
and inject input.**
**How it surfaced:** a stale controller-UI preview page (`Origin:
http://localhost:5174`) in a desktop webview held a pad and streamed ~240 neutral
frames/sec with **no phone attached** — the server window showed a phantom
"Connected devices: 1".
**INHERITED FROM PYTHON, not a Rust regression:** `server.py:1155` acquires the
pad on connect and line 1161 unpacks the auth field then discards it (`_auth`).
**Why not just check the auth token:** the client sends a **hardcoded
`0xABCD1234`** (`controller-ui/src/app/App.tsx:1134`) — identical for every user
and install. It is a format marker, not a secret. Checking it would reject
nothing while risking every wired user. Real auth needs a per-install token on
both ends = an Android release, not a server patch.
**Fix:** reject the upgrade (403) unless `Origin` is absent / `null` / `file://`
(non-browser and pre-1.3.1 clients) or **exactly**
`https://appassets.androidplatform.net` — the `WebViewAssetLoader` origin the real
app presents. Works because `Origin` is a **forbidden header**: page JavaScript
cannot forge it.
**Limitation, stated honestly:** a *native* local process can forge any header, so
this is not authentication. It closes the realistic remote vector (a visited web
page) and leaves local malware, which already implies far more capability than a
virtual gamepad.
**Check:** 🤖 `cargo test --lib ws` (5 origin tests; the allowed and refused values
were both captured live, not invented).
Live-verified 2026-07-21 with phone 1.3.22/code 46 attached: the phone connected
(`WS connected: usb:1`) while the page was refused with
`WS refused: disallowed Origin "http://localhost:5174"`, and `sessions=0` — the
phantom device was gone.

---

# B. Android app / controller UI

### B0. 🚨 Input must stream ONLY from the controller screen
**Found 2026-07-21 while chasing "the server keeps my volume at max".** The usbWS
worker's ~200 Hz "keep the wired link hot" re-blast had **no screen gate and
never cleared `latest`** — one input packet ever sent primed it to re-send that
stale snapshot forever, from EVERY screen. Server telemetry: ~250 identical
pkt/s from the DASHBOARD (`pad_writes=1`), fresh app launch included. So a
virtual Xbox pad (with a latched stick/gyro snapshot in it) existed on the PC
the whole time the app was open — exposing users to anything controller-aware
(Game Bar volume, Steam overlays) at all times, not just while playing.
**NOT a server bug** (Python behaves the same given the same stream), and NOT
transport-layer: the standing WS link on every screen is correct and must stay.
**Fix (1.3.23 / code 47):** the worker gained a `stream` flag driven by
ControllerScreen's `isActive` (`usbWS.setStreaming`); `stream-off` also nulls
`latest` so re-entry is primed by fresh input only.
**Check:** 📱 server telemetry with the app on the dashboard: `WS connected`
appears but NO `Controller session +` and NO `sessions=` lines (verified
2026-07-21: baseline ok=691→4436/25 s before, **silence** after). Then open the
controller screen and confirm streaming resumes.
**⚠️ REMAINING HOLE:** the **native UDP engine** (Wi-Fi/tether users) has the
same pattern — a ~30 Hz keep-alive resending the last input frame, gated by the
transport coordinator, not screen state (`gamepad-engine.cpp`). Needs the same
isActive gating via a JNI pause call (remember the `external fun` JNI gotcha).
Until then, Wi-Fi users still hold a pad from every screen.

### B1. Copy `dist/index.html` before EVERY APK build ⚠️
Skip it and the APK ships a **stale UI** while looking fine.
```bash
cd apps/controller-ui && npx vite build
cp dist/index.html ../android-client/app/src/main/assets/dist/index.html
```

### B2. Never mark an `external fun` `internal` 🚨
**What broke (2026-07-21):** instant force-close —
`UnsatisfiedLinkError: injectNativePayload$GamepadClient_app_directRelease`.
Kotlin name-mangles `internal` members, breaking the JNI symbol. **It compiles
perfectly.** Use `private external fun` + a plain wrapper, and catch
**`Throwable`** (a linkage failure is an `Error`, not an `Exception`).
**Check:** install and open the controller screen. `adb logcat | grep -c FATAL`
must be 0.

### B3. App.tsx is fragile — CRLF + non-breaking spaces ⚠️
**What broke (2026-07-14):** a regex edit with a **non-unique anchor** deleted
~133 K chars (4600 → 1809 lines). NBSP zones ~2649–3505.
**Rule:** never edit by non-unique anchor; check occurrence count first; back up
first (`App.tsx.bak-YYYYMMDD-HHMMSS`).

### B4. Gyro must never run on a timer 🚨
**What broke:** gyro froze on every button press. Chromium defers DOM timers
~90–160 ms around each tap (399 holes measured in 762 taps); rAF is not deferred.
**Rule:** nothing latency-critical on `setInterval`/`setTimeout` in the
controller UI.
**Check:** hold a tilt and mash buttons — steering must not freeze.

### B5. D-pad is strict 4-way
Nearest cardinal only. No diagonals, no opposite pairs.
**Check:** slide a thumb around the d-pad — exactly one arrow lit at any time.

### B6. Haptics fire once per press
Never per fill-step (that reads as a vibration, not a button). Press + release
give distinct tiers.

### B7. Never CSS-transition SVG geometry
`x/y/width/height` for a finger-tracked value lags/sticks on the phone WebView.
Use plain attributes or an imperative transform.

### B8. Gyro glide must be delta-time based
`k = 1 - exp(-dt/28ms)`. A fixed per-frame lerp is a 120 Hz bug.

### B10. 🚨 Phone left FLAT with gyro on = runaway input into Windows
**Found 2026-07-21.** Symptom: Windows volume climbing by itself in the
background while the server ran.
**Chain:** the phone was lying flat on a desk with the controller screen open and
gyro ON → measured `roll = -41.2°` against a 45° full-lock, `pitch = -87.1°` →
the virtual pad's **left stick sat pegged ~92% in one direction, continuously** →
Xbox Game Bar (running, gamepad-enabled) treated it as a held direction and
walked its volume widget up.
**Not server-specific:** Python relays the same pegged stick. It is a product
behaviour, not a port regression.
**The gyro was NOT malfunctioning.** At 41.2° against a 45° full-lock, pegging
the stick is the mathematically correct output — that is what a 41° tilt means.
**❌ REJECTED FIX — do not re-propose:** "treat gyro as neutral above ~75° pitch."
Akhil rejected this 2026-07-21 and was right: it **limits gyro capability** for
anyone playing reclined/propped, does nothing for a phone resting at a shallow
angle, and the orientation-classifying math it leads to is the same complexity
that previously **slowed the whole gyro path down**. The gyro deliberately has no
per-orientation special-casing; keep it that way.
**Correct framing:** the condition is not "bad orientation", it is *"nobody is
playing but the pad is still driving Windows"*. Any future fix must target
presence/activity, never orientation, and must not add math to the hot path.
**Mitigations today:** turn GYRO off on the controller screen, back out of the
controller screen, or stop the server when not testing.
**Check:** put the phone flat on a desk with gyro on and the controller screen
open, then read the pad — `LX` must not sit pegged:
```powershell
# XInputGetState slot 0 — LX should be near 0, not ±32767
```

### B9. `console.log` in the WebView is a dead end
No `WebChromeClient`, so JS logs never reach logcat. Route metrics through a
`@JavascriptInterface` that calls `Log.i` (that's what `GPM` does).

---

# C. Native input path (Phase 3)

### C1. Native path activates and beats the JS path 📱
**Check:** `adb logcat -s GPM:I` should show
`native input path ACTIVE (widgets=N)` then
`native touch->handle: … avg≈1.6–1.9 ms p95≈3–5 ms`
(the old JS path was ~6.8 ms avg / 15 ms p95).

### C2. `__setNativeInput(false)` returns to the JS path cleanly 📱
The instant escape hatch if native input misbehaves — no reinstall.

### C3. Known cosmetic gaps (NOT bugs)
Touch ripples and the stick grab-tint don't render in native mode.

### C4. Gyro still steers while mashing buttons 📱
The original B4 symptom, re-verified on the native path.

---

# D. Build / release pipeline

### D1. Version bump is mandatory
Same `versionCode` = the in-app updater never fires **and** Play rejects the
upload.

### D2. Store artifacts go stale silently ⚠️
`releases/store/<ver>/` does **not** rebuild itself. After any app fix, the
6 store variants must be rebuilt or you ship the old code.
**Current status: `releases/store/1.3.22/` is STALE** — predates the gyro fix,
the memo work, Phase 3 and the double-pad fix.

### D3. The website must serve the `-direct.apk` 🚨 **live bug**
It is currently serving the **amazonstore** build, which has no self-updater →
**the in-app updater is dead for website users.** Fix + Register & Activate.

### D4. Debug WebView must be re-gated before release
Test builds set `setWebContentsDebuggingEnabled(true)` unconditionally for CDP.
Release source must be back to `if (BuildConfig.DEBUG)`.
**Check:** `grep -n "BuildConfig.DEBUG" MainActivity.kt` near the WebView setup.

---

# E. Environment gotchas that waste time

* **CDP hangs when the app is backgrounded.** Android 16 freezes cached
  processes. Foreground the app first (`adb shell am start …`).
* **Only ONE process may bind udp/7777.** Two servers = two pads. Stop Python
  before starting Rust and vice-versa.
* **A backgrounded phone app drops the pad after 3 s** — that is correct
  behaviour, not a bug (it caught us once: "gamepad tester shows none detected"
  was simply a WhatsApp call backgrounding the app).

---

## Legend

🤖 automated (`cargo test` / build) · 📱 needs the phone · ⚠️ has bitten us ·
🚨 caused a crash or a live user-facing bug
