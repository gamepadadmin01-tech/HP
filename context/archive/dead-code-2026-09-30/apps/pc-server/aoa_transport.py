"""
AOA (Android Open Accessory) direct-USB transport — Milestone 1 proof-of-concept.

GOAL: lowest-possible WIRED latency (~1-2 ms) by talking to the phone directly over
USB bulk endpoints — no adb, no tethering, no IP stack. The PC is the USB *host*;
the phone becomes a USB *accessory* with two raw bulk endpoints (IN = phone->PC
input packets, OUT = PC->phone ACK/rumble).

This file is written so it can GRADUATE into the real server transport at M3:
  * `AoaTransport` is a reusable class (handshake + open + recv/send).
  * The 20-byte wire format and "ACK"+ts reply are reused UNCHANGED from server.py.
  * `python aoa_transport.py` runs the M1 PoC (find -> handshake -> open -> bulk loop
    with latency stats) so we can prove the driver + handshake work on a real PC
    BEFORE building the Android side (M2) and server integration (M3).

PREREQUISITES (see SETUP_AOA.md):
  1. pip install pyusb
  2. A libusb-1.0 backend DLL reachable on PATH (libusb-1.0.dll).
  3. A WinUSB driver bound to the device so PyUSB can open it. For M1 testing the
     fastest path is Zadig (bind WinUSB to the accessory device once); production
     ships an INF / libwdi auto-install (M4).

Reference: https://source.android.com/docs/core/interaction/accessories/aoa
"""

import os
import struct
import sys
import time

try:
    import usb.core
    import usb.util
except ImportError:  # pragma: no cover - environment hint only
    usb = None

# ── libusb backend resolution ─────────────────────────────────────────────────
# pyusb needs a libusb-1.0 backend DLL. We ship one (the `libusb` PyPI package's
# DLL, bundled by PyInstaller). Resolve it frozen-aware; fall back to pyusb's
# default search. Returns None if none is found, in which case AOA no-ops cleanly.
_BACKEND = None
_BACKEND_RESOLVED = False

def _libusb_dll_path():
    candidates = []
    if getattr(sys, "frozen", False):
        candidates.append(os.path.join(os.path.dirname(sys.executable), "libusb-1.0.dll"))
        mei = getattr(sys, "_MEIPASS", None)
        if mei:
            candidates.append(os.path.join(mei, "libusb-1.0.dll"))
    try:
        import libusb  # the `libusb` PyPI package bundles the DLL
        candidates.append(os.path.join(os.path.dirname(libusb.__file__),
                                       "_platform", "windows", "x86_64", "libusb-1.0.dll"))
    except Exception:
        pass
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None

def _backend():
    global _BACKEND, _BACKEND_RESOLVED
    if _BACKEND_RESOLVED:
        return _BACKEND
    _BACKEND_RESOLVED = True
    if usb is None:
        return None
    try:
        import usb.backend.libusb1 as _l1
        dll = _libusb_dll_path()
        if dll:
            _BACKEND = _l1.get_backend(find_library=lambda _x: dll)
        if _BACKEND is None:
            _BACKEND = _l1.get_backend()  # pyusb's default search as a fallback
    except Exception:
        _BACKEND = None
    return _BACKEND

# ── AOA control-request opcodes (USB vendor requests on the device) ───────────
AOA_GET_PROTOCOL = 51       # IN  : returns supported AOA protocol version (uint16 LE)
AOA_SEND_STRING = 52        # OUT : send one identifying string (by index)
AOA_START_ACCESSORY = 53    # OUT : tell the phone to re-enumerate in accessory mode

# bmRequestType values: vendor request, recipient = device.
_REQ_IN = usb.util.CTRL_IN | usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_RECIPIENT_DEVICE if usb else 0xC0
_REQ_OUT = usb.util.CTRL_OUT | usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_RECIPIENT_DEVICE if usb else 0x40

# String indices sent via AOA_SEND_STRING (order matters; all six are required).
AOA_STR_MANUFACTURER = 0
AOA_STR_MODEL = 1
AOA_STR_DESCRIPTION = 2
AOA_STR_VERSION = 3
AOA_STR_URI = 4
AOA_STR_SERIAL = 5

# These identity strings MUST match the Android `res/xml/accessory_filter.xml`
# (created in M2) EXACTLY (manufacturer + model + version), or the phone won't
# route the accessory to our app. Keep them here as the single source of truth.
ACCESSORY = {
    AOA_STR_MANUFACTURER: "GamepadOS",
    AOA_STR_MODEL: "GamepadController",
    AOA_STR_DESCRIPTION: "GamepadOS low-latency USB controller",
    AOA_STR_VERSION: "1.0",
    AOA_STR_URI: "https://gamepad.space",
    AOA_STR_SERIAL: "GP-AOA-0001",
}

# After START_ACCESSORY the phone re-appears under Google's accessory VID with one
# of these PIDs (accessory, accessory+adb, and the two audio-capable variants).
AOA_VID = 0x18D1
AOA_PIDS = (0x2D00, 0x2D01, 0x2D04, 0x2D05)

# Shared wire contract — IDENTICAL to server.py. Do NOT diverge.
PACKET_SIZE = 20
ACK_MAGIC = b"ACK"
RMB_MAGIC = b"RMB"

# Re-enumeration after START_ACCESSORY: the old device drops and the accessory
# re-appears. Poll for it.
REENUM_TIMEOUT_S = 8.0
REENUM_POLL_S = 0.10


class AoaError(Exception):
    pass


def _is_already_accessory(dev) -> bool:
    return dev.idVendor == AOA_VID and dev.idProduct in AOA_PIDS


def _looks_like_hub_or_root(dev) -> bool:
    # bDeviceClass 0x09 = USB hub. Skip hubs/root devices when scanning.
    return dev.bDeviceClass == 0x09


def find_accessory_capable_device(explicit_vid=None, explicit_pid=None):
    """Return a device that speaks AOA (GET_PROTOCOL >= 1).

    If explicit VID/PID are given, use only that device. Otherwise probe every
    non-hub device and keep the first that answers GET_PROTOCOL with a version.
    A device already in accessory mode is returned as-is (no handshake needed).
    """
    if usb is None:
        raise AoaError("pyusb not installed — run `pip install pyusb`.")
    if _backend() is None:
        raise AoaError("No libusb-1.0 backend found (ship libusb-1.0.dll next to the exe).")

    kwargs = {"find_all": True, "backend": _backend()}
    if explicit_vid is not None:
        kwargs["idVendor"] = explicit_vid
    if explicit_pid is not None:
        kwargs["idProduct"] = explicit_pid

    devices = list(usb.core.find(**kwargs))
    if not devices:
        raise AoaError("No USB devices found matching the filter. Is the phone plugged in?")

    # Already-accessory? Use it directly.
    for dev in devices:
        if _is_already_accessory(dev):
            print(f"[find] device already in accessory mode: {dev.idVendor:04x}:{dev.idProduct:04x}")
            return dev, True

    # Otherwise probe for AOA support.
    for dev in devices:
        if _looks_like_hub_or_root(dev):
            continue
        try:
            version = get_protocol(dev)
        except usb.core.USBError as e:
            # Most commonly: "no backend"/"access denied"/"entity not found" → driver issue.
            print(f"[find] {dev.idVendor:04x}:{dev.idProduct:04x} not probeable ({e}); "
                  f"if this is the phone, bind WinUSB to it (see SETUP_AOA.md).")
            continue
        if version >= 1:
            print(f"[find] AOA-capable device {dev.idVendor:04x}:{dev.idProduct:04x}, protocol v{version}")
            return dev, False

    raise AoaError("No AOA-capable device responded to GET_PROTOCOL. "
                   "Check the USB cable (must be a DATA cable), and that WinUSB is bound to the phone.")


def get_protocol(dev) -> int:
    """AOA GET_PROTOCOL (51) → protocol version (0 means not supported)."""
    data = dev.ctrl_transfer(_REQ_IN, AOA_GET_PROTOCOL, 0, 0, 2)
    return struct.unpack("<H", bytes(data))[0]


def send_identity_strings(dev) -> None:
    """AOA SEND_STRING (52) ×6 — manufacturer, model, description, version, uri, serial."""
    for index in range(6):
        payload = ACCESSORY[index].encode("utf-8") + b"\x00"
        sent = dev.ctrl_transfer(_REQ_OUT, AOA_SEND_STRING, 0, index, payload)
        if sent != len(payload):
            raise AoaError(f"SEND_STRING index {index} short write ({sent}/{len(payload)})")


def start_accessory(dev) -> None:
    """AOA START_ACCESSORY (53) — phone drops off the bus and re-enumerates."""
    dev.ctrl_transfer(_REQ_OUT, AOA_START_ACCESSORY, 0, 0, b"")


def wait_for_accessory(timeout=REENUM_TIMEOUT_S):
    """Poll until the phone re-appears as 18D1:2D0x, or time out."""
    deadline_polls = int(timeout / REENUM_POLL_S)
    for _ in range(deadline_polls):
        for pid in AOA_PIDS:
            dev = usb.core.find(idVendor=AOA_VID, idProduct=pid, backend=_backend())
            if dev is not None:
                print(f"[reenum] accessory present: {AOA_VID:04x}:{pid:04x}")
                return dev
        time.sleep(REENUM_POLL_S)
    raise AoaError("Phone did not re-enumerate in accessory mode after START_ACCESSORY "
                   "(check the on-phone 'Use app with this USB accessory?' prompt / M2 not built yet).")


def open_bulk_endpoints(dev):
    """Claim the accessory interface and return (ep_in, ep_out) bulk endpoints."""
    # On Windows WinUSB there is no kernel driver to detach; guard the call anyway.
    try:
        if dev.is_kernel_driver_active(0):
            dev.detach_kernel_driver(0)
    except (NotImplementedError, usb.core.USBError):
        pass

    dev.set_configuration()
    cfg = dev.get_active_configuration()
    intf = cfg[(0, 0)]

    ep_in = usb.util.find_descriptor(
        intf, custom_match=lambda e:
        usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_IN
        and usb.util.endpoint_type(e.bmAttributes) == usb.util.ENDPOINT_TYPE_BULK)
    ep_out = usb.util.find_descriptor(
        intf, custom_match=lambda e:
        usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_OUT
        and usb.util.endpoint_type(e.bmAttributes) == usb.util.ENDPOINT_TYPE_BULK)

    if ep_in is None or ep_out is None:
        raise AoaError("Accessory interface is missing a bulk IN/OUT endpoint pair.")

    usb.util.claim_interface(dev, intf.bInterfaceNumber)
    print(f"[open] claimed interface {intf.bInterfaceNumber}; "
          f"bulk IN=0x{ep_in.bEndpointAddress:02x} OUT=0x{ep_out.bEndpointAddress:02x} "
          f"maxpkt={ep_in.wMaxPacketSize}")
    return ep_in, ep_out


class AoaTransport:
    """Reusable AOA transport. recv() returns a 20-byte input packet; send_ack()
    writes the "ACK"+timestamp reply. server.py will use this at M3."""

    def __init__(self, dev, ep_in, ep_out):
        self.dev = dev
        self.ep_in = ep_in
        self.ep_out = ep_out

    @classmethod
    def connect(cls, explicit_vid=None, explicit_pid=None):
        dev, already = find_accessory_capable_device(explicit_vid, explicit_pid)
        if not already:
            version = get_protocol(dev)
            print(f"[handshake] GET_PROTOCOL → v{version}")
            send_identity_strings(dev)
            print("[handshake] sent 6 identity strings")
            start_accessory(dev)
            print("[handshake] START_ACCESSORY sent; waiting for re-enumeration…")
            usb.util.dispose_resources(dev)
            time.sleep(0.3)  # let the old node drop before we poll for the new one
            dev = wait_for_accessory()
        ep_in, ep_out = open_bulk_endpoints(dev)
        return cls(dev, ep_in, ep_out)

    def recv(self, timeout_ms=200):
        """Read one input packet. Returns bytes (len PACKET_SIZE) or None on timeout."""
        try:
            data = self.ep_in.read(self.ep_in.wMaxPacketSize, timeout=timeout_ms)
        except usb.core.USBError as e:
            if e.errno in (110, None) or "timeout" in str(e).lower():
                return None
            raise
        return bytes(data)

    def send_ack(self, timestamp):
        self.ep_out.write(ACK_MAGIC + struct.pack("<Q", timestamp), timeout=200)

    def send_rumble(self, large, small):
        """Push force-feedback to the phone: "RMB" + large + small (same framing as
        the UDP/WS transports)."""
        self.ep_out.write(RMB_MAGIC + bytes([large & 0xFF, small & 0xFF]), timeout=200)

    def close(self):
        try:
            usb.util.dispose_resources(self.dev)
        except Exception:
            pass


def _poc_bulk_loop(transport, duration_s=15.0):
    """M1 latency proof: read packets, parse timestamp, ACK, and print stats.

    Latency here is the read-cadence / round-trip floor over the USB link; the true
    finger→game number is measured on-device (M5). The point of M1 is to PROVE the
    handshake + WinUSB bind work and that bulk transfer is in the ~1-2 ms class.
    """
    print(f"[loop] reading bulk packets for {duration_s:.0f}s … (move sticks / press buttons)")
    count = 0
    intervals = []
    last = None
    t_end = time.perf_counter() + duration_s
    while time.perf_counter() < t_end:
        pkt = transport.recv(timeout_ms=200)
        if pkt is None:
            continue
        now = time.perf_counter()
        if last is not None:
            intervals.append((now - last) * 1000.0)
        last = now
        count += 1
        if len(pkt) >= 8:
            ts = struct.unpack("<Q", pkt[:8])[0]
            transport.send_ack(ts)

    if not intervals:
        print("[loop] received 0 packets. Handshake/enumeration may be fine, but the phone "
              "isn't writing to the bulk endpoint yet — that needs the Android accessory "
              "handler (M2). M1 still PASSES if find+handshake+open succeeded above.")
        return
    intervals.sort()
    avg = sum(intervals) / len(intervals)
    p50 = intervals[len(intervals) // 2]
    p99 = intervals[min(len(intervals) - 1, int(len(intervals) * 0.99))]
    print(f"[loop] packets={count} inter-packet ms: avg={avg:.2f} p50={p50:.2f} "
          f"p99={p99:.2f} min={intervals[0]:.2f} max={intervals[-1]:.2f}")
    print("[GO/NO-GO] If p50 is low single-digit ms and stable → GREEN-LIGHT M2-M5.")


def main(argv):
    vid = pid = None
    # Optional: `python aoa_transport.py 0x2717 0xff08` to target a specific phone.
    if len(argv) >= 2:
        vid = int(argv[1], 16)
    if len(argv) >= 3:
        pid = int(argv[2], 16)

    print("=== AOA Milestone 1 — PC proof-of-concept ===")
    if usb is None:
        print("FATAL: pyusb not importable. `pip install pyusb` and provide libusb-1.0.dll. "
              "See SETUP_AOA.md.")
        return 2
    try:
        transport = AoaTransport.connect(vid, pid)
    except AoaError as e:
        print(f"FAIL: {e}")
        return 1
    except usb.core.USBError as e:
        print(f"FAIL (USBError): {e}\n"
              "  → Almost always a driver issue: bind WinUSB to the device with Zadig, "
              "then retry. See SETUP_AOA.md.")
        return 1

    try:
        _poc_bulk_loop(transport)
    finally:
        transport.close()
    print("=== M1 done ===")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
