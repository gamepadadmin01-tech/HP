# Controller open / close animation: the agreed flow

Owner's description, 2026-11-11. This is the behaviour to keep. Any change to it must keep every point below true,
and `apps/controller-ui/transitions.test.mjs` checks each one frame by frame.

## The idea

A small gamepad icon in the theme colour shows the change between Home (held upright) and the controller (held
sideways). The icon always matches **how the player is holding the phone**. It does **not** follow the screen.

- Phone held **upright**: the icon stands up (vertical).
- Phone held **sideways**: the icon lies flat (horizontal).

## Opening (tap a controller on Home)

1. The screen fades to the controller's colour. It's plain, with no icon yet.
2. Behind that plain colour, the screen turns to landscape and the controller is built. The app waits until the
   screen size has stopped changing (the turn, then the system bars hiding).
3. The icon pops up matching how the phone is held:
   - **held upright**: it appears **standing**, then **turns flat**;
   - **held sideways already**: it appears **flat** and **does not turn**.
4. The icon and the background fade away together and show the controller. The controller itself does not move.

## Closing (Back, or the BACK button)

The same steps the other way round:

1. Fade to the plain colour over the controller.
2. Behind it, the screen turns back to portrait and Home is built. Wait until the size stops changing.
3. The icon pops up matching how the phone is held:
   - **held sideways**: it appears **flat**, then **turns standing**;
   - **held upright already**: it appears **standing** and **does not turn**.
4. The icon and background fade away and show Home.

## Rules that keep it from glitching

- **The screen never turns while the icon is showing.** It turns only under the plain colour, before the icon
  appears. (The bug of 2026-11-11: the screen turned while the icon was visible, so the icon looked
  horizontal → vertical → horizontal to a player holding the phone sideways.)
- The icon only ever turns **one way, once** (or not at all). It never turns back.
- The reveal waits until the screen size is stable, so the controller or Home never redraws in the middle of the fade.
- Back and taps are ignored until the whole sequence has finished.
- Only the icon (one layer) moves, using transform and opacity only. The controller and Home never move or scale.

## Where it lives

- `apps/controller-ui/src/app/App.tsx`: `iconThrough()` (the steps), `CoverLayer` (the icon), `howHeld()`.
- `apps/controller-ui/src/styles/redesign.css`, section 27b: the timings.
- `apps/android-client/.../MainActivity.kt`: `getHeldRotation()` (motion sensor: how the phone is held) and
  `getDisplayRotation()` (how the screen is turned). If the phone is lying flat, or the app shell is too old to answer,
  the icon simply pops up the target way and does not turn.

## Timings (deliberately slow, owner will tune)

| Step | Time |
|---|---|
| Plain colour fades in | 0.16 s |
| Turn and settle | the phone's turn, then 0.3 s of no size changes |
| Icon pops up | 0.35 s |
| Pause | 0.25 s |
| Icon turns (only when needed) | 0.6 s |
| Pause | 0.3 s |
| Icon and background fade out | 0.4 s |

Without a turn, the icon pops up and holds for 0.7 s in total.

The layout editor still uses the plain fade (`coverThrough`), not this flow.
