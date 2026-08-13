---
name: fdrive-overview
description: "Working-drive inventory — F:\\ was FORMATTED 2026-07-26; everything now lives at D:\\AKHIL\\HP"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2eb8022d-fde2-405c-89f1-4aee6551258f
  modified: 2026-07-26T08:20:48.856Z
---

## 🚨 F:\ WAS FORMATTED 2026-07-26 — THE WORKING DRIVE IS NOW `D:\AKHIL\HP`
Everything was copied F:\ → `D:\AKHIL\HP` first (65 GB / 290k files), then F: was wiped and unmounted.
**All memory files were rewritten to `D:\AKHIL\HP\…` on 2026-08-13** — 75 stale path references
fixed across 15 files. Any remaining `F:\` you see is deliberate narrative about the old drive,
not a live path. If you find a live one, it is a bug: fix it.

Historically that mapping was `F:\hlooo` →
`D:\AKHIL\HP\Android\Sdk` → `D:\AKHIL\HP\Android\Sdk`, `D:\AKHIL\HP\keys` → `D:\AKHIL\HP\keys`.
- **Permanently LOST** (created 2026-07-26 after the copy had already passed that folder, never on D:):
  `apps/docs/make_guide_part.py`, `docs/notes/GamepadOS_Guide_Part_VI_Accounts_and_Sync.md` + `.pdf`.
  Other guide PDFs (Complete_Book, The_Complete_Guide, Interdisciplinary_Analysis, Study_Plan) DID survive in `docs/notes/`.
- Also not copied but harmless: `pc-server-rs/target/` (1,152 files — `cargo build` regenerates) and `D:\AKHIL\HP\.claude` skills (reinstall).
- `local.properties` repointed to the D: SDK in BOTH `hlooo/apps/android-client` and `App with login/apps/android-client`.
  A stale F: copy survives only in `D:\AKHIL\HP\$RECYCLE.BIN\…` (junk, ignore).
- Memory was migrated from the `F--` project slug to `D--AKHIL-HP`; the `F--` copy is now stale.
- Build env is now: `JAVA_HOME=D:\AKHIL\HP\hlooo\tools\jdk\jdk-17.0.19+10`,
  `ANDROID_HOME=D:\AKHIL\HP\Android\Sdk`, `D:\AKHIL\HP\hlooo\tools\gradle-8.14.4\bin\gradle.bat` (no wrapper).

F:\ drive WAS the user's primary personal + development storage drive (historical detail follows).

**Why:** Analyzed on 2026-06-21 to give Claude full context of what's available.
**How to apply:** Reference this when the user asks about any file or project on F drive.

## DRIVE REORGANIZED 2026-07-11 (supersedes layout details below)
⚠️ **The paragraph below is HISTORY from the F:-drive era (pre-2026-07-26). F: was formatted; the
`_TRASH_REVIEW`, `.tmp.driveupload` and `F:\personal\` items it lists no longer exist and are not
pending actions.** Kept only to explain where things ended up.

Root files are GONE from F:\ root: resumes → **F:\personal\**; flexsquares logos + Gemini sources → **D:\AKHIL\HP\flexsquares\branding\**; 22 stray DLLs + bing1.html + other junk → **F:\_TRASH_REVIEW\** (4.02 GB quarantine with MOVE_LOG.md — nothing hard-deleted; user reviews then deletes). hlooo root marketing assets → **D:\AKHIL\HP\hlooo\marketing\**; study plans → hlooo\NOTES\; Amazon .pem → D:\AKHIL\HP\keys\; hlooo-workspace (Antigravity copy) + heap dumps + replit_assets duplicates + flexsquares installers all quarantined. Still awaiting USER deletion: F:\.tmp.driveupload (10.4 GB stale Drive staging — do NOT move it, delete via Explorer), $RECYCLE.BIN (688 MB), _TRASH_REVIEW itself. D:\AKHIL\HP\keys holds plaintext secrets on a LOCAL drive with no backup (flagged to user; see [[project_fdrive_overview]] §secrets and D:\AKHIL\HP\context\INVENTORY.md §4). Drive: 1,397 GB total / ~50 GB used. Note: apps/pc-server-rust no longer exists (only GamepadServer-linux, ios-client, GamepadOS-iOS alongside the main apps); **gradle is now 9.6.1** (verified 2026-08-13 from `build_apk.bat`): the app is on AGP 9.3.1, which needs Gradle 9.5.0+ and REJECTS every 8.x — `tools/gradle-8.5`, `8.9` and `8.14.4` are kept for reference and cannot build. Build via JAVA_HOME=D:\AKHIL\HP\hlooo\tools\jdk\jdk-17.0.19+10 + D:\AKHIL\HP\hlooo\tools\gradle-9.6.1\bin\gradle.bat (no gradlew wrapper).

## Key Folders

### hlooo/ — Main Dev Project (GamepadOS)
- Cross-platform gamepad support platform
- Git remote: https://github.com/gamepadadmin01-tech/gamepad
- Git user: Akhil / gamepadadmin01@gmail.com
- apps/android-client/ — Android app (Gradle)
- apps/pc-server/ — Python desktop server — THIS is the LIVE/shipped one (dist/GamepadServer.exe)
- apps/pc-server-rust/ — Rust rewrite of pc-server — INCOMPLETE & wire-incompatible, NOT shipped (drops all packets); see [[realtime-latency-stack]]
- apps/controller-ui/ — React/TypeScript UI (Capacitor, Vite, Shadcn)
- website/backend/ — Node.js/Express + Prisma ORM
- website/frontend/ — Vite + React web frontend
- daily-news-app/ — Separate Node.js news aggregation app ("echonews-ai"). **MOVED OUT of hlooo → `D:\AKHIL\HP\daily-news-app` on 2026-07-16** (unrelated to GamepadOS).
- ⚠️ Paths in this file predate the **2026-07-16 hlooo reorg** — `store-releases/`→`releases/store/`, `releases-archive/`→`releases/archive/`, `NOTES/`+`high professional notes/`→`docs/notes/`, `SESSION_HANDOFF_*.md`→`docs/handoffs/`, store photo folders→`store-assets/{amazon,uptodown,indus}/`, `ad-footage/`→`marketing/ad-footage/`. `apps/`, `tools/`, `website/`, `RELEASE.md` unchanged. Full map + undo: `D:\AKHIL\HP\hlooo\MOVE_LOG.md`.
- tools/ — JDK, Gradle 8.5, Android platform-tools, rustup-init.exe, vs_BuildTools.exe
- .cargo/ + .rustup/ — Rust toolchain
- GamepadOS_Ad_Production_Kit.pdf — Marketing materials

### Android/ — Android SDK
- SDK path: D:\AKHIL\HP\Android\Sdk
- build-tools 34.0.0, NDK, CMake, platform-tools (adb/fastboot), platforms

### capcut/ (~4.23 GB) — Video Editing
- CapCut app installations (versions 3.9.0, 7.5.0, 8.7.0)
- Drafts: 0611, 0611(1), 0616
- exports/ and material downloaded/ folders

### Daddy's retirement/ — Personal Family Media
- Photos (NAS09198.JPG etc.) and videos from a retirement celebration
- retirement.mp4 + backup copies

### downloads/ — Empty

### Root Files (Sensitive)
- RECOVERY-CODES-GamepadSupport.txt — GamepadSupport account recovery codes (plain text — insecure)
- twilio_2FA_recovery_code.txt — Twilio 2FA recovery code (plain text — insecure)
- ChatGPT Image Jun 15, 2026, 01_20_46 PM.png — AI-generated image
