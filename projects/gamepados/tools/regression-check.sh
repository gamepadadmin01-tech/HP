#!/usr/bin/env bash
# GamepadOS regression runner — the automatable half of docs/REGRESSION_CHECKLIST.md
#
# A checklist nobody runs is worse than no checklist, so everything that CAN be
# machine-checked is here behind one command. Items that genuinely cannot be
# automated (feel, haptics, on-device gyro) are printed as a manual list by
# --device rather than silently skipped.
#
#   --fast    Rust tests + UI typecheck/build            (~1 min, no hardware)
#   --full    + APK build + PC-server protocol tests     (~5 min)
#   --device  + on-device checks and the manual list     (phone must be attached)
#
# Exit code is non-zero if any automated check fails.

set -uo pipefail

# Derived from this script's own location (tools/ -> repo root), NOT hardcoded.
# It WAS hardcoded to F:/hlooo, and when the project moved to D:/AKHIL/HP/projects/gamepados
# every `cd` in here failed. Because the failures were bare `cd` errors the run
# still printed a summary, and one check even reported PASS while having
# evaluated nothing — a regression runner that cannot fail correctly is worse
# than no regression runner.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RS="$ROOT/apps/pc-server-rs"
UI="$ROOT/apps/controller-ui"
ANDROID="$ROOT/apps/android-client"
ADB="$ROOT/tools/platform-tools/adb.exe"
JDK="$ROOT/tools/jdk/jdk-17.0.19+10"
# Must match what app/build.gradle.kts actually needs. AGP 9.3.1 requires
# Gradle >= 9.5, and build.gradle.kts:19 says outright that gradle-8.14.4
# "CANNOT" build this project and is kept for reference only. This was still
# pointing at 8.14.4, so every --full run failed at plugin resolution with
# "Minimum supported Gradle version is 9.5.0" — a toolchain error that reads
# like a source error.
GRADLE="$ROOT/tools/gradle-9.6.1/bin/gradle.bat"

MODE="${1:---fast}"
FAILED=()
PASSED=0

pass() { PASSED=$((PASSED+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { FAILED+=("$1");      printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
info() { printf '        %s\n' "$1"; }
head2() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ── Tier 1 ───────────────────────────────────────────────────────────────────
head2 "Tier 1 — protocol conformance & unit tests (A1-A12, no hardware)"

# Regenerate golden vectors FIRST: they are extracted from the live server.py,
# so if the Python wire path changed, the Rust tests must fail loudly (A1).
if (cd "$RS" && python tools/gen_golden.py >/tmp/gg.log 2>&1); then
  pass "golden vectors regenerated from the real server.py"
else
  fail "golden vector generation (A1) — see /tmp/gg.log"
  tail -5 /tmp/gg.log 2>/dev/null | sed 's/^/        /'
fi

if (cd "$RS" && cargo test --quiet >/tmp/ct.log 2>&1); then
  N=$(grep -oE 'test result: ok\. [0-9]+' /tmp/ct.log | grep -oE '[0-9]+' | awk '{s+=$1} END {print s}')
  pass "cargo test — ${N:-?} tests (wire, sessions, auth, ViGEm map, WS, netdetect, pairing)"
else
  fail "cargo test — see /tmp/ct.log"
  grep -E "^(error|test .* FAILED|assertion)" /tmp/ct.log 2>/dev/null | head -8 | sed 's/^/        /'
fi

# Wheel mode's multi-turn unwrap (900°/720°). Pure maths, no hardware — and the one
# place in that feature where a mistake is dangerous rather than merely wrong, so it
# is checked on every run. Mirrors MainActivity.unwrapRoll.
if node "$ROOT/tools/wheel-unwrap.test.js" >/tmp/wu.log 2>&1; then
  pass "wheel-mode unwrap — $(grep -c '^PASS' /tmp/wu.log) assertions (multi-turn steering)"
else
  fail "wheel-mode unwrap maths — see /tmp/wu.log"
  grep '^FAIL' /tmp/wu.log 2>/dev/null | head -6 | sed 's/^/        /'
fi

head2 "Tier 1 — controller UI (B1, B3)"
if (cd "$UI" && npx tsc -p tsconfig.check.json --noEmit >/tmp/tsc.log 2>&1); then
  pass "TypeScript typecheck clean"
else
  # 2 pre-existing 'ltrt' legacy-widget errors are expected; anything else is new.
  COUNT=$(grep -c "error TS" /tmp/tsc.log 2>/dev/null || echo 0)
  LTRT=$(grep -c "'\"ltrt\"'" /tmp/tsc.log 2>/dev/null || echo 0)
  if [ "$COUNT" -eq "$LTRT" ] && [ "$COUNT" -le 2 ]; then
    pass "TypeScript — only the $COUNT known legacy 'ltrt' errors"
  else
    fail "TypeScript — $COUNT errors ($LTRT known); see /tmp/tsc.log"
    grep "error TS" /tmp/tsc.log | head -6 | sed 's/^/        /'
  fi
fi

if (cd "$UI" && npx vite build >/tmp/vite.log 2>&1); then
  pass "vite build"
else
  fail "vite build — see /tmp/vite.log"
fi

# B1: the single most common shipping mistake — stale UI inside the APK.
if [ -f "$UI/dist/index.html" ] && [ -f "$ANDROID/app/src/main/assets/dist/index.html" ]; then
  if cmp -s "$UI/dist/index.html" "$ANDROID/app/src/main/assets/dist/index.html"; then
    pass "B1: android assets match the freshly built UI"
  else
    fail "B1: android assets are STALE — copy dist/index.html before building the APK"
    info "cp $UI/dist/index.html $ANDROID/app/src/main/assets/dist/index.html"
  fi
else
  fail "B1: dist/index.html missing on one side"
fi

# D4: release source must not ship an unconditional debug WebView.
if grep -q "if (BuildConfig.DEBUG) {" "$ANDROID/app/src/main/java/com/gamepad/client/MainActivity.kt" 2>/dev/null; then
  pass "D4: WebView debugging is gated behind BuildConfig.DEBUG"
else
  fail "D4: setWebContentsDebuggingEnabled may be unconditional — re-gate before release"
fi

# ── Tier 2 ───────────────────────────────────────────────────────────────────
if [ "$MODE" = "--full" ] || [ "$MODE" = "--device" ]; then
  head2 "Tier 2 — APK build + PC-server protocol (A5-A8)"
  # ANDROID_HOME was hardcoded to F:/Android/Sdk and broke with the drive move,
  # same as ROOT above. local.properties already carries the authoritative
  # sdk.dir, so read it from there and only fall back to a guess.
  SDK="$(sed -n 's/^sdk\.dir=//p' "$ANDROID/local.properties" 2>/dev/null | sed 's/\\\\/\//g; s/\\//g' | head -1)"
  [ -d "$SDK" ] || SDK="$ROOT/../Android/Sdk"
  if (cd "$ANDROID" && JAVA_HOME="$JDK" ANDROID_HOME="$SDK" "$GRADLE" assembleDirectRelease >/tmp/gradle.log 2>&1); then
    pass "gradle assembleDirectRelease"
  else
    fail "gradle build — see /tmp/gradle.log"
    grep -E "^e:|error:" /tmp/gradle.log 2>/dev/null | head -6 | sed 's/^/        /'
  fi

  # Protocol tests against a live server on a spare port (never disturbs 7777).
  if [ -x "$RS/target/release/pc-server-rs.exe" ]; then
    # --key and --lan-ip are REQUIRED, not optional polish. loopback_test.py
    # signs frames with token ABCD1234, so without --key the server compares
    # against the persisted pairing key and rejects every valid frame. And
    # --lan-ip must be LAN-shaped: a 127.x client counts as OFF-LAN, which is a
    # different auth branch. Omitting either makes the whole check fail while
    # looking like a protocol regression.
    "$RS/target/release/pc-server-rs.exe" --dry-run --port 7788 --no-ws \
      --key ABCD1234 --lan-ip 192.168.1.34 >/tmp/srv.log 2>&1 &
    SRV=$!
    sleep 2
    if (cd "$RS" && timeout 60 python tools/loopback_test.py --port 7788 >/tmp/lb.log 2>&1); then
      pass "UDP protocol loopback (ACK echo, stale rejection, burst)"
    else
      fail "UDP loopback — see /tmp/lb.log"
      tail -6 /tmp/lb.log 2>/dev/null | sed 's/^/        /'
    fi
    kill $SRV 2>/dev/null; wait $SRV 2>/dev/null

    "$RS/target/release/pc-server-rs.exe" --dry-run --port 7789 >/tmp/srv2.log 2>&1 &
    SRV2=$!
    sleep 2
    if (cd "$RS" && timeout 60 python tools/ws_test.py --port 7789 >/tmp/ws.log 2>&1); then
      pass "WebSocket bridge vs a real websockets client (handshake, frames, ping/pong)"
    else
      fail "WebSocket test — see /tmp/ws.log"
      tail -6 /tmp/ws.log 2>/dev/null | sed 's/^/        /'
    fi
    kill $SRV2 2>/dev/null; wait $SRV2 2>/dev/null

    # A8b: a half-open socket must NOT hold a virtual pad (real ghost-pad bug).
    "$RS/target/release/pc-server-rs.exe" --dry-run --port 7794 --no-qr >/tmp/srv3.log 2>&1 &
    SRV3=$!
    sleep 2
    if (cd "$RS" && timeout 60 python tools/ws_ghost_test.py --port 7794 >/tmp/ghost.log 2>&1); then
      pass "A8b: stale WebSocket is torn down (no ghost pad)"
    else
      fail "A8b: GHOST PAD — a silent WS peer still holds a pad; see /tmp/ghost.log"
      tail -4 /tmp/ghost.log 2>/dev/null | sed 's/^/        /'
    fi
    kill $SRV3 2>/dev/null; wait $SRV3 2>/dev/null
  else
    fail "pc-server-rs.exe not built — run: cd $RS && cargo build --release"
  fi
fi

# ── Tier 3 ───────────────────────────────────────────────────────────────────
if [ "$MODE" = "--device" ]; then
  head2 "Tier 3 — on-device (needs the phone)"
  if "$ADB" devices 2>/dev/null | grep -q "device$"; then
    pass "phone attached"
    CRASHES=$("$ADB" logcat -d 2>/dev/null | grep -cE "FATAL EXCEPTION|UnsatisfiedLinkError")
    if [ "${CRASHES:-0}" -eq 0 ]; then pass "B2: no FATAL/UnsatisfiedLinkError in logcat"
    else fail "B2: $CRASHES crash lines in logcat — check the JNI signatures"; fi

    PADS=$(powershell -NoProfile -Command "@(Get-CimInstance Win32_PnPEntity -EA SilentlyContinue | Where-Object { \$_.Name -match 'Xbox 360' }).Count" 2>/dev/null | tr -d '\r')
    info "A5/A9: virtual pads currently present: ${PADS:-?}  (must be 1 per connected phone, never 2 for one)"
  else
    fail "no phone attached — Tier 3 skipped"
  fi

  cat <<'MANUAL'

  ── MANUAL (cannot be automated — this is where automation is blind) ──
  [ ] C1  adb logcat -s GPM:I  ->  "native input path ACTIVE" and
          "native touch->handle: avg ~1.6-1.9ms p95 ~3-5ms"
  [ ] C4/B4  hold a tilt and MASH buttons — steering must not freeze
  [ ] B5  slide a thumb around the d-pad — exactly ONE arrow lit, ever
  [ ] B6  press+release feel distinct; an analog trigger pull does NOT buzz
          continuously
  [ ] A5  exactly ONE controller in the PC's gamepad list. Then, with the phone
          on tether, run: adb reverse tcp:7777 tcp:7777
          -> still exactly one pad 20s later
  [ ] A9  background the phone app -> the pad disappears within ~3s
  [ ] A8  RTT badge sits ~2.4-2.6ms over USB tether
  [ ] play an actual game: buttons, both sticks, triggers, d-pad, gyro
MANUAL
fi

# ── Summary ──────────────────────────────────────────────────────────────────
head2 "Summary"
printf '  %d passed, %d failed\n' "$PASSED" "${#FAILED[@]}"
if [ "${#FAILED[@]}" -gt 0 ]; then
  printf '\n  Failures:\n'
  for f in "${FAILED[@]}"; do printf '   - %s\n' "$f"; done
  printf '\n  See %s/docs/REGRESSION_CHECKLIST.md for what each ID means.\n' "$ROOT"
  exit 1
fi
printf '  All automated checks passed.\n'
[ "$MODE" = "--device" ] || printf '  (Tier 3 on-device checks NOT run — use --device before shipping.)\n'
exit 0
