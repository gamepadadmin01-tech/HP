---
name: gamepados-double-pad-bug
description: "GamepadOS 'two virtual gamepads' root cause: transport coordinator gated usbWS.disconnect() on isOpen(), letting a zombie WebSocket worker claim a second pad"
metadata: 
  node_type: memory
  type: project
  originSessionId: 664c6c96-23e9-4864-92eb-4e269c0d4182
  modified: 2026-07-21T03:16:14.150Z
---

**Two virtual controllers for one phone** (seen in the PC gamepad detector
2026-07-20). Root-caused from the server log, which is the fastest diagnostic:

```
Controller session +10.66.39.130 (active=1)   ← phone, UDP over USB-tether
Controller session +usb:1        (active=2)   ← SAME phone, over USB-debug WebSocket
```

**Cause:** `server.py`'s `start_adb_reverse_watcher` re-creates the
`adb reverse tcp:7777` tunnel **on every server start**, and the server grants a
virtual pad for **every open WebSocket** (`padmgr.acquire`, ~line 1155). On the
phone, the transport coordinator in `App.tsx` called
`if (w.isOpen()) w.disconnect();` — but `disconnect()` is the ONLY thing that
clears the worker's internal `enabled` flag, and it was gated on the socket
already being open. A worker that is **enabled but not yet connected** (tunnel
down, retrying every 1 s in its own loop) slips past that guard forever, then
connects the instant a tunnel reappears → second pad.

Trigger sequence: WS enabled as the auto-mode fallback (happens whenever there's
no engine and no tether — e.g. right after an app crash) → tunnel disappears →
tunnel returns while the native tether/Wi-Fi engine is live.

**Fix (shipped):** call `w.disconnect()` **unconditionally** in all three
coordinator branches (wireless-protection, `tether`, `auto`). It's idempotent
and cheap — one worker postMessage per 1.5 s reconcile.

**Rule: gate `connect()`, never `disconnect()` — `isOpen()` is not `enabled`.**

This is the remaining hole in the June 2026 "device connects twice" fix (that
fix added the coordinator, but with this gate). NOT caused by Phase 3 native
input — Phase 3 was exonerated by checking phone telemetry
(`usbWS_open:false, engineRunning:true` = one transport) and PC processes (one
server instance) before blaming it.

**Diagnostic recipe:** phone side `AndroidBridge.getNetworkTelemetryJson()` +
`window.__usbWS.isOpen()` via CDP; PC side `Get-NetUDPEndpoint -LocalPort 7777`
and the server's `Controller session +/-` log lines.

Related: [[realtime-latency-stack]], [[kotlin-jni-internal-mangling]].
