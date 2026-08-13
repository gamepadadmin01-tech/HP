---
name: edit-directly-no-worktrees
description: "User demands edits directly in his real folders — no worktree copies, no scratch duplicates"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a9693bb2-10c4-445c-854b-a2a03dbf6115
---

The user said: "delete all files that you work with and just edit the files inside my folder directly, don't confuse me."

**Why:** Working in the Claude worktree (and restoring from the wrong duplicate) made him believe his latest website was destroyed — a major trust break. F:\ is also Google Drive-synced, so deletions/locks behave oddly and duplicates multiply.

**How to apply:** Edit files in `F:\hlooo\...` directly via absolute paths. Don't copy projects into the worktree; if a preview server needs project-root paths, use an NTFS junction inside the worktree pointing at the real folder instead of copying. Confirm before deleting anything under F:\ (Drive sync + protected-path blocks). See [[project-layout]].
