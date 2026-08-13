# GamepadServer on Linux

The same `server.py` that ships on Windows, with the virtual controller
backed by the kernel's **uinput** facility instead of ViGEmBus. Games (native,
SDL, Steam/Proton) see a real wired Xbox 360 pad — vid `045e` / pid `028e`,
xpad-style axes — and rumble flows back to the phone through the standard
force-feedback interface. The phone app (Android 1.3.0 / iOS) needs **zero
changes**: same QR pairing, same 20-byte UDP protocol, same GRX encryption.

## What's different from Windows

| Piece | Windows | Linux |
|---|---|---|
| Virtual pad | ViGEmBus driver (`vgamepad`) | kernel uinput (`virtualpad_linux.py`, python-evdev) |
| Rumble | ViGEm notification callback | uinput force-feedback (FF_RUMBLE) |
| Config dir | `%LOCALAPPDATA%\GamepadServer` | `~/.config/GamepadServer` |
| Firewall setup | automatic (netsh + UAC) | manual, one command (see below) |
| USB tether auth | RNDIS adapter detection | `usb0`/`rndis*`/`enx*` interface detection |
| AOA / WS wired modes | bundled adb.exe | uses `adb` from PATH if installed (optional) |
| In-app updater | downloads the .exe installer | not offered (update via your package/tarball) |

## Setup (once)

```bash
# 1. Dependencies (Debian/Ubuntu; adapt for your distro)
sudo apt install python3 python3-pip python3-tk python3-pil.imagetk gcc python3-dev
pip3 install -r requirements-linux.txt
#    (evdev builds against kernel headers; on Arch: pacman -S python-evdev,
#     on Fedora: dnf install python3-evdev — the distro package also works)

# 2. Give your user access to /dev/uinput (else run the server with sudo)
sudo tee /etc/udev/rules.d/60-gamepadserver-uinput.rules >/dev/null <<'EOF'
KERNEL=="uinput", MODE="0660", GROUP="input", OPTIONS+="static_node=uinput"
EOF
sudo usermod -aG input "$USER"
sudo udevadm control --reload-rules && sudo udevadm trigger
# log out and back in for the group to apply; ensure the module is loaded:
sudo modprobe uinput

# 3. Open the UDP port if you run a firewall (most desktops don't):
sudo ufw allow 7777:7786/udp        # ufw
# or: sudo firewall-cmd --add-port=7777-7786/udp --permanent && sudo firewall-cmd --reload
```

## Verify the virtual pad works (before involving the phone)

```bash
python3 test_linux_pad.py
```

All checks should say `[ok]` — it creates the pad, reads it back like a game
would (buttons, sticks, dpad, triggers), exercises rumble both directions,
and confirms clean unplug. If it fails with a permissions error, re-check
step 2 (or run once with `sudo` to confirm everything else works).

Bonus checks with real tools:
- `evtest` → pick "Microsoft X-Box 360 pad" while the server + phone run
- Steam → Settings → Controller → the pad appears when a phone connects
- `fftest /dev/input/eventX` exercises rumble from the game side

## Run

```bash
python3 server.py
```

The QR window opens (tkinter). Scan with the phone exactly like on Windows.
The pairing key persists in `~/.config/GamepadServer/pairing_key.txt`.

Headless box (no display)? The GUI needs X/Wayland today — run under a
desktop session, or ask for a `--headless` mode as a follow-up (the UDP core
has no GUI dependency).

## Notes & current limitations (v1)

- **Wi-Fi and USB-tether transports work.** The adb/WebSocket wired mode
  engages only if `adb` is installed and the phone has USB debugging on
  (optional; Wi-Fi is the primary path). AOA direct-USB needs pyusb/libusb
  and is off unless present — same as Windows.
- The in-app updater is Windows-only (it downloads a .exe). Linux updates
  ship as a new tarball/package.
- Multi-pad: up to 4 phones, same as Windows — each gets its own uinput pad.
- Rumble comes from games that emit force feedback on Linux (SDL games,
  Steam Input, Proton/Wine XInput titles). Some native titles never rumble
  on Linux — that's the game, not the phone link.

## Packaging a release (later)

PyInstaller works on Linux the same way (`pyinstaller --onefile server.py`),
but build ON Linux (ideally the oldest distro you want to support). A
`.desktop` launcher + tarball, an AppImage, or a Flatpak are all viable;
decide when the port is validated on real hardware.
