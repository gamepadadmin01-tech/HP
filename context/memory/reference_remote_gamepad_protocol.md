---
name: reference-remote-gamepad-protocol
description: "How the SmartFusionLabs 'Remote Gamepad' reference app (GamepadOS's model) does phone->PC input+gyro"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 7193ec24-f60b-44f2-b841-183b2efb57c5
  modified: 2026-08-13T11:40:11.443Z
---

**Remote Gamepad** by SmartFusionLabs (`C:\Program Files\SmartFusionLabs\Remote Gamepad\Remote Gamepad.exe`, v1.10.2) is the commercial reference app GamepadOS was modeled on. Reverse-engineered its phone→PC mechanism on 2026-07-04 (binary strings + live TCP proxy interception on the user's own PC/phone).

**Tech stack (from bundled `notices/notices.json`):** Kotlin/Native + **Ktor** (networking) + **ViGEmClient/ViGEm Bus** (virtual Xbox pad injection — same driver GamepadOS uses) + **adb** (Android USB) + **libusbmuxd** (iPhone-over-USB) + QR code gen + **Sentry** (crash telemetry). Config at `%APPDATA%\SmartFusionLabs\Remote Gamepad\my_settings\default.json` → `{"connectionport":52528}`.

**THE MECHANISM = HYBRID TWO-CHANNEL (the "impressive" part):**
- **TCP control channel** on the configured port (default **52528**, `0.0.0.0`): handshake, pairing, and it **negotiates a UDP port**. Binary length-prefixed protocol: `[2-byte LE length][type byte][payload]`. Captured handshake: PHONE→PC `0f00 01 0d 0000003d 20bf0ab7d4a444` (15B), PC→PHONE `0800 01 0a 00 cbf6 01` (8B). The `cb f6` = `0xF6CB` = **63179** = the UDP port the PC tells the phone to stream to.
- **UDP input+gyro stream** on the negotiated dynamic port (**63179** this session, `0.0.0.0`): the real-time low-latency channel. After the TCP handshake, ALL input (buttons + gyro) jumps to UDP — which is why a TCP-only proxy sees the handshake then silence.
- **USB path:** adb tunnels the phone's socket to a PC **loopback** dynamic port (observed `127.0.0.1:58588↔58587`); control still 52528. Windows loopback traffic is NOT capturable by pktmon (bypasses NDIS) — a hard limitation, not a tooling error. pktmon ALSO failed to capture Wi-Fi packets on this Win11 26200 build (0 packets every time) — its `start --capture` logs only counters here; use a TCP/UDP proxy instead.

**vs GamepadOS:** same core insight (UDP for low-latency input) but Remote Gamepad adds a dedicated reliable TCP control channel ALONGSIDE the UDP — cleaner separation of setup/reliability vs hot-path input. GamepadOS folds control into UDP (+ a WebSocket for USB-debug) and is more advanced on security (GRX X25519+AES-GCM encryption, which Remote Gamepad lacks).

**NOT captured:** exact byte layout INSIDE the UDP gyro packet (which sensor field / int vs float / send rate). Would require a UDP-MITM that rewrites the negotiated port (0xF6CB) in the TCP handshake to route UDP through a logger — deferred as diminishing-returns detail.

**Interception method that worked (their own PC+phone, legit protocol analysis):** move real server to 52529 via config, run a Python TCP proxy on 52528→52529, phone reconnects via SAVED connection (NOT fresh QR, which encodes the new port and bypasses). Gotcha: the app's bundled adb inherits the listen socket handle — kill all `SmartFusionLabs`-path processes to free the port. Everything restored to 52528 after.

**Firewall:** wireless works out of the box because the installer adds a **program-scoped Windows
firewall rule** at install time (not a port rule). Worth copying — it is why their wireless pairing
"just works" for users who would never open a port manually.

Related: [[project-realtime-latency-stack]], [[project-grx-crypto]].
