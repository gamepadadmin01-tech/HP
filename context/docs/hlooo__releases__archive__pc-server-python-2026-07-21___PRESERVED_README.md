# PRESERVED SNAPSHOT — Python PC server (`apps/pc-server`) — 2026-07-21

**This is a full, byte-verified snapshot of the WORKING, SHIPPED GamepadOS PC
server**, taken immediately before starting the Phase 2 (new server) rewrite.

## ⚠️ Why this matters

`F:\hlooo\apps\` is **NOT a git repository**. There is no version control, no
cloud version history, no File History, and no VSS on F: (it is a local NTFS
disk). **Timestamped copies like this one are the ONLY rollback that exists.**
If the live `apps/pc-server` is damaged, this folder is the recovery source.

## What was captured

- Source: `F:\hlooo\apps\pc-server`
- Taken: 2026-07-21
- **41 files, 125.1 MB**
- **Integrity: every file SHA256-verified identical to the source at copy time.**
  Hashes recorded in `SHA256SUMS.txt` (format: `<sha256>  <relative path>`).
- Excluded: `__pycache__/` only — regenerable Python bytecode, and volatile
  because the server was running during the copy. Nothing else was skipped.

## State of the code in this snapshot

- `server.py` (100 KB, modified 2026-07-20 18:07) — includes the **Phase 1
  latency optimisations** (timeBeginPeriod(1), DSCP-EF, SO_SNDBUF).
- `server.py.bak-20260720-180600` — the pre-Phase-1 version, kept as-is.
- `dist/GamepadServer.exe` — the PyInstaller build. **NOTE: this exe is OLDER
  than `server.py`** (pre-Phase-1); source changes do not ship until the exe is
  rebuilt (`python -m PyInstaller GamepadServer.spec --noconfirm`).
- Also includes: `aoa_transport.py` (AOA direct-USB), `grx_crypto.py` /
  `grx_session.py` (GRX encrypted input), `GamepadServer.spec`, `installer/`,
  `driver/` (Zadig/WinUSB scaffolding), `build/`, and the earlier
  `_preserve_pre-slim/` snapshot.

## Restore

```powershell
# full restore (DESTRUCTIVE to the live folder — back it up first)
robocopy 'F:\hlooo\releases\archive\pc-server-python-2026-07-21' 'F:\hlooo\apps\pc-server' /E

# or recover a single file
Copy-Item 'F:\hlooo\releases\archive\pc-server-python-2026-07-21\server.py' 'F:\hlooo\apps\pc-server\server.py'
```

Verify integrity any time:
```powershell
Get-Content SHA256SUMS.txt | ForEach-Object {
  $h,$p = $_ -split '\s+',2
  $a = (Get-FileHash (Join-Path $PSScriptRoot $p) -Algorithm SHA256).Hash
  if ($a -ne $h) { "MISMATCH: $p" }
}
```

## 🔒 The contract any replacement server MUST honour

The **20-byte wire format is immutable** and shared by three files
(`controller-ui/src/app/App.tsx`, `android-client/.../gamepad-engine.cpp`,
`pc-server/server.py`) which must agree **byte-for-byte**:

```
<Q H B B B B B B I   little-endian, 20 bytes
ts(u64) buttons(u16) LT RT LSx LSy RSx RSy (u8, centre 128) authToken(u32)
```

A previous Rust server rewrite (`pc-server-rust/`, ~3.1 GB) was **deleted**
because it invented its own format (HMAC + i16 sticks + 16-char key) and
therefore dropped **every** packet. **Build a wire-conformance test against this
preserved Python server BEFORE switching anything over.**

Other behaviour a replacement must keep: ACK = `"ACK"` + echoed 8-byte
send-timestamp (drives the RTT badge); rumble = `"RMB"` + large + small; one
virtual pad per UDP source; and the WebSocket bridge allocates a pad per open
socket (see the double-pad note in
`docs/handoffs/SESSION_HANDOFF_2026-07-20C-phase3.md` §6.2).

**Do not delete this snapshot until a replacement server is proven on-device.**
