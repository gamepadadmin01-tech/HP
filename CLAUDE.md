# D:\AKHIL\HP — start here

This file is loaded automatically at the start of every session in this folder. It lives on `D:`
and is committed to git, so **a Claude reinstall cannot erase it** — unlike
`C:\Users\akhil\.claude\`, which has already been wiped once.

Full detail: **`context/INVENTORY.md`** (the folder map) and **`context/README.md`**.

---

## Who

**Akhil** — akhilpitchuka@gmail.com. Solo developer and owner of **GamepadOS**
(phone app = `GamepadOS.apk`, PC side = `GamepadServer.exe`).

- **"Aukstea" is his CUSTOMER, not him.** Messages signed Aukstea are end-user bug reports he
  relays. Replies go to Akhil; when he asks for "a reply for the client," write it for Aukstea.
- **Explain before implementing, in plain words, one new term at a time.** He is genuinely strong
  at flow and behaviour design and at behavioural debugging; he is not yet fluent in code
  mechanics and has asked to be taught rather than handed output. Do not patronise him — ask
  behaviour-level questions first, that is where his real understanding lives.
- **Not comfortable with terminals.** Run commands for him rather than handing him a list.

## Standing rules — these have all been asked for explicitly

1. **Push the HP repo yourself; never push the website repo.** (Owner, 2026-11-18: "always you manage the HP repo,
   don't ask me to push, I will only handle the website repo".) HP: commit, then `git push origin redesign-flat:main
   redesign-flat --follow-tags` (main on GitHub = the latest released code). Website repo
   (`projects/gamepados/website`, Railway deploys from it): prepare the commit, he pushes. Never force-push.
2. **Never add `Co-Authored-By: Claude`** trailers. Commits show only Akhil.
3. **Commit as `gamepadadmin01@gmail.com`** — never override the author. Vercel Hobby rejects
   builds from non-owner authors.
4. **Never work in a worktree or a scratch copy.** Edit the real folders directly, via absolute
   paths. A worktree copy once made him believe his website had been destroyed. If a preview
   server needs a project root, use an NTFS junction — never a copy.
5. **Confirm before deleting anything under `D:\AKHIL\HP`.** In his words: *"THIS HP FOLDER IS MY
   LIFE."*
6. **Never put his name in outgoing mail or messages.** Sign as "GamepadOS" only.
7. **Never use a non-unique anchor for automated text edits.** See "Scars" below.
8. **Don't edit Windows build files with PowerShell `Set-Content`.** It adds a BOM and flips CRLF
   to LF, and `cmd.exe` misparses a `.bat` with LF endings — the errors it produces
   (`'M' is not recognized`, `JAVA_HOME is set to an invalid directory`) point nowhere near the
   real cause. `.bat` must be CRLF; `.sh` must stay LF. Prefer the Edit tool.
9. **Every GamepadOS file lives inside `D:\AKHIL\HP` — never in `D:\DOWNLOADS` or anywhere else.**
   (Owner, 2026-11-18: "outside HP we should not have a single file".) Builds, APKs, AABs, store
   graphics, videos and test builds go to `projects/gamepados/releases/<version>/` (or `test-builds/`,
   `releases/admin-app/`), all git-ignored. The one exception is the *installed* PC server
   (`D:\Gamepad Server\`), which is a program install, not a project file.
10. **Every real release is archived — never a test build.** (Owner, 2026-11-18.) As soon as a version is built
    for Google Play, run `python projects/gamepados/tools/archive-release.py <version> <code> --status "…"`. It makes
    `releases/<date>_GamepadOS-<version>_code<code>/` with only the AAB, the Play mapping file, the website and
    Uptodown APKs, `RELEASE.md` (date, status, exact commits, signing key, how to rebuild) and `SHA256SUMS.txt`;
    tags the exact code (`gamepados-v<v>-code<c>` in HP, `app-v<v>-code<c>` in website); and adds a row to
    `projects/gamepados/RELEASES.md`. Update the status row when Play approves or rejects. Remind him to push WITH
    tags, and to attach the folder's files to a GitHub Release on that tag (the folder itself is not backed up).

## Folder map

Reorganised 2026-08-13. Folder names with spaces are gone, and `hlooo` — which meant nothing —
is now `projects/gamepados`.

```
D:\AKHIL\HP\
├── CLAUDE.md                 <- this file
├── context/                  <- the durable brain (inventory, 108 docs, memory, rebuild steps)
├── projects/
│   ├── gamepados/            <- THE PRODUCT (was "hlooo")
│   │   ├── apps/             <- android-client, controller-ui, pc-server, pc-server-rs, ios-client
│   │   ├── website/          <- its own repo: gamepadadmin01-tech/gamepad
│   │   ├── tools/            <- pinned JDK 17 + Gradle 9.8.2 (do not delete)
│   │   ├── releases/         <- every build by version (2.0.0/, 1.4.18-play/, …, old-versions/,
│   │   │                        admin-app/, pc-server-old/); 2.0.0/ also holds play-store-graphics/ + videos/
│   │   ├── test-builds/      <- throwaway test APKs (DO-NOT-UPLOAD); git-ignored
│   │   ├── marketing/  store-assets/  docs/   (docs/design-reference-2026-11 = the UI reference shots)
│   ├── flexsquares/          <- sell-the-white-space site
│   ├── daily-news-app/       <- echonews-ai, unrelated
│   └── spotify-corizo/       <- Corizo academic project
├── toolchain/
│   ├── android-sdk/          <- SDK root (was "Android/Sdk")
│   └── android-cli/          <- was "Android/AndroidCLI"
├── media/capcut/
├── installers/
├── archive-local/            <- untracked old copies (June website backup, June project zip WITH .env)
└── keys/                     <- PLAINTEXT SECRETS. Never commit, never upload.
                                 keys/user-data/ = exported user lists (personal data)
```

**2026-11-18:** 64 GamepadOS items gathered from `D:\DOWNLOADS`, `D:\GamepadOS-private` and
`D:\AKHIL\VEDIOS & RECORDING` into the places above — the full list is in
`projects/gamepados/MOVE_LOG.md`.

**HP is 22.32 GB / 97,774 files** — down from 60.2 GB / ~390,000 on 2026-08-13.

**`projects/gamepados-account/` was deleted 2026-08-14** — it was a superseded 7 GB duplicate; the
account system lives in the main tree. Its 3 unpushed commits are preserved as patches at
`context/archive/gamepados-account-unpushed-commits/`, and the GitHub repo still exists.

## Build — the parts that bite

- **Gradle 9.8.2 is mandatory.** The app is on AGP 9.5.0, which requires Gradle 9.5.0+ and rejects
  every 8.x. The dead 8.5 / 8.9 / 8.14.4 copies were retired on 2026-08-13. There is no `gradlew`
  — Gradle is invoked by absolute path.
- **The build hardcodes absolute paths.** After the 2026-08-13 reorganisation these are:
  `JAVA_HOME=D:\AKHIL\HP\projects\gamepados\tools\jdk\jdk-17.0.20.1+1`,
  `ANDROID_HOME=D:\AKHIL\HP\toolchain\android-sdk`, and gradle at
  `D:\AKHIL\HP\projects\gamepados\tools\gradle-9.8.2\bin\gradle.bat`. If you ever move a folder,
  the files to fix are `apps/android-client/build_apk.bat` (+ its backup copy),
  `apps/android-client/local.properties` (`sdk.dir`), `build_exact_composite.py`,
  `create_stacked_promo.py`, `tools/regression-check.sh`, and `HP/.claude/launch.json`.
  **This has silently broken the build twice before.**
- **Two UI bundles since 2026-11-02.** In `apps/controller-ui` run `npm run build:all`, then copy
  `dist/index.html` → `apps/android-client/app/src/main/assets/dist/` (every flavour except Play) **and**
  `dist-play/index.html` → `apps/android-client/app/src/playstore/assets/dist/` (Google Play only), or the APK
  silently ships the previous UI. The Play bundle has no Razorpay and shows only Google Play's price; the other
  bundle shows ₹19 in India and $0.50 elsewhere. Gradle stops the build if a flavour has the wrong bundle.
- **The PC server is the Rust one, `apps/pc-server-rs`.** The old Python server (`apps/pc-server`)
  was retired and moved to `context/archive/dead-code-2026-09-30/apps/pc-server` on 2026-09-30
  (owner-approved). Its PyInstaller notes (Pillow ≥ 12 needs `PIL.ImageFont`/`PIL._imagingft`)
  apply only if it is ever revived. Comments that say "mirrors apps/pc-server/…" now point there.
- Five Android flavours: `direct`, `playstore`, `aptoide`, `uptodown`, `amazonstore`.
- Full commands: **`context/REBUILD.md`**. Release process: `projects/gamepados/RELEASE.md`.
- After any significant change: `projects/gamepados/docs/REGRESSION_CHECKLIST.md`.

## Backup status — read this before deleting anything

| Path | Remote | Risk |
|---|---|---|
| `D:\AKHIL\HP` (this repo: `CLAUDE.md`, `context/`, `projects/gamepados/`) | `gamepadadmin01-tech/HP` | Claude pushes it (rule 1). Until 2026-11-18 GitHub only had 1.4.12 — 112 commits had never been pushed. **Uncommitted changes are unprotected**: commit and push after each piece of work |
| ~~`projects/gamepados-account`~~ | `gamepadadmin01-tech/app-with-login` | **deleted 2026-08-14**; 3 unpushed commits saved as patches in `context/archive/` |
| `projects/flexsquares` | `gamepadadmin01-tech/flexspace` | fine |
| `projects/gamepados/website` | `gamepadadmin01-tech/gamepad` | fine |
| `keys/`, `media/capcut/`, `projects/spotify-corizo/`, `projects/daily-news-app/` | none | 🔴 no backup |

`D:` is a **local** disk. No cloud sync, no version history, no VSS, no File History. An earlier
memory claimed the old `F:` drive was Google Drive-synced — that was wrong, and it is why the
2026-07-26 format lost three guide files permanently.

## Scars — things that have actually gone wrong here

- **2026-07-14 — `App.tsx` destroyed.** An automated PowerShell `IndexOf`/regex edit matched a
  non-unique anchor (`return () => clearInterval(id)` appears 5×) and deleted ~133,000 characters
  (4,600 → 1,809 lines). Recovered by splicing a two-week-old backup between the intact head and
  tail. **`App.tsx` has mixed CRLF/LF and many repeated strings.** Never use `IndexOf`/regex with a
  non-unique anchor — count occurrences first, prefer the `Edit` tool with a large unique context
  block, and keep a backup before any PowerShell text surgery. Backups: `context/recovery/`.
- **2026-07-02 — the Antigravity incident.** Another AI broke pairing and version handling; needed
  a full restore.
- **The worktree incident.** See rule 4.
- **2026-11-09 — the "app opens twice" launch glitch.** Weeks of reports, survived three wrong fixes (colours,
  refresh rate, removing the logo). Cause: an unused black `SurfaceView` under the transparent WebView in
  `MainActivity.setupHybridLayout` showed through until the page painted (brown → black → brown). Removed in
  test APK 16; the WebView is now brown except while the QR camera is on. Never put a surface layer under the
  WebView again, and never make the WebView transparent outside the camera screen. Round 2 (APK 22): an
  intermittent jitter at the splash hand-off. `setKeepOnScreenCondition` blocked drawing, so the page drew for the
  first time mid-fade. Now the splash fades only after the WebView confirms the page is on screen
  (`postVisualStateCallback`). Never go back to `setKeepOnScreenCondition`.
- **2026-07-26 — `F:` was formatted.** The whole tree moved to `D:\AKHIL\HP`. Three guide files
  were lost. Every memory path was rewritten to `D:\` on 2026-08-13; any `F:\` you now see is
  deliberate history, not a live path.

## Where the context lives

- `context/INVENTORY.md` — every folder, its size, its backup state, its risk
- `context/REBUILD.md` — how to regenerate anything deleted as cache
- `context/docs/INDEX.md` — all 108 project documents, indexed
- `context/memory/` — Claude's memory, merged from three namespaces and path-corrected
- `projects/gamepados/docs/handoffs/` — the project diary; the newest handoff is the best catch-up
