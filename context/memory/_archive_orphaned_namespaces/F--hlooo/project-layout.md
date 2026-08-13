---
name: project-layout
description: Where everything lives in F:\hlooo after the June 2026 cleanup and website rebuild
metadata: 
  node_type: memory
  type: project
  originSessionId: a9693bb2-10c4-445c-854b-a2a03dbf6115
---

**The product's name is GamepadOS** (not RemoteGamepad — corrected by the user June 12, 2026). Phone app = GamepadOS.apk, PC side = GamepadServer.exe.

**Reorganized June 20, 2026** into a clean root. `F:\hlooo` now holds exactly: `apps\`, `website\`, `tools\`, `daily-news-app\` (a separate side project the user wanted kept), dotfolders, and two entry-point docs at root: **`CLAUDE_CONTEXT.md`** (the full new-session brief — read it first) and **`BUILD.md`** (exact tool paths + build commands).

- `F:\hlooo\apps` — the product: `pc-server` (Python, GamepadServer.exe via PyInstaller, ViGEmBus), `android-client` (Kotlin/Gradle APK + C++ NDK), `controller-ui` (React UI → inlined dist), `pc-server-rust` (experiment), and `docs\` (ARCHITECTURE, LOW_LATENCY_GUIDE, SKILL, AOA_REQUIREMENTS — moved here from root).
- `F:\hlooo\tools` — build tools **moved out of `apps\`**: `jdk` (JDK 17), `gradle-8.5`, `platform-tools` (adb), `vs_BuildTools.exe`, `rustup-init.exe`. Android SDK stays OUTSIDE at `F:\Android\Sdk` (pinned in local.properties — deliberately not moved). After this move, fixed paths in `GamepadServer.spec` (adb → `..\..\tools\platform-tools\`) and `android-client\build_apk.bat`.
- `F:\hlooo\website` — the rebuilt website ("Signal" design: paper-white #F6F5F1, ink #141417, orange #FF4D00). Vite static frontend + Express/Prisma/Brevo ticketing backend. Its OWN local git repo. NOTE: the **live** helpdesk runs from a separate repo, see [[live-helpdesk-repo]].

Deleted in the June 20 cleanup (per user): stale ROOT duplicates `android-client`/`controller-ui`/`pc-server` (old v1.1.0 — live code is in `apps\`, v1.1.6), plus `admin-dashboard`, `admin_page_by_antigravity`, `promo`, `source_export`, `support-website`, `project-knowledge`, `assets`.

**Important:** the `F:\hlooo` git repo is a **stale local snapshot** (tracked the old root copies); the **live app code in `apps\` is untracked** — don't trust git history as current state. Only `website\` is pushed/deployed; the apps tree stays local.

**How to apply:** never create parallel copies of these folders; check [[edit-directly-no-worktrees]] before starting work. Deploy targets: backend → Railway, frontend → Vercel, email → Brevo.
