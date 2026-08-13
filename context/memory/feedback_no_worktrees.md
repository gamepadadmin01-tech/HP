---
name: feedback-no-worktrees
description: "Never work in a worktree or scratch copy — edit Akhil's real folders directly via absolute paths"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 04fa20ba-c801-4536-9b63-6783224ac0d6
  modified: 2026-08-13T11:38:01.502Z
---

Akhil said: *"delete all files that you work with and just edit the files inside my folder directly, don't confuse me."*

**Why:** working in a Claude worktree — and then restoring from the wrong duplicate — made him
believe his latest website had been destroyed. That was a major trust break, and it is the reason
he still asks for "anything related to Claude worktrees" to be removed. Duplicates of his projects
are not a neutral convenience to him; they are the thing that once cost him his work.

**How to apply:**
- Edit files in `D:\AKHIL\HP\...` directly, via absolute paths.
- Never copy a project into a worktree or scratch directory to work on it.
- If a preview server needs a project-root path, use an NTFS junction pointing at the real folder
  — never a copy.
- Confirm before deleting anything under `D:\AKHIL\HP`.
- Do not leave behind backup folders, `.bak` files, or "_old" copies. If a backup is genuinely
  needed, put it in `D:\AKHIL\HP\context\recovery\` and say so.

**Status 2026-08-13:** verified there are no git worktrees anywhere on `C:` or `D:`. The residue
that did exist (scratch copies, recovery backups, a deleted `apps/` tree in the recycle bin) was
inventoried in `D:\AKHIL\HP\context\INVENTORY.md`.

**One correction to the original note:** it claimed `F:\` was Google Drive-synced and that this
explained odd deletion behaviour. That was wrong — `F:` was a local NTFS disk with no cloud
version history, which is why the 2026-07-26 format lost files permanently. `D:` is likewise
local. There is no automatic backup. See [[project_fdrive_overview]].

Related: [[project_antigravity_incident]], [[feedback_challenge_own_code]].
