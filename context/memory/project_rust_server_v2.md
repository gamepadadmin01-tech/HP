---
name: project-rust-server-v2
description: "Rust PC server — source/installer are 2.0.1 but backend still serves 2.0.0 (unactivated security fix); GUI/HTTP/singleton/origin-check/link-stability state"
metadata: 
  node_type: memory
  type: project
  originSessionId: 48166bf1-41e4-4e7d-8603-dbf2bd064555
  modified: 2026-08-10T10:56:58.108Z
---

## 🚨 VERSION STATE (verified on disk + live API 2026-08-10)

**Source + installer = 2.0.1. Live backend = 2.0.0. The activation step was never run.**

- `2.0.1` agrees across all four places the updater contract cares about: `src/http.rs` `app_version!`, `build.rs` File/ProductVersion (`2.0.1.0`), `installer/GamepadServer.iss` AppVersion + VersionInfoVersion, and the built `staging/GamepadServer.exe` (FileVersion 2.0.1.0).
- Installer built **2026-08-03 18:29**, 8.81 MB. sha256 `668a74874193ffb6f24ccd2a3e313da061fc90f91c6e86be99f2c3ca54e57edb`.
- `website/backend/downloads/GamepadServer-Setup-2.0.1.exe` is **committed and pushed** (tree clean, no unpushed commits) — so the file is deployed; only the Releases-panel **Register & Activate** for pc 2.0.1 is missing.
- `GET /api/version` still returns `pc.version 2.0.0` / sha `fbedaf88…`, and the generic fallback `GamepadServer-Setup.exe` in downloads is byte-identical to the 2.0.0 artifact. Every updating user lands on 2.0.0.
- **This is not a cosmetic patch.** 2.0.1 IS the fix for `net::is_offlan` assuming a /24 instead of reading the interface's real prefix length: on any LAN wider than /24, same-wire peers were classified off-LAN, and the off-LAN branch is the one that accepts auth token 0 → keyless pairing reachable from LAN peers it was never meant to be. That hole is live right now.
- Minor drift: `Cargo.toml` still says `version = "0.1.0"`. Harmless — `installer/build-installer.ps1`'s version gate only checks http.rs / iss / build.rs — but it's a 4th copy out of step.
- Android for comparison (same API call): live **1.3.24 / versionCode 48**; a **1.3.26 APK** is committed to downloads but not activated. See [[project-grx-crypto]] — its version notes are far older than this.

## Reply-source pinning — `src/pktinfo.rs` (2026-08-10, built + tested, NOT device-verified)

Symptom Akhil reported: with a **PC-side VPN**, the phone app shows disconnected while input works perfectly and the PC shows connected — on **both Wi-Fi and USB** (the "both transports" part is the tell).

Cause: the server binds `0.0.0.0`, so `send_to` lets the kernel pick the reply's source IP by route lookup. A VPN/second adapter can make that differ from the address the phone dialled, and `gamepad-engine.cpp:467` drops any ACK/rumble from an unexpected source (anti-spoof guard — correct, keep it). One-way break: input fine, PC's inbound session count fine, phone's `linkAlive` never true.

Fix: `IP_PKTINFO` — capture each datagram's arrival address + ifindex via `WSARecvMsg`, re-state both on the reply via `WSASendMsg`. Best-effort; falls back to plain `recv_from`/`send_to` and prints `replies : ...` at startup so it's observable. **`WSARecvMsg` is not exported from ws2_32 — must be fetched via `WSAIoctl(SIO_GET_EXTENSION_FUNCTION_POINTER)`; `WSASendMsg` IS exported.**

⚠️ **GOTCHA that aborted the process on first run:** the cmsg control buffer must be **usize-aligned**, not `[u8; N]`. Casting a 1-byte-aligned array to `*mut WSACMSGHDR` is UB → `misaligned pointer dereference` → `STATUS_STACK_BUFFER_OVERRUN`. Backed it with `[usize; 8]`.

Verified: 105 tests pass (7 new). The discriminating test is `pinning_overrides_the_kernels_source_choice` — pin the reply to the *wrong* local address and delivery changes, proving the control message is honoured (the other tests would pass against the unfixed server, since with no VPN the route picks correctly anyway). Loopback protocol test A/B'd against the pre-change release binary: identical results.

**NOT yet proven against the actual VPN** — needs Akhil to connect it and re-test. Also will NOT help if the VPN client blocks LAN via a WFP driver ("allow local network" toggle, usually off by default) — that's client-side.

**Shipping note: since 2.0.1 was never activated, this can go out AS 2.0.1 — no version bump needed, nobody has the old 2.0.1.**

Loopback harness gotcha: `tools/loopback_test.py` defaults to `--token ABCD1234`, so the server must be started with `--key ABCD1234` and a LAN-shaped `--lan-ip` (NOT 127.0.0.1 — loopback counts as off-LAN and changes the auth branch). Its `[6] all 200 ACKed` failure is **by design** (drain-to-newest coalesces bursts), not a regression.

Related: `tools/regression-check.sh` had `ROOT="D:/AKHIL/HP/projects/gamepados"` hardcoded and was **fully broken since the drive move** — every check `cd`-failed, yet it still printed a summary and reported one bogus PASS. Now derives ROOT from its own location. See [[project-fdrive-overview]].

## Adapter classification by DESCRIPTION — `netdetect.rs` (2026-08-10, built + tested)

Fix #2 of the VPN work. `lan_score` guessed "is this a tunnel?" from the IP range (192.168=100 > 172.16-31=80 > 10.x=60) on the assumption that home LANs are 192.168 and tunnels are 10.x. **That is inverted on Akhil's machine — his Wi-Fi is `10.0.6.194/20`** (Realtek RTL8852BE), so a VPN on 192.168.x outranked the real LAN outright; and a VPN on 10.x tied and won the tie-break, because the tie-break went to whoever holds the default route (= the VPN). Tunnel won both ways.

New: `is_tunnel_desc()` / `is_virtual_desc()` / `adapter_score(desc, ip)` = `lan_score` minus 1000 (tunnel) or 500 (virtual). Class dominates IP range; ordering within a class unchanged. `lan_ip()` now enumerates `(description, ip)` and ranks with `adapter_score`. **`lan_score` deliberately kept as-is** — it's the documented server.py mirror and the no-description fallback (non-Windows / enumeration failure).

Gotchas worth keeping:
- **`Microsoft Wi-Fi Direct Virtual Adapter` is Up on this laptop and contains "Wi-Fi"** — never treat "wi-fi" in a description as evidence of a real wireless NIC.
- **Hyper-V / WSL `vEthernet` switches sit on 172.x = score 80, ABOVE a real 10.x LAN at 60.** Latent bug on any dev machine with either installed; now demoted.
- **Palo Alto's adapter is `PANGP Virtual Ethernet Adapter`** — the acronym, no "GlobalProtect" anywhere in it. Found because the test used real strings pulled from `Get-NetAdapter -IncludeHidden`, not invented ones. Same lesson as the tether-by-description bug of June 2026.
- Tether adapters are checked FIRST and can never be classified tunnel/virtual — a USB-tethered phone is a legitimate target.
- De-dup in `lan_ip()` must prefer the entry that HAS a description; adding the route IP unconditionally would re-add a description-less duplicate that scores as if it were a real NIC (and on a VPN machine that duplicate IS the tunnel).

Verified: 114 tests pass. On this machine `lan_ip()` auto-detects `10.0.6.194` with VirtualBox's `192.168.56.1` present — same answer as before but now for the right reason and robust to VirtualBox being moved off the hardcoded 192.168.56 special case. `regression-check.sh --fast` 6/6.

## Honest link state in the app — `linkState.ts` (2026-08-10, built + browser-verified)

Fix #3. The UI rendered one boolean: `linkAlive ? "CONNECTED" : "DISCONNECTED"`, so every failure looked identical. During the VPN bug it said DISCONNECTED while the game responded to the sticks.

`getMsSinceLastAck()` already returned **-1 = no ACK has EVER arrived** vs a real age — the information existed, it just was never exported. Kotlin `getNetworkTelemetryJson` now emits `sinceAck` raw. New `controller-ui/src/app/linkState.ts` (pure module, deliberately NOT inlined into the fragile App.tsx) maps it to 4 states: `connected` / `no-reply` (TX-ing, never answered → VPN/firewall/wrong IP) / `stalled` (answered before, went quiet) / `off`. Labels CONNECTED / NO REPLY / LINK LOST / DISCONNECTED; amber for the two degraded states; only `connected` pulses.

Wired into 2 sites in App.tsx: the header badge (~L3981) and the USB "Automatic Connection" card (~L2261, which also shows the actionable hint).

Verified in the vite preview by injecting a fake `AndroidBridge` and driving all 4 states live: header text, computed dot colour, pulse class, and tooltip all correct. **Preview trick worth reusing: the telemetry effect captures `window.AndroidBridge` at mount, so injecting it later does nothing and HMR does a FULL RELOAD that wipes it. What works: set the bridge, clear `#root`, then `await import('/src/main.tsx?bust=' + Date.now())` to re-bootstrap React with the bridge already present.** Also `import('/src/app/linkState.ts')` in the page to unit-test the pure module through vite. (controller-ui has NO test framework — no vitest/jest. Worth adding.)

## regression-check.sh was broken 4 ways by the drive/toolchain moves (all fixed 2026-08-10)

It reported confident PASSes while evaluating nothing. All four found while trying to verify the VPN fixes:
1. `ROOT="D:/AKHIL/HP/projects/gamepados"` hardcoded → every `cd` failed; one check still printed PASS.
2. `ANDROID_HOME=D:/AKHIL/HP/Android/Sdk` hardcoded → now read from `android-client/local.properties` `sdk.dir` (= `D:\AKHIL\HP\toolchain\android-sdk`).
3. `GRADLE` pinned to `tools/gradle-8.14.4` → **AGP is now 9.3.1 and needs Gradle >= 9.5**; `build.gradle.kts:19` says 8.14.4 "CANNOT" build it. Now `tools/gradle-9.6.1`. (Supersedes the old "AGP 9 deferred" note in [[feedback-latest-tooling]].)
4. The `--full` loopback check started the server with no `--key`/`--lan-ip` → every valid frame rejected, looked like a protocol regression.

After fixing: `--fast` 6/6, `--full` 9/10.

⚠️ **The one remaining `--full` failure is `[6] burst of 200 frames all ACK — got ~144`, and it is BY DESIGN**: drain-to-newest deliberately coalesces bursts and ACKs only the newest frame per source. `loopback_test.py`'s assertion predates that and is simply stale. Fails identically on the pre-change binary. Deciding the correct assertion is a protocol call — NOT silently changed. Fix it by asserting "the newest frame is always ACKed and no frame is ACKed twice" rather than a raw count.

## Build state (2026-07-21 evening)

Rust PC server (`D:\AKHIL\HP\projects\gamepados\apps\pc-server-rs`) is the FULL v2 app, 96 tests passing. Built on top of the Phase-2 protocol core after Akhil's hours-long F1 session proved both Phase 3 native input and the Rust server (clearing the release gate AND invalidating the "ship Python first" decision — Akhil chose Rust-UI-first, egui, then one combined release).

**Proven this session (all live-verified, not just unit-tested):**
- `singleton.rs` — mutex `RemoteGamepadServerSingleton` shared with Python + Inno `AppMutex` (installer contract, checklist A14). Cross-process verified BOTH directions vs Python. `--dry-run` is exempt (regression runner starts 3 dry-runs). Tests must use `claim_named()` with a throwaway name — claiming the real mutex made the test fail whenever a server was running.
- `http.rs` — ureq+rustls with **platform-verifier** (Windows cert store, NOT bundled webpki-roots: the updater can't use the updater to fix itself). check_for_update/download_update/submit_feedback verified against the LIVE backend incl. real 28MB artifact SHA256 + negative control (bad hash → rejected + file deleted). APP_VERSION was **2.0.0** here (major bump = full rewrite; must stay > 1.1.17 and agree with installer AppVersion + backend manifest) — **now 2.0.1, see the version block at the top**.
- `ui.rs` egui window — QR (white plate hugs code, quiet zone baked into texture), device count via lock-free `status.rs` atomics (GUI must NEVER take the server mutex — A16), update check/download/install, feedback dialog (same validation strings as Python). Window close → `std::process::exit(0)` (A15; with the mutex a leaked process now BLOCKS next launch). `--dry-run` forces headless (A17).
- **Icon = the mobile app's icon with TRANSPARENT background** (Akhil insisted twice: first no generic icon, then no dark square). Source `android-client/.../drawable/app_icon.png` (512px, has alpha) → `assets/app_icon.{ico,png}`, exe icon via `build.rs` + winresource, window via `include_bytes!`. Do NOT re-composite the #0C0C0C adaptive-icon background.
- `ws.rs` **Origin check (A18)**: any real web origin is 403'd unless exactly `https://appassets.androidplatform.net` (captured from real phone 1.3.22); absent/null/file:// allowed (native + pre-1.3.1). Closes the any-webpage-can-claim-a-gamepad hole (inherited from Python — server.py discards `_auth`; JS client sends hardcoded 0xABCD1234 so token validation would break wired mode). Found via a stale controller-ui preview page in the Claude desktop webview holding a phantom pad (Origin http://localhost:5174).
- `ws.rs` **link stability (A8b revised)**: idle-close ONLY connections holding a session; sessionless idle links are the phone's STANDING connection (open on every app screen) — keep + WS-ping (`lnk`) every 5s; dead tunnels die on write failure; `set_write_timeout(5s)`. Device count = `sessions.udp_count() + ws::live_links()` (counting WS sessions too would double-count). First version churned usb:1→17 and showed 0 devices with phone connected. `ws_ghost_test.py` PASS = close OR ping during silence.

**Machine-state gotchas:** `Start-Process -RedirectStandardOutput` launches the egui window minimized/off-screen at -25600,-25600 (= -32000/1.25 DPI) — launch-harness artifact, NOT a bug (A17). Volume-jumps-to-100% issue was diagnosed as GOBOULT buds AVRCP Absolute Volume (DisableAbsoluteVolume=0), NOT the server — zero XInput devices present during repro; fix is user-side registry + reboot; suggested testing with buds disconnected. ~10 stale Unknown Xbox-360 PnP entries accumulated from repeated server restarts (registry residue, harmless).

**Volume-at-max saga (RESOLVED product-side, 2026-07-21 late):** Akhil insisted users can't registry-edit → root-caused instead of workarounds. Guide forwarding is IDENTICAL Python/Rust (server.py:1012, allow_guide=True both, retested 2026-07-03 — NOT a Rust regression). Real bug = **app always-streaming (checklist B0)**: usbWS worker's ~200Hz re-blast had no screen gate and never cleared `latest` → ~250 identical pkt/s from the dashboard → pad existed whenever app open. **Fixed in 1.3.23/code 47** (worker `stream` flag + latest=null on stream-off, driven by ControllerScreen isActive), device-verified: dashboard = link only, zero packets, zero sessions. Pegged-stick experiment (24s full-deflection through real pad) moved volume 0% with Game Bar overlay closed → volume-walk needs overlay open (H button = Guide bit 14 opens it). AVRCP/GOBOULT buds absolute-volume = separate non-product issue. **APK note: phone's installed build is RELEASE-signed** (debug keystore mismatches — install app/build/outputs/apk/direct/release/, and `assembleDebug` does NOT rebuild release outputs; stale-release-APK trap cost one bad install.

**Packaging DONE (2026-07-21 night):** exe is now `windows_subsystem="windows"` (NO console popup; AttachConsole(parent) keeps dev-terminal prints; redirected launches unaffected — regression suite green) + MessageBoxW on the two invisible-fatal paths (already-running verified on screen, ViGEm-missing). Feedback endpoint live-tested OK (one [TEST] ticket in admin portal, source=pc). **Installer BUILT**: `apps/pc-server-rs/installer/` (own iss + build-installer.ps1; staging renames pc-server-rs.exe→GamepadServer.exe; bundles adb.exe+2 DLLs into {app} because find_adb probes next-to-exe and Rust doesn't self-extract adb; ViGEm MSIs referenced from ../pc-server/installer; NeedVigem64/86 Check actually wired — Python's iss defined VigemInstalled but never used it). Output 8.4MB, sha256 fbedaf88fd8520c1e5de99ebc01970f8060876a0bcb2d153a9c21c5ce66ede59. PS5.1 gotcha: cargo/ISCC write progress to stderr → script must NOT use ErrorActionPreference=Stop. NOTE: user's production install lives at **D:\gamepad server\** (Inno UsePreviousAppDir will upgrade there, not Program Files). Controller-screen streaming verified live (pkt climbing, gyro swinging) after Akhil tapped LAUNCH.

**Pending:** Akhil runs GamepadServer-Setup.exe (UAC — upgrade-over-1.1.17 test) + gameplay session on it, then **Register&Activate pc 2.0.1** (`GamepadServer-Setup-2.0.1.exe`, sha `668a7487…`) on the backend — still not done as of 2026-08-10. Task #8 remainder — native UDP engine same always-streaming pattern (~30Hz keep-alive in gamepad-engine.cpp, coordinator-gated not screen-gated) still leaks pads for Wi-Fi users; needs JNI pause-TX + isActive wiring (external-fun JNI gotcha) — should land before 1.3.23 store artifacts. 6 store artifacts → rebuild as 1.3.23 + website APK fix. Real WS auth (per-install token both ends) is a future Android release.
