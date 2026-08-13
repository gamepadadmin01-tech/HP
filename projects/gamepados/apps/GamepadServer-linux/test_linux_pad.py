"""
test_linux_pad.py — on-Linux self-test for virtualpad_linux.py.

Creates the virtual X360 pad, opens it back up as a consumer (like a game
would through evdev), and verifies buttons/axes/dpad/triggers, rumble
(FF upload -> callback), and clean unplug.

Run ON LINUX:  sudo python3 test_linux_pad.py
(or as a user with rw access to /dev/uinput and /dev/input/event*)
"""
import sys
import time

if not sys.platform.startswith("linux"):
    sys.exit("This self-test must run on Linux (needs /dev/uinput).")

import evdev
from evdev import InputDevice, ecodes as e, ff

import virtualpad_linux as vp

PASS = 0
FAIL = 0


def check(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"[ok] {name}")
    else:
        FAIL += 1
        print(f"[FAIL] {name}  {detail}")


def find_device(timeout=3.0):
    """Locate the freshly created virtual pad's /dev/input node."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        for path in evdev.list_devices():
            try:
                d = InputDevice(path)
            except Exception:
                continue
            if (d.info.vendor == 0x045E and d.info.product == 0x028E
                    and "X-Box 360" in d.name):
                return d
            d.close()
        time.sleep(0.1)
    return None


def drain(dev, wait=0.3):
    """Collect events for `wait` seconds -> {(type, code): last value}."""
    got = {}
    deadline = time.time() + wait
    dev.grab = getattr(dev, "grab", None)  # no grab needed, read shared
    while time.time() < deadline:
        ev = dev.read_one()
        if ev is None:
            time.sleep(0.01)
            continue
        if ev.type in (e.EV_KEY, e.EV_ABS):
            got[(ev.type, ev.code)] = ev.value
    return got


def main():
    rumbles = []
    pad = vp.VX360Gamepad()
    pad.register_notification(
        lambda _c, _t, large, small, _led, _u: rumbles.append((large, small)))

    dev = find_device()
    check("virtual pad appears in /dev/input with X360 identity (045e:028e)",
          dev is not None)
    if dev is None:
        return finish()

    caps = dev.capabilities()
    check("device advertises FF_RUMBLE (games will offer rumble)",
          e.EV_FF in caps and e.FF_RUMBLE in caps.get(e.EV_FF, []),
          str(caps.get(e.EV_FF)))

    # ── input path: buttons + axes + dpad + triggers ──
    pad.reset()
    pad.press_button(vp.XUSB_BUTTON.XUSB_GAMEPAD_A)
    pad.press_button(vp.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_LEFT)
    pad.left_trigger(value=200)
    pad.right_trigger(value=55)
    pad.left_joystick_float(x_value_float=1.0, y_value_float=1.0)   # up-right
    pad.right_joystick_float(x_value_float=-0.5, y_value_float=0.0)
    pad.update()
    got = drain(dev)
    check("BTN_A pressed", got.get((e.EV_KEY, e.BTN_A)) == 1, str(got))
    check("dpad left -> ABS_HAT0X = -1", got.get((e.EV_ABS, e.ABS_HAT0X)) == -1)
    check("LT/RT -> ABS_Z=200 / ABS_RZ=55",
          got.get((e.EV_ABS, e.ABS_Z)) == 200 and got.get((e.EV_ABS, e.ABS_RZ)) == 55)
    check("left stick: +Y(up) -> ABS_Y negative (xpad convention)",
          got.get((e.EV_ABS, e.ABS_X)) == 32767 and got.get((e.EV_ABS, e.ABS_Y)) == -32767)
    check("right stick X -0.5", got.get((e.EV_ABS, e.ABS_RX)) in range(-16400, -16350))

    pad.reset()
    pad.update()
    got = drain(dev)
    check("reset -> everything neutral",
          got.get((e.EV_KEY, e.BTN_A)) == 0
          and got.get((e.EV_ABS, e.ABS_HAT0X)) == 0
          and got.get((e.EV_ABS, e.ABS_Z)) == 0
          and got.get((e.EV_ABS, e.ABS_Y)) == 0)

    # ── rumble path: upload + play + stop + erase, like SDL does ──
    rumble = ff.Rumble(strong_magnitude=0xC000, weak_magnitude=0x6000)
    effect = ff.Effect(
        e.FF_RUMBLE, -1, 0,
        ff.Trigger(0, 0),
        ff.Replay(1000, 0),
        ff.EffectType(ff_rumble_effect=rumble),
    )
    eid = dev.upload_effect(effect)
    dev.write(e.EV_FF, eid, 1)          # play
    time.sleep(0.4)
    check("FF play -> callback (large=0xC0, small=0x60)",
          rumbles and rumbles[-1] == (0xC0, 0x60), str(rumbles))
    dev.write(e.EV_FF, eid, 0)          # stop
    time.sleep(0.4)
    check("FF stop -> callback zeros", rumbles and rumbles[-1] == (0, 0), str(rumbles))
    dev.erase_effect(eid)

    # ── clean unplug ──
    path = dev.path
    dev.close()
    pad.close()
    time.sleep(0.5)
    check("close() unplugs the device node", path not in evdev.list_devices())

    return finish()


def finish():
    print(f"\n{'ALL PASSED' if FAIL == 0 else 'FAILURES PRESENT'}: {PASS} ok, {FAIL} failed")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
