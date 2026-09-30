# RemoteGamepad — PC Server Setup

Turn your phone into a wireless/USB controller for Windows games.

## Quick start (2 steps)

1. **Run `GamepadServer.exe`.**
   - **First launch only:** it will offer to install the **ViGEmBus** controller
     driver (needed to create the virtual gamepad). Click **OK**, accept the
     Windows permission prompt, and let the short install finish. The driver
     installer is **built in** — nothing to download.
   - Windows may also ask to allow a **firewall rule** — click **Yes** (lets your
     phone reach the server). One time only.
   - After the driver installs, start `GamepadServer.exe` again if prompted — a
     window with a **QR code** appears.

2. **Connect your phone.**
   - **Wi-Fi:** put phone + PC on the same network, open the RemoteGamepad app,
     scan the QR code.
   - **USB (lowest latency):** plug in, turn on **USB tethering** in Android
     settings — the app connects automatically (no scan).

The server window shows **CONNECTED** once your phone links up.

## Notes & troubleshooting

- **Driver prompt** — ViGEmBus is a free, open-source, signed driver (by nefarius).
  The install is one-time per PC. If you ever decline it, just re-run the server
  and click OK at the prompt.
- **SmartScreen "unknown publisher"** — click **More info → Run anyway**. (The app
  is unsigned for now; expected and safe.)
- **Phone won't connect over Wi-Fi** — both devices must be on the **same** network
  (not a guest/isolated one). Some routers block device-to-device traffic; if so,
  use USB tethering instead.
- **Phone won't connect over USB** — enable **USB tethering** (Android Settings →
  Network/Connections → Hotspot & tethering → USB tethering).
- **Server won't start** — a `GamepadServer_error.log` is written next to the exe;
  open it (or send to support).

## Requirements

- Windows 10 or 11 (64-bit)
- Phone + PC on the same Wi-Fi, OR a USB cable with USB tethering
- (ViGEmBus driver — installed automatically on first run)
