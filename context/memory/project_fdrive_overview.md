---
name: fdrive-overview
description: "Working-drive map — everything lives at D:\\AKHIL\\HP, reorganised 2026-08-13 into projects/ toolchain/ media/"
metadata: 
  node_type: memory
  type: project
  originSessionId: 04fa20ba-c801-4536-9b63-6783224ac0d6
  modified: 2026-08-13T13:04:56.792Z
---

# The working drive: `D:\AKHIL\HP`

Rewritten 2026-08-13 after the folder was reorganised. Earlier versions of this memory had
accumulated three rounds of path edits and become self-contradictory; this is the clean version.

## Layout

```
D:\AKHIL\HP\
├── CLAUDE.md                 auto-loaded session brief — READ THIS FIRST
├── context/                  durable brain: INVENTORY.md, REBUILD.md, 108 docs, memory mirror
├── projects/
│   ├── gamepados/            THE PRODUCT (was "hlooo")
│   ├── gamepados-account/    account-system fork (was "App with login")
│   ├── flexsquares/          sell-the-white-space site
│   ├── daily-news-app/       echonews-ai, unrelated
│   └── spotify-corizo/       Corizo academic project
├── toolchain/
│   ├── android-sdk/          SDK root (was "Android/Sdk") — build-tools 34.0.0, NDK, cmake
│   └── android-cli/
├── media/capcut/             CapCut drafts, exports, footage
├── installers/               DaVinci Resolve
├── keys/                     PLAINTEXT SECRETS — never commit, never upload
└── _TO_DELETE_2026-08-13/    32.67 GB staged, awaiting the user's go-ahead
```

## Build environment (verified by a real build 2026-08-13)

```
JAVA_HOME    = D:\AKHIL\HP\projects\gamepados\tools\jdk\jdk-17.0.19+10
ANDROID_HOME = D:\AKHIL\HP\toolchain\android-sdk
gradle       = D:\AKHIL\HP\projects\gamepados\tools\gradle-9.6.1\bin\gradle.bat
```

**Gradle 9.6.1 is mandatory** — the app is on AGP 9.3.1, which requires 9.5.0+ and rejects every
8.x. The dead 8.5 / 8.9 / 8.14.4 copies were retired. There is no `gradlew`.

Last verified build: `BUILD SUCCESSFUL in 2m 35s`, `app-direct-release.apk` 2.03 MB,
versionCode 51, versionName 1.3.27.

**If you move any folder, these hardcode absolute paths and must be fixed:**
`apps/android-client/build_apk.bat` (+ its `_backup_pre_agp9_20260804` copy),
`apps/android-client/local.properties` (`sdk.dir`), `build_exact_composite.py`,
`create_stacked_promo.py`, `tools/regression-check.sh`, `HP/.claude/launch.json`.
**A folder move has silently broken this build twice.**

## Backup state

`D:` is a **local** disk — no cloud sync, no version history, no VSS, no File History. An earlier
memory claimed the old `F:` drive was Google Drive-synced; that was wrong and the error propagated
widely before being corrected.

| What | Remote |
|---|---|
| `D:\AKHIL\HP` (one repo: CLAUDE.md + context/ + projects/gamepados) | **none yet — NOT pushed** |
| `projects/gamepados/website` | `gamepadadmin01-tech/gamepad` |
| `projects/gamepados-account` | `gamepadadmin01-tech/app-with-login` |
| `projects/flexsquares` | `gamepadadmin01-tech/flexspace` |
| `keys/`, `media/`, `spotify-corizo`, `daily-news-app` | none |

Until 2026-08-13 the product source had **no version control at all**. See [[feedback_no_worktrees]]
and `context/INVENTORY.md`.

## Drive history — why paths keep changing

```
F:\hlooo  →  F:\  →  D:\AKHIL\HP  →  D:\AKHIL\HP\projects\gamepados
```

`F:` was a local NTFS disk (1.4 TB, "HOME PERSONAL"), **formatted 2026-07-26**. Everything was
copied to `D:\AKHIL\HP` first (65 GB / 290k files), then F: was wiped.

**Permanently lost** in that format (created after the copy had already passed that folder):
`apps/docs/make_guide_part.py`, `docs/notes/GamepadOS_Guide_Part_VI_Accounts_and_Sync.md` + `.pdf`.
The other guide PDFs (Complete_Book, The_Complete_Guide, Interdisciplinary_Analysis, Study_Plan)
survived in `projects/gamepados/docs/notes/` — and still have no backup.

Any `F:\` reference you now find in a memory is deliberate history, not a live path. All live paths
were rewritten (75 refs on 2026-08-13, then 69 more after the reorg).

## Earlier reorganisations

- **2026-07-16** — inside the product: `store-releases/`→`releases/store/`,
  `releases-archive/`→`releases/archive/`, `NOTES/`+`high professional notes/`→`docs/notes/`,
  `SESSION_HANDOFF_*.md`→`docs/handoffs/`, store photos→`store-assets/{amazon,uptodown,indus}/`,
  `ad-footage/`→`marketing/ad-footage/`. Full map and undo instructions:
  `projects/gamepados/MOVE_LOG.md`.
- **2026-08-13** — the HP root reorg described above, plus: 10.99 GB of build cache staged, the
  dead Capacitor project and three dead Gradle versions retired, family media removed (the user
  has it on another laptop), and `tw-animate-css` declared after it was found to be an undeclared
  build dependency.
