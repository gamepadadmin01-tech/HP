# SESSION HANDOFF — 2026-07-20

Continuation of the GamepadOS latency-optimisation work. Read **§4 (Gotchas)** before
touching any code — several of them have already cost real time in past sessions.

---

## 1. Where things stand

### Release: v1.3.22 / versionCode 46 — BUILT + ARCHIVED, **NOT UPLOADED**
All 6 store variants are in `F:\hlooo\releases\store\1.3.22\`:

| File | Size |
|---|---|
| `GamepadOS-1.3.22-playstore.aab` | 2.5 MB |
| `-direct.apk` / `-amazonstore` / `-apkpure` / `-indusstore` / `-uptodown` | 2.1 MB each |

Verified: every APK reports `versionCode='46' versionName='1.3.22'`; arm64 `.so` LOAD
segments align `0x4000` (16 KB); `apksigner` → "Verified using v2 scheme: true", 1 signer.

**The version bump was mandatory** — source was still 1.3.21/45 while the live site
already served 1.3.21/45 with *different* content (live sha `90be7e7f…` vs rebuilt
`ba77f9cd…`). Same versionCode = in-app updater never fires + Play rejects duplicate.

Current distribution state:
- **Website** still serves 1.3.21 / 45
- **Play** still on 1.3.0 / 24
- Nothing from 1.3.22 uploaded anywhere.

### Phone
`DAIFEYGEKB89V4QG` (Redmi 2311DRK48I, Android 16) has **1.3.22 + Phase 0 + Phase 1**
installed. Install is in-place (`install -r`), custom pads preserved.

> There is a SECOND phone (`10BF4Y2T7L008EE`) carrying a **store-signed 1.3.0** whose
> signature does NOT match our release keystore — `install -r` fails on it with
> `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Only fix is uninstall-then-install, which wipes
> that device's custom pads. Don't do it without asking.

### PC server
`apps/pc-server/server.py` has the Phase 1 optimisations and **was left RUNNING from
source** in this session (`python -u server.py`, LAN IP 192.168.1.34).
The installed `GamepadServer.exe` is an OLDER PyInstaller build **without** Phase 1 —
rebuild the installer once the gains are confirmed. Backup: `server.py.bak-20260720-180600`.

---

## 2. THE KEY RESULT — measured, not assumed

Phase 0 instrumented the segment the in-app RTT badge cannot see. ~15 samples while
actually playing:

| Segment | avg | p50 | p95 | max |
|---|---|---|---|---|
| **touch → JS dispatch** | **~6.8 ms** | ~5.7 ms | **~15 ms** | **25.8 ms** |
| JS → native bridge | 0.71 ms | 0.50 ms | ~1.8 ms | 11.2 ms |
| Network RTT (USB tether) | 2.5 ms (**round** trip) | — | — | — |

One-way input path:
```
6.8  ms  touch → JS          ← 78% of total
0.7  ms  JS → native bridge
1.25 ms  wire to PC (half of 2.5 RTT)
─────────
~8.75 ms
```

**Conclusions:**
1. The WebView/JS hop is **~2.7× the entire network round-trip**. All previous tuning
   targeted the 2.5 ms while 6.8 ms sat unmeasured — which is exactly why Phase 1 showed
   "no change in RTT" (it was a CPU/allocation win, never a latency one).
2. The bridge fires **~190×/sec at 0.71 ms** = ~13% of a core on the **JS main thread** —
   the same thread that dispatches touches. The send path is partly inflating its own
   dispatch number.
3. p95 15 ms / max 25.8 ms is **jitter** — worse for gameplay feel than a higher average.

**Priority decision: Phase 3 BEFORE Phase 2.** Phase 3 targets ~7.5 ms; the Rust server
targets a fraction of 1.25 ms one-way. ~15× the payoff.

### How to re-measure (harness is already shipped)
```bash
adb -s DAIFEYGEKB89V4QG logcat -c
adb -s DAIFEYGEKB89V4QG logcat -s GPM:I
# then: open app → connect → launch controller → press buttons ~30s
```
Prints every 5 s. Silence with `window.GPM.on = false`.

---

## 3. NEXT UP — Phase 3: native input path

**Goal:** take input off the JS/WebView path entirely. No UI change; the WebView keeps
rendering, it just stops being on the input critical path.

**Design:**
1. JS publishes pad geometry (button rects/circles + ids) to native **once** on load and
   on pad-switch — JS already owns the layout.
2. Native touch listener above the WebView, on the **controller screen only** (the custom
   pad editor keeps JS touch — it isn't latency-critical).
3. Native hit-tests, builds the 20-byte payload, calls `injectNativePayload` directly.
   **JS never runs on the input path.**
4. Native pushes pressed-state back to JS for **visuals only**, coalesced per frame.
   Visuals may lag a frame; input must not.

**Must handle:** analog sticks + triggers need continuous move tracking natively (not just
down/up). Gyro is already native. D-pad is strict 4-way (see §4).

**Expected:** ~8.75 ms → ~1.5–2 ms one-way; wire becomes the bottleneck. Then Phase 2
(Rust server) becomes worth doing.

**Do it behind a flag** so it can be A/B'd against the current path with the same GPM
harness — prove the gain, don't assume it.

### Remaining phases
- **Phase 2 — Rust PC server.** Toolchain fully verified this session, **nothing to install**:
  Rust 1.96 `x86_64-pc-windows-msvc` compiles+links, VS 2022 present, `vigem-client v0.1.4`
  compiles, **ViGEmBus driver installed and RUNNING**. Build a wire-conformance test FIRST
  (see §4.1). Open question: UDP-only first (keep Python for AOA) or port AOA too?
- **Phase 4 — default to USB tether** (already the fastest at 2.5 ms).

---

## 4. GOTCHAS — read before editing

### 4.1 The 20-byte wire format is an immutable contract
```
<Q H B B B B B B I   (little-endian, 20 bytes)
ts(u64) buttons(u16) LT RT LSx LSy RSx RSy (u8, centre 128) authToken(u32)
```
Defined in **three** files that must agree byte-for-byte:
`controller-ui/src/app/App.tsx` · `android-client/.../cpp/gamepad-engine.cpp` · `pc-server/server.py`

> A previous Rust server (`pc-server-rust/`, ~3.1 GB) was **deleted** because it invented
> its own format (HMAC + i16 sticks + 16-char key) and therefore dropped **every** packet.
> Any rewrite must match this byte-for-byte and be conformance-tested against the real
> phone before switchover.

### 4.2 App.tsx is fragile — CRLF + non-breaking spaces
Lines **~2660–3478** (the region spliced in during the 2026-07-14 corruption recovery) use
**CRLF endings AND U+00A0 non-breaking-space indentation** (254 lines).
**Multi-line `Edit`-tool matches FAIL silently there.** Use a Node script with
line-index anchors + uniqueness assertions, and preserve the `\r`:
```js
let L = fs.readFileSync(p,'utf8').split('\n');
const i = L.findIndex(l => l.includes('unique anchor'));
if (L.filter(l => l.includes('unique anchor')).length !== 1) throw new Error('not unique');
const eol = L[i].endsWith('\r') ? '\r' : '';
```
Also: **back up App.tsx before any surgery** (`App.tsx.bak-YYYYMMDD-HHMMSS`) — a regex edit
with a non-unique anchor once deleted ~133 K chars.

### 4.3 `console.log` in the WebView is a dead end
There is **no `WebChromeClient` / `onConsoleMessage`** in MainActivity, so JS `console.log`
never reaches logcat. This silently wasted a measurement run this session. Use the bridge:
```kotlin
@JavascriptInterface fun logMetric(line: String) { Log.i("GPM", line) }
```

### 4.4 Manual asset copy before EVERY APK build
```bash
cd apps/controller-ui && npx vite build
cp dist/index.html ../android-client/app/src/main/assets/dist/index.html
```
Skip it and the APK ships a stale UI.

### 4.5 `apps/` is NOT a git repo
No VCS safety net for App.tsx / MainActivity.kt / gamepad-engine.cpp / server.py.
Timestamped `.bak-` copies are the only rollback. (`website/` IS a git repo and is in sync
with origin.)

### 4.6 Gyro / controller behaviour that must not regress
- **D-pad is strict 4-way** — nearest cardinal only. No adjacent (diagonal) or opposite pairs.
- **Gyro indicator** lives in its OWN layer at `zIndex:0` **behind** the button canvas
  (`z-[5]`); HUD toggle is `z-10`. Buttons carry black silhouettes to occlude it. It is
  hidden entirely in 3D mode. 7.5 px thick, no persistent track line.
- **Haptics are a button-touch tick, never a vibration** — fire ONCE per press, never per
  fill-step. Trigger strength is 45 ("buttonPress" tier), not 85 ("triggerPull").
- **Never CSS-transition SVG geometry** (`x/y/width/height`) for a finger-tracked value —
  it lags/sticks on the phone WebView. Use plain attributes or an imperative transform.
- Gyro glide is **delta-time based** (`k = 1 - exp(-dt/28ms)`) so it behaves identically on
  60 Hz and 120 Hz panels. A fixed per-frame lerp is a 120 Hz bug.

---

## 5. Build / install / run commands

```bash
# UI
cd F:/hlooo/apps/controller-ui && npx vite build
cp dist/index.html ../android-client/app/src/main/assets/dist/index.html

# APK (single flavor)
JAVA_HOME=F:/hlooo/tools/jdk/jdk-17.0.19+10 ANDROID_HOME=F:/Android/Sdk \
  F:/hlooo/tools/gradle-8.14.4/bin/gradle.bat -p F:/hlooo/apps/android-client assembleDirectRelease

# All store flavors + AAB
  ... assembleDirectRelease assembleAmazonstoreRelease assembleApkpureRelease \
      assembleIndusstoreRelease assembleUptodownRelease bundlePlaystoreRelease

# Install (in-place, keeps custom pads)
F:/hlooo/tools/platform-tools/adb.exe -s DAIFEYGEKB89V4QG install -r \
  F:/hlooo/apps/android-client/app/build/outputs/apk/direct/release/app-direct-release.apk

# PC server (source = has Phase 1; the installed .exe does NOT)
cd F:/hlooo/apps/pc-server && python -u server.py
```
Signing: `app/release.keystore`, credentials in `local.properties`
(`keystore.password` / `key.alias` / `key.password`).

---

## 6. Open decisions for the user

1. **`resizeableActivity="false"`** — the last remaining Play Console warning. Left as-is
   deliberately (safe default for a landscape controller; Android 16 ignores it on large
   screens anyway). Asked twice, never answered. Flipping it needs a rebuild but **no**
   version bump since nothing is uploaded.
2. **Phase 2 scope** — Rust server UDP-only first, or port AOA/USB too?
3. **Uploads** — 1.3.22 artifacts are ready but nothing has been uploaded. Note the website
   should serve `GamepadOS-1.3.22-direct.apk` (a prior issue had it serving the
   *amazonstore* build, which breaks the self-updater for website users), then Register &
   Activate.
