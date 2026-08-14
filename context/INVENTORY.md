# INVENTORY — `D:\AKHIL\HP`

Measured and reorganised **2026-08-13**. Before that day: 60.2 GB across ~390,000 files, in a flat
root of 16 folders with meaningless names. This document describes the folder **as it is now**.

---

## 1. The layout

```
D:\AKHIL\HP\
├── CLAUDE.md                 auto-loaded session brief
├── context/                  this folder — the durable brain
├── projects/
│   ├── gamepados/            THE PRODUCT (was "hlooo")
│   │                         (gamepados-account/ was deleted 2026-08-14)
│   ├── flexsquares/          sell-the-white-space site
│   ├── daily-news-app/       echonews-ai, unrelated
│   └── spotify-corizo/       Corizo academic project
├── toolchain/
│   ├── android-sdk/          SDK root (was "Android/Sdk")
│   └── android-cli/          (was "Android/AndroidCLI")
├── media/capcut/
├── installers/
├── keys/                     PLAINTEXT SECRETS — never commit, never upload
└── .agents/skills/           live hyperframes video skills
```

**HP is now 22.32 GB across 97,774 files**, down from 60.2 GB / ~390,000. Free space on `D:` went
from 43.5 GB to 81.5 GB.

### Sizes as measured before the cleanup

| Folder (old name) | Size | Files | Now |
|---|---|---|---|
| `hlooo` | 9.19 GB | 110,891 | `projects/gamepados` — 3.55 GB after cache removal |
| `App with login` | 7.06 GB | 103,240 | **deleted 2026-08-14** (was `projects/gamepados-account`) |
| `capcut` | 5.70 GB | 15,291 | `media/capcut` |
| `Android` | 2.03 GB | 56,785 | `toolchain/android-sdk` + `android-cli` |
| `DaVinci Resolve Studio 21.0.0.48` | 9.46 GB | 8 | `installers/` |
| `keys` | 40 MB | 6 | unchanged |
| `flexsquares` | 30 MB | 3,185 | `projects/flexsquares` |
| `minor spotify project corizo` | 20 MB | 18 | `projects/spotify-corizo` |
| `.agents` | 18 MB | 841 | unchanged — **live, in use** |
| `daily-news-app` | ~0 | 632 | `projects/daily-news-app` |

Removed from HP entirely: **`Daddy's retirement`** (21.26 GB, 378 files — family video; Akhil
confirmed a copy exists on another laptop).

`du` and PowerShell were cross-checked and agree to within 0.01 GB. An early `du` run reporting
95 GB was an artifact of scanning concurrently with the folder moves.

---

## 2. Git and backup state — the risk map

| Path | Remote | Risk |
|---|---|---|
| `D:\AKHIL\HP` (this repo) | **none yet** | 🔴 **created 2026-08-13, NOT pushed — do this first** |
| ~~`projects/gamepados-account`~~ | `gamepadadmin01-tech/app-with-login` | **deleted 2026-08-14**; 3 unpushed commits saved as patches |
| `projects/flexsquares` | `gamepadadmin01-tech/flexspace` | 2 files dirty |
| `projects/gamepados/website` | `gamepadadmin01-tech/gamepad` | 9 files dirty |
| `keys/`, `media/capcut/`, `projects/spotify-corizo/`, `projects/daily-news-app/` | none | 🔴 no backup |

**Until 2026-08-13, `projects/gamepados/apps/` — the actual product — had no version control of any
kind.** Not a stale repo, not an old remote: nothing. It had already come close to being lost twice:

- **2026-07-14** — an automated PowerShell edit matched a non-unique anchor in `App.tsx` and
  deleted ~133,000 characters (4,600 → 1,809 lines). Recovered by splicing a two-week-old backup
  between the intact head and tail. See `recovery/README.md`.
- **2026-07-02** — the Antigravity AI broke pairing and version handling; needed a full restore.

`D:` is a local disk. No VSS, no File History, no cloud version history. **Pushing this repo is the
only real protection, and it has not happened yet.**

---

## 3. Where the space went — all of this was DELETED on 2026-08-14

Everything below was moved to a staging folder, verified individually, then permanently deleted
with Akhil's explicit go-ahead. **None of it is recoverable.** Rebuild instructions for the caches
are in `REBUILD.md`.

### Regenerable build cache — 10.94 GB, 202,150 files

| Path | Size | Files |
|---|---|---|
| `gamepados/apps/pc-server-rs/target` | 4.61 GB | 12,563 |
| `gamepados-account/apps/pc-server-rs/target` | 4.20 GB | 11,819 |
| `gamepados/.cargo` + `gamepados-account/.cargo` | 1.36 GB | 37,514 |
| `controller-ui/node_modules` ×2 | 0.48 GB | 137,736 |
| `website/{backend,frontend}/node_modules` | 0.25 GB | 2,483 |
| `android-client/.gradle` | 0.04 GB | 26 |

Two Rust `target/` directories alone were **8.8 GB — 15% of the entire folder.** Rebuild commands
are in `REBUILD.md`.

### Also deleted

| Item | Size | Why |
|---|---|---|
| `Daddy's retirement` | 21.26 GB | family media — Akhil confirmed a copy on another laptop |
| the `$RECYCLE.BIN` folder | 5.47 GB | a leftover **copy** of the old F: drive's bin, not the live Windows one; see §5 |
| `gradle-8.5` + `8.9` + `8.14.4` | 429 MB | **cannot build this app** — AGP 9.3.1 rejects all 8.x |
| `controller-ui/android` | 53 files | dead Capacitor project; no Capacitor deps, no script references it |
| `_test-pc-1.1.15`, `backup app.tsx`, `_recovery_backups`, `*.bak-*` | ~44 MB | scratch copies, all verified redundant or archived to `recovery/` |

### Must be kept — not "just a download"

| Path | Size | Why |
|---|---|---|
| `projects/gamepados/tools/` | ~500 MB | **Pinned JDK 17.0.19+10 + Gradle 9.6.1**, referenced by absolute path. There is no `gradlew`. |
| `toolchain/android-sdk` | 2.03 GB | pinned in `local.properties` (`sdk.dir`) |

---

## 4. Secrets — never in git, never in a shared cloud folder

| Path | What |
|---|---|
| `keys\AppstoreAuthenticationKey.pem` | Apple App Store auth key |
| `keys\RECOVERY-CODES-GamepadSupport.txt` | account recovery codes |
| `keys\release key.txt` | release signing password |
| `keys\rzp-key.csv` | Razorpay API key |
| `keys\twilio_2FA_recovery_code.txt` | Twilio 2FA recovery |
| `projects\gamepados\apps\android-client\app\release.keystore` | **Play Store signing key** |
| `projects\gamepados\apps\android-client\local.properties` | **contains `keystore.password` and `key.password` in plaintext** |
| `**/website/backend/.env` | Brevo API key, DB URL, admin creds |
| `**/secrets/` | Indus API key etc. |

**`release.keystore` is the single most irreplaceable file here.** Lose it and the Play Store
listing can never be updated again — a new key means a new listing and every existing install is
orphaned. It exists only on this laptop.

Both git repos were verified to exclude all of the above (`git ls-files` scan, 2026-08-13). The HP
repo uses a **whitelist** `.gitignore` so a stray `git add -A` cannot reach `keys/`.

---

## 5. Structural findings

- **`projects/gamepados-account` was DELETED 2026-08-14** (3,541 files, 1.93 GB after its build
  caches had already been cleared). It was superseded — the account system lives in the main tree,
  which has `AccountAuth.tsx`, `TabAccount.tsx`, `api/account.ts` and `store/account.ts`, none of
  which the fork ever had. Its 3 unpushed commits are preserved as patches at
  `context/archive/gamepados-account-unpushed-commits/`; its unique `native.ts` and Gradle wrapper
  at `context/archive/gamepados-account-unique/`. The GitHub repo `app-with-login` still exists.

  ⚠️ **Consequence to be aware of:** 48 shadcn/ui component files and the original design assets
  (`controller.jpeg`, `game_controller.pdf`, `image-1..6.png`) now exist **only in that GitHub
  repo** — the local copies are gone from the recycle bin, the staging folder and the fork. Main's
  code references none of them, so nothing is broken, but they are one `git clone` away rather
  than on disk. The blueprint markdown survives in `context/docs/`.

- **`apps/GamepadOS-iOS` vs `apps/ios-client` — RESOLVED 2026-08-13.** `GamepadOS-iOS` is a strict
  superset: `ios-client` has **zero** unique files, and all six files that differ are **newer and
  larger** in `GamepadOS-iOS` (`project.yml`, `bridge-shim.js`, `Haptics.swift` 11.2 KB vs 4.7 KB,
  `MainViewController.swift`, `MotionEngine.swift`, `WebBundle/index.html`). `GamepadOS-iOS` also
  carries the real Xcode project, `Assets.xcassets` and `Generated/Info.plist`. **`ios-client` is
  the superseded copy.** It was left in place pending Akhil's confirmation — nothing was deleted.
- **The nested `.claude/launch.json` files** use **relative** paths and are valid — keep them. Only
  `HP\.claude\skills\` (19 empty directory shells, 0 files) was dead; the real skills are in
  `.agents\skills\`.
- **`projects/gamepados/website` is its own repo nested inside the HP repo**, and is excluded via
  `.gitignore` so the two do not fight.
- **The `$RECYCLE.BIN` folder held `$RB86WEL\apps\`** — a complete deleted `apps/` tree (5.47 GB,
  98,271 files). Note this was **not** the live Windows recycle bin (that lives at `D:\$RECYCLE.BIN`
  and was untouched); it was a leftover copy carried over when the tree was moved off the old `F:`
  drive root. Verified before deletion: **zero files newer than live**, and all 68 files unique to
  it were the shadcn/ui library plus `src/imports/` design assets, which live code imports nowhere.
  **Deleted 2026-08-14.** At the time they also existed in `gamepados-account`, but that folder was
  deleted the same day — so those 48 component files and the design assets (`controller.jpeg`,
  `game_controller.pdf`, `image-1..6.png`) now survive **only in the `app-with-login` GitHub repo**.
  Nothing local depends on them; the blueprint markdown is in `context/docs/`.
- **Three guide PDFs** in `projects\gamepados\docs\notes\` have no backup and are not markdown, so
  they are not in `context/docs/`. Three other guide files were already lost when `F:` was
  formatted on 2026-07-26.
- **A latent build bug was found and fixed.** `controller-ui/src/styles/tailwind.css` imports
  `tw-animate-css`, which was not declared in `package.json` — it only resolved because a stray
  copy sat in `node_modules`. Any fresh clone or `npm ci` would have failed. Now pinned at 1.3.8.

---

## 6. The path history that broke Claude's memory

```
F:\hlooo   →   F:\   →   D:\AKHIL\HP   →   D:\AKHIL\HP\projects\gamepados
```

`F:` was formatted on 2026-07-26. Claude keys memory by absolute project path, so each move started
a fresh namespace on `C:`:

| Namespace | Files | Status |
|---|---|---|
| `…\projects\F--hlooo\memory\` | 6 | orphaned — held the worktree rule and the "Aukstea" fact |
| `…\projects\F--\memory\` | 27 | orphaned — strict subset of current |
| `…\projects\D--AKHIL-HP\memory\` | 33 | current |

All three sat on `C:`, which the Claude Desktop reinstall wiped. They are now merged, 75 stale
`F:\` paths corrected, and mirrored into `context/memory/` — which lives on `D:` and goes into git.
The originals are archived under `context/memory/_archive_orphaned_namespaces/`.
