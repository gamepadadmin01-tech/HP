# `context/` — the durable brain of `D:\AKHIL\HP`

Created 2026-08-13.

## What this is

Everything a person — or a fresh Claude session on a brand-new laptop — needs to understand this
folder, without relying on anything stored in `C:\Users\akhil\.claude\`.

That last part is the whole point. Claude's own memory lives on `C:`, keyed by the project's
absolute path. When the folder moved (`F:\hlooo` → `F:\` → `D:\AKHIL\HP`) the memory fragmented
into three disconnected namespaces, and when Claude Desktop was reinstalled after the corruption,
`C:` got wiped and the context went with it.

**This folder lives on `D:`, inside the project, and goes into git.** A reinstall cannot touch it.
A new laptop gets it with `git clone`.

## What's in here

| Path | What |
|---|---|
| `INVENTORY.md` | What every folder in HP actually is, its size, its backup status, and its risk |
| `REBUILD.md` | The exact command to regenerate anything that was deleted as a cache |
| `docs/` | All 108 markdown documents found anywhere in HP, copied and flattened, + `INDEX.md` |
| `docs/_manifest.csv` | Original path, size, and modified date for each of the 108 |
| `memory/` | Claude's memory, merged from all three namespaces and with paths corrected |
| `recovery/` | The `App.tsx` backups from the 2026-07-14 corruption, gathered in one place |

## The rules

1. **`docs/` holds copies.** Every original is still at its source path. Never "clean up" an
   original because a copy exists here.
2. **This folder is authoritative for context, not for code.** If a doc here disagrees with the
   code, the code wins — update the doc.
3. **No secrets, ever.** No `.env`, no `.keystore`, no key files, no recovery codes. This folder
   goes into git; those must not.
4. **When something significant changes, update `INVENTORY.md`.** It is the map. A stale map is
   worse than no map.

## Where the real risk is

`projects/gamepados/apps/` — the actual GamepadOS product source — had **no version control of any kind** as of
2026-08-13. Not a stale repo, not an old remote: nothing. That is being fixed, and until the fix is
confirmed pushed, one bad delete loses the product. See `INVENTORY.md` for the full risk table.
