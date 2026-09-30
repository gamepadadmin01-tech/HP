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
