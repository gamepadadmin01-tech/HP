---
name: reference-app-remote-gamepad
description: "The commercial \"Remote Gamepad\" (SmartFusionLabs) app the user benchmarks GamepadOS against — install path, stack, and how it makes wireless \"just work\""
metadata: 
  node_type: memory
  type: reference
  originSessionId: d25c4125-8bdb-4992-860c-7a0390a74714
---

The user benchmarks their app (GamepadOS / [[project-layout]]) against the commercial **"Remote Gamepad" by SmartFusionLabs**, installed locally at `C:\Program Files\SmartFusionLabs\Remote Gamepad\`. Inspect it there when asked "how does the real app do X".

**Stack (from notices.json + binary strings):** Kotlin/Native (kotlinx.* + Ktor for networking) compiled to a single ~8.4 MB exe; **libui-ng** for the light-themed GUI; **libusbmuxd** (iOS USB) + bundled **adb** (Android USB); **ViGEmClient/ViGEmBus** for the virtual pad. Licenses live as files in a `notices\` folder (notices.json), NOT a GUI button.

**How wireless "just works" for everybody (the key finding):** it is plain LAN UDP via Ktor — **NO cloud relay, STUN, mDNS, or NAT traversal** (verified: no such strings/domains in the binary). The ONLY thing that makes it reliable is its firewall strategy: a **program-scoped** Windows Firewall rule — `allow program="<exe>", Port=Any, Profile=Any (incl. Public), UDP+TCP` — added **at install time** by its admin installer. Program+Port=Any sidesteps the bind-fallback-port problem and Public-network blocking with no router config.

**Applied to our app:** `ensure_firewall_rule()` in pc-server/server.py now creates the same program-scoped rule (+ a port-range fallback) and cleans up legacy per-path rules. The complete match would be a proper installer (Inno Setup) doing firewall + ViGEmBus driver at install → zero runtime UAC. AP/client isolation is NOT solved by either app (USB is the guaranteed fallback both bundle); it's rare, not the "everybody" problem — the firewall is.
