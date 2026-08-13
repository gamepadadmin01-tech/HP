"""
virtualpad_mock.py — no-op virtual pad backend (macOS / CI / development).

Same API surface as vgamepad / virtualpad_linux, but the "pad" is just
recorded state: no driver, no kernel device. Lets the full server run on a
platform with no virtual-controller support so the network/GRX/QR layers can
be developed and tested. `simulate_rumble()` lets a test inject game
force-feedback and exercise the server->phone RMB path.
"""
import threading

__all__ = ["VX360Gamepad", "XUSB_BUTTON"]


class XUSB_BUTTON:
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


_instances = []          # live pads, for tests to reach (mock-only surface)
_instances_lock = threading.Lock()


class VX360Gamepad:
    def __init__(self):
        self._lock = threading.Lock()
        self.buttons = 0
        self.lt = 0
        self.rt = 0
        self.lx = 0.0
        self.ly = 0.0
        self.rx = 0.0
        self.ry = 0.0
        self.updates = 0
        self.closed = False
        self._notification = None
        with _instances_lock:
            _instances.append(self)

    def reset(self):
        with self._lock:
            self.buttons = 0
            self.lt = self.rt = 0
            self.lx = self.ly = self.rx = self.ry = 0.0

    def press_button(self, button):
        with self._lock:
            self.buttons |= button

    def release_button(self, button):
        with self._lock:
            self.buttons &= ~button

    def left_trigger(self, value):
        with self._lock:
            self.lt = int(value)

    def right_trigger(self, value):
        with self._lock:
            self.rt = int(value)

    def left_joystick_float(self, x_value_float, y_value_float):
        with self._lock:
            self.lx, self.ly = x_value_float, y_value_float

    def right_joystick_float(self, x_value_float, y_value_float):
        with self._lock:
            self.rx, self.ry = x_value_float, y_value_float

    def update(self):
        with self._lock:
            self.updates += 1

    def register_notification(self, callback_function):
        self._notification = callback_function

    def simulate_rumble(self, large, small):
        """Test hook: pretend the game sent force feedback."""
        cb = self._notification
        if cb is not None:
            cb(None, None, int(large), int(small), 0, None)

    def close(self):
        self.closed = True
        self._notification = None
        with _instances_lock:
            if self in _instances:
                _instances.remove(self)

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass


def live_pads():
    """Mock-only: list of currently-open pads (for tests)."""
    with _instances_lock:
        return list(_instances)
