# REBUILD — regenerating everything that was deleted as cache

Nothing in this document is guesswork. Every path and version was read out of the actual build
scripts in this folder on 2026-08-13.

---

## The pinned toolchain (NOT deleted — do not delete)

| Tool | Version | Path |
|---|---|---|
| JDK | 17.0.19+10 | `D:\AKHIL\HP\projects\gamepados\tools\jdk\jdk-17.0.19+10` |
| Gradle | **9.6.1** | `D:\AKHIL\HP\projects\gamepados\tools\gradle-9.6.1` |
| Android SDK | — | `D:\AKHIL\HP\toolchain\android-sdk` |
| adb | — | `D:\AKHIL\HP\projects\gamepados\tools\platform-tools` |
| bundletool | — | `D:\AKHIL\HP\projects\gamepados\tools\bundletool` |

⚠️ **Gradle 9.6.1 is mandatory.** The app is on AGP 9.3.1, which requires Gradle 9.5.0+ and
rejects every 8.x. The `gradle-8.5`, `gradle-8.9` and `gradle-8.14.4` folders are kept for
reference and **cannot build this app** — do not use them and do not "fix" a build by pointing at
one.

There is **no `gradlew`** in this project. Gradle is invoked by absolute path.

---

## 1. Controller UI — `apps/controller-ui`

Deleted: `node_modules/` (68,608 files, 0.24 GB)

```bash
npm install
```

Scripts available (from `package.json`): `build` → `vite build`, `dev` → `vite`.

```bash
npm run build
```

### ⚠️ The step that is always forgotten

The Android app ships the UI as an inlined `dist/index.html`. After every UI build you **must**
copy it across, or the APK silently ships the previous UI:

```bash
robocopy dist ..\android-client\app\src\main\assets\dist /MIR
```

Verify both files exist and match before building the APK:
- `apps\controller-ui\dist\index.html`
- `apps\android-client\app\src\main\assets\dist\index.html`

---

## 2. Android APK — `apps/android-client`

Deleted: `.gradle/` (26 files), `build/`

Use the existing script, which already sets `JAVA_HOME`, `ANDROID_HOME` and `PATH` correctly:

```bash
apps\android-client\build_apk.bat
```

That builds the **direct** flavour (the one shipped from the website). Five flavours exist —
`direct`, `playstore`, `aptoide`, `uptodown`, `amazonstore`. For the others, from
`apps\android-client`:

```bash
D:\AKHIL\HP\projects\gamepados\tools\gradle-9.6.1\bin\gradle.bat bundlePlaystoreRelease
```

```bash
D:\AKHIL\HP\projects\gamepados\tools\gradle-9.6.1\bin\gradle.bat assembleUptodownRelease assembleAmazonstoreRelease
```

Gradle re-creates `.gradle/` and `build/` on the first run. Expect the first build to be slow —
it re-downloads the dependency cache.

See `docs/hlooo__RELEASE.md` for the full "5 flavors, one release" process.

---

## 3. Rust PC server — `apps/pc-server-rs`

Deleted: `target/` (4.61 GB — the single largest reclaim), and the shared `hlooo\.cargo` (0.68 GB)

```bash
cargo build --release
```

`Cargo.lock` is committed, so the exact dependency versions come back. `.cargo` is refetched
automatically on the first build. The first build is slow (it recompiles every crate); subsequent
ones are fast.

If `cargo` is missing on a new machine, `tools\rustup-init.exe` is present.

---

## 4. Python PC server — `apps/pc-server`

Deleted: `__pycache__/` (regenerated automatically — nothing to do)

To rebuild the executable:

```bash
pyinstaller GamepadServer.spec
```

⚠️ **Pillow ≥ 12 needs `PIL.ImageFont` and `PIL._imagingft` bundled** — do not add them to the
spec's exclude list, or the built exe crashes at startup. This was a real bug, fixed in PC 1.1.17.

---

## 5. Website — `projects/gamepados/website`

Deleted: `backend/node_modules` (0.21 GB), `frontend/node_modules` (0.04 GB)

```bash
npm install --prefix backend
```

```bash
npm install --prefix frontend
```

The backend runs `prisma db push` on prestart, so the schema applies itself.

`website/` is its own git repo (`gamepadadmin01-tech/gamepad`) — backend deploys to Railway,
frontend to Vercel, both from `main`.

---

## 6. `App with login` — the fork

Same commands, same layout. Deleted there: `apps/pc-server-rs/target` (4.20 GB), `.cargo`
(0.68 GB), `apps/controller-ui/node_modules` (0.24 GB).

It is a git repo (`gamepadadmin01-tech/app-with-login`), so a clean checkout also works.

---

## 7. Full new-laptop bootstrap

1. Install Git, then clone the repos.
2. Install Node LTS, Python 3.12+, and Rust (`rustup`).
3. Install the Android SDK (Android Studio, or command-line tools), and point
   `apps/android-client/local.properties` at it.
4. Copy `tools/` across, or re-download JDK 17.0.19+10 and **Gradle 9.6.1** to the same paths.
5. Restore secrets by hand from the password manager — `.env` files, `release.keystore`,
   `keys/`. **These are never in git.**
6. Run sections 1, 3 and 5 above.

Then confirm with the regression checklist: `projects/gamepados/docs/REGRESSION_CHECKLIST.md`, driven by
`projects/gamepados/tools/regression-check.sh` (`--fast` / `--full` / `--device`).
