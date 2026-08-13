# SESSION HANDOFF — 2026-07-21

Follows `SESSION_HANDOFF_2026-07-20C-phase3.md`. Read **§1 (machine state)** before
touching anything — a non-default server is currently running.

---

## 1. ⚠️ MACHINE STATE RIGHT NOW

| Thing | State |
|---|---|
| **PC server running** | **RUST** (`pc-server-rs.exe`, PID 26488) on udp/7777, real ViGEm |
| **Python server** | **STOPPED** |
| Virtual pads | **1** (correct) |
| Phone `DAIFEYGEKB89V4QG` | 1.3.22 / code 46, installed 19:25 — **debug-WebView build** (CDP works) |
| Phone app screen | Dashboard (not the controller) |
| Phone transport | WebSocket `usb:1` (~5-6 ms), **not** tether |
| Rust tests | **81 passing** |

**To restore the normal setup:**
```powershell
Get-Process pc-server-rs | Stop-Process -Force
cd F:\hlooo\apps\pc-server; python -u server.py
```

> The phone currently has a **debug-WebView** APK (built for the GRX test). The
> SOURCE is correctly re-gated to `if (BuildConfig.DEBUG)` — regression check D4
> passes. Rebuild+install before shipping so the debug build doesn't leak out.

---

## 2. THE ONE THING BLOCKING RELEASE

**Phase 3 gameplay verdict — still not done.** It is default-ON, replaces the
entire input path, is measured (~1.6-1.9 ms avg / 3-5 ms p95 vs the old ~6.8 /
15 ms JS path) and crash-free, but **nobody has played a game on it.**

Known-and-fine in native mode: touch ripples don't render, stick grab-tint
missing. Escape hatch: `window.__setNativeInput(false)` — instant, no reinstall.

---

## 3. What shipped this session

### 3.1 Double-gamepad bug — ROOT-CAUSED AND FIXED 🚨
Two virtual pads for one phone. Server log was the giveaway:
`+10.66.39.130 (active=1)` **and** `+usb:1 (active=2)`.

`server.py::start_adb_reverse_watcher` re-creates the `adb reverse tcp:7777`
tunnel on every server start. The client coordinator called
`if (w.isOpen()) w.disconnect();` — but `disconnect()` is the only thing that
clears the worker's `enabled` flag, so an **enabled-but-not-yet-connected**
worker slipped past and grabbed a pad the moment a tunnel reappeared.

**Fix:** `w.disconnect()` unconditionally in all three coordinator branches
(App.tsx). **Rule: gate `connect()`, never `disconnect()` — `isOpen()` ≠ `enabled`.**
This was the remaining hole in the June "device connects twice" fix.

### 3.2 Controller UI
GYRO and CALIBRATE halved (`px-2 py-0.5`, 8 px text); `GYRO ON · TAP` → **`GYRO`**
(state is carried by the dot's colour/glow). Verified in the live preview: 48 px
and 63 px wide vs ~124/104 before. Built, asset synced, installed.

### 3.3 Regression checklist + runner (Akhil's proposal)
* `docs/REGRESSION_CHECKLIST.md` — ~30 entries, each a bug that ACTUALLY happened:
  symptom, root cause, exact check. Sections A (PC server) / B (Android+UI) /
  C (native input) / D (release) / E (environment).
* `tools/regression-check.sh` — `--fast` (~1 min) / `--full` / `--device`.
* **Negative-controlled**: drifting the Android asset made B1 FAIL, restoring made
  it PASS. It then caught a real stale-asset miss on its first working day.

### 3.4 Python server PRESERVED (do not delete)
`releases/archive/pc-server-python-2026-07-21/` — 41 files, **126 MB**, every file
SHA256-verified, plus `SHA256SUMS.txt`, `_PRESERVED_README.md` and a 240 KB
source-only zip. Kept **outside `apps/`** so no build script can touch it.
`apps/` has no VCS; this is the only rollback.

### 3.5 Rust PC server — Phase 2 (81 tests)
Runs with **zero arguments**. `F:\hlooo\apps\pc-server-rs`.

| Module | Status |
|---|---|
| `wire.rs` | ✅ 12 conformance tests vs real `server.py` |
| `session.rs` | ✅ pads, reaping, dedup, **transport-switch migration** |
| `net.rs` | ✅ auth, ordering, ACK/RMB, GRX routing, telemetry |
| `vigem.rs` | ✅ real Xbox 360 pad, verified via live XInput |
| `netdetect.rs` | ✅ VPN-aware LAN IP + tether discovery |
| `pairing.rs` | ✅ reuses Python's persisted key (no re-scan) |
| `ws.rs` | ✅ hand-rolled WebSocket, validated vs a real client |
| `adbreverse.rs` | ✅ per-serial tunnel, verified live |
| `grx.rs` | ✅ **18 vectors + full interop with the real Android build** |
| `qr.rs` | ✅ terminal QR (Wi-Fi pairing needs it) |

**GRX proven on-device:** `[GRX] HELLO … CONFIRM … ESTABLISHED`,
`grx=[established=1 ok=672 dropped=0]` — the real Kotlin client (Android **Tink**
HKDF) handshaking with the Rust implementation.

---

## 4. Bugs found in MY OWN Rust code (all fixed)

1. **`1u128 << 128` overflow** in the replay window — 4 tests failed loudly.
2. **Drain-to-newest would have silently eaten GRX** — it only kept 20-byte
   frames, so 41-byte encrypted frames and handshakes were discarded. Handshakes
   are now passed individually (a state machine, not a sample) and **before**
   input in the same batch.
3. **GRX session leak** — Python evicts GRX state for IPs with no pad session; I
   didn't, so the handshake map grew for the life of the process.
4. **🚨 WebSocket GHOST PAD** — see below.
5. **Duplicate module** — I rewrote `adbreverse.rs` as `adbwatch.rs` because I
   trusted my own status report over the roadmap file. Deleted. *Lesson: read the
   roadmap before reporting status.*

### The ghost pad (A8b in the checklist)
App force-stopped → UDP session correctly reaped, but `usb:1` **kept its virtual
pad indefinitely** with the socket still `Established`. An `adb reverse` tunnel
can leave the server side open after the phone is gone — the FIN never arrives —
and a plain blocking read parked the thread forever, so teardown never ran. A
lingering pad squats an XInput slot and pushes the next phone to player 2.

**Fix:** 250 ms read timeout + 5 s `WS_IDLE_TIMEOUT` + bounded handshake read.
**Proven:** `tools/ws_ghost_test.py` holds a socket open and goes silent; server
closes at 5.0 s and logs `Controller session -usb:1 (active=0)`. Wired into
`regression-check.sh --full`.

---

## 5. Decisions made (NOT todos — don't re-litigate blind)

* **❌ AOA skipped.** Nothing bound to WinUSB but the ADB interface, no accessory
  device, and the **Python** server logs `AOA: no accessory yet (Operation not
  supported or unimplemented on this platform)` — it has never moved a packet
  there either. Porting = translating unverified code, adding a USB dep, unable
  to test, behind a Zadig bind that breaks adb AND tethering. Gain ~1-2 ms vs
  tether's ~2.4 ms.
* **❌ Rust GUI / installer / updater not built.** Python's UI is a tkinter window
  whose only functional job is the QR — the terminal now does that. Building an
  installer+updater for a server that is not the shipping server is productising
  something unadopted.
* **❌ Gyro "neutralise above 75° pitch" REJECTED by Akhil, correctly.** At 41°
  against a 45° full-lock, pegging the stick is the *correct* output. The fix
  would have cut capability for reclined/propped play and led into the
  orientation math that previously slowed the gyro down. **Any future fix must
  target presence/activity, never orientation, and add nothing to the hot path.**

---

## 6. The "server changed my volume" incident (B10)

Not a server bug. Phone lying flat, gyro ON, controller screen open:
`roll = -41.2°` (vs 45° full-lock) → left stick pegged ~92% **continuously** →
Xbox Game Bar (running, gamepad-enabled) walked its volume widget up. Python
relays the same pegged stick. Mitigations: turn GYRO off, leave the controller
screen, or stop the server.

---

## 7. Release backlog — what's actually left

**Mine (~half a day):**
1. Rebuild the **6 store artifacts** — `releases/store/1.3.22/` is **STALE**
   (dated Jul 20 12:05, predates the gyro fix, Phase 3, the double-pad fix and
   today's buttons).
2. Verify each APK: versionCode 46, signing, 16 KB `.so` alignment.
3. Website: serve `GamepadOS-1.3.22-direct.apk`. It currently serves
   `backend/downloads/GamepadOS-1.3.21.apk` (Jul 15) which is the **amazonstore**
   build → **the in-app self-updater is dead for website users**.
4. `regression-check.sh --full` and `--device`.

**Akhil's (a few hours):**
1. **Play a game** (§2) ← the real gate
2. `resizeableActivity` decision
3. Push the website commit (repo is in sync with origin; I don't push)
4. Upload to Play / Amazon / Uptodown / Indus / APKPure
5. Register & Activate

**Then 1-3 days of store review → ~2-4 days to public.**

> **Recommend a staged rollout (10-20%) on Play.** Play is on **1.3.0**; this
> would ship **1.3.22** — 22 versions of accumulated change including a full
> input-path rewrite, in one jump.

> **The Rust server does NOT gate the release.** Ship with the existing Python
> `GamepadServer.exe`, which already has the GUI, installer, updater and a
> firewall rule. Adopt Rust after it is proven in real use.

---

## 8. Gotchas added this session

* **Windows Firewall**: rules exist for `pc-server-rs.exe`, but a fresh binary
  needs one; Python's installer creates its own. Broadcast discovery
  (`10.66.39.255`) did not reach the Rust server while unicast did.
* **`phone_is_sending_packets: 0` with `engine: true`** — the phone's native UDP
  engine reported running but transmitted nothing, so `linkAlive` stayed false
  and it fell back to WebSocket. Client-side coordinator issue, present with the
  Python server too. **Unresolved — worth chasing.**
* CDP still hangs when the app is backgrounded (Android 16 freezes cached
  processes) — foreground it first.
* Only ONE process may bind udp/7777. Two servers = two pads.
* App.tsx backup this session: `App.tsx.bak-20260721-174416`.
