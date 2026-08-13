# Plan B — AOA Direct-USB Transport: Requirements

> **Goal:** Lowest-possible wired latency (~1-2 ms) by talking **directly over USB**
> with no adb, no tethering, no network. The PC becomes the USB **host**; the phone
> becomes a USB **accessory** with two raw **bulk endpoints**.
>
> **Accepted trade-off:** every PC user installs a USB driver (shipped in the zip).
> This is the one thing that made AOA "not worth it" before — now it's in scope.

---

## 1. How AOA works (the protocol)

1. PC enumerates USB devices, finds the phone (initial VID/PID, e.g. Xiaomi).
2. PC sends the **AOA handshake** via USB control transfers:
   - `bRequest 51` (GET_PROTOCOL) → phone returns AOA version (≥1).
   - `bRequest 52` (SEND_STRING) ×6 → manufacturer, model, description, version, URI, serial.
   - `bRequest 53` (START_ACCESSORY) → phone **re-enumerates** in accessory mode.
3. Phone reappears as **VID `0x18D1`**, **PID `0x2D00`** (accessory) or **`0x2D01`** (accessory + adb).
4. PC re-opens it, claims the interface, gets **2 bulk endpoints** (IN + OUT).
5. Data flows as raw USB bulk transfers — phone→PC = input packets, PC→phone = ACK/rumble.

Reference: https://source.android.com/docs/core/interaction/accessories/aoa

---

## 2. PC side requirements (the server)

| Requirement | Detail |
|---|---|
| **USB library** | `pyusb` (libusb backend) OR native libusb. Must be bundled into `GamepadServer.exe` (PyInstaller). |
| **WinUSB driver** | The accessory device (`18D1:2D00/2D01`) needs a libusb-compatible driver (**WinUSB**) bound to it, or PyUSB can't open it. **This is the install-in-zip piece.** |
| **Driver installer** | Ship a signed **WinUSB INF + catalog**, or use `libwdi`/`wdi-simple.exe` to auto-bind WinUSB at first run. Options below. |
| **AOA handshake** | Implement the 51/52/53 control-transfer sequence; handle re-enumeration (wait + re-scan for `18D1:2D00`). |
| **Bulk I/O loop** | Read 20-byte packets from bulk IN → `apply_inputs()` (reuse existing). Write `b"ACK"+ts` to bulk OUT. |
| **Coexistence** | Keep UDP (Wi-Fi/tether) + WS (USB-debug) running; AOA is a 3rd transport, auto-selected when an accessory device appears. |
| **Device matching** | The handshake ID strings (manufacturer/model) MUST match the Android `accessory_filter.xml` exactly. |

### Driver-binding options (pick one)
- **A. Signed WinUSB INF** (best UX): get the INF **attestation-signed** via Microsoft Hardware Dev Center (~$, one-time). Installs cleanly, no warnings. Ship INF in zip + a one-click installer.
- **B. `libwdi` auto-install** (Zadig's engine): the server programmatically installs WinUSB on first run (UAC prompt). Unsigned → SmartScreen/driver warning unless we sign the bundled driver.
- **C. Bundle Zadig + instructions** (worst UX): user runs Zadig manually once. Only if A/B blocked.

> ⚠️ **Decision needed:** A (sign the INF) is the only "clean" path. B/C show a scary driver prompt. Since users install from the zip anyway, **B is likely acceptable for v1**, A for polish.

---

## 3. Android side requirements (the app)

| Requirement | Detail |
|---|---|
| **`res/xml/accessory_filter.xml`** | Declares manufacturer/model/version matching the PC's handshake strings. |
| **Manifest intent-filter** | `android.hardware.usb.action.USB_ACCESSORY_ATTACHED` on MainActivity, pointing at the filter. |
| **Accessory open** | `UsbManager.openAccessory(accessory)` → `ParcelFileDescriptor` → raw **file descriptor**. |
| **Transport** | Pass the **fd to the native C++ engine** (new JNI `initAccessoryNative(fd)`); the existing 1000 Hz SCHED_FIFO thread `write()`s 20-byte frames to the fd and `read()`s ACKs — reuses `currentPayload`, gyro, touch, latency. Cleanest reuse of the engine. |
| **Permission** | First connect shows "Use app with this USB accessory?" — handle + remember (checkbox). |
| **Mode switch** | When accessory mode is active, route input to the accessory fd instead of UDP/WS. |
| **Build** | No new SDK; `UsbManager`/`UsbAccessory` are standard. NDK change to add fd write/read mode. |

---

## 4. Shared protocol (unchanged)
- Reuse the **20-byte packet** (`<Q H B B B B B B I>`) and the **`"ACK"+8-byte timestamp`** reply. No format changes — only the *transport* changes (USB bulk instead of socket).

---

## 5. Zip package contents (what ships to players)
```
GamepadControllers-PC/
├── GamepadServer.exe          (with AOA + libusb + UDP + WS)
├── driver/
│   ├── gamepad_winusb.inf     (WinUSB bind for 18D1:2D00 / 2D01)
│   ├── gamepad_winusb.cat     (signed catalog)
│   └── install-driver.bat     (one-click install, or auto on first run)
├── SETUP.md
└── (existing ViGEmBus auto-install stays)
```

---

## 6. Risks & open questions
1. **Driver signing** — unsigned WinUSB triggers a warning / requires signing ($ + Dev Center account). Biggest open item.
2. **AOA + charging/adb** — accessory mode can coexist with adb (PID 2D01); confirm the phone still charges.
3. **Re-enumeration timing** — after START_ACCESSORY the device drops and reappears; the server must poll/wait robustly.
4. **Per-device ID strings** — must match exactly between PC handshake and `accessory_filter.xml`.
5. **Windows version coverage** — WinUSB works Win7+; test on Win10/11.
6. **Multiple phones / hubs** — match by our accessory VID/PID, not the phone's original.
7. **Fallback** — if AOA fails (driver missing), silently fall back to USB-debug (WS, ~5 ms) so it never hard-breaks.

---

## 7. Effort & milestones
1. **M1 — PC AOA proof-of-concept (~1 day):** PyUSB handshake + bulk echo against the phone in a throwaway script. Proves the driver + handshake work on this PC. *(Highest-risk first.)*
2. **M2 — Android accessory handler (~1 day):** manifest filter + open accessory + native fd write/read; loop input through.
3. **M3 — Server integration (~0.5 day):** AOA bulk loop → `apply_inputs`; auto-select transport; ACK path.
4. **M4 — Driver packaging (~0.5-1 day):** INF/libwdi installer in the zip; sign or accept warning.
5. **M5 — Test + fallback (~0.5 day):** latency measurement, AOA→WS fallback, on real hardware.

**Total: ~3.5-4 focused days**, with **driver signing** as the wildcard.

---

## 8. What I need from you (decisions)
1. **Driver path:** sign the INF (clean, ~$, Dev Center) **or** ship libwdi auto-install (free, shows a warning)? *(Recommend: start with libwdi/warning for v1.)*
2. **Keep WS as fallback?** *(Recommend: yes — AOA when driver present, WS otherwise.)*
3. **Go/no-go after M1:** the proof-of-concept tells us if AOA+driver actually works on target PCs before we invest in M2-M5.

> **Senior recommendation:** start with **M1 (PC proof-of-concept)** before anything else. If the handshake + WinUSB bind works on a real machine and shows ~1-2 ms in a bulk echo, green-light the rest. If the driver fight is too ugly, we stop having spent only a day.
