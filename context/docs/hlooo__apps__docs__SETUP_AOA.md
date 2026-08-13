# AOA Direct-USB — Milestone 1 Setup & Go/No-Go

> **Why M1 first:** AOA's only real risk is the **WinUSB driver bind** on a real PC.
> M1 proves the handshake + driver + bulk endpoints work in ~1 day. If it's green we
> build M2–M5; if the driver fight is ugly we stop, having spent only a day.
> Code: [`apps/pc-server/aoa_transport.py`](../pc-server/aoa_transport.py).

## What M1 proves
1. PyUSB can open the phone over USB on this PC.
2. The AOA handshake (GET_PROTOCOL 51 → SEND_STRING×6 52 → START_ACCESSORY 53) works.
3. The phone re-enumerates as `18D1:2D0x` and exposes a **bulk IN/OUT** endpoint pair.
4. Bulk transfer latency is in the **~1–2 ms class** (the whole point).

## Prerequisites
1. **Python deps:** `pip install pyusb`
2. **libusb backend:** put `libusb-1.0.dll` somewhere on `PATH` (e.g. next to the script
   or in `System32`). Download from the libusb releases (the `MS64\dll` build for 64-bit Python).
3. **A real USB *data* cable** (many charge-only cables have no data lines — silent failure).
4. **WinUSB bound to the phone** so PyUSB can claim it:
   - For M1 testing, the fastest path is **[Zadig](https://zadig.akeo.ie/)**: run it,
     *Options → List All Devices*, select the phone, choose **WinUSB**, click *Replace/Install Driver*.
   - **Important:** binding WinUSB to the phone's normal interface will **disable adb/MTP**
     for that device. To undo: Device Manager → the device → *Uninstall device* (tick *delete driver*) → replug.
   - Production (M4) ships a signed INF / `libwdi` auto-install bound specifically to
     `18D1:2D00`/`2D01`, so the user's normal phone mode is untouched.

## Run it
```bash
cd apps/pc-server
python aoa_transport.py
# or target a specific phone by initial VID/PID (hex):
python aoa_transport.py 0x2717 0xff08
```

### Expected output (success path)
```
=== AOA Milestone 1 — PC proof-of-concept ===
[find] AOA-capable device 2717:ff08, protocol v2
[handshake] GET_PROTOCOL → v2
[handshake] sent 6 identity strings
[handshake] START_ACCESSORY sent; waiting for re-enumeration…
[reenum] accessory present: 18d1:2d01
[open] claimed interface 0; bulk IN=0x81 OUT=0x01 maxpkt=512
[loop] reading bulk packets for 15s …
```
- If you get to `[open] claimed interface …` → **the driver + handshake WORK (M1 core PASS).**
- Receiving actual packets in `[loop]` needs the Android side (M2) to open the accessory
  and write — until M2 exists, 0 packets is expected and **M1 still passes** on the handshake.

### Common failures
| Symptom | Cause | Fix |
|---|---|---|
| `pyusb not installed` / `No backend available` | missing pyusb or libusb DLL | install both (above) |
| `USBError: Access denied` / `Entity not found` on probe | no WinUSB bound | Zadig → WinUSB on the device |
| `No AOA-capable device responded` | charge-only cable, or non-AOA device | swap to a data cable; pass explicit VID/PID |
| `did not re-enumerate` | START_ACCESSORY ok but no accessory node | check phone screen prompt; some phones need adb/MTP enabled first |

## Decisions needed (from AOA_REQUIREMENTS.md §8) — defaulting per the doc's recommendation
- **Driver path:** start with **libwdi auto-install (free, shows a one-time warning)** for v1;
  sign the INF later for polish. *(Change if you'd rather pay for signing up front.)*
- **Keep WS fallback:** **yes** — AOA when the driver is present, WebSocket otherwise, so it never hard-breaks.

## Go/No-Go gate
- **GREEN** (build M2–M5): reach `[open] claimed interface …` and, once M2 lands, see low
  single-digit-ms inter-packet timing in `[loop]`.
- **RED** (stop / rethink): can't bind WinUSB without breaking the phone, or handshake fails
  across test PCs.

## Roadmap after a green M1
- **M2 (Android):** `res/xml/accessory_filter.xml` (must match the strings in `aoa_transport.py`'s
  `ACCESSORY` dict), manifest `USB_ACCESSORY_ATTACHED` intent-filter, `UsbManager.openAccessory()`
  → `ParcelFileDescriptor` → new JNI `initAccessoryNative(fd)`. The native TX thread already built
  for low latency (event-driven send, redundancy, RT priority) just `write()`s/`read()`s the fd
  instead of the UDP socket — **maximal reuse**.
- **M3 (server):** drive `AoaTransport.recv()` → existing `apply_inputs()`; auto-select transport;
  ACK via `send_ack()`.
- **M4:** driver packaging in the zip. **M5:** on-device latency + AOA→WS fallback.
