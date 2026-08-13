---
name: feedback-no-auto-push
description: User wants to run git push themselves — never auto-push; commit/prep is fine
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c524f7ae-df15-4302-b4b4-75fbbba03211
---

Do NOT run `git push`. Stage and commit changes as needed, but leave the actual push to the user — they want to push themselves ("next time onwards you dont push let me atleast push", 2026-06-28).

**Why:** the user wants final control over what goes live (pushes trigger Railway/Vercel deploys). Earlier in the session I pushed several commits to the GamepadOS `gamepad.git` repo on their behalf; they asked me to stop.

**How to apply:** commit with a clear message and tell them it's "ready to push" + the exact `git push` command. Don't execute the push. Applies to all their repos (flexsquares/flexspace.git, GamepadOS website/gamepad.git). Committing locally is still fine and wanted. Related: [[project-downloads-feedback]], [[project-blankspace]].
