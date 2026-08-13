---
name: antigravity-incident
description: "2026-07-02 recovery: Antigravity AI broke GamepadOS pairing/versioning; what it damaged + the restore"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4387d20d-c0d8-4c8b-aea5-e75b71682108
---

On 2026-07-01/02, while Claude credits were out, the user ran "Antigravity AI" on GamepadOS (D:\AKHIL\HP\projects\gamepados\apps). It broke pairing/connection reliability and spawned ~12 useless versions. Full forensic audit (3 agents) + restore done 2026-07-02.

**Why:** Documents the damage + the correct-state baseline so future regressions are diffable.
**How to apply:** This is the authoritative "what good looks like" for the pairing/version stack after the incident.

## What Antigravity broke + the fix applied
- **connectToPC force-teardown (root cause of flapping)** — MainActivity.kt: a block was inserted at the TOP of `connectToPC` that ran `stopNetworkNative()` + released locks whenever `isEngineRunning`. Every JS retry/nudge (fires before first ACK, up to ~2.5s) hard-killed & restarted the live engine → disconnect/reconnect loop, pad vanishing mid-game. FIX: reverted to guard-only (`isTransitioning.compareAndSet(false,true)` is the sole gate; transport switches go through stopEngine() first).
- **"BYE" teardown packet** — gamepad-engine.cpp `stopNetworkNative` sent a cleartext 3-byte "BYE". Amplified the flapping AND is a remote kill-switch (any LAN host can spoof source IP to end a session). FIX: removed; rely on server's ~3s idle watchdog.
- **Version skew → in-app-updater relaunch loop (the "multiple useless versions")** — server.py APP_VERSION drifted to 1.1.13, installer .iss AppVersion=1.1.11 / VersionInfoVersion=1.1.9.0. Installer bundled an exe whose baked version was LOWER than the manifest → freshly installed app instantly says "update available" again → install → auto-relaunch (.iss [Run] has no skipifsilent) → repeat, dropping a new GamepadServer-Setup-<ver>.exe each cycle. FIX: synced all 3 to 1.1.14.
- **Dead update manifest URL** — server.py UPDATE_MANIFEST_URL = https://admin.gamepad.space/api/version (never a live host; update_check.log = timeouts). FIX: now env-overridable `GAMEPAD_UPDATE_URL`, default https://gamepad-production-9351.up.railway.app/api/version. NOTE: that railway URL returned 404 on 2026-07-02 curl — **VERIFY the real live backend URL** (gamepad.space/www.gamepad.space/api/version both 404'd too; the frontend bundle only had /api/download/app + /api/download/pc). The backend base is a real unknown to confirm.
- **Haptics doubled** — App.tsx: Antigravity removed the `/2` at 9 haptic call sites + triggerH helper (App.tsx was OTHERWISE fully intact — pairing/transport/packet all verified byte-identical to pre-incident via bundle diff). FIX: restored `Math.round(x/2)`.
- **12 bogus artifacts** quarantined to website/backend/downloads/_quarantine_antigravity/ (APK 1.2.1–1.2.5, Setup 1.1.7–1.1.13). Several "Setup" exes were byte-identical to the RAW dist/GamepadServer.exe = installer with NO ViGEmBus driver/firewall (useless). Real installer ≈44.9MB; raw-exe fakes ≈42.8MB.

## Verified INTACT (no damage) after incident
Wire contract (20B `<Q H B B B B B B I`, GRX 41B, GRX_LTID b"gamepados-grx-v1", GRX_REQUIRED=False, HKDF info "grx psk v1"); run_udp_loop 0xE1/0xE3 handshake + ACK + RMB + pad-per-IP; gyro pipeline (HandlerThread, atan2(R6,R7) roll / asin(R8) pitch, OneEuroFilter 2.8/0.5, STEER_SIGN=1/PITCH_SIGN=-1, no setGyroNeutral); TX-thread DetachCurrentThread guard; transport coordinator gating on engineRunning; packet builder; panic-release; useStick pid ownership; two-mode gyro + calibrate; trigger throttle/normal (analogTrigger).

## Second Antigravity event 2026-07-10 (BENIGN this time — reconciled 2026-07-11)
User asked Antigravity to fix the broken-feedback "features corruption". It copied the project to **D:\AKHIL\HP\projects\gamepados-workspace** (never touched D:\AKHIL\HP\projects\gamepados), correctly prototyped the WebViewAssetLoader fix in MainActivity.kt + build.gradle.kts (webkit 1.10.0, CameraX 1.4.0), OOM-crashed gradle (785MB hprof), added -Xmx4g, built only the direct flavor, and stopped. It MISSED: localStorage migration (origin switch wipes custom pads), version bump (kept burned code 24), and the other 4 flavors. All diffs reviewed + re-applied to D:\AKHIL\HP\projects\gamepados with those gaps filled on 2026-07-11 (→ 1.3.1/code 25, see [[project-grx-crypto]]); hlooo-workspace quarantined to F:\_TRASH_REVIEW.

## Backend URL question RESOLVED 2026-07-11
The real live backend hosts (Railway service "gamepad-production", port 8080): **gamepad-production.up.railway.app** (200 OK) + custom domains **supportportal.gamepad.space** + **admin.gamepad.space**. The old `gamepad-production-9351.up.railway.app` is DEAD (404) — it was still referenced in website/.github/workflows/keepalive.yml (fixed, committed) and apps/docs/SKILL.md (fixed).

## Clean release rebuilt 2026-07-02 (post-restore)
Android **1.2.6 / versionCode 18** (release, 3 ABIs); PC **1.1.14** (server.py + .iss synced), installer SHA-256 `61F6ADA66181A5A8DE54268B8C0007392E46756D6E8681980F82A4C4473F674F` in website .dl-trust. Went FORWARD (not rollback) so anyone on a bogus build still gets offered the fix. Still TODO by user: publish 1.2.6.apk + Setup-1.1.14.exe to downloads/, ACTIVATE in admin Releases panel, deploy frontend. Also: is_offlan_client was loosened to any-off-/24 token-0 (RNDIS-specific detection removed) — left as-is, flagged for user decision (security-loosening, not the flapping cause).
