GamepadOS - AOA direct-USB driver
=================================

WHAT THIS IS
  AOA (Android Open Accessory) is the lowest-latency WIRED transport (~1-2 ms):
  the PC talks to the phone over raw USB bulk endpoints, with no IP stack and no
  adb in the path. GamepadServer already contains the full AOA implementation and
  bundles the libusb backend it needs.

WHAT'S MISSING (this folder)
  Windows must bind the WinUSB driver to the GamepadOS USB accessory device
  (VID 18D1, PID 2D00 = accessory, 2D01 = accessory+adb) so the server can open
  it. That driver bind is the one manual step.

  Run  install-driver.bat  and follow the prompts (uses Zadig to bind WinUSB).

YOU PROBABLY DON'T NEED THIS
  Wi-Fi and USB-tethering work with no driver at all. USB-tethering already gives
  ~2.5-4 ms in practice, so AOA is a small additional gain for the cost of the
  driver bind. Only set this up if you specifically want the absolute lowest
  wired latency.

CAVEATS
  - Binding WinUSB to the phone's accessory interface disables adb/MTP for that
    device until you remove the driver (Device Manager -> Uninstall, tick
    "delete the driver software", then replug).
  - The accessory only appears (18D1:2D0x) after GamepadServer performs the AOA
    handshake over USB; if the device isn't listed in Zadig, make sure the phone
    is plugged in and the GamepadOS app is open.

ROADMAP TO ZERO-FRICTION (not yet done)
  - Option A (clean): ship an attestation-signed WinUSB INF + .cat (Microsoft
    Hardware Dev Center) so it installs with no warning.
  - Option B (free): libwdi auto-install on first run (one UAC prompt, shows an
    unsigned-driver warning).
  See apps/docs/AOA_REQUIREMENTS.md sections 5-6 for the full plan.
