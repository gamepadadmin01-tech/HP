# App.tsx working snapshots, 20–22 July 2026

Seven hand-made backups of `apps/controller-ui/src/app/App.tsx`, taken during the
July work and left sitting in the source tree until 2026-08-27.

## Why they were kept rather than deleted

They were `.gitignore`d where they sat, and **git history for `App.tsx` only begins
2026-08-13** (commit `8acd978`, when HP became one repo). So nothing else in this
repository covers 20–22 July. Deleting them would have destroyed the only surviving
record of that period — for the one file in this project that has already lost
~133,000 characters to a careless automated edit.

That is a different incident from the one archived one level up: `../App.corrupted.tsx`,
`../App.reconstructed.tsx` and `../App.tsx.2026-07-14_pre-corruption-backup` are the
**14 July** corruption. These are later, ordinary working snapshots.

## Why they are stored plain, not zipped

Git delta-compresses near-identical text extremely well, and these seven files are
mostly the same file. A `.zip` would be opaque binary that git must store whole and
cannot delta — it would take MORE room in the repository, not less, while also making
the contents un-greppable and un-diffable. Storing them as plain text is both smaller
in git and directly usable, which is what matters at the moment you actually need them.

## Contents

Chronological. Sizes are the on-disk originals; each was hash-verified after copying.

| File | Bytes |
|---|---|
| App.tsx.bak-20260720-103345 | 232,418 |
| App.tsx.bak-20260720-194500 | 236,277 |
| App.tsx.bak-20260720-phase3 | 237,297 |
| App.tsx.bak-20260721-174416 | 248,578 |
| App.tsx.bak-20260722-131346-preoverlay | 255,349 |
| App.tsx.bak-20260722-162500-prerender | 256,071 |
| App.tsx.bak-20260722-preaccount | 256,641 |

To compare one against the current file:

    diff <(tr -d '\r' < App.tsx.bak-20260722-preaccount) \
         <(tr -d '\r' < ../../../projects/gamepados/apps/controller-ui/src/app/App.tsx)

(`tr -d '\r'` matters — App.tsx is CRLF, and these carry mixed endings.)
