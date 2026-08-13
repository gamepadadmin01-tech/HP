# D:\AKHIL\HP — start here

This file is loaded automatically at the start of every session in this folder. It lives on `D:`
and is committed to git, so **a Claude reinstall cannot erase it** — unlike
`C:\Users\akhil\.claude\`, which has already been wiped once.

Full detail: **`context/INVENTORY.md`** (the folder map) and **`context/README.md`**.

---

## Who

**Akhil** — akhilpitchuka@gmail.com. Solo developer and owner of **GamepadOS**
(phone app = `GamepadOS.apk`, PC side = `GamepadServer.exe`).

- **"Aukstea" is his CUSTOMER, not him.** Messages signed Aukstea are end-user bug reports he
  relays. Replies go to Akhil; when he asks for "a reply for the client," write it for Aukstea.
- **Explain before implementing, in plain words, one new term at a time.** He is genuinely strong
  at flow and behaviour design and at behavioural debugging; he is not yet fluent in code
  mechanics and has asked to be taught rather than handed output. Do not patronise him — ask
  behaviour-level questions first, that is where his real understanding lives.
- **Not comfortable with terminals.** Run commands for him rather than handing him a list.

## Standing rules — these have all been asked for explicitly

1. **Never run `git push`.** Prepare the commit; he pushes.
2. **Never add `Co-Authored-By: Claude`** trailers. Commits show only Akhil.
3. **Commit as `gamepadadmin01@gmail.com`** — never override the author. Vercel Hobby rejects
   builds from non-owner authors.
4. **Never work in a worktree or a scratch copy.** Edit the real folders directly, via absolute
   paths. A worktree copy once made him believe his website had been destroyed. If a preview
   server needs a project root, use an NTFS junction — never a copy.
5. **Confirm before deleting anything under `D:\AKHIL\HP`.** In his words: *"THIS HP FOLDER IS MY
   LIFE."*
6. **Never put his name in outgoing mail or messages.** Sign as "GamepadOS" only.
7. **Never use a non-unique anchor for automated text edits.** See "Scars" below.

## Folder map

Reorganised 2026-08-13. Folder names with spaces are gone, and `hlooo` — which meant nothing —
is now `projects/gamepados`.

```
D:\AKHIL\HP\
├── CLAUDE.md                 <- this file
├── context/                  <- the durable brain (inventory, 108 docs, memory, rebuild steps)
├── projects/
│   ├── gamepados/            <- THE PRODUCT (was "hlooo")
│   │   ├── apps/             <- android-client, controller-ui, pc-server, pc-server-rs, ios-client
│   │   ├── website/          <- its own repo: gamepadadmin01-tech/gamepad
│   │   ├── tools/            <- pinned JDK 17 + Gradle 9.6.1 (do not delete)
│   │   ├── releases/  marketing/  store-assets/  docs/
│   ├── gamepados-account/    <- the account-system fork (was "App with login")
│   ├── flexsquares/          <- sell-the-white-space site
│   ├── daily-news-app/       <- echonews-ai, unrelated
│   └── spotify-corizo/       <- Corizo academic project
├── toolchain/
│   ├── android-sdk/          <- SDK root (was "Android/Sdk")
│   └── android-cli/          <- was "Android/AndroidCLI"
├── media/capcut/
├── installers/
└── keys/                     <- PLAINTEXT SECRETS. Never commit, never upload.
```

**HP is 22.32 GB / 97,774 files** — down from 60.2 GB / ~390,000 on 2026-08-13.

`projects/gamepados-account/` is a legitimate fork, not a duplicate to delete.

## Build — the parts that bite

- **Gradle 9.6.1 is mandatory.** The app is on AGP 9.3.1, which requires Gradle 9.5.0+ and rejects
  every 8.x. The dead 8.5 / 8.9 / 8.14.4 copies were retired on 2026-08-13. There is no `gradlew`
  — Gradle is invoked by absolute path.
- **The build hardcodes absolute paths.** After the 2026-08-13 reorganisation these are:
  `JAVA_HOME=D:\AKHIL\HP\projects\gamepados\tools\jdk\jdk-17.0.19+10`,
  `ANDROID_HOME=D:\AKHIL\HP\toolchain\android-sdk`, and gradle at
  `D:\AKHIL\HP\projects\gamepados\tools\gradle-9.6.1\bin\gradle.bat`. If you ever move a folder,
  the files to fix are `apps/android-client/build_apk.bat` (+ its backup copy),
  `apps/android-client/local.properties` (`sdk.dir`), `build_exact_composite.py`,
  `create_stacked_promo.py`, `tools/regression-check.sh`, and `HP/.claude/launch.json`.
  **This has silently broken the build twice before.**
- **Always copy `apps/controller-ui/dist/index.html` → `apps/android-client/app/src/main/assets/dist/`
  before building the APK**, or it silently ships the previous UI.
- **Pillow ≥ 12 needs `PIL.ImageFont` and `PIL._imagingft` bundled** in the PyInstaller spec, or
  the PC server exe crashes at startup.
- Five Android flavours: `direct`, `playstore`, `aptoide`, `uptodown`, `amazonstore`.
- Full commands: **`context/REBUILD.md`**. Release process: `hlooo/RELEASE.md`.
- After any significant change: `hlooo/docs/REGRESSION_CHECKLIST.md`.

## Backup status — read this before deleting anything

| Path | Remote | Risk |
|---|---|---|
| `D:\AKHIL\HP` (this repo: `CLAUDE.md`, `context/`, `projects/gamepados/`) | **none yet** | 🔴 **created 2026-08-13, NOT pushed — do this first** |
| `projects/gamepados-account` | `gamepadadmin01-tech/app-with-login` | 3 commits unpushed |
| `projects/flexsquares` | `gamepadadmin01-tech/flexspace` | fine |
| `projects/gamepados/website` | `gamepadadmin01-tech/gamepad` | fine |
| `keys/`, `media/capcut/`, `projects/spotify-corizo/`, `projects/daily-news-app/` | none | 🔴 no backup |

`D:` is a **local** disk. No cloud sync, no version history, no VSS, no File History. An earlier
memory claimed the old `F:` drive was Google Drive-synced — that was wrong, and it is why the
2026-07-26 format lost three guide files permanently.

## Scars — things that have actually gone wrong here

- **2026-07-14 — `App.tsx` destroyed.** An automated PowerShell `IndexOf`/regex edit matched a
  non-unique anchor (`return () => clearInterval(id)` appears 5×) and deleted ~133,000 characters
  (4,600 → 1,809 lines). Recovered by splicing a two-week-old backup between the intact head and
  tail. **`App.tsx` has mixed CRLF/LF and many repeated strings.** Never use `IndexOf`/regex with a
  non-unique anchor — count occurrences first, prefer the `Edit` tool with a large unique context
  block, and keep a backup before any PowerShell text surgery. Backups: `context/recovery/`.
- **2026-07-02 — the Antigravity incident.** Another AI broke pairing and version handling; needed
  a full restore.
- **The worktree incident.** See rule 4.
- **2026-07-26 — `F:` was formatted.** The whole tree moved to `D:\AKHIL\HP`. Three guide files
  were lost. Every memory path was rewritten to `D:\` on 2026-08-13; any `F:\` you now see is
  deliberate history, not a live path.

## Where the context lives

- `context/INVENTORY.md` — every folder, its size, its backup state, its risk
- `context/REBUILD.md` — how to regenerate anything deleted as cache
- `context/docs/INDEX.md` — all 108 project documents, indexed
- `context/memory/` — Claude's memory, merged from three namespaces and path-corrected
- `hlooo/docs/handoffs/` — the project diary; the newest handoff is the best catch-up
