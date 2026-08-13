# GamepadOS iOS client — Mac build & install runbook

The iPhone app is a port of the Android client: the SAME React controller UI
(`WebBundle/index.html`, byte-identical to the APK's bundle) hosted in a
WKWebView, with the native layer (UDP engine, GRX encryption, gyro, haptics,
QR pairing) rewritten in Swift. It talks to the SAME PC server (1.1.16) over
the same 20-byte UDP protocol + GRX handshake — no server changes needed.

## What you need
- The MacBook with **Xcode 15+** (App Store, free). First launch installs the
  iOS platform — accept it.
- Your **iPhone** with a USB cable (or same-Wi-Fi wireless debugging).
- An **Apple ID** signed into Xcode (Settings → Accounts). A free account is
  enough to install on your own phone; the app re-signs every 7 days (just hit
  Run again). Public distribution later = $99/yr Apple Developer + App Store.
- This folder, synced to the Mac (F:\ is Google Drive — install Google Drive
  on the Mac, or copy `apps/ios-client/` over by AirDrop/USB).

## One-time project generation
The Xcode project is generated from `project.yml` (never hand-edited):

```bash
brew install xcodegen        # install Homebrew first if missing: https://brew.sh
cd .../apps/ios-client
xcodegen                      # -> GamepadOS.xcodeproj
open GamepadOS.xcodeproj
```

No Homebrew? Manual fallback: File → New → Project → iOS App (UIKit App
Delegate lifecycle, product name GamepadOS, bundle id `com.gamepad.client`),
delete the template sources, drag in `Sources/` (copy items, add to target),
drag `WebBundle/` as a **folder reference** (blue folder!) and `Shim/` as
resources, then copy the `info.properties` keys from `project.yml` into the
target's Info tab (camera + local-network usage strings are REQUIRED).

## Signing + first install
1. Target **GamepadOS** → Signing & Capabilities → check *Automatically manage
   signing*, pick your Team (your Apple ID).
2. If the bundle id collides, change it to something unique, e.g.
   `com.gamepad.client.<yourname>`.
3. Plug in the iPhone → select it as the run destination → **Run** (⌘R).
4. First run on a free account: on the phone, Settings → General → VPN &
   Device Management → trust your developer certificate.
5. iOS will ask for **Local Network** permission on first connect and
   **Camera** on first QR scan — allow both.

## Pairing test (same flow as Android)
1. PC: GamepadServer 1.1.16 running, phone and PC on the same Wi-Fi.
2. iPhone: open GamepadOS → Scan QR → point at the server's QR.
3. Expect: dashboard shows connected, buttons drive the virtual pad, RTT in
   the telemetry readout, rumble buzzes the Taptic Engine.

## When Swift compile errors appear (they will — this port was authored on
## Windows without a Swift compiler)
Fastest loop: install Claude Code on the Mac (`npm i -g @anthropic-ai/claude-code`),
run it in this folder, and paste the Xcode error list. The porting contracts
live in `IOS_PORT_SPEC.md` (wire format, GRX bytes, bridge semantics) — the
fixes should never change protocol constants, only Swift syntax/API usage.

## Known v1 gaps (deliberate)
- No USB/AOA transport (iPhone has no RNDIS tether path) — Wi-Fi only.
- No in-app self-update (Apple forbids it; App Store handles updates).
- `getWifiInfoJson` returns placeholders — iOS needs special entitlements for
  band/RSSI.
- Charge bypass / battery-optimization prompts are Android-only, stubbed.

## File map
- `project.yml` — XcodeGen spec (bundle id, Info.plist keys, folder refs)
- `Shim/bridge-shim.js` — recreates `window.AndroidBridge` for the React UI
- `Sources/AppDelegate.swift` — window + JS-driven orientation lock
- `Sources/MainViewController.swift` — WKWebView host, bridge dispatch, state pump
- `Sources/UdpEngine.swift` — 20-byte wire protocol + ACK/RTT + rumble RX
- `Sources/GrxSession.swift` — GRX handshake + AES-GCM sealing (CryptoKit)
- `Sources/MotionEngine.swift` — CoreMotion tilt (roll/pitch + 1€ filter)
- `Sources/Haptics.swift`, `Sources/QRScanner.swift`
- `WebBundle/index.html` — the built controller UI (copy from the Android
  assets after every `npm run build`; keep the two in lockstep)
