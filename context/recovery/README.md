# recovery/ — the App.tsx corruption of 2026-07-14

## What happened

An automated PowerShell edit used `IndexOf` with a **non-unique anchor**. The string
`return () => clearInterval(id)` appears **five times** in `App.tsx`. The edit matched the wrong
one and deleted roughly **133,000 characters** — the file went from ~4,600 lines to 1,809.

`apps/` was not under version control at the time, and `D:` has no VSS, no File History and no
cloud version history. There was nothing to roll back to.

It was recovered by splicing three pieces together: the still-intact head of the current file, the
middle from a roughly two-week-old manual backup, and the still-intact tail of the current file.
Session changes were then re-applied by hand and the result was build- and render-verified.

## The files kept here

| File | Size | What it is |
|---|---|---|
| `App.tsx.2026-07-14_pre-corruption-backup` | 199 KB | The manual backup whose middle was spliced in. Was loose at `D:\AKHIL\HP\backup app.tsx\` |
| `App.corrupted.tsx` | 98 KB | The damaged file, kept as evidence of what the bad edit produced |
| `App.reconstructed.tsx` | 223 KB | The spliced result, immediately after recovery |

For reference, the live file today is `projects/gamepados/apps/controller-ui/src/app/App.tsx` — 260 KB,
4,691 lines, last modified 2026-08-10. It has moved on considerably from all three of these; they
are history, not fallbacks.

## The known regression risk

The recovered middle came from a ~1.2.x / 1.3.3-era backup, so components in the **middle** of
`App.tsx` may be missing features added in 1.3.1–1.3.7 — specifically `ControllerScreen`,
`TabHome` and `TabSystem`. The head and tail were current at the time.

If a feature that definitely existed appears to have vanished, this is the first thing to suspect.
Compare against the minified `dist` bundle, which was built before the corruption.

## The lesson — this is now a standing rule

**Never use `IndexOf` or a regex with a non-unique anchor on `App.tsx`.** It has mixed CRLF/LF line
endings and many repeated strings.

- Count occurrences before any automated edit.
- Prefer the `Edit` tool with a large, genuinely unique context block.
- Take a backup before any PowerShell text surgery — and put it here, not loose in the tree.

As of 2026-08-13, `projects/gamepados/` is under git, so a mistake like this is now recoverable with
`git checkout`. That was not true when this happened.
