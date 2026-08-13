# Store listing text — draft, ready to paste into Play Console / Aptoide / Uptodown

## Short description (Play limit: 80 characters)
Turn your phone into a low-latency wireless (or USB) controller for your PC.

## Full description (Play limit: 4000 characters)

GamepadOS turns your Android phone into a wireless — or wired — game controller
for your Windows PC. No extra hardware, no dongles: your phone becomes a full
standard game controller that any PC game recognizes automatically.

HOW IT WORKS
Install the free GamepadServer app on your PC, scan the pairing QR code with
GamepadOS, and you're connected. Your phone's touchscreen becomes sticks,
buttons, and triggers; tilt the phone for gyro steering. Every input is
encrypted end-to-end before it ever leaves your phone.

CONNECT YOUR WAY
• Wi-Fi — scan a QR code and you're playing in seconds
• USB — plug in for the lowest possible latency and zero Wi-Fi dependency

BUILT FOR SPEED
The input engine samples at up to 1000 Hz and is written in native C++ for
minimal delay — wired connections measure around 2.5 ms.

MAKE IT YOURS
Don't like the default layout? Build your own: drag-and-drop buttons,
thumbsticks, and triggers into a custom controller shaped exactly for the
games you play. Save as many layouts as you want.

GYRO STEERING
Tilt-to-steer with a choice of racing or 3D-look modes, adjustable sensitivity
and dead zone, and haptic feedback synced to in-game rumble.

PRIVACY BY DESIGN
GamepadOS has no accounts, no analytics SDKs, no ads, and no cloud. Your
controller input travels directly from your phone to your PC over your own
network — it never touches our servers or anyone else's.

FREE
GamepadOS is free with no in-app purchases.

Requirements: a Windows PC running the free GamepadServer companion app, and
a shared Wi-Fi network (or a USB cable) between your phone and PC.

## Category
Tools (or: Productivity — pick whichever your Play Console account defaults
show as available; "Tools" is the closer fit for a device-utility app).

## Content rating notes
No user-generated content, no ads, no in-app purchases, no account/login,
camera used only for scanning the pairing QR code, no data leaves the device
except to the user's own PC on the local network. This should qualify for the
lowest content rating tier across all rating boards.

## Privacy policy URL
https://<your-live-domain>/privacy.html
(confirm the exact deployed domain before submitting — see privacy.html's
existing content, which is already accurate: no ads/analytics/tracking, only
the contact form collects anything, and that's clearly disclosed.)

## Data Safety form — quick-reference answers
- Does your app collect or share any of the required user data types? NO
  (no ads SDK, no analytics SDK — verified by direct manifest/dex/webview-bundle
  inspection of the shipped APK)
- Is data encrypted in transit? YES (GRX: X25519 + AES-128-GCM, phone↔PC only)
- Can users request data deletion? N/A — nothing is collected/stored off-device
- Camera permission: declared, used only to scan the pairing QR code
