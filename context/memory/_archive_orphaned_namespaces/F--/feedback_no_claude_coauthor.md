---
name: no-claude-coauthor
description: "Never add Co-Authored-By: Claude trailers to commits in the user's repos"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6098ea47-06de-42b9-a2c6-9d4070ced1e7
---

Do NOT add `Co-Authored-By: Claude ...` trailers to commit messages in the user's repositories (website, flexsquares, any GamepadOS repo).

**Why:** On 2026-07-11 the user saw GitHub render "Akhil and Claude committed" and explicitly said they don't want Claude showing in their commit history. Three unpushed commits were rewritten with `git filter-branch --msg-filter` to strip the trailers.

**How to apply:** End commit messages with no AI attribution trailer at all. Author stays gamepadadmin01@gmail.com per [[feedback-git-author-vercel]]. Related: [[feedback-no-auto-push]].
