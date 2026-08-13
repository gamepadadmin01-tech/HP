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
│   ├── gamepados-account/    account-system fork (was "App with login")
│   ├── flexsquares/          sell-the-white-space site
│   ├── daily-news-app/       echonews-ai, unrelated
│   └── spotify-corizo/       Corizo academic project
├── toolchain/
│   ├── android-sdk/          SDK root (was "Android/Sdk")
│   └── android-cli/          (was "Android/AndroidCLI")
├── media/capcut/
├── installers/
├── keys/                     PLAINTEXT SECRETS — never commit, never upload
├── .agents/skills/           live hyperframes video skills
└── _TO_DELETE_2026-08-13/    staged, awaiting go-ahead
```

### Sizes as measured before the cleanup

| Folder (old name) | Size | Files | Now |
|---|---|---|---|
| `hlooo` | 9.19 GB | 110,891 | `projects/gamepados` — 3.55 GB after cache removal |
| `App with login` | 7.06 GB | 103,240 | `projects/gamepados-account` |
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
| `projects/gamepados-account` | `gamepadadmin01-tech/app-with-login` | 3 commits unpushed |
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

## 3. Where the space went

### Regenerable build cache — 10.99 GB, staged for deletion

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

### Also staged

| Item | Size | Why |
|---|---|---|
| `Daddy's retirement` | 21.26 GB | family media, copy on another laptop |
| recycle bin contents | 5.47 GB | see §5 |
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

- **`projects/gamepados-account` is a legitimate fork**, not junk. It is the account-system
  rebuild and is safely on GitHub. **Do not delete it as a "duplicate."**
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
- **The recycle bin held `$RB86WEL\apps\`** — a complete deleted `apps/` tree (5.47 GB, 98,271
  files). Verified 2026-08-13: **zero files newer than live**, and all 68 files unique to it (the
  shadcn/ui library and `src/imports/` design assets) survive in `gamepados-account`, which is on
  GitHub. Live code imports none of them. A safety copy was taken into staging anyway. **It was
  NOT emptied** — that is Akhil's call.
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
