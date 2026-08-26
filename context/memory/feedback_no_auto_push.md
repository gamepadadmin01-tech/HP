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

**Which repo the backlog lives in (2026-08-27):** he pushes the WEBSITE repo
(gamepadadmin01-tech/gamepad) himself promptly, so its commits do not pile up — a deploy
is waiting on them. The HP repo (gamepadadmin01-tech/HP) is the one where unpushed
commits accumulate, so that is the backlog worth reporting back to him. This changes
nothing about the rule itself: still never run `git push` on either.

**Shell-quoting hazard (2026-08-27):** I broke this rule by accident. Writing
a backtick-wrapped `git push` inside a DOUBLE-quoted bash string makes bash treat it as
command substitution and RUN it — the HP repo got pushed with no push command anywhere
in my input. Never let the literal words git push sit inside backticks in a double-quoted
shell string; use a single-quoted heredoc, or write it without backticks.
