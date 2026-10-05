# 2026-10-05 — Wi-Fi input reliability (PC server 2.1.4, app 1.4.8)

Backups of every touched source file: `context/recovery/wifi-reliability-2026-10-05/`.

## The report
In F1 on Wi-Fi, some inputs never arrived. Setup: the PC joined the controller phone's own 5 GHz
hotspot, very close. The owner was sure the cause was on our side, and the code showed he was right.

## Causes found (in order of weight for that setup)
1. **The PC's Wi-Fi card scans and naps.**
   - About once a minute Windows scans other channels, which means 100–300 ms of silence.
   - In power-save the card sleeps between packets, and the hotspot holds our packets until it wakes.
   - Afterwards the held packets arrive as one pile.
2. **The server kept only the last packet of a pile.**
   - `main.rs` `upsert` chose by ARRIVAL order. A tap whose press and release were in one pile left
     only the release.
   - A reordered pile could also drop the newest frame.
3. **A press too short for the game.** A release written about 1 ms after its press is invisible to
   a game that reads XInput once per frame (~16 ms).
4. **The phone's resend was too short for Wi-Fi.**
   - Each change went out 3× within ~4 ms.
   - After that, nothing was sent until the 33 ms keep-alive, even with LT held.
5. **A same-size resize tore down native touch.** `App.tsx` `setWindowSize` always made a new object,
   and the overlay effect's cleanup releases every held finger.
6. **No opt-out of Windows 11 background power throttling (EcoQoS)** for a server that is usually
   minimised.

## PC server 2.1.4 (`apps/pc-server-rs`)
- **`wlan.rs` (new):**
  - While at least one UDP phone is connected: background scan off, media streaming mode on.
  - It runs on its own thread. `wlanapi.dll` is loaded at runtime, so the server still starts on
    a PC without Wi-Fi.
  - The original values are read first, written to `%LOCALAPPDATA%\GamepadServer\wlan_restore.txt`,
    and put back when the last phone leaves, on window close, and before the in-app updater exits.
  - If the file is still there at the next start, the values are restored then.
  - Never active in `--dry-run`, unless `GAMEPAD_WLAN=1` is set (used only to test this module).
  - Permission check on this PC: Builtin Users have WLAN_WRITE_ACCESS to both settings, so no admin
    is needed.
- **`net.rs` `Server::handle_batch`:**
  - Every frame of a pile is decoded.
  - The newest frame is chosen by TIMESTAMP; on equal timestamps, the later arrival wins.
  - Frames are judged against the pre-pile `last_ts`.
  - A button pressed somewhere in the pile but up in the newest frame is still written as a press
    (`merged`).
  - Still one ACK per pile, so the phone's RTT reading is unaffected.
- **`session.rs` `MIN_PRESS` = 20 ms:**
  - A release is held back (`pending`) until the press has been on the pad for 20 ms.
  - The receive loop shrinks its read timeout to the deadline and calls `flush_due`.
  - Buttons only: triggers and sticks are never delayed.
  - Only UDP sessions; the USB-debugging WebSocket is unchanged.
  - Neutral reset and migration clear the hold.
- **`winperf.rs`:**
  - `disable_power_throttling` (EcoQoS off for this process).
  - `raise_receive_thread` (receive thread at HIGHEST; the process stays ABOVE_NORMAL so the game is
    not outranked).
- **Stats:**
  - A new 5 s line: `wifi: gaps>50ms= >100ms= >250ms= longest= | merged= held= neutral_resets=`.
  - The 0.5 s neutral reset now logs a line (it was silent before).
- **Tests:** 10 new tests in `net.rs` and 3 in `wlan.rs`. All 110 lib tests and all integration suites pass.

## App 1.4.8 (versionCode 62)
- **`gamepad-engine.cpp`:**
  - While input is not neutral, or for 250 ms after a change, the full state goes out every **8 ms**
    (it was 33 ms).
  - Buttons are sent pressed for at least **30 ms**. The press time is recorded at inject time, so a
    tap that starts and ends between two TX snapshots is still sent.
  - Holds are cleared when streaming stops and on a new session.
- **`App.tsx`:** a same-size resize keeps the same `windowSize` object.

## Second report the same day: back from recents needed a QR rescan
**Symptom:** with the app in recents, coming back left it not connecting until the QR was scanned again.

**Cause:** three things, all needed together.
1. **Android freezes a backgrounded app.** The PC heard nothing for 3 s and dropped the pad. Its
   idle tick then evicted the phone's GRX (encryption) state at once. The resumed phone kept sending
   frames encrypted with the old keys; they were dropped and never answered.
2. **On resume the engine fell back to broadcast immediately**, because the last ACK was more than
   3.5 s old. On a phone hotspot a 255.255.255.255 broadcast follows the default route, which is
   mobile data, so it never reaches the PC. The engine never retried the PC's own address.
3. **Nothing on the phone ever started a fresh session for a stalled Wi-Fi link.** The transport
   coordinator only retries USB tether.

**Fixes:**
- **Server (`net.rs`):**
  - GRX state is kept for `GRX_KEEP` (10 min) after the pad session drops, via `grx_seen` refreshed
    on the idle tick. A lone HELLO for an IP that never held a pad is still evicted at once.
  - A HELLO now replaces an established GRX session when that IP has no live pad (anti-spoof is kept
    while the pad is live).
- **Engine (`gamepad-engine.cpp`):** `homePeer` = the QR IP. While discovering, every frame and every
  handshake frame is also sent to it.
- **UI (`transportCoordinator.ts` + `App.tsx`):** Wi-Fi self-heal.
  - When the link is running, not alive, and either `sinceAck` > 6 s or a heal is already under way:
    stop the engine, then `connectToPC(savedPc)`.
  - Backoff is 8 → 16 → 30 s. Never while `document.hidden`, never without a saved PC, never for a
    link that has not answered since it started. 8 new cases in `transport-switch.test.mjs`
    (21 pass).

**Verified:** `examples/resume_check.rs` is an encrypted fake phone. It plays, goes silent 5–6 s
(pad dropped), then resumes WITHOUT a new handshake. Against the shipped 2.1.4 exe it got 97 ACKs on
return, and the server logged `-127.0.0.1` then `+127.0.0.1`. Two new unit tests cover key retention
and the HELLO rule.

**Not verified:** a real phone frozen in recents on the hotspot.

## Builds
- **PC server 2.1.4:** `releases/pc/2.1.4/actual/GamepadServer-Setup-2.1.4.exe`
  - sha256 `432e0f96e7b73128fdaf66f204edad64d1b4f14bbde08d5c8f90f1028a1ee667`
  - Unsigned, like 2.1.3.
  - Website copy staged in `website/backend/downloads/`.
- **App 1.4.8 (62):** `releases/mobile/1.4.8/actual/` contains all seven flavours.
  - Version, signer, flavour SDK checks, the UI hash and 18 JNI exports are all verified.
  - The AAB passes bundletool validate and jarsigner, and is version 62.
  - The unit tests pass (12 + 12).
  - `libgamepad_engine.so` is 1,216 bytes larger than 1.4.7's, which is the new sending code.
  - The Play upload folder is updated; the 1.4.7 files were moved to `1-app-bundle/old-1.4.7/`.

## Verified on this PC
- **Real server binary in dry-run, with a fake phone on 127.0.0.1:**
  - 3 taps sent as press and release back to back: 2 were `merged`, 1 `held`, and all 3 reached the pad.
  - Before this change, all 3 could have been lost.
- **Wi-Fi settings, read from another process** (scratchpad `wlan_state.ps1`):

  | Moment | Background scan | Streaming mode |
  |---|---|---|
  | Before | 1 | 0 |
  | Phone connected | 0 | 1 |
  | Phone gone | 1 | 0 |
  | Connected, then server killed | 1 | 0 (Windows also restores on process death) |
  | Restart with the leftover file | 1 | 0 (file restored and removed) |

## Not verified
- The real F1 run on the phone hotspot.
- **What to watch:**
  - `gaps>100ms` should be near 0, and `longest` well under 250 ms.
  - Taps (DRS, gear shifts) should always register, and a held LT should never drop.
- **Driver caveat:** some Wi-Fi drivers ignore the streaming-mode hint. Background-scan off is the
  part that removes the once-a-minute stall.
