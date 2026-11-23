# CamOS overnight session — 2026-11-23

The owner gave phone access over USB debugging ("make 60 fps smoother, consistent, high quality … shut down after").
Everything below was tested on his phone (Xiaomi 2311DRK48I, MediaTek) through adb, with the PC log
(`%LOCALAPPDATA%\GamepadServer\camos.log`) and recordings from "CamOS Camera" made with ffmpeg.
Latest test APK: `test-builds/camos/CamOS-0.6.0-test-DO-NOT-UPLOAD.apk` (installed on the phone).

## 60 fps — solved for this phone (Premium)

- What the camera offers apps (`adb shell dumpsys media.camera`): normal mode tops out at **30 fps**; Android's
  high-speed mode offers only 1920×1080 at 120/240 fps, delivered in batches of 4/8.
- High-speed mode gives the picture engine (a "preview" surface) only 30 a second, so **direct 60 fps** feeds the
  camera straight into the video chip (which keeps 60 of the 120) and the PC turns the picture upright.
- Measured: camera 59–61 fps, phone sends 60, and an app on the PC gets **2,700 frames in 45 s, every gap 16.7 ms**,
  picture upright (also when the app started in portrait and turned to the "Wide" shape).
- Direct mode now shows the **phone preview** too (the camera's second output, 30 fps on the phone; the PC still
  gets 60), fitted and turned like the normal preview.
- Free users: 60 fps chip locked with a short explanation; they stream 720p30 with the watermark (verified).
- The Premium list now says "Real 60 fps, even on phones that need the camera's fast mode".
- MediaTek's own 60 fps setting for normal mode (`hfpsMode`) is implemented but **switched off** (`TRY_MTK60`): the
  camera accepted it and still gave 30 to an app.

## Bugs found and fixed on the phone

1. **Two streams fighting after a quick restart** (Stop→Start, a shape change, the switch into direct mode): the old
   network thread kept reconnecting next to the new one; they knocked each other off the PC every second. Every
   Start now has a number; old threads, late camera callbacks and the old cleanup leave the new stream alone.
2. Switching lens didn't restart when the frame rate changed (front 30 → back 60 stayed at 30). Fixed.
3. After direct mode, the normal preview was shifted with a black bar (buffer size left at 1920×1080). Fixed.
4. The "Your phone gives CamOS 30 fps… try 720p" tip showed on the front camera (which has no 60) and gave wrong
   advice for this phone. Now only when 60 was really asked for, with correct wording.
5. With the USB tunnel gone, a phone paired over USB said **"Your Gamepad Server is too old"**. It now looks for the
   PC on Wi-Fi and, if not found, says "No USB connection to your PC. Plug the cable back in, or use the same
   Wi-Fi as the PC." (no misleading download hint).

## Smooth Wi-Fi mode (UDP) — spare pieces

- While the PC reports more than 2 % loss, the phone adds one spare piece per 6 (an XOR of them); the PC rebuilds a
  lost piece at once instead of asking. Fake phone at 9 % loss, 20 s: 457 of 707 lost pieces rebuilt instantly,
  asks to resend 462 → 120, 0 pictures skipped. Wait before skipping a picture 220 → 350 ms.
- **Not tested on the real phone over Wi-Fi**: the phone's Wi-Fi was off; turned on for the test it joined
  "IIITS_Student_EXT" (10.0.97.x), which cannot reach the PC on "IIITS_Student" (10.0.5.x, ping 0/5). Wi-Fi was
  turned off again afterwards. Test this when both are on the same network (or the phone's hotspot).

## Later the same night (0.6.1)

- The live label shows the quality really sent (direct mode always sends the camera's 1080p, even with 720p chosen).
- "Tall" shape in direct 60: the PC turns the picture 90° clockwise. Verified with the fake phone's test pattern
  through "CamOS Camera" (red stripe left → top). On the real phone the lens was covered, so not checked by eye.
- Incident: a tap/swipe meant for CamOS landed while a call was ringing and may have answered it. All later phone
  automation first checks that no call is ringing/active and that CamOS is the app in front (scratchpad `safe.sh`).

## Left for the owner

- Wi-Fi smooth mode on the real phone (see above).
- Choose whether 60 fps for free users should stay locked on phones like this one (current: Premium).
- Old DLL copies in `test-builds/camos/camos_vcam.old-*.dll` can be deleted (needs his OK).
