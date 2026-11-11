---
name: controller-open-close-flow
description: "Owner-agreed controller open/close icon flow (2026-11-11): icon follows how the phone is HELD, screen turns only under a plain cover"
metadata:
  node_type: memory
  type: project
  originSessionId: f2cc66f0-40fc-4245-a9ac-8892ce06f6a6
  modified: 2026-11-11T08:30:36.184Z
---

The controller open/close animation follows a flow the owner described on 2026-11-11, written up in
`projects/gamepados/docs/CONTROLLER_OPEN_CLOSE_FLOW.md`.

- A gamepad icon matches how the player physically HOLDS the phone: standing when held upright, flat when held sideways.
- Opening: if held upright it turns flat; if already sideways it doesn't turn.
- Closing: if held sideways it turns standing; if already upright it doesn't turn.
- Then icon and cover fade together to reveal the screen.

**Why:** the earlier version turned the screen while the icon showed. Players holding the phone sideways saw the icon
go horizontal → vertical → horizontal, plus a glitch: the screen size changed again (system bars) during the reveal.

**How to apply:**
- Never turn the screen while the icon is visible. Turn it under the plain colour first, and wait for the window size
  to settle.
- How the phone is held comes from the native bridge (`getHeldRotation` + `getDisplayRotation`).
- `transitions.test.mjs` checks the four held/direction cases from the player's point of view.
- The owner wants it slow for now and will ask for speed changes. Related: [[launch-glitch-surfaceview-2026-11-09]].
