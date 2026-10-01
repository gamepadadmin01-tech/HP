# 2026-10-01 — Held buttons dropped once a minute (1.4.6), fixed before release

Final build: `releases/mobile/1.4.6/actual/final-held-input-fix-2026-10-01/`. Same files in
`store-assets/google-play/`. Backups of the three source files: `context/recovery/held-input-fix-2026-10-01/`.

## The report
Holding LT as the accelerator in F1: every so often the pressed glow vanished with the finger still
down, the car stopped, and the button had to be pressed again. It happened on Wi-Fi and USB tethering,
and affected the whole controller. Wi-Fi also felt laggy and jittery on a 5 GHz hotspot. The owner
asked for the latency display and the time countdown to be removed from the controller.

## Root cause (mine, from 2026-09-30)
`PlaytimeChip` re-sent the native geometry (`setNativeInputGeometry`) on every label change: once a
minute, and every second in the final minute. `NativeInputEngine.setGeometry` ends with
`clearAllInputLocked()`, so every re-send released every held button. The App.tsx comment claiming
"setGeometry keeps held fingers" was never true and was not checked. Over USB tethering the native
path is used as well, which is why it happened on both links.

## Fixes
1. Time chip removed from the controller (`App.tsx`; `PlaytimeChip.tsx` is now unused but kept). The
   NX_CHANGED re-send listener is gone.
2. `NativeInputEngine.setGeometry`: when matrix + widgets + stick feel are identical to the last call,
   it only swaps exclusions/dpr/haptics and keeps held input. The signature is recorded only after a
   full apply.
3. Latency badge removed, together with the controller's 200 ms telemetry poll (each poll re-rendered
   the whole pad, 5×/s). The app-level 500 ms poll (`useNetworkTelemetry`) pauses while
   `view === "controller"`.
4. `AdsBridge`: no automatic `load()` after an ad closes or fails to show. The next ad loads when the
   button is next on screen, or on the tap. Before this, the next ad's video downloaded as play
   resumed from the out-of-time screen.

Unchanged: the 15/10/5-minute warning toasts (`PlaytimeToast`) and the lockout. The time limit is
enforced exactly as before; it is just not displayed during play.

## About the Wi-Fi jitter
The app already holds `WIFI_MODE_FULL_LOW_LATENCY` and sets DSCP EF + SO_PRIORITY on the socket. The
in-app contributors (re-renders, background ad download) are fixed. A phone acting as a hotspot adds
jitter of its own that the app cannot remove; a router (or USB) is steadier.

## Not verified
On a real phone: hold LT for 2+ minutes and watch that the glow and acceleration stay; then watch
one ad from the out-of-time screen and check that play is smooth straight after.
