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
