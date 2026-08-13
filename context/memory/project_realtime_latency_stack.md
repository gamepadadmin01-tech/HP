---
name: realtime-latency-stack
description: "Phone→PC input path: the live stack, the measured latency breakdown, and the Phase 3 native-input result"
metadata: 
  node_type: memory
  type: project
  originSessionId: 04fa20ba-c801-4536-9b63-6783224ac0d6
  modified: 2026-08-13T18:51:10.325Z
---

The realtime product in `projects/gamepados/apps/` — separate from the website/ticketing platform
([[website-backend-architecture]]). Byte contract: [[reference_wire_protocol]].

## The live stack

- **Phone UI** — `controller-ui/src/app/App.tsx` inside the `android-client` WebView.
- **Phone native** — `android-client/app/src/main/cpp/gamepad-engine.cpp`, C++ NDK UDP engine
  (2 ms poll, send-on-change + ~30 Hz keep-alive). **Not 1000 Hz / SCHED_FIFO despite what
  `ARCHITECTURE.md` says.**
- **PC server** — `pc-server/server.py` (Python + vgamepad/ViGEm) → `dist/GamepadServer.exe`.
  **A source change is not shipped until the exe is rebuilt** (`python -m PyInstaller
  GamepadServer.spec --noconfirm`).

⚠️ **The Rust server (`pc-server-rs`) is NOT the shipped one.** See [[project_rust_server_v2]].

## Measured latency — the WebView was the bottleneck

Instrumented on-device (`adb logcat -s GPM:I`, toggle `window.GPM.on`), 2026-07-20:

| segment | avg | p95 | max |
|---|---|---|---|
| touch → JS dispatch | **6.8 ms** | 15 ms | 25.8 ms |
| JS → native bridge | 0.71 ms | 1.8 ms | 11.2 ms |
| network RTT (USB tether) | 2.5 ms round trip | | |

One-way ≈ **8.75 ms, of which the WebView/JS hop was 78%** — about 2.7× the entire network round
trip. RTTs: USB tether 2.5 ms, USB debugging 5–6 ms, wireless 10 ms.

**This is why PC-side and CPU tuning kept showing "no change in RTT" — it optimises the small
end.** It also justified doing the native input path *before* the Rust server rewrite (~15× the
payoff).

## Phase 3 — native input path, VERIFIED ON DEVICE 2026-07-21

`NativeInputEngine.kt` is an invisible overlay View above the WebView. It hit-tests touches
against pad geometry published by JS, keeps button/stick/trigger state, merges gyro in Kotlin at
~200 Hz, builds the 20-byte payload and calls the unchanged C++ TX thread. **Zero C++ changes.**

Result: **~1.6–1.9 ms avg touch→handle, down from ~6.8 ms — 3.7× faster, with the p95 jitter tail
cut ~3×.** JS send path confirmed dormant.

- Feature flag: localStorage `gp_native_input`, **default ON**; runtime `window.__setNativeInput(bool)`.
- Two real bugs were found on-device and fixed: see [[feedback_kotlin_jni_internal]] (an `external
  fun` must not be `internal` — name mangling gives a runtime `UnsatisfiedLinkError` that compiles
  fine) and [[project_double_pad_bug]].
- Known gaps: touch ripples and stick grab-tint don't render in native mode; occasional p95 spike
  (~14–18 ms) when the UI thread is busy — the first lever is thinning the per-frame `__nvis`
  visual mirror.

**STILL PENDING: the gameplay-feel verdict** — buttons, sticks, triggers, d-pad and gyro in a real
game. That has been the release gate since 2026-07-21.

## Editing gotcha

`App.tsx` is now **uniformly CRLF** (older notes claiming the useGyro region is LF are stale).
Non-breaking-space zones remain around lines ~2649–3505. Combined with repeated strings, this is
what made the 2026-07-14 corruption possible — see [[feedback_no_worktrees]] and
`context/recovery/README.md`.

Full session detail: `projects/gamepados/docs/handoffs/SESSION_HANDOFF_2026-07-20*.md` and
`_2026-07-21.md`. Blow-by-blow history archived at
`context/archive/memory-history/project_realtime_latency_stack_FULL_2026-08-14.md`.
