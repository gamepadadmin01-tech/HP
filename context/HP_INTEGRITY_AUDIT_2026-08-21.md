# HP folder — corruption & integrity audit

**Date:** 2026-08-21 · **Scope:** `D:\AKHIL\HP` (~25 GB) · **Method:** read-only scans, nothing modified

---

## Bottom line

**No corrupted files were found.** Every one of the 163 archives — including all
GamepadOS APKs and the .aab store bundles — passed a full CRC check, which reads
every byte inside the file and compares it to a checksum recorded when the file was
made. If even one byte had rotted on disk, that check would have caught it.

All three git repositories pass `git fsck` (git's own internal corruption check).
`App.tsx` — the file that lost 133,000 characters in the July incident — is
**fully healthy**: 5,096 lines, larger than every backup, brackets balanced, clean
ending.

What I did find is **two genuinely broken script files** and a handful of risks.
None of them are disk corruption; all are the "wrong line endings" damage your
`CLAUDE.md` already warns about.

---

## What I checked

| Area | Result |
|---|---|
| 163 archives (APK, AAB, JAR, ZIP) — full CRC test | ✅ 0 bad |
| 3 git repos — `git fsck` | ✅ clean |
| `App.tsx` structure + size vs backups | ✅ healthy, 5,096 lines |
| Zero-byte files across the tree | ✅ 1 dead leftover, rest are vendor files |
| `.bat` / `.cmd` — BOM and line endings | ⚠️ 2 issues |
| `.sh` — line endings | ⚠️ 1 issue |
| Hardcoded build paths (JDK, SDK, Gradle, UI bundle) | ✅ all 5 resolve |
| Backup / push state of all repos | ✅ better than documented |

---

## Actually broken

### 1. `projects/gamepados/tools/regression-check.sh` — will not run  (HIGH)

The file has **CRLF line endings** (212 of them). CRLF means each line ends with
a hidden carriage-return character that Windows uses but Linux-style shells do not.
Bash reads that stray character as part of the command, so it fails with errors like
`$'\r': command not found`.

**What it breaks:** this is the regression runner your own checklist tells you to run
after every significant change. It cannot currently run at all.

**Fix** — strips the stray characters, changes nothing else:

    sed -i 's/\r$//' D:/AKHIL/HP/projects/gamepados/tools/regression-check.sh

### 2. `projects/gamepados/apps/pc-server/driver/install-driver.bat` — risky  (MEDIUM)

The opposite problem: this is a `.bat` file with **LF-only endings**, and your
`CLAUDE.md` rule is that `.bat` must be CRLF. It contains a multi-line
`if exist (...)` block at line 18 — that is exactly the construction `cmd.exe`
misparses when the line endings are wrong.

**What it breaks:** the driver installer may silently take the wrong branch on a
customer's machine. Worth converting back to CRLF.

---

## Not broken, but worth knowing

### `build_apk.bat` has a UTF-8 BOM — and it is harmless  (LOW)

Both `build_apk.bat` and its backup start with three invisible bytes (`EF BB BF`),
the fingerprint of a PowerShell `Set-Content` edit — the exact hazard your notes warn
about. **I tested it rather than assuming.** I built two identical test scripts, one
with the BOM and one without, ran both through `cmd.exe`, and they produced identical
output. So the BOM is not breaking your build today.

It is still worth removing, because the rule exists for a reason: if the first line
of that file ever changes from `@echo off` to something that matters, the BOM would
start corrupting it.

### Signing passwords sit in plaintext  (MEDIUM — not leaked)

`apps/android-client/local.properties` contains your keystore and key passwords in
readable text. **The good news: it is correctly gitignored** (I verified against
`projects/gamepados/.gitignore` line 16) and is **not** tracked by git, so it has not
leaked anywhere. I also swept the entire tracked file list for `.jks`, `.keystore`,
`.pem`, `.env` and similar — **nothing secret is committed.**

The remaining risk is local only: anyone with access to this laptop can read the
password that signs your app.

### One dead file

`apps/controller-ui/src/styles/globals.css` is 0 bytes and nothing imports it.
It is leftover, not corruption. Safe to delete whenever you like.

---

## Good news that contradicts your notes

`CLAUDE.md` carries a red warning that the HP repo was "created 2026-08-13, **NOT
pushed**". **That is now out of date.** The repo has a remote at
`github.com/gamepadadmin01-tech/HP.git` and **0 unpushed commits** — all 19 commits
are safely on GitHub. `flexsquares` and the `website` repo are also fully pushed.

Worth correcting that line in `CLAUDE.md` so it stops raising a false alarm.

---

## Where the 25 GB actually goes

| Folder | Size |
|---|---|
| `installers/` (mostly DaVinci Resolve) | 9.5 GB |
| `projects/gamepados/` | 7.1 GB |
| `media/capcut/` | 5.7 GB |
| `toolchain/android-sdk/` | 2.1 GB |
| everything else | < 100 MB |

`installers/` and `media/capcut/` are 15 GB of re-downloadable third-party software.
They are the obvious candidates if you ever need space — but neither is backed up, so
decide deliberately, don't sweep them.

---

## Do these now

1. Fix `regression-check.sh` line endings — it is your safety net and it currently cannot run.
2. Convert `install-driver.bat` back to CRLF before it ships to another customer.
3. Update the stale "NOT pushed" warning in `CLAUDE.md` — it is no longer true.
4. Commit the 6 modified + 4 new files currently sitting uncommitted (4 research docs).
5. Optional: strip the BOM from `build_apk.bat`, and delete the empty `globals.css`.

*Nothing in this audit was modified. All checks were read-only.*
