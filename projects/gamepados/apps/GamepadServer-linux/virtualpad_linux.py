"""
virtualpad_linux.py — Linux virtual Xbox 360 pad backend for GamepadServer.

Drop-in replacement for the slice of the `vgamepad` module surface that
server.py uses (VX360Gamepad, XUSB_BUTTON): creates a kernel-level virtual
controller through /dev/uinput (python-evdev), presenting the exact identity
of a wired Xbox 360 pad (vid 045e / pid 028e, xpad-style capabilities) so
SDL2/SDL3, Steam/Proton and native Linux games enumerate it as a real
controller — the same role ViGEmBus plays on Windows.

Rumble: games upload FF_RUMBLE effects to the virtual device; a reader
thread services the uinput upload/erase requests and forwards play/stop to
the callback registered via register_notification(callback_function=...) —
the same (client, target, large, small, led, user_data) signature ViGEm's
notification gives server.py on Windows.

Requires: python-evdev and write access to /dev/uinput (see LINUX.md).
"""
import os
import select
import struct
import threading

from evdev import UInput, AbsInfo, ecodes as e

__all__ = ["VX360Gamepad", "XUSB_BUTTON"]


class XUSB_BUTTON:
    """XInput button bitmask — values identical to vgamepad/XUSB."""
    XUSB_GAMEPAD_DPAD_UP        = 0x0001
    XUSB_GAMEPAD_DPAD_DOWN      = 0x0002
    XUSB_GAMEPAD_DPAD_LEFT      = 0x0004
    XUSB_GAMEPAD_DPAD_RIGHT     = 0x0008
    XUSB_GAMEPAD_START          = 0x0010
    XUSB_GAMEPAD_BACK           = 0x0020
    XUSB_GAMEPAD_LEFT_THUMB     = 0x0040
    XUSB_GAMEPAD_RIGHT_THUMB    = 0x0080
    XUSB_GAMEPAD_LEFT_SHOULDER  = 0x0100
    XUSB_GAMEPAD_RIGHT_SHOULDER = 0x0200
    XUSB_GAMEPAD_GUIDE          = 0x0400
    XUSB_GAMEPAD_A              = 0x1000
    XUSB_GAMEPAD_B              = 0x2000
    XUSB_GAMEPAD_X              = 0x4000
    XUSB_GAMEPAD_Y              = 0x8000


# XUSB bit -> evdev key code (dpad handled separately via HAT0X/Y, like xpad)
_BTN_MAP = [
    (XUSB_BUTTON.XUSB_GAMEPAD_A,              e.BTN_A),
    (XUSB_BUTTON.XUSB_GAMEPAD_B,              e.BTN_B),
    (XUSB_BUTTON.XUSB_GAMEPAD_X,              e.BTN_X),
    (XUSB_BUTTON.XUSB_GAMEPAD_Y,              e.BTN_Y),
    (XUSB_BUTTON.XUSB_GAMEPAD_LEFT_SHOULDER,  e.BTN_TL),
    (XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_SHOULDER, e.BTN_TR),
    (XUSB_BUTTON.XUSB_GAMEPAD_START,          e.BTN_START),
    (XUSB_BUTTON.XUSB_GAMEPAD_BACK,           e.BTN_SELECT),
    (XUSB_BUTTON.XUSB_GAMEPAD_LEFT_THUMB,     e.BTN_THUMBL),
    (XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_THUMB,    e.BTN_THUMBR),
    (XUSB_BUTTON.XUSB_GAMEPAD_GUIDE,          e.BTN_MODE),
]

# uinput-side event constants (linux/uinput.h; not all python-evdev builds
# export them under ecodes).
_EV_UINPUT = getattr(e, "EV_UINPUT", 0x0101)
_UI_FF_UPLOAD = getattr(e, "UI_FF_UPLOAD", 1)
_UI_FF_ERASE = getattr(e, "UI_FF_ERASE", 2)

# struct input_event: struct timeval (2 native longs) + u16 type + u16 code +
# s32 value. Native sizes/alignment — 24 bytes on 64-bit.
_EVENT_FMT = "llHHi"
_EVENT_SIZE = struct.calcsize(_EVENT_FMT)

_MAX_EFFECTS = 16


def _caps(with_ff):
    caps = {
        e.EV_KEY: [code for _bit, code in _BTN_MAP],
        e.EV_ABS: [
            # xpad-identical ranges: sticks s16 (fuzz 16 / flat 128),
            # triggers 0-255, dpad as hat.
            (e.ABS_X,  AbsInfo(0, -32768, 32767, 16, 128, 0)),
            (e.ABS_Y,  AbsInfo(0, -32768, 32767, 16, 128, 0)),
            (e.ABS_RX, AbsInfo(0, -32768, 32767, 16, 128, 0)),
            (e.ABS_RY, AbsInfo(0, -32768, 32767, 16, 128, 0)),
            (e.ABS_Z,  AbsInfo(0, 0, 255, 0, 0, 0)),
            (e.ABS_RZ, AbsInfo(0, 0, 255, 0, 0, 0)),
            (e.ABS_HAT0X, AbsInfo(0, -1, 1, 0, 0, 0)),
            (e.ABS_HAT0Y, AbsInfo(0, -1, 1, 0, 0, 0)),
        ],
    }
    if with_ff:
        caps[e.EV_FF] = [e.FF_RUMBLE]
    return caps


class VX360Gamepad:
    """API-compatible subset of vgamepad.VX360Gamepad backed by uinput."""

    def __init__(self):
        ident = dict(name="Microsoft X-Box 360 pad",
                     vendor=0x045E, product=0x028E, version=0x0110,
                     bustype=e.BUS_USB)
        self._ff_ok = True
        try:
            try:
                self._ui = UInput(events=_caps(True), max_effects=_MAX_EFFECTS, **ident)
            except TypeError:
                # older python-evdev without the max_effects kwarg
                self._ui = UInput(events=_caps(True), **ident)
        except Exception:
            # FF unsupported by this python-evdev/kernel combo — controller
            # still works, just without rumble.
            self._ff_ok = False
            self._ui = UInput(events=_caps(False), **ident)

        self._lock = threading.Lock()
        self._buttons = 0
        self._lt = 0
        self._rt = 0
        self._lx = 0.0
        self._ly = 0.0
        self._rx = 0.0
        self._ry = 0.0
        self._written = {}           # evdev (type, code) -> last written value

        self._notification = None
        self._effects = {}           # effect id -> (large 0-255, small 0-255)
        self._active = set()         # effect ids currently playing
        self._gain = 0xFFFF
        self._last_rumble = (0, 0)

        self._stop = threading.Event()
        self._reader = None
        if self._ff_ok:
            t = threading.Thread(target=self._ff_loop, daemon=True,
                                 name="uinput-ff")
            t.start()
            self._reader = t

    # ── vgamepad-compatible input surface ───────────────────────────────

    def reset(self):
        with self._lock:
            self._buttons = 0
            self._lt = self._rt = 0
            self._lx = self._ly = self._rx = self._ry = 0.0

    def press_button(self, button):
        with self._lock:
            self._buttons |= button

    def release_button(self, button):
        with self._lock:
            self._buttons &= ~button

    def left_trigger(self, value):
        with self._lock:
            self._lt = max(0, min(255, int(value)))

    def right_trigger(self, value):
        with self._lock:
            self._rt = max(0, min(255, int(value)))

    def left_joystick_float(self, x_value_float, y_value_float):
        with self._lock:
            self._lx = max(-1.0, min(1.0, x_value_float))
            self._ly = max(-1.0, min(1.0, y_value_float))

    def right_joystick_float(self, x_value_float, y_value_float):
        with self._lock:
            self._rx = max(-1.0, min(1.0, x_value_float))
            self._ry = max(-1.0, min(1.0, y_value_float))

    def update(self):
        """Flush current state to the kernel (diff-only, one SYN per flush)."""
        with self._lock:
            b = self._buttons

            def _s16(f):
                return max(-32768, min(32767, int(round(f * 32767.0))))

            # vgamepad float sticks are XInput-style (+Y = up); evdev ABS_Y
            # is down-positive (xpad convention) -> negate Y.
            state = [
                (e.EV_ABS, e.ABS_X,  _s16(self._lx)),
                (e.EV_ABS, e.ABS_Y,  _s16(-self._ly)),
                (e.EV_ABS, e.ABS_RX, _s16(self._rx)),
                (e.EV_ABS, e.ABS_RY, _s16(-self._ry)),
                (e.EV_ABS, e.ABS_Z,  self._lt),
                (e.EV_ABS, e.ABS_RZ, self._rt),
                (e.EV_ABS, e.ABS_HAT0X,
                 (1 if b & XUSB_BUTTON.XUSB_GAMEPAD_DPAD_RIGHT else 0)
                 - (1 if b & XUSB_BUTTON.XUSB_GAMEPAD_DPAD_LEFT else 0)),
                (e.EV_ABS, e.ABS_HAT0Y,
                 (1 if b & XUSB_BUTTON.XUSB_GAMEPAD_DPAD_DOWN else 0)
                 - (1 if b & XUSB_BUTTON.XUSB_GAMEPAD_DPAD_UP else 0)),
            ]
            state += [(e.EV_KEY, code, 1 if b & bit else 0)
                      for bit, code in _BTN_MAP]

            wrote = False
            for etype, code, val in state:
                if self._written.get((etype, code)) != val:
                    self._ui.write(etype, code, val)
                    self._written[(etype, code)] = val
                    wrote = True
            if wrote:
                self._ui.syn()

    # ── rumble (force feedback) ─────────────────────────────────────────

    def register_notification(self, callback_function):
        self._notification = callback_function

    def _emit_rumble(self):
        large = small = 0
        for eid in self._active:
            l, s = self._effects.get(eid, (0, 0))
            large = max(large, l)
            small = max(small, s)
        large = large * self._gain // 0xFFFF
        small = small * self._gain // 0xFFFF
        if (large, small) == self._last_rumble:
            return
        self._last_rumble = (large, small)
        cb = self._notification
        if cb is not None:
            try:
                cb(None, None, large, small, 0, None)
            except Exception:
                pass

    def _ff_loop(self):
        fd = self._ui.fd
        buf = b""
        while not self._stop.is_set():
            try:
                r, _w, _x = select.select([fd], [], [], 0.2)
            except (OSError, ValueError):
                return
            if not r:
                continue
            try:
                buf += os.read(fd, _EVENT_SIZE * 64)
            except BlockingIOError:
                continue
            except OSError:
                return
            while len(buf) >= _EVENT_SIZE:
                _sec, _usec, etype, code, value = struct.unpack(
                    _EVENT_FMT, buf[:_EVENT_SIZE])
                buf = buf[_EVENT_SIZE:]
                self._handle_ff_event(etype, code, value)

    def _handle_ff_event(self, etype, code, value):
        if etype == _EV_UINPUT and code == _UI_FF_UPLOAD:
            try:
                upload = self._ui.begin_upload(value)
                eff = upload.effect
                if eff.type == e.FF_RUMBLE:
                    r = eff.u.ff_rumble_effect
                    self._effects[eff.id] = (r.strong_magnitude >> 8,
                                             r.weak_magnitude >> 8)
                else:
                    # non-rumble effect types (periodic/constant): keep the id
                    # known so play/stop stays consistent, but contribute 0
                    self._effects[eff.id] = (0, 0)
                upload.retval = 0
                self._ui.end_upload(upload)
                # re-upload of a playing effect takes hold immediately
                if eff.id in self._active:
                    self._emit_rumble()
            except Exception:
                pass
        elif etype == _EV_UINPUT and code == _UI_FF_ERASE:
            try:
                erase = self._ui.begin_erase(value)
                self._effects.pop(erase.effect_id, None)
                self._active.discard(erase.effect_id)
                erase.retval = 0
                self._ui.end_erase(erase)
                self._emit_rumble()
            except Exception:
                pass
        elif etype == e.EV_FF:
            if code == e.FF_GAIN:
                self._gain = max(0, min(0xFFFF, value))
            elif value > 0:
                self._active.add(code)
            else:
                self._active.discard(code)
            self._emit_rumble()

    # ── lifecycle ────────────────────────────────────────────────────────

    def close(self):
        """Unplug the virtual controller NOW (server.py calls this from
        PadManager._free so a disconnected phone's pad never lingers)."""
        self._stop.set()
        t = self._reader
        if t is not None and t is not threading.current_thread():
            t.join(timeout=1.0)
        self._reader = None
        self._notification = None
        try:
            self._ui.close()
        except Exception:
            pass

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass
