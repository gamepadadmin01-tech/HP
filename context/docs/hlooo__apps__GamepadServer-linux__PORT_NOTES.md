# Linux port — change summary (authored on the Mac, 2026-07-06)

This folder is a modified copy of `F:\hlooo\apps\pc-server\` (the drive was
mounted read-only on the Mac — NTFS). To merge back: copy these files into
`F:\hlooo\apps\pc-server\` from the Lenovo. The patched `server.py` REPLACES
the original — every change is platform-guarded, Windows behavior is
byte-for-byte identical (same ViGEm path, same netsh/msi/mutex code).

## New files
- `virtualpad_linux.py` — uinput virtual X360 pad (the ViGEm equivalent),
  incl. rumble via force-feedback upload servicing. Needs python-evdev.
- `virtualpad_mock.py`  — no-op pad backend (macOS/dev/CI).
- `test_linux_pad.py`   — on-Linux self-test for the uinput backend.
- `requirements-linux.txt`, `LINUX.md` (setup + run + packaging notes).

## server.py changes (all guarded, Windows-identical)
1. `_load_vgamepad()` — non-Windows: return `virtualpad_linux` (Linux) or
   `virtualpad_mock` (other POSIX) instead of importing vgamepad.
2. `_acquire_single_instance()` (module-level one) — POSIX branch: flock on
   a per-user lock file in tmp; same semantics as the Windows mutex.
3. `_gp_config_dir()` — POSIX: `$XDG_CONFIG_HOME/GamepadServer`
   (`~/.config/GamepadServer`); Windows unchanged.
4. NEW `_posix_ipv4_adapters()` (libc getifaddrs via ctypes, Linux+macOS) and
   `_ipv4_adapters()` selector; `_all_ipv4()` now uses the selector.
5. `_usb_tether_subnets()` — on POSIX matches tether interface NAMES
   (`usb0`/`rndis*`/`enx<mac>`) via new `_TETHER_IFACE_RE`; Windows keeps the
   adapter-description regex.
6. `boost_process_priority()` — POSIX: best-effort `os.nice(-5)`.
7. `PadManager._free()` — after the ViGEm unregister attempt, duck-typed
   `pad.close()` for non-ViGEm backends (kills the uinput device + FF reader
   thread immediately -> no ghost pad; mirrors the Windows unplug-now fix).
8. `_load_or_create_key()` — uses `_gp_config_dir()` (same path on Windows).
9. `_NO_WINDOW` — `0` on POSIX (passing CREATE_NO_WINDOW creationflags to
   subprocess raises ValueError off-Windows; this made the adb watcher dead
   on Linux even with adb installed).

## Verified (on the Mac, 2026-07-06)
- All files py_compile clean.
- Full-stack e2e 12/12: this patched server.py (mock backend) paired over
  live UDP with the REAL iOS client engine (compiled unmodified Swift
  UdpEngine+GrxSession): GRX handshake ESTABLISHED in the real server loop,
  first ENCRYPTED input decrypted and driving the pad, buttons/triggers/
  sticks land with correct XUSB mapping and sign conventions, game-side
  rumble reached the engine as RMB (180:90 then 0:0), disconnect freed the
  pad through the new close() path (no ghost).

## NOT yet verified (needs a real Linux machine)
- `virtualpad_linux.py` against a live kernel: run `python3 test_linux_pad.py`
  on Linux (see LINUX.md). The FF upload/erase servicing uses python-evdev's
  begin_upload/end_upload — if a version mismatch surfaces, fix HERE, not in
  server.py.
- A real game seeing the pad (Steam/SDL) + rumble feel.
- Packaging (PyInstaller on Linux / tarball / AppImage) — deliberately after
  hardware validation.
