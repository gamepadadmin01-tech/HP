---
name: fdrive-overview
description: "Full inventory of F:\\ drive — what's there, purpose of each folder, key project details"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2eb8022d-fde2-405c-89f1-4aee6551258f
---

F:\ drive is the user's primary personal + development storage drive.

**Why:** Analyzed on 2026-06-21 to give Claude full context of what's available.
**How to apply:** Reference this when the user asks about any file or project on F drive.

## DRIVE REORGANIZED 2026-07-11 (supersedes layout details below)
Root files are GONE from F:\ root: resumes → **F:\personal\**; flexsquares logos + Gemini sources → **F:\flexsquares\branding\**; 22 stray DLLs + bing1.html + other junk → **F:\_TRASH_REVIEW\** (4.02 GB quarantine with MOVE_LOG.md — nothing hard-deleted; user reviews then deletes). hlooo root marketing assets → **F:\hlooo\marketing\**; study plans → hlooo\NOTES\; Amazon .pem → F:\keys\; hlooo-workspace (Antigravity copy) + heap dumps + replit_assets duplicates + flexsquares installers all quarantined. Still awaiting USER deletion: F:\.tmp.driveupload (10.4 GB stale Drive staging — do NOT move it, delete via Explorer), $RECYCLE.BIN (688 MB), _TRASH_REVIEW itself. F:\keys holds plaintext secrets on a cloud-synced drive (flagged to user). Drive: 1,397 GB total / ~50 GB used. Note: apps/pc-server-rust no longer exists (only GamepadServer-linux, ios-client, GamepadOS-iOS alongside the main apps); gradle is now 8.9 (tools/gradle-8.9), build via JAVA_HOME=F:\hlooo\tools\jdk\jdk-17.0.19+10 + F:\hlooo\tools\gradle-8.9\bin\gradle.bat (no gradlew wrapper).

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
- daily-news-app/ — Separate Node.js news aggregation app ("echonews-ai"). **MOVED OUT of hlooo → `F:\daily-news-app` on 2026-07-16** (unrelated to GamepadOS).
- ⚠️ Paths in this file predate the **2026-07-16 hlooo reorg** — `store-releases/`→`releases/store/`, `releases-archive/`→`releases/archive/`, `NOTES/`+`high professional notes/`→`docs/notes/`, `SESSION_HANDOFF_*.md`→`docs/handoffs/`, store photo folders→`store-assets/{amazon,uptodown,indus}/`, `ad-footage/`→`marketing/ad-footage/`. `apps/`, `tools/`, `website/`, `RELEASE.md` unchanged. Full map + undo: `F:\hlooo\MOVE_LOG.md`.
- tools/ — JDK, Gradle 8.5, Android platform-tools, rustup-init.exe, vs_BuildTools.exe
- .cargo/ + .rustup/ — Rust toolchain
- GamepadOS_Ad_Production_Kit.pdf — Marketing materials

### Android/ — Android SDK
- SDK path: F:\Android\Sdk
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
