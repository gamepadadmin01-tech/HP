# MOVE_LOG — hlooo reorganisation (2026-07-16)

Reorganised the `hlooo` root from **18 top-level entries to 8**, grouped by kind, and
removed folder names containing spaces.

Every move below was a **plain rename on the same volume** — no copies, no content
changed, no files deleted. To undo any row, reverse it.

## Not moved, on purpose

`apps/`, `tools/`, `website/` stayed exactly where they are:

- **Build scripts hardcode them by absolute path.** `apps/android-client/build_apk.bat`
  points at `F:\hlooo\tools\jdk\jdk-17.0.19+10` and `F:\hlooo\tools\gradle-8.14.4`;
  `F:\.claude\launch.json`, the PyInstaller specs (`apps/pc-server/GamepadServer.spec`)
  and `marketing/*.py` all reference `F:/hlooo/apps/...`.
- **`apps/` and `tools/` have no version control.** A bad move there is unrecoverable.
- Moving them buys nothing: `apps/` is already one-folder-per-app, which is the right
  shape. See "Open items" below for what `apps/` *actually* needs.

## Moves

| From | To |
|---|---|
| `store-releases/` | `releases/store/` |
| `releases-archive/` | `releases/archive/` |
| `amazon app store/` | `store-assets/amazon/` |
| `photos for uptodown/` | `store-assets/uptodown/` |
| `indus app submission photos/` | `store-assets/indus/` |
| `ad-footage/` | `marketing/ad-footage/` |
| `ig_endcard_1080x1920.png` | `marketing/brand/` |
| `ig_logo_square_1024.png` | `marketing/brand/` |
| `SESSION_HANDOFF_2026-07-04.md` | `docs/handoffs/` |
| `SESSION_HANDOFF_2026-07-11.md` | `docs/handoffs/` |
| `NOTES/*` (3 files) | `docs/notes/` |
| `high professional notes/*` (3 files) | `docs/notes/` |
| `daily-news-app/` | **`F:\daily-news-app`** (out of `hlooo` entirely) |

`NOTES/` and `high professional notes/` merged into `docs/notes/` (no filename
collisions) and the two emptied folders were removed. `RELEASE.md` stays at the root by
convention.

### Why `daily-news-app` left

It is **`echonews-ai` — "Daily News and Market Intelligence AI Dashboard"**, an entirely
separate project with zero GamepadOS references. It now lives at `F:\daily-news-app`.
All 632 files verified intact after the move.

## Resulting tree

```
hlooo/
├── apps/            # the product (android-client, ios-client, controller-ui, pc-server, …)
├── website/         # marketing site + support portal backend (the only git repo)
├── tools/           # jdk, gradle, platform-tools, bundletool
├── releases/
│   ├── store/       # per-version store artifacts (1.3.0 … 1.3.21)
│   └── archive/     # older release sources
├── store-assets/    # per-store submission material
│   ├── amazon/
│   ├── uptodown/
│   └── indus/
├── marketing/
│   ├── ad-footage/
│   └── brand/
├── docs/
│   ├── notes/       # the books / study plans (+ ERRATA)
│   └── handoffs/    # session handoffs
└── RELEASE.md
```

## Stale references created by this move (docs only — nothing executable)

These mention old paths and are now slightly wrong. Harmless to builds:

- `docs/notes/ERRATA_2026-07-12.md` — says "the PDFs in this folder and in `F:\hlooo\NOTES\`";
  both sets now live together in `docs/notes/`.
- `docs/notes/GamepadOS_Study_Plan.md` / `.txt` — reference `F:/hlooo/apps/` and
  `F:/hlooo/website/`, both **still correct** (those did not move).
- `docs/handoffs/SESSION_HANDOFF_2026-07-04.md` — references `F:\hlooo\releases-archive\`
  → now `releases/archive/`.
- `docs/handoffs/SESSION_HANDOFF_2026-07-11.md` and `releases/store/1.3.6|1.3.7/RELEASE_NOTES.md`
  — reference `store-releases/` → now `releases/store/`.
- `apps/docs/GRX_INTEGRATION.md`, `releases/archive/README.md` — reference
  `releases-archive/` → now `releases/archive/`.

## Open items — what `apps/` actually needs (NOT done here)

Restructuring `apps/` was considered and rejected; its layout is already correct. The
real issues found while surveying, none of which are layout problems:

1. **`apps/GamepadOS-iOS/` and `apps/ios-client/` are near-duplicates.** Identical
   `IOS_PORT_SPEC.md`, `README_MAC_SETUP.md` and the same 7 `Sources/` files, but
   **`project.yml` differs** and `GamepadOS-iOS/` additionally holds `Assets.xcassets`,
   `GamepadOS.xcodeproj`, `Generated/` and `CHANGES_MAC.md`. One is likely an
   `xcodegen` export of the other. **Needs a human decision — do not delete either
   blindly.**
2. **`apps/controller-ui/node_modules/` = 68,608 files** — 84% of everything under
   `apps/`. Regenerable with `npm install`; delete it any time the folder count bothers
   you. The "82,163 files" figure is essentially this.
3. **`apps/controller-ui/android/`** (65 files) — a Capacitor Android project. The real
   Android client is `apps/android-client/`. Probably dead; verify before removing.
4. Small cruft: `apps/pc-server/_preserve_pre-slim/`, `apps/pc-server/__pycache__/`,
   `apps/pc-server/_grxserver.log`, `apps/controller-ui/_recovery_backups/`
   (this last one relates to the App.tsx recovery — keep unless certain).
5. `apps/android-client/app/src/main/java/com/gamepad/client/MainActivity.kt.bak-updater`
   — backup from the store-build hardening; delete after the 1.3.21 device test.

## 2026-09-30 — folder tidy (owner request: "organize the gamepadOS folder")

Moves only, nothing deleted. releases/ was reorganised separately: see releases/README.md and releases/_MOVE_LOG_2026-09-30.json.

- `projects/gamepados/docs/manual-redeem-2026-09-21` -> `projects/gamepados/docs/qa-evidence/manual-redeem-2026-09-21` (10 file(s))
- `projects/gamepados/docs/resume-tether-2026-09-20` -> `projects/gamepados/docs/qa-evidence/resume-tether-2026-09-20` (8 file(s))
- `projects/gamepados/docs/ui-compact-library-2026-09-20` -> `projects/gamepados/docs/qa-evidence/ui-compact-library-2026-09-20` (11 file(s))
- `projects/gamepados/docs/ui-redesign-research-2026-09-16` -> `projects/gamepados/docs/qa-evidence/ui-redesign-research-2026-09-16` (33 file(s))
- `projects/gamepados/marketing/amazon_tablet_icon_114.png` -> `projects/gamepados/marketing/store-graphics/amazon_tablet_icon_114.png` (1 file(s))
- `projects/gamepados/marketing/apkpure_feature_graphic_1024x500.jpg` -> `projects/gamepados/marketing/store-graphics/apkpure_feature_graphic_1024x500.jpg` (1 file(s))
- `projects/gamepados/marketing/app_icon_128x128.png` -> `projects/gamepados/marketing/store-graphics/app_icon_128x128.png` (1 file(s))
- `projects/gamepados/marketing/featured_image_1024x500.jpg` -> `projects/gamepados/marketing/store-graphics/featured_image_1024x500.jpg` (1 file(s))
- `projects/gamepados/marketing/gamepados_feature_1024x500.png` -> `projects/gamepados/marketing/store-graphics/gamepados_feature_1024x500.png` (1 file(s))
- `projects/gamepados/marketing/gamepados_feature_graphic.png` -> `projects/gamepados/marketing/store-graphics/gamepados_feature_graphic.png` (1 file(s))
- `projects/gamepados/marketing/gamepados_feature_graphic_realistic.png` -> `projects/gamepados/marketing/store-graphics/gamepados_feature_graphic_realistic.png` (1 file(s))
- `projects/gamepados/marketing/gamepados_feature_with_assets.png` -> `projects/gamepados/marketing/store-graphics/gamepados_feature_with_assets.png` (1 file(s))
- `projects/gamepados/marketing/gamepados_promo_3d_daylight.jpg` -> `projects/gamepados/marketing/store-graphics/gamepados_promo_3d_daylight.jpg` (1 file(s))
- `projects/gamepados/marketing/gamepados_promo_3d_night.jpg` -> `projects/gamepados/marketing/store-graphics/gamepados_promo_3d_night.jpg` (1 file(s))
- `projects/gamepados/marketing/gamepados_promo_realistic_daylight.jpg` -> `projects/gamepados/marketing/store-graphics/gamepados_promo_realistic_daylight.jpg` (1 file(s))
- `projects/gamepados/marketing/gamepados_promo_realistic_night.jpg` -> `projects/gamepados/marketing/store-graphics/gamepados_promo_realistic_night.jpg` (1 file(s))
- `projects/gamepados/marketing/gamepados_promo_s24ultra_daylight.jpg` -> `projects/gamepados/marketing/store-graphics/gamepados_promo_s24ultra_daylight.jpg` (1 file(s))
- `projects/gamepados/marketing/gamepados_promo_s24ultra_night.jpg` -> `projects/gamepados/marketing/store-graphics/gamepados_promo_s24ultra_night.jpg` (1 file(s))
- `projects/gamepados/marketing/gamepados_s24ultra_gyro_turn_synced.jpg` -> `projects/gamepados/marketing/store-graphics/gamepados_s24ultra_gyro_turn_synced.jpg` (1 file(s))
- `projects/gamepados/marketing/gamepados_s24ultra_straight_synced.jpg` -> `projects/gamepados/marketing/store-graphics/gamepados_s24ultra_straight_synced.jpg` (1 file(s))
- `projects/gamepados/marketing/promotional_image.jpg` -> `projects/gamepados/marketing/store-graphics/promotional_image.jpg` (1 file(s))
- `projects/gamepados/marketing/promotional_image_pro.jpg` -> `projects/gamepados/marketing/store-graphics/promotional_image_pro.jpg` (1 file(s))
- `projects/gamepados/marketing/uptodown_icon_512.png` -> `projects/gamepados/marketing/store-graphics/uptodown_icon_512.png` (1 file(s))
- `projects/gamepados/marketing/mediakit.zip` -> `projects/gamepados/marketing/store-graphics/mediakit.zip` (1 file(s))
- `projects/gamepados/marketing/ANNOUNCEMENT_1.3.29.md` -> `projects/gamepados/marketing/kits/ANNOUNCEMENT_1.3.29.md` (1 file(s))
- `projects/gamepados/marketing/APKPURE_SUBMISSION.md` -> `projects/gamepados/marketing/kits/APKPURE_SUBMISSION.md` (1 file(s))
- `projects/gamepados/marketing/GamepadOS_Ad_Production_Kit.pdf` -> `projects/gamepados/marketing/kits/GamepadOS_Ad_Production_Kit.pdf` (1 file(s))
- `projects/gamepados/marketing/GamepadOS_Instagram_Reel_Kit.md` -> `projects/gamepados/marketing/kits/GamepadOS_Instagram_Reel_Kit.md` (1 file(s))
- `projects/gamepados/marketing/GamepadOS_YouTube_Reveal_Kit.md` -> `projects/gamepados/marketing/kits/GamepadOS_YouTube_Reveal_Kit.md` (1 file(s))
- `projects/gamepados/marketing/UPTODOWN_SUBMISSION.md` -> `projects/gamepados/marketing/kits/UPTODOWN_SUBMISSION.md` (1 file(s))
- `projects/gamepados/marketing/_composited.png` -> `projects/gamepados/marketing/scratch/_composited.png` (1 file(s))
- `projects/gamepados/marketing/_feature_design.html` -> `projects/gamepados/marketing/scratch/_feature_design.html` (1 file(s))
- `projects/gamepados/marketing/_final_overlay.html` -> `projects/gamepados/marketing/scratch/_final_overlay.html` (1 file(s))
- `projects/gamepados/marketing/_race.png` -> `projects/gamepados/marketing/scratch/_race.png` (1 file(s))
- `projects/gamepados/marketing/_race_scene.html` -> `projects/gamepados/marketing/scratch/_race_scene.html` (1 file(s))
- `projects/gamepados/marketing/create_pro_promo.py` -> `projects/gamepados/marketing/scratch/create_pro_promo.py` (1 file(s))
- `projects/gamepados/marketing/create_promo.py` -> `projects/gamepados/marketing/scratch/create_promo.py` (1 file(s))
- `projects/gamepados/tools/resize_feature.py` -> `projects/gamepados/tools/scripts/resize_feature.py` (1 file(s))
- `projects/gamepados/tools/webview-cdp.mjs` -> `projects/gamepados/tools/scripts/webview-cdp.mjs` (1 file(s))
- `projects/gamepados/tools/rustup-init.exe` -> `installers/rustup-init.exe` (1 file(s))
- `projects/gamepados/tools/vs_BuildTools.exe` -> `installers/vs_BuildTools.exe` (1 file(s))
- `projects/gamepados/apps/android-client.zip` -> `context/archive/dead-code-2026-09-30/apps/android-client-snapshot-2026-08-20.zip` (1 file(s))

## 2026-09-30 — releases split, and caches deleted (owner request)

- releases/ split into `releases/mobile/<version>/` and `releases/pc/<version>/` (was `app-<v>` /
  `pc-<v>`), one CHANGELOG.txt per product. Every move is in releases/_MOVE_LOG_2026-09-30.json.
- DELETED on the owner's explicit instruction ("delete the rust cache and reel renders"), ~11 GB:
  `apps/pc-server-rs/target` (Rust build cache — rebuilt by the next `cargo build`, which will be
  slow once), `marketing/instagram/reel-mg/renders` and `marketing/instagram/reel-web/renders`
  (PNG frame sequences + render logs; no videos — the finished reels in instagram/*.mp4 are kept,
  and the render scripts regenerate the frames). None of it was in git.


# 2026-11-18 — every GamepadOS file outside HP brought in

Owner: "outside HP we should not have a single file". All plain renames on the same drive (D:), nothing copied,
nothing deleted. Destinations are git-ignored (`releases/`, `test-builds/`, `docs/design-reference-*/`,
`marketing/videos/`; `archive-local/` and `keys/` at the HP root). Scripts that wrote to `D:\DOWNLOADS`
(`finish.py`, `make_translations.py`, admin-android README) now write into `releases/`.

Left outside on purpose: `D:\Gamepad Server\` (the installed PC server, a program install).
Empty shells Windows kept open: `D:\DOWNLOADS\GamepadOS-2.0-store-graphics\` and `D:\GamepadOS-private\`.

```
D:/DOWNLOADS/GamepadOS-2.0.0-release -> HP/projects/gamepados/releases/2.0.0
LOCKED /d/DOWNLOADS/GamepadOS-2.0-store-graphics
D:/DOWNLOADS/GamepadOS-2.0-videos -> HP/projects/gamepados/releases/2.0.0/videos
D:/DOWNLOADS/GamepadOS-1.4.18-play -> HP/projects/gamepados/releases/1.4.18-play
D:/DOWNLOADS/GamepadOS-1.4.17-release -> HP/projects/gamepados/releases/1.4.17
D:/DOWNLOADS/GamepadOS-1.4.16-release -> HP/projects/gamepados/releases/1.4.16
D:/DOWNLOADS/OLD-1.4.15-release-DO-NOT-UPLOAD -> HP/projects/gamepados/releases/OLD-1.4.15-DO-NOT-UPLOAD
D:/DOWNLOADS/OLD-1.4.14-release-DO-NOT-UPLOAD -> HP/projects/gamepados/releases/OLD-1.4.14-DO-NOT-UPLOAD
D:/DOWNLOADS/GamepadOS-old-versions -> HP/projects/gamepados/releases/old-versions
D:/DOWNLOADS/GamepadOS-Admin -> HP/projects/gamepados/releases/admin-app
D:/DOWNLOADS/GamepadServer-Setup-2.1.0.exe -> HP/projects/gamepados/releases/pc-server-old/GamepadServer-Setup-2.1.0.exe
D:/DOWNLOADS/GamepadServer-Setup-2.1.2.exe -> HP/projects/gamepados/releases/pc-server-old/GamepadServer-Setup-2.1.2.exe
D:/DOWNLOADS/GamepadServer.exe -> HP/projects/gamepados/releases/pc-server-old/GamepadServer-2026-06-14.exe
D:/DOWNLOADS/GamepadOS-colour-TEST -> HP/projects/gamepados/test-builds/colour-TEST
D:/DOWNLOADS/GamepadOS-redesign-TEST -> HP/projects/gamepados/test-builds/redesign-TEST
D:/DOWNLOADS/GamepadServer-TEST -> HP/projects/gamepados/test-builds/GamepadServer-TEST
D:/DOWNLOADS/GamepadOS-1.4.12-touchpad-test.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.12-touchpad-test.apk
D:/DOWNLOADS/GamepadOS-1.4.12-unity-test.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.12-unity-test.apk
D:/DOWNLOADS/GamepadOS-1.4.13-ad-compensation.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-ad-compensation.apk
D:/DOWNLOADS/GamepadOS-1.4.13-clean.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-clean.apk
D:/DOWNLOADS/GamepadOS-1.4.13-playstore-account.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-playstore-account.apk
D:/DOWNLOADS/GamepadOS-1.4.13-playstore-billing.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-playstore-billing.apk
D:/DOWNLOADS/GamepadOS-1.4.13-playstore-cleanpad.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-playstore-cleanpad.apk
D:/DOWNLOADS/GamepadOS-1.4.13-playstore-final.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-playstore-final.apk
D:/DOWNLOADS/GamepadOS-1.4.13-playstore-newtools.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-playstore-newtools.apk
D:/DOWNLOADS/GamepadOS-1.4.13-playstore-plans.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-playstore-plans.apk
D:/DOWNLOADS/GamepadOS-1.4.13-playstore-rating.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-playstore-rating.apk
D:/DOWNLOADS/GamepadOS-1.4.13-playstore-sensitivity.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-playstore-sensitivity.apk
D:/DOWNLOADS/GamepadOS-1.4.13-playstore-test.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-playstore-test.apk
D:/DOWNLOADS/GamepadOS-1.4.13-playstore-unity.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-playstore-unity.apk
D:/DOWNLOADS/GamepadOS-1.4.13-website-account.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-website-account.apk
D:/DOWNLOADS/GamepadOS-1.4.13-website-cleanpad.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-website-cleanpad.apk
D:/DOWNLOADS/GamepadOS-1.4.13-website-final.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-website-final.apk
D:/DOWNLOADS/GamepadOS-1.4.13-website-newtools.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-website-newtools.apk
D:/DOWNLOADS/GamepadOS-1.4.13-website-plans.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-website-plans.apk
D:/DOWNLOADS/GamepadOS-1.4.13-website-rating.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-website-rating.apk
D:/DOWNLOADS/GamepadOS-1.4.13-website-sensitivity.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-website-sensitivity.apk
D:/DOWNLOADS/GamepadOS-1.4.13-website-test.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-website-test.apk
D:/DOWNLOADS/GamepadOS-1.4.13-website.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.13-website.apk
D:/DOWNLOADS/GamepadOS-1.4.14-uptodown-DEBUG-test-only.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.14-uptodown-DEBUG-test-only.apk
D:/DOWNLOADS/GamepadOS-1.4.14-website-DEBUG-test-only.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-1.4.14-website-DEBUG-test-only.apk
D:/DOWNLOADS/GamepadOS-playstore-120fps.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-playstore-120fps.apk
D:/DOWNLOADS/GamepadOS-playstore-chip.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-playstore-chip.apk
D:/DOWNLOADS/GamepadOS-playstore-popup.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-playstore-popup.apk
D:/DOWNLOADS/GamepadOS-playstore-split.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-playstore-split.apk
D:/DOWNLOADS/GamepadOS-playstore-touchpad2.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-playstore-touchpad2.apk
D:/DOWNLOADS/GamepadOS-playstore-touchpad3.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-playstore-touchpad3.apk
D:/DOWNLOADS/GamepadOS-website-120fps.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-website-120fps.apk
D:/DOWNLOADS/GamepadOS-website-chip.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-website-chip.apk
D:/DOWNLOADS/GamepadOS-website-popup.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-website-popup.apk
D:/DOWNLOADS/GamepadOS-website-split.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-website-split.apk
D:/DOWNLOADS/GamepadOS-website-touchpad2.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-website-touchpad2.apk
D:/DOWNLOADS/GamepadOS-website-touchpad3.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS-website-touchpad3.apk
D:/DOWNLOADS/OLD-GamepadOS-1.4.14-playstore-has-layout2.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/OLD-GamepadOS-1.4.14-playstore-has-layout2.apk
D:/DOWNLOADS/GamepadOS1.4.1wheelmodeTESTdirect.apk -> HP/projects/gamepados/test-builds/loose-apks-2026-08-to-11/GamepadOS1.4.1wheelmodeTESTdirect.apk
D:/DOWNLOADS/backup -> HP/archive-local/website-backup-2026-06
D:/DOWNLOADS/GamepadOS_Project_Optimized.zip -> HP/archive-local/GamepadOS_Project_Optimized-2026-06.zip
D:/DOWNLOADS/gamepad.space-Performance-on-Search-2026-10-11.zip -> HP/archive-local/gamepad.space-Performance-on-Search-2026-10-11.zip
D:/DOWNLOADS/GamepadOS-video-assets -> HP/archive-local/emergent-video-assets-2026-11-17
D:/DOWNLOADS/GamepadOS-video-assets.zip -> HP/archive-local/emergent-video-assets-2026-11-17.zip
D:/DOWNLOADS/unigram -> HP/projects/gamepados/docs/design-reference-2026-11
D:/AKHIL/VEDIOS & RECORDING/GamepadOS_Professional_Redo_v1.mp4 -> HP/projects/gamepados/marketing/videos/GamepadOS_Professional_Redo_v1.mp4
D:/DOWNLOADS/Supabase Snippet Users list.csv -> HP/keys/user-data/supabase-users-list-2026-11-02.csv
D:/GamepadOS-private/admin-candidates-2026-10-03.txt -> HP/keys/user-data/admin-candidates-2026-10-03.txt
D:/DOWNLOADS/GamepadOS-2.0-store-graphics/en/01-controller-3840x2160.png -> HP/projects/gamepados/releases/2.0.0/play-store-graphics/en/01-controller-3840x2160.png
D:/DOWNLOADS/GamepadOS-2.0-store-graphics/en/02-home-2160x3840.png -> HP/projects/gamepados/releases/2.0.0/play-store-graphics/en/02-home-2160x3840.png
D:/DOWNLOADS/GamepadOS-2.0-store-graphics/en/03-connect-2160x3840.png -> HP/projects/gamepados/releases/2.0.0/play-store-graphics/en/03-connect-2160x3840.png
D:/DOWNLOADS/GamepadOS-2.0-store-graphics/en/04-racing-3840x2160.png -> HP/projects/gamepados/releases/2.0.0/play-store-graphics/en/04-racing-3840x2160.png
D:/DOWNLOADS/GamepadOS-2.0-store-graphics/en/05-editor-3840x2160.png -> HP/projects/gamepados/releases/2.0.0/play-store-graphics/en/05-editor-3840x2160.png
D:/DOWNLOADS/GamepadOS-2.0-store-graphics/en/06-settings-2160x3840.png -> HP/projects/gamepados/releases/2.0.0/play-store-graphics/en/06-settings-2160x3840.png
D:/DOWNLOADS/GamepadOS-2.0-store-graphics/en/07-why-2160x3840.png -> HP/projects/gamepados/releases/2.0.0/play-store-graphics/en/07-why-2160x3840.png
D:/DOWNLOADS/GamepadOS-2.0-store-graphics/en/08-plans-2160x3840.png -> HP/projects/gamepados/releases/2.0.0/play-store-graphics/en/08-plans-2160x3840.png
D:/DOWNLOADS/GamepadOS-2.0-store-graphics/en/app-icon-512.png -> HP/projects/gamepados/releases/2.0.0/play-store-graphics/en/app-icon-512.png
D:/DOWNLOADS/GamepadOS-2.0-store-graphics/en/feature-graphic-1024x500.png -> HP/projects/gamepados/releases/2.0.0/play-store-graphics/en/feature-graphic-1024x500.png
D:/DOWNLOADS/GamepadOS-2.0-store-graphics/feature-graphic-options/option-A-1024x500.png -> HP/projects/gamepados/releases/2.0.0/play-store-graphics/feature-graphic-options/option-A-1024x500.png
D:/DOWNLOADS/GamepadOS-2.0-store-graphics/feature-graphic-options/option-B-1024x500.png -> HP/projects/gamepados/releases/2.0.0/play-store-graphics/feature-graphic-options/option-B-1024x500.png
D:/DOWNLOADS/GamepadOS-2.0-store-graphics/feature-graphic-options/option-C-1024x500.png -> HP/projects/gamepados/releases/2.0.0/play-store-graphics/feature-graphic-options/option-C-1024x500.png
D:/DOWNLOADS/GamepadOS-2.0-store-graphics/feature-graphic-options-preview.png -> HP/projects/gamepados/releases/2.0.0/play-store-graphics/feature-graphic-options-preview.png
D:/DOWNLOADS/GamepadOS-2.0-store-graphics/play-translations-20-languages.txt -> HP/projects/gamepados/releases/2.0.0/play-store-graphics/play-translations-20-languages.txt
D:/DOWNLOADS/GamepadOS-2.0-store-graphics/play-translations-6-languages.txt -> HP/projects/gamepados/releases/2.0.0/play-store-graphics/play-translations-6-languages.txt
```
