# GamepadOS — Session Handoff (2026-07-04)

> **Fresh session: read this file first.** It captures the exact state so we can resume.
> Also loaded automatically: `~/.claude/projects/F--/memory/MEMORY.md` (project memories).

---

## CURRENT LATEST VERSIONS (shipped set)

| App | Version | File in `F:\hlooo\website\backend\downloads\` | SHA-256 |
|---|---|---|---|
| Android | **1.3.0** (versionCode **22**) | `GamepadOS-1.3.0.apk` | `4425155061594BA6E6C52ADE44165FC020401023665ED57706EF4CCF39202D8D` |
| PC | **1.1.16** | `GamepadServer-Setup-1.1.16.exe` | `2353F100965CAFB035918582CFA49525D0E57072E8F5B268AF7861ED51355A65` |

- Previous set was 1.2.9 (code 21) / 1.1.15 — still on the phone until the new APK is installed.
- Website download page SHA-256 (`website/frontend/index.html` `.dl-trust`) already updated to the PC 1.1.16 hash above.
- APK 1.3.0 release-signed (cert SHA-256 `5b5537c6…`), contains all 3 ABIs (arm64-v8a + armeabi-v7a + x86_64) + the fresh controller-ui bundle. PC exe rebuilt GRX-aware (42.8 MB).
- All older versions preserved in the downloads folder (nothing overwritten).
- **UPDATE 2026-07-05:** APK 1.3.0 rebuilt TWICE more after this doc was first written (same version/code 22, never activated): (a) gyro indicator redesigned to user spec — top edge above GYRO toggle, edge-to-edge, 6.5px thick, no glow, behind buttons; (b) opaque silhouette fills added to play widgets (Widgets.tsx/GamepadWidgets.tsx/App.tsx) so the bar can't bleed through semi-transparent buttons. FINAL sha = the `44251550…` in the table (supersedes `6380D6BB…` and intermediates `E1F16AE4…`/`64E23202…`/`33ec76a7…`). Downloads + `GamepadOS.apk` + releases-archive all byte-identical. Installed on the phone via adb, md5-verified MATCH, launched OK.

## ROLLBACK POINT (revert here if needed)
`F:\hlooo\releases-archive\`
- `v1.3.0-android\` — APK + `src\` (App.tsx, Widgets.tsx, GamepadWidgets.tsx, Dialogs.tsx, build.gradle.kts, MainActivity.kt, GrxCrypto.kt, gamepad-engine.cpp)
- `v1.1.16-pc\` — installer + `src\` (server.py, grx_session.py, grx_crypto.py, GamepadServer.iss, .spec, requirements.txt)
- Prior points preserved: `v1.2.9-android\`, `v1.1.15-pc\` (and earlier).
- `releases-archive/README.md` documents every fix. Archived hashes are byte-identical to downloads.

---

## WHAT WAS FIXED THIS SESSION

### Android 1.2.7 → 1.2.9 (controller-ui, `apps/controller-ui/src/app/`)
- **Pairing wireless-drop**: `handleManualConnect` in App.tsx resets sticky `gp_wired_pref` to "auto" (QR path already did).
- **Gyro 3D**: CALIBRATE button moved inline beside the GYRO toggle (was overlapping at top-center).
- **Racing gyro bar**: removed the stray `borderBottom` line under the slider.
- **LT/RT triggers** (`components/Widgets.tsx` `TriggerPill`): resting color was already cyan (`RED_NORM`=cyan there — the real renderer). Fixed the top gloss from an off-center **rounded rect** → **centered ellipse** to match all other buttons. (Note: `GamepadWidgets.tsx` `TriggerBlock` is a DIFFERENT, unused component — an earlier edit there was a no-op.)

### PC 1.1.14 → 1.1.15 (`apps/pc-server/server.py`, `grx_session.py`)
- **USB-tether auth**: new ctypes `GetAdaptersAddresses` enumeration (`_win_ipv4_adapters`) + tether-aware token-0 rule (`is_usb_tether_client`). Fixes "tether never connects since 1.1.9".
- **GRX misroute killing the UDP thread**: `is_handshake` now length-checks (`_HS_MIN_LEN`); handlers wrapped so a bad frame can't kill the loop ("dead until restart" bug).
- **Pad/XInput-slot migration**: single-device Wi-Fi↔tether switch keeps the same pad/slot (player 1 stays player 1). Guarded to `len(sessions)==1` so multi-device never steals.
- **Ghost-pad leak**: `_free` now `vigem_target_x360_unregister_notification` + `pad.cmp_func=None` + `s.pad=None` → pad unplugs immediately (was lingering via a ref cycle, squatting slot 0).
- **No ACK without a pad**: 5th device (past 4-pad XInput cap) shows disconnected, not fake-connected.
- **Xbox Guide (🎮)**: now forwarded on ALL transports incl. tether — old "Game Bar resets RNDIS adapter" retested live and does NOT reproduce on Win11 26200.
- **Multi-device verified** (loopback-alias simulator + XInput polling): 2 same-subnet, 2 diff-subnet concurrent, 1-device switch, 3 devices, 4-cap + 5th-rejected, WS+UDP mixed → all independent pads, 0 ghosts.

---

## ⏳ PENDING — needs the USER (owner access; agent cannot do these)
*(Status re-verified 2026-07-05 22:00)*
1. ~~Upgrade installed PC server~~ **DONE** — registry shows Gamepad Server **1.1.16** installed 2026-07-04.
2. Admin portal → **📦 Releases** → Register & Activate **PC 1.1.16** + **App 1.3.0** (needs RELEASE_KEY). **← the main remaining step** (until then `/api/version` serves the old set and the in-app updater won't offer the new versions).
3. ~~Redeploy frontend~~ **DONE** — website repo committed ("release: update GamepadOS to 1.3.0", correct author) and pushed; `main` == `origin/main`, Vercel auto-deploys owner-authored pushes. Worth a quick glance at the live site to confirm.
4. **On-device validation of the 1.3.0/1.1.16 gyro + latency pass** — APK is installed on the phone (md5-verified 2026-07-05); the play-test itself remains: encrypted (GRX) input still drives the pad after the seal-gate change; STEER_SIGN/PITCH_SIGN direction (flip if tilt-right steers left / look-Y inverted); tilt-throttle feel + sign; smooth-deadzone feel; RTT shows no regression.
5. One real in-app-updater test per platform (per `F:\hlooo\RELEASE.md`) — after step 2.
6. **Open thread from 2026-07-05 session:** user said admin-portal features were missing; a full check found NO missing features anywhere (repo in sync, last portal commits July 2, nothing uncommitted). Question "which features did you mean?" is still unanswered.

## WHAT WAS DONE — 23-enhancement gyro + latency pass (1.2.9→1.3.0 / 1.1.15→1.1.16)
Origin: a multi-agent analysis workflow proposed 30 enhancements, adversarially verified against the code + 20-byte wire contract → 23 survived. All 23 addressed; wire format unchanged; builds verified (tsc + vite clean, gradle assembleRelease OK all-3-ABIs release-signed, PyInstaller OK, GRX self-tests 12/12).

**Native/server/Kotlin:**
- **GRX seal gated on `doSend`** (gamepad-engine.cpp ~L303) — was sealing on every ~500 Hz idle poll and discarding it; now only on real sends. Biggest heat/jitter win.
- **GRX `Cipher` reused** across seals (GrxCrypto.kt Sender) — no per-packet JCE provider lookup.
- **`SO_PRIORITY=6` (WMM AC_VO)** added in applyLowLatencyTos.
- **Adaptive keep-alive** 30→60 Hz while rumble active (gamepad-engine.cpp ~L283).
- Removed shipped **`Log.d("GYRO")`** diagnostic + dead **`fusionOrient`** field; **OneEuro class defaults** aligned to shipped 2.8/0.5.
- **ACK moved after `apply_inputs`** (server.py) — off the input→pad path.

**App.tsx (browser-preview verified):** smooth subtract-and-rescale **deadzone** (no-op at default 0); **scale60 fix** (gyro injected in normalized space, bypasses the hidden ~8% radial deadzone); **racing recenter** (CALIBRATE now in both modes); **2D look indicator** for 3D mode; **tilt-throttle** setting (localStorage `gyro_throttle`, default OFF, racing-only, threaded through DashboardScreen/TabSystem/ControllerScreen); fixed misleading "raw" comment; expo kept; extrapolation documented as deliberate no-go.

**3 items deliberately DEFERRED (coded-risk, not applied blind):** per-pad ViGEm lock (concurrency unverifiable w/o hardware, multi-pad-only); base64→binary JS bridge (verifier: skip — marginal, off hot path, WebView regression risk); GRX cached jbyteArray (subsumed by seal-gate). Revisit with a device if desired.

**⚠️ Still device-unverified (guesses in shipped code):** `STEER_SIGN=1.0`/`PITCH_SIGN=-1.0` (MainActivity.kt ~L96) — flip if tilt-right steers left / 3D look-Y inverted. Tilt-throttle Y sign (`lsYn - gy`) may need flipping. Both are behind CALIBRATE/default-OFF so shipping default is safe.

**REGRESSION AUDIT (multi-agent, post-build):** reviewed pairing / buttons / rumble / UI-smoothness against the actual changes. Result: **3/4 clean.** Pairing "ACK-after-apply could flap the link" concern investigated + **refuted** (apply_inputs early-returns on unchanged reports before ViGEm update(), so keep-alives always ACK; a flap needs the pad genuinely dead). Buttons + rumble clean. UI: found + **fixed** one low-severity cosmetic bug — 3D look-dot Y didn't recenter when gyro toggled off while tilted (added `targetBy = 0` to the gyro-off branch, App.tsx useGyro). PC exe/installer unaffected (client-only fix).

**UI LAYERING — indicator BEHIND buttons (user request):** the gyro moving indicator (racing tilt bar + 3D dot) rendered on TOP of the gamepad buttons and overlapped BACK / LT / RT. Fix in two parts (App.tsx ControllerScreen): (1) extracted the indicator (bar+dot) out of the z-10 HUD into its own `zIndex:0` layer (controls stay in the z-10 HUD, tappable); (2) **raised the button canvas from `z-0` to `z-[5]`** so it paints ABOVE the z-0 indicator. NOTE: equal `z-0` + DOM-order was NOT enough — a stacking quirk kept the indicator on top; the explicit higher canvas z-index is what actually put it behind. Proven in browser preview with an opaque-bar occlusion test (buttons/sticks/LT/RT paint over the bar; 0 console errors). (3) The bar/dot were still floating in the empty TOP margin above the controller graphic (nothing there to occlude them), so the indicator layer was moved to `top:0;bottom:0;justify-center` — **vertically CENTERED** over the controller — so the bar now runs across the middle BEHIND the buttons (dpad/sticks/LT/RT paint over it). Verified on the real device via adb screencap. **APK 1.3.0 rebuilt** → the hash in the table above (`6380D6BB…`) is the FINAL build; installed + confirmed on the user's phone. Client-only; PC side unchanged.

---

## BUILD QUICK-REF
- **Controller-ui bundle**: `cd apps/controller-ui && npm run build`, then `robocopy dist ..\android-client\app\src\main\assets\dist /MIR`.
- **APK**: `cd apps/android-client && .\build_apk.bat` → `app\build\outputs\apk\release\app-release.apk` (release-signed, keystore cert `5b5537c6…`; JDK at `F:\hlooo\tools\jdk\jdk-17.0.19+10`, gradle `F:\hlooo\tools\gradle-8.5`).
- **PC exe**: `cd apps/pc-server && python -m PyInstaller GamepadServer.spec --noconfirm` → `dist\GamepadServer.exe`.
- **Installer**: `cd apps/pc-server/installer && "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" GamepadServer.iss /Q` → `Output\GamepadServer-Setup.exe`.
- **Version bump spots** (RELEASE.md): server.py `APP_VERSION`, installer .iss `AppVersion`+`VersionInfoVersion`, build.gradle.kts `versionCode`+`versionName`, website/frontend/index.html `.dl-trust` SHA-256.
- Pairing key (for test tooling): `%LOCALAPPDATA%\GamepadServer\pairing_key.txt`. Server UDP port **7777**.

---

## NEW WORKSTREAM 2026-07-06 — iOS client port (user request: "iOS and Mac")
- **`F:\hlooo\apps\ios-client\`** — complete authored-on-Windows Xcode project for the iPhone controller app: same React UI bundle (WebBundle/index.html, byte-identical to APK 1.3.0's), `Shim/bridge-shim.js` recreating window.AndroidBridge (sync getters backed by native pushes — REQUIRED, see spec/JS_BRIDGE_USAGE.md §F), Swift sources (UdpEngine = 20B wire + ACK/RTT + RMB + broadcast lock-on; GrxSession = CryptoKit GRX port; MotionEngine = gyro math + 1€ filter; Haptics/QRScanner/MainViewController/AppDelegate), project.yml (XcodeGen), README_MAC_SETUP.md (build runbook), IOS_PORT_SPEC.md + spec/*.md (byte-exact contracts extracted by a 4-agent workflow from the shipped code).
- **Verified here:** shim + real UI bundle in browser preview — UI boots in native mode, 0 console errors, all sync getters parse, pushed telemetry drives the CONNECTED badge (`WebBundle/preview-test.html` harness; serve `apps/ios-client` and open it to re-test).
- **NOT verified (needs the Mac):** Swift compilation (authored without a compiler — expect syntax fixes, protocol constants are contract), GRX byte-compat vs `python grx_crypto.py` vectors, on-device pairing. Runbook says: install Claude Code on the Mac, open this folder, paste Xcode errors.
- **Server-side: ZERO changes needed** — the iPhone talks to shipped PC 1.1.16 like any Android phone.
- **Mac SERVER (MacBook hosting games) still unresearched** — the research agent hit the account usage limit. Core problem: ViGEm is Windows-only; macOS options to evaluate = DriverKit HID dext (restricted entitlement), root IOHIDUserDevice helper, or v1 keyboard/mouse mapping via CGEventPost. Do a proper researched verdict before writing code.

## OPTIONAL / PARKED WORK
- **Remote Gamepad (SmartFusionLabs) reverse-engineering** — reference app analysis. Full findings in memory `reference_remote_gamepad_protocol.md`. Mechanism = **hybrid TCP-control(52528) + UDP-input(negotiated port, e.g. 63179)**, binary length-prefixed, Kotlin/Ktor/ViGEm. NOT captured: exact UDP gyro byte layout (needs a UDP-MITM that rewrites the negotiated port `0xF6CB` in the TCP handshake). Interception method that worked: move real server to 52529 via `%APPDATA%\SmartFusionLabs\Remote Gamepad\my_settings\default.json`, Python TCP proxy on 52528→52529, phone reconnects via SAVED connection (not fresh QR). pktmon does NOT work here (0 packets on this Win11 build; also can't sniff loopback).
- **AOA direct-USB sub-1ms path** — ~90% coded both sides, parked at the WinUSB-driver M1 gate. See `apps/docs/SETUP_AOA.md`.

---
*Handoff written 2026-07-04. To resume: "refer to F:\hlooo\SESSION_HANDOFF_2026-07-04.md".*
