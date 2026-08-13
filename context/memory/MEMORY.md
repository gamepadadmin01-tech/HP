# Memory Index

> 📍 **Durable copy: `D:\AKHIL\HP\context\memory\`, in git.** This directory on `C:` is a cache —
> a Claude reinstall wipes it. If it comes back empty, restore from `context/`.
> Session brief: `D:\AKHIL\HP\CLAUDE.md` · Folder map: `context/INVENTORY.md` ·
> All 108 project docs indexed at `context/docs/INDEX.md` — **read that index rather than
> loading the large docs.**

## Who / how to work

- [Who Akhil is](user_akhil_identity.md) — solo owner of GamepadOS; **"Aukstea" is his CUSTOMER, not him**; not comfortable with terminals
- [How he learns](user_akhil_learning_state.md) — strong at flow/behaviour design, near-zero at code mechanics; explain before implementing, one term at a time
- [Never use worktrees](feedback_no_worktrees.md) — edit his real folders directly; a worktree copy once made him think his site was destroyed
- [No auto-push](feedback_no_auto_push.md) — never run `git push`; commit and prep only
- [Git author](feedback_git_author_vercel.md) — commit as gamepadadmin01@gmail.com; Vercel Hobby blocks non-owner authors
- [No Claude co-author](feedback_no_claude_coauthor.md) — no `Co-Authored-By` trailers
- [Brand voice](feedback_brand_voice_email.md) — never put his name in outgoing mail; sign as "GamepadOS"
- [Challenge your own code](feedback_challenge_own_code.md) — remove what measurement shows adds nothing
- [Regression checklist](feedback_regression_checklist.md) — run `docs/REGRESSION_CHECKLIST.md` after big changes
- [Latest tooling](feedback_latest_tooling.md) — now AGP 9.3.1 + **Gradle 9.6.1** (build-verified 2026-08-13)

## The drive

- [Working drive map](project_fdrive_overview.md) — 🗂️ **reorganised 2026-08-13: `hlooo` → `projects/gamepados`, `Android` → `toolchain/android-sdk`.** All paths corrected; build re-verified

## GamepadOS — the product

- [Wire protocol](reference_wire_protocol.md) — the 20-byte frame, button bits, GRX 41-byte encrypted frame. **The load-bearing contract**
- [Release checklist](reference_release_checklist.md) — every version touchpoint, the 5 flavours, and the Register & Activate step that keeps getting missed
- [GRX crypto](project_grx_crypto.md) — encrypted input layer, LIVE. Live = 1.3.24/code 48; 1.3.26 committed but never activated; source builds 1.3.27/code 51
- [Realtime latency](project_realtime_latency_stack.md) — measured breakdown; Phase 3 native input **3.7× faster, device-verified**; gameplay-feel verdict still the release gate
- [Controller UI widgets](project_controller_ui_widgets.md) — live pad widgets in `Widgets.tsx` (`GamepadWidgets.tsx` is DEAD)
- [Gyro indicator design](feedback_gyro_indicator_design.md) — USER-MANDATED: top edge, 6.5px thick, no glow, behind buttons
- [Gyro idle gate](feedback_gyro_idle_gate.md) — USER-MANDATED: suppress after 1s of no touch; wakes on button/touch, never on gyro itself
- [Double-pad bug](project_double_pad_bug.md) — gate `connect()`, never `disconnect()`
- [Kotlin JNI gotcha](feedback_kotlin_jni_internal.md) — an `external fun` must never be `internal` (name mangling → runtime `UnsatisfiedLinkError`, compiles fine)
- [Rust server v2](project_rust_server_v2.md) — 🚨 2.0.1 built+pushed but **never activated**; the is_offlan keyless-pairing hole it fixes is still live
- [iOS/Mac port](project_ios_mac_port.md) — needs a Mac to compile. `GamepadOS-iOS` is the real tree; `ios-client` is superseded
- [Play production access](project_play_production_access.md) — 🎉 unlocked 2026-08-12; verify which build gets promoted

## Website / platform

- [Website backend](project_website_backend.md) — Express+Prisma ticketing platform, auth, webhook, DNS at Namecheap, known gotchas
- [Downloads + feedback](project_downloads_feedback.md) — 🚨 the site serves the **amazonstore** APK as the direct download → self-updater dead for website users
- [Account system](project_gamepados_account.md) — identity rebuild; the account UI now lives in the MAIN tree, not the fork

## Other projects

- [Flexsquares](project_blankspace.md) — sell-the-white-space site
- [PlayCarys](project_playcarys_hillclimb.md) — FFSD academic project at `D:\AKHIL\ACADEMIC\...`
- [Antigravity incident](project_antigravity_incident.md) — 2026-07-02, another AI broke pairing/versions; full restore done

## Reference

- [Remote Gamepad protocol](reference_remote_gamepad_protocol.md) — the commercial app GamepadOS was modelled on; hybrid TCP-control + UDP-input
- [Liquid glass refraction](reference_liquid_glass_refraction.md) — real Snell's-law method; Chromium-only, so viable in the Android WebView
- [Guide PDF toolchain](reference_guide_pdf_toolchain.md) — use PyMuPDF/pdftotext to read the notes PDFs
- [Indus update API](reference_indus_update_api.md) — upload script + where the key goes
- [C: drive audit](reference_c_drive_disk_audit.md) — where C: space actually goes

---

**⚠️ App.tsx has repeated strings and NBSP zones.** An automated edit with a non-unique anchor once
deleted ~133,000 characters of it. Count occurrences first; prefer the Edit tool with a large
unique context block. Backups and the full story: `context/recovery/README.md`.
