---
name: feedback-git-author-vercel
description: "Commit author for GamepadOS/Flexsquares repos must be gamepadadmin01@gmail.com, NOT akhilpitchuka@gmail.com — Vercel Hobby blocks non-owner authors"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c524f7ae-df15-4302-b4b4-75fbbba03211
---

When committing in the user's deployed repos, use the git author **Akhil <gamepadadmin01@gmail.com>** (the repo's configured identity). Do NOT override it with `-c user.email="akhilpitchuka@gmail.com"` (that's the user's Claude-account email from `userEmail`, a DIFFERENT identity).

**Why:** the GamepadOS website repo (`gamepad.git`) auto-deploys via **Vercel on the Hobby/free plan**, which **only deploys commits whose author is the project owner** (`gamepadadmin01@gmail.com`). On 2026-06-28 I committed 4 commits with `-c user.email="akhilpitchuka@gmail.com"`; Vercel blocked every deploy ("commit author did not have contributing access… Hobby Plan does not support collaboration"). Fix was to re-author (soft reset + recommit) and force-push.

**How to apply:** just run plain `git commit` — the repo's `user.email` is already `gamepadadmin01@gmail.com`. Never pass `-c user.name/-c user.email` overrides. If a commit ends up with the wrong author, re-author before it's deployed. The GitHub account is `gamepadadmin01-tech`. Also remember [[feedback-no-auto-push]] — let the user push.
