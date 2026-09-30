# GamepadOS — what lives where

```
gamepados/
├── apps/                    THE CODE — build scripts hard-code these paths, do not move them
│   ├── android-client/      Android app (Kotlin shell + native engine). Builds all store flavours.
│   ├── controller-ui/       The app's screens (React). Build, then copy dist/index.html into
│   │                        android-client/app/src/main/assets/dist/ before building the APK.
│   ├── pc-server-rs/        Windows PC server (Rust) — the one that ships.
│   ├── GamepadOS-iOS/       iOS port with the Xcode project   ┐ two diverged copies: ios-client has
│   ├── ios-client/          iOS port, newer code files       ┘ newer code, GamepadOS-iOS the project.
│   │                        Merge on a Mac before any iOS work.
│   ├── GamepadServer-linux/ Linux server port (notes + prototype)
│   └── docs/                Technical docs: protocol, architecture, low-latency guide, AOA.
│
├── website/                 gamepad.space — its OWN git repo (frontend on Vercel, backend on Railway).
│   └── backend/downloads/   Files the website serves to users. Do not move.
│
├── releases/                mobile/ and pc/ kept separate; inside each, one folder per version
│                            (mobile/1.4.6/, pc/2.1.3/) with actual/ (released), test/ (test
│                            builds) and CHANGES.txt, plus a CHANGELOG.txt per product.
│                            See releases/README.md.
│
├── docs/
│   ├── handoffs/            The project diary — newest file = latest state. Start here.
│   ├── REGRESSION_CHECKLIST.md
│   ├── research/ · notes/ · reports/
│   └── qa-evidence/         Screenshots and check scripts from test rounds (dated folders).
│
├── marketing/
│   ├── instagram/           Reel projects + finished reels. Render scripts use these exact paths.
│   ├── ad-footage/ · brand/ · screenshots/   (scripts use these paths too)
│   ├── store-graphics/      Icons, feature graphics, promo images, media kit.
│   ├── kits/                Reel / ad / YouTube kits, announcements, store submission notes.
│   └── scratch/             Old one-off mockups and scripts (their paths point at F:\hlooo — dead).
│
├── store-assets/            Per-store upload assets (amazon, indus, uptodown).
├── tools/                   Pinned build toolchain: jdk/, gradle-9.6.1/, bundletool/, platform-tools/
│                            + regression-check.sh, wheel-unwrap.test.js, indus-upload.ps1, scripts/.
│                            The JDK and Gradle paths are hard-coded in the build: do not move.
├── secrets/                 Not in git. Never commit or upload.
├── RELEASE.md               How to release (bump, build, verify, publish).
└── MOVE_LOG.md              Every folder move, with dates.
```

Moved out on 2026-09-30: the retired Python PC server, old backups and zips
(`context/archive/dead-code-2026-09-30/`), and the Rust / VS installers (`D:\AKHIL\HP\installers\`).
