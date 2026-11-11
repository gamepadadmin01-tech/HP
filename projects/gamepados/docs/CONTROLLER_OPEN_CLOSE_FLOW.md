# Controller and editor open / close: the agreed flow

**Reference: version 1.4.16.** The owner's decision on 2026-11-11: *"check our old version 1.4.16 … taking that
as reference implement in our new app with new theme."* Do not invent a new mechanism. The experiments of
2026-11-10/11 (circle burst, pop-out, a gamepad icon that turns with the phone) all glitched on the phone, and all
of them were removed.

## What happens (exactly as 1.4.16, in the new theme)

1. **Tap a controller** (or Back, or open/close the layout editor).
2. The **LOADING curtain** fades in over the screen (0.18 s). It uses the controller's background colour, with a
   pulsing gamepad in the theme orange and the word LOADING.
3. **0.1 s after the tap**, the app asks Android to turn the screen and switches to the next screen behind the curtain.
4. **0.18 s after that**, the curtain fades away and shows the new screen.
5. **Android's own screen-turn animation** plays over the turn itself. This is part of the design: it covers the
   moment the screen changes shape. (Do not set `rotationAnimation` to JUMPCUT or CROSSFADE; 1.4.16 had neither.)

There's a safety net: if anything hangs, the curtain lifts after 1.2 s anyway. Taps and Back are ignored while the
curtain is down.

## Where it lives

- `apps/controller-ui/src/app/App.tsx`: `runCurtainSequence()` (the timing), the curtain itself
  (`data-testid="curtain"`), `navigateTo()` (Home and controller), `openEditor()` and `closeEditor()`.
- `apps/android-client/.../MainActivity.kt`: `setScreenOrientation()`. It uses Android's default turn animation,
  the same as 1.4.16.
- Test: `apps/controller-ui/transitions.test.mjs`. It checks:
  - the curtain shows;
  - the screen switches under it;
  - the phone is asked to turn only the right way;
  - there are no blank frames, and it ends clean;
  - the drawn frames are smooth while the curtain is up;
  - double tap, Back during opening, and the editor all behave.

## Why the experiments failed (for whoever changes this next)

- The screen turned **while something was visible** (an icon, a growing controller). A player holding the phone
  sideways sees every screen turn twist what's on screen.
- Android's own turn animation was switched off (JUMPCUT), so nothing covered the moment the screen changes shape.
- The status and navigation bars hiding after the turn resize the page a second time, which redrew the screen
  mid-fade.

1.4.16 avoids all three, because the curtain is up and Android's own animation runs over the turn.
