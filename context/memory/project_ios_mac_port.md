---
name: project-ios-mac-port
description: "iOS/Mac expansion: iPhone controller app authored at D:\AKHIL\HP\projects\gamepados\apps\ios-client (needs Mac to build), Mac server unresearched"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6e066367-dbe3-4e6f-9dc2-c6f66607f246
---

**Started 2026-07-06 (user: "make our app available for iOS and Mac", has iPhone + MacBook).**

**iOS client — AUTHORED, not yet compiled.** `D:\AKHIL\HP\projects\gamepados\apps\ios-client\`: same React UI bundle as APK 1.3.0 in a WKWebView; `Shim/bridge-shim.js` recreates window.AndroidBridge with SYNCHRONOUS getters backed by `window.__iosPush` state pushes at ≤120 Hz (Promise getters would kill gyro/telemetry/rumble — spec/JS_BRIDGE_USAGE.md §F). Swift: UdpEngine (20B wire, ACK/RTT EMA 0.8/0.2, RMB seq, 3x redundancy, 30/60 Hz keep-alive, broadcast lock-on, no-BYE), GrxSession (CryptoKit; flat HKDF salt=transcript-hash — NOT the doc's two-stage; counter pre-increment; tag-last; 41B), MotionEngine (up=-gravity, roll=atan2(ux,uy), pitch=-asin(uz) degrees, 1€ 2.8/0.5), Haptics, QRScanner (→ window.onQRScanned, backslash-first escaping). project.yml = XcodeGen. Contracts in spec/*.md are NORMATIVE for compile-fixing. Browser-preview verified: UI boots native-mode, 0 errors (`WebBundle/preview-test.html`, serve apps/ios-client). PC server 1.1.16 needs ZERO changes.

**Next:** user copies the folder to the MacBook by hand (there is NO cloud sync — D: is a local disk) → Xcode 15+ + `xcodegen` → fix compile errors (install Claude Code on Mac; constants untouchable) → free-Apple-ID sideload (7-day resign) → pair vs 1.1.16 → check STEER_SIGN/PITCH_SIGN + GRX vectors vs `python grx_crypto.py`. Public release later needs $99/yr Apple Developer + App Store review (no iOS sideload distribution).

**Mac SERVER (MacBook hosts games): UNRESEARCHED** — research agent died on usage limit 2026-07-06. ViGEm is Windows-only. Candidates to research before coding: DriverKit HID dext (restricted entitlement), root IOHIDUserDevice helper, CGEventPost keyboard/mouse mapping as driverless v1. Python server logic itself is portable; only the virtual-pad backend is the problem.

**Version-parity gotcha:** iOS reports 1.3.0/code 22 (matches Android) so the shared UI's update card compares against the Android manifest; when Android ships code 23 the iOS build will falsely offer an "update" — gate the update card by platform before that.

Related: [[project-grx-crypto]], [[project-realtime-latency-stack]], [[feedback-no-auto-push]].
