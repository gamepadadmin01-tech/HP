---
name: controller-open-close-flow
description: "Controller/editor open-close must follow version 1.4.16 (LOADING curtain + Android's own turn animation); owner decision 2026-11-11 after many failed experiments"
metadata:
  node_type: memory
  type: feedback
  originSessionId: f2cc66f0-40fc-4245-a9ac-8892ce06f6a6
  modified: 2026-11-11T08:54:54.576Z
---

Controller and editor open/close follow **version 1.4.16** exactly, in the new theme. The doc is
`projects/gamepados/docs/CONTROLLER_OPEN_CLOSE_FLOW.md`.

The sequence (`runCurtainSequence`):
1. The LOADING curtain fades in (0.18 s).
2. At 0.1 s the app calls setScreenOrientation and swaps the screen.
3. 0.18 s later the curtain lifts.
4. Android's default turn animation covers the turn. Never set JUMPCUT/CROSSFADE.

**Why:** on 2026-11-10/11 Claude tried a circle burst, a pop-out and a gamepad icon that followed how the phone is
held. Every one glitched on the owner's phone: the screen turned while something was visible, Android's turn
animation was off, and the system bars resized the page mid-fade. The owner was very frustrated ("check our old
version 1.4.16 … taking that as reference").

**How to apply:**
- Before inventing any animation mechanism, look at how the last version the owner liked did it (git: 1.4.16 =
  commit 89702ef) and reuse that.
- Only change visuals (colours/theme) unless he asks for more.
- Judge smoothness on painted frames.
- Related: [[launch-glitch-surfaceview-2026-11-09]], [[controller-animation-performance-rules]].
