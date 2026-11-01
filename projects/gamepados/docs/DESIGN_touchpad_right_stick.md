# Design: touchpad that moves the right stick

Customer request (support portal, 2026-10-30): "a touchpad, similar to a laptop trackpad, but designed to control the right joystick." Owner decisions (2026-10-31):

1. **Both feels, player chooses:** swipe **speed** and **distance**.
2. **A new piece in the layout editor** (placed and resized like any widget), **plus a ready-made sample pad** that shows players how to use it.
3. **On lift is also a setting:** **instant** or **glide**, with a recommended default.

Recommended defaults for a new touchpad: **speed + instant, sensitivity 1**.

4. **A clean surface, in two shapes** (owner, 2026-11-02, after the first look on a phone): the pad has NO joystick drawing and no default words, like the PS4 touchpad. It can be a **rectangle or a circle** (a Shape choice in the editor; a circle takes touches only inside the circle). While a finger is down it shows a glow under the finger, a ripple and a faint sliding dot grid. The shape is stored as `tpShape` ("rect" | "circle"), exported to the phone engine as `round`, and mirrored by `padContains` (touchpad.ts) and `TouchpadMath.contains`.

## Behaviour (the rules live in code: `controller-ui/src/app/touchpad.ts`, mirrored by `android-client/.../TouchpadMath.kt`)

- A touchpad is a rectangle. A finger on it pushes the **right stick** (design units, full = 60).
- **Speed:** stick follows how fast the finger moves; a stopped finger sends no events, so the pad lowers the stick by itself ~45 ms after the last move. A fast swipe ~900 units/s at sensitivity 1 = full.
- **Distance:** stick follows how far the finger is from where it first touched; holds while the finger rests; 90 units of drag = full at sensitivity 1.
- **Landing** never deflects the stick. Sensitivity 0.3-3. Finger right = +x, finger down = +y (same as the sticks).
- **Instant release:** stick snaps to centre. **Glide:** eases to centre (time constant 80 ms).
- The existing 8% dead zone and the optional stick curve still apply afterwards, like any stick. The gyro in 3D mode also drives the right stick and is added on top.

## Why two implementations

Touch input is handled natively by `NativeInputEngine.kt` (default ON) AND by the page (Widgets.tsx) when native input is off. A pad that works in only one of them is broken for some players, and a touchpad is used together with the left stick, so the page cannot own it while a native finger is down. Both must implement the widget, with the same maths (that is why `touchpad.ts` and `TouchpadMath.kt` have identical constants and test cases).

## Stages

| # | Stage | Status |
|---|---|---|
| 1 | Movement rules in both languages, with tests (`touchpad.test.mjs`, `TouchpadMathTest.kt`) | **done 2026-10-31** |
| 2 | Data model: `WidgetType` + `"touchpad"`, optional `tpFeel`, `tpRelease`, `tpSens` on `CustomBtnDef` (`types.ts`); make sure saved/shared/cloud pads keep the fields and old pads are untouched; export `{k:"pad", x,y,w,h, vis, feel, release, sens, hap}` in `buildNativeGeometry` (`App.tsx`) | **done 2026-11-01** (`types.ts`; share check in the website `server.js`; geometry export in `App.tsx`) |
| 3 | Native engine: `K_PAD` widget in `NativeInputEngine.kt` (hit test = rectangle; one `TouchpadMath` per finger; a ~16 ms ticker while any pad is active, because speed/glide need time to pass; result copied to `rsX/rsY`; visual feedback key; release rules; clear on pad change). Parse `feel/release/sens` in `setGeometry` and include them in the geometry signature | **done 2026-11-01** (`NativeInputEngine.kt`: `K_PAD`, frame ticker, visual feed `p`) |
| 4 | Page: a `Touchpad` widget in `Widgets.tsx` (look + held state + pointer handling with `TouchpadState` for the native-off path) and the render loop in `App.tsx`; feed the right stick the same way `RightStick` does | **done 2026-11-01** (`Touchpad.tsx`, `touchpadVisual.ts`; real-browser test `touchpad-dom.test.mjs`) |
| 5 | Layout editor: add "Touchpad" to the widget list; inspector with Feel (Speed - recommended / Distance), On release (Instant - recommended / Glide), Sensitivity slider; defaults as above | **done 2026-11-01** (`CustomPadEditor.tsx`, `TouchpadSettings.tsx` with a live "Try it" area) |
| 6 | Sample pad "Touchpad camera" shipped with the app (left stick, face buttons, triggers, a big touchpad on the right) and a one-line hint on the pad that says how to use it | **done 2026-11-01** ("Touchpad Camera" template in the create-pad flow) |
| 7 | Build, phone test (feel in a real game, with and without native input, with left stick used at the same time), `REGRESSION_CHECKLIST.md`, release notes | todo |

## Risks to watch

- Native/page drift (rule: change both together; tests exist for the maths, not for the wiring).
- A pad shared by code or cloud-synced to an OLDER app: unknown widget type must not crash it (check how `App.tsx` treats unknown types when loading).
- Ticker must stop when no pad is active (battery) and must never inject when the engine is inactive.
- A finger on the touchpad and the gyro 3D mode both write the right stick: define the merge (touchpad value goes in first, gyro is added after, clamped), exactly like `buildAndInjectLocked` already does for the real stick.
- Haptics: keep a light tick on first touch only; no per-move buzz.
