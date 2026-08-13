# INVENTORY — `D:\AKHIL\HP`

Measured 2026-08-13. **60.2 GB across ~390,000 files.**

---

## 1. Top-level map

| Folder | Size | Files | What it is | Backed up? |
|---|---|---|---|---|
| `Daddy's retirement` | 21.26 GB | 378 | Family video + photos (`retirement.mp4`) | **No — irreplaceable** |
| `DaVinci Resolve Studio 21.0.0.48` | 9.46 GB | 8 | Installer + patcher | Re-downloadable |
| `hlooo` | 9.19 GB | 110,891 | **GamepadOS — the product** | Only `website/` |
| `App with login` | 7.06 GB | 103,240 | Git fork of `hlooo` — account-system rebuild | Yes (GitHub) |
| `capcut` | 5.70 GB | 15,291 | CapCut drafts, exports, source footage | **No** |
| `$RECYCLE.BIN` | 5.47 GB | 98,292 | A deleted `apps/` tree | n/a |
| `Android` | 2.03 GB | 56,785 | Android SDK + NDK 25.1.8937393 | Re-downloadable |
| `keys` | 40 MB | 6 | **Secrets, in plaintext** | **No — see §4** |
| `_test-pc-1.1.15` | 40 MB | 1,614 | Scratch copy of the PC server + a venv | Redundant |
| `flexsquares` | 30 MB | 3,185 | Flexsquares site | Yes (GitHub) |
| `minor spotify project corizo` | 20 MB | 18 | Corizo academic project (DJ_AI, Genre_Blender) | **No** |
| `.agents` | 18 MB | 841 | Hyperframes video skills — **live, in use** | n/a |
| `daily-news-app` | ~0 | 632 | echonews-ai, unrelated side project | **No** |
| `backup app.tsx` | 199 KB | 1 | Pre-corruption `App.tsx` backup (2026-07-14) | Archived to `recovery/` |
| `.claude` | ~0 | 3 | `launch.json`, `settings.local.json`, empty skill shells | n/a |
| `Config.Msi` | 0 | 0 | Windows installer leftover | n/a |

---

## 2. Git and backup state — the risk map

| Path | Remote | Dirty | Unpushed | Risk |
|---|---|---|---|---|
| `App with login` | `gamepadadmin01-tech/app-with-login` | 0 | **3 commits** | Push pending |
| `flexsquares` | `gamepadadmin01-tech/flexspace` | 2 files | 0 | Low |
| `hlooo/website` | `gamepadadmin01-tech/gamepad` | 9 files | 0 | Low |
| **`hlooo/apps`** | **none** | — | — | 🔴 **total loss risk** |
| `hlooo/releases`, `marketing`, `store-assets`, `docs`, `tools` | none | — | — | 🔴 no backup |
| `capcut`, `Daddy's retirement`, `minor spotify…`, `daily-news-app` | none | — | — | 🔴 no backup |

**`hlooo/apps/` is the product** — Android client, controller-ui, PC server (Python and Rust), the
iOS port. It has never been under version control. It has already come close to being lost twice:

- **2026-07-14** — an automated PowerShell edit matched a non-unique anchor in `App.tsx` and
  deleted ~133,000 characters (4,600 → 1,809 lines). Recovered by splicing a two-week-old backup
  into the intact head and tail. See `recovery/`.
- **2026-07-02** — the Antigravity AI broke pairing and version handling; required a full restore.

There is no VSS, no File History, and no cloud version history on `D:`. A backup is the only
protection.

---

## 3. Where the 60 GB actually went

### Regenerable build cache — ~10.9 GB

| Path | Size | Files |
|---|---|---|
| `hlooo\apps\pc-server-rs\target` | 4.61 GB | 12,563 |
| `App with login\apps\pc-server-rs\target` | 4.20 GB | 11,819 |
| `hlooo\.cargo` | 0.68 GB | 18,766 |
| `App with login\.cargo` | 0.68 GB | 18,748 |
| `hlooo\apps\controller-ui\node_modules` | 0.24 GB | 68,608 |
| `App with login\apps\controller-ui\node_modules` | 0.24 GB | 69,128 |
| `hlooo\website\backend\node_modules` | 0.21 GB | 2,005 |
| `hlooo\website\frontend\node_modules` | 0.04 GB | 478 |
| `hlooo\apps\android-client\.gradle` | 0.04 GB | 26 |

Two Rust `target/` directories alone are **8.8 GB — 15% of the entire folder.** Rebuild commands
are in `REBUILD.md`.

### Must be kept — not "just a download"

| Path | Size | Why |
|---|---|---|
| `hlooo\tools\` | 0.92 GB | **Pinned JDK 17.0.19+10 + Gradle 9.6.1.** `build_apk.bat`, the PyInstaller specs and `.claude/launch.json` reference it by absolute path. There is no `gradlew`. |
| `App with login\tools\` | 0.78 GB | Same, for the fork |
| `Android\Sdk` | 2.03 GB | Pinned in `local.properties`; deliberately kept outside `hlooo` |

### Real content

`hlooo`: `releases/` 0.46 GB (APKs/AABs), `marketing/` 0.23 GB, `store-assets/` 0.01 GB, plus
~1.5 GB of source. That ~1.5 GB is the part that genuinely matters and that git should hold.

---

## 4. Secrets — do not put any of these in git or a shared cloud folder

| Path | What |
|---|---|
| `keys\AppstoreAuthenticationKey.pem` | Apple App Store auth key |
| `keys\RECOVERY-CODES-GamepadSupport.txt` | Account recovery codes |
| `keys\release key.txt` | Release signing password |
| `keys\rzp-key.csv` | Razorpay API key |
| `keys\twilio_2FA_recovery_code.txt` | Twilio 2FA recovery |
| `keys\Gamepad Server\` | (folder) |
| `hlooo\apps\android-client\app\release.keystore` | **Play Store signing key** |
| `App with login\apps\android-client\app\release.keystore` | Same |
| `hlooo\website\backend\.env` | Brevo API key, DB URL, admin creds |
| `App with login\website\backend\.env` | Same |
| `App with login\apps\controller-ui\.env` | — |
| `hlooo\secrets\`, `App with login\secrets\` | Indus API key etc. |

**`release.keystore` is the single most irreplaceable file in this folder.** Lose it and the Play
Store listing can never be updated again — a new key means a new app listing and every existing
install is orphaned. It currently exists only on this laptop.

---

## 5. Structural notes

- **`App with login` is a legitimate fork of `hlooo`**, not junk. Same `apps/`, `website/`,
  `tools/`; only difference at the top level is that it lacks `apps/docs/`. It is the
  account-system rebuild and is safely on GitHub. **Do not delete it as a "duplicate."**
- **`apps/GamepadOS-iOS/` vs `apps/ios-client/`** are near-duplicates — identical specs, different
  `project.yml`; `GamepadOS-iOS/` additionally has `Assets.xcassets`, `GamepadOS.xcodeproj`,
  `Generated/`, `CHANGES_MAC.md`. One is likely an xcodegen export of the other. **`MOVE_LOG.md`
  flags this as needing a human decision — it is unresolved. Do not delete either.**
- **The nested `.claude/launch.json` files** in `flexsquares/`, `hlooo/`, and
  `hlooo/apps/controller-ui/` use **relative** paths and are valid — keep them. Only
  `HP\.claude\skills\` (19 empty directory shells, 0 files) is dead. The real skills are in
  `.agents\skills\` and are actively loaded.
- **`hlooo` is not a git repo**, but `hlooo\website` is — a repo nested inside a non-repo. When
  `hlooo` gets its own repo, `website/` must be excluded so the two do not fight.
- **`$RECYCLE.BIN` holds `$RB86WEL\apps\`** — a complete deleted `apps/` tree (5.47 GB, 98,271
  files) containing `docs/`, which `App with login/apps` lacks. Almost certainly the pre-move `F:\`
  copy. Verify against live before emptying.
- **`hlooo\tools\` holds four Gradle versions**, but `build_apk.bat` states plainly that only
  **9.6.1** works: the app is on AGP 9.3.1, which requires Gradle 9.5.0+ and rejects any 8.x.
  `gradle-8.5` (140 MB), `gradle-8.9` (144 MB) and `gradle-8.14.4` (145 MB) are **429 MB of build
  tools that cannot build this app** — kept "for reference" only. Deletion candidate, but it is a
  judgment call, not a cache, so it was left alone.
- **`build_apk.bat` was already corrected to `D:\AKHIL\HP` paths on 2026-08-03.** Any note
  claiming the build still points at `F:\` is out of date.
- **Three guide PDFs** in `hlooo\docs\notes\` (`GamepadOS_Complete_Book.pdf`,
  `GamepadOS_The_Complete_Guide.pdf`, `GamepadOS_Interdisciplinary_Analysis.pdf`) have no backup
  and are not markdown, so they are not in `context/docs/`. Memory records that three guide files
  were already lost when `F:` was formatted on 2026-07-26.

---

## 6. The path history that broke Claude's memory

```
F:\hlooo   →   F:\   →   D:\AKHIL\HP
```

`F:` was formatted on 2026-07-26. Claude keys its memory by absolute project path, so each move
started a fresh namespace on `C:`:

| Namespace | Files | Status |
|---|---|---|
| `C:\Users\akhil\.claude\projects\F--hlooo\memory\` | 6 | orphaned |
| `C:\Users\akhil\.claude\projects\F--\memory\` | 27 | orphaned |
| `C:\Users\akhil\.claude\projects\D--AKHIL-HP\memory\` | 31 | current |

All three sat on `C:`, which the Claude Desktop reinstall wiped. They are now merged and mirrored
into `context/memory/`, which lives on `D:` and goes into git.

**Every path reference inside those memories said `F:\hlooo\…` and is now corrected.** If you find
a stray `F:\` anywhere, read it as `D:\AKHIL\HP\`.
