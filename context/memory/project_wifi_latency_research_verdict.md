---
name: project-wifi-latency-research-verdict
description: "2026-08-28 Wi-Fi latency research verdict: the app is already at 10-18ms, most proposed work is shipped, and the real gap is field telemetry — what to skip and why"
metadata: 
  node_type: memory
  type: project
  originSessionId: eb2b2a35-7693-446e-bd41-bc64719d5afb
  modified: 2026-08-29T18:02:13.721Z
---

A research brief (`AGENT_PROMPT_Claude_Opus_WiFi_Latency_Research.md`, AI-generated, from Downloads)
asked for a 6-dimension Wi-Fi latency study on the premise that GamepadOS runs at **80–400 ms
P50–P99**. **That premise is false** — the measured stack is **10–18 ms** finger→game on tuned
5 GHz ([[project_realtime_latency_stack]]). The brief's "goal" of <50 ms P50 was passed in July.

Full report: `projects/gamepados/docs/research/WIFI_LATENCY_RESEARCH_2026-08-28.md`.
Readable version: https://claude.ai/code/artifact/00ee7379-6b39-4b20-9a15-1a80fa5e6ab2

## Decided: do NOT research or build these again

- **L4S / ECN** — manages bulk flows filling a queue. A 1–10 kbps input stream can't fill one and
  has no send rate to back off. No consumer AP support. **Keep TOS `0xB8` with ECN bits 00 —
  do not set ECT(1).**
- **MPTCP / ReMP TCP** — TCP; head-of-line blocking is what the UDP design exists to avoid.
- **Wi-Fi + LTE dual path** — cellular RTT 30–70 ms vs ~10 ms Wi-Fi, so the second copy always
  loses the race. Defensible as *failover*, never as a latency feature.
- **Reed-Solomon / block FEC** — recovery latency is bounded below by (N−1) packet intervals.
  Strictly worse than the 3× spread duplication already shipped. **Don't raise
  `CHANGED_PACKET_REDUNDANCY` either** — airtime is preamble/ACK-dominated, so extra copies cost
  ~3× airtime exactly when a congested AP can least afford it.
- **TFLite latency prediction** — inference costs about as much as the whole touch→handle time,
  and there is nothing to act on: one path, no bitrate, "send now" already optimal.
- **Input dead-reckoning** — actively wrong for a controller. A mispredicted stick steers the car
  into a wall. A wrong input is worse than a late one.

## Already shipped (the brief's "quick wins" — all of them)

DSCP EF + `SO_PRIORITY` 6→WMM AC_VO, event-driven condvar send, send-on-change + 30/60 Hz
keep-alive, 3× redundancy spread ~2 ms apart, `SCHED_FIFO`→`nice(-19)`, single-copy JNI,
`connect()`ed socket, Wi-Fi low-latency lock; PC side: 1 MB buffers, symmetric DSCP-EF,
`HIGH_PRIORITY_CLASS`, `timeBeginPeriod(1)`, drain-to-newest.

## The real gap: NO FIELD TELEMETRY

The only field latency number is an **EWMA-smoothed float** (`latencyMsAtomic`, α=0.2) — a *mean*
estimator that mathematically hides the p95 spikes that are the actual problem. The detailed `GPM`
harness is `adb logcat` only, so it only ever runs on Akhil's own desk/phone/Wi-Fi. **This is why
the brief could assert 80–400 ms unchallenged.** Fix: ring buffer of raw RTT samples → p50/p95/p99
→ a "Network Health" panel. Label it **link latency, never input latency** — RTT excludes the
digitizer and the game's tick, which are the two largest terms.

## APPLIED 2026-08-29 (committed, NOT pushed, NOT device-tested)

Seven fixes landed as separate commits on `main`:
1. `__nvis` no longer holds the input lock through JSON serialization — **the p95 mechanism**.
   `pushVisuals` built a JSONObject + 2 JSONArrays + 6 boxed Doubles inside `synchronized(lock)`,
   the same lock touch and the 200Hz gyro inject take, once per frame. Dedup also moved ahead of
   the build (it used to serialize then discard). Found by direct reading, not by any agent.
2. ACK drain `break` → `continue` — it handled ONE ack per pass, inflating displayed RTT.
3. GRX seal gated on `haveTransport && !accessoryMode` + `grxReady` latch reset — on USB the seal
   ran and the AOA branch discarded its output.
4. Gyro `dCutoff` 1.0 → 3.5 (onset lag).
5. Server centre snap ±4 → ±1 in BOTH servers. ⚠️ **`gen_golden.py` must be re-run before this
   ships** — no Python on this machine, so `tests/golden_vectors.json` is stale and conformance
   will fail. Deliberately did not hand-edit it (Python banker's rounding).
6+7. Stick origin now follows the thumb (default ON — the fixed origin reported ~27% deflection on
   a 20-unit landing offset), plus an optional radial response curve (default 1.0 = linear =
   unchanged). New `controller-ui/src/app/stickFeel.ts`, mirrored exactly in `NativeInputEngine`.
   Clamp is `min(w.r, STICK_MAX_R*0.5)` — **NOT** `w.r - STICK_MAX_R`, which collapses to 0 on the
   default lstick (r=56 vs STICK_MAX_R=60) and would silently disable it there.
   Verified: vite build clean; `tsc -p tsconfig.check.json` = 13 errors both with and without the
   change (all pre-existing key-prop/narrowing), so zero new type errors.

## Round 2, 2026-08-29 — user-reported bugs

- **"Controller locks to one side when opening" — ROOT CAUSE FOUND, FIXED.** The CALIBRATE
  zero lived only in memory (JS `useRef`, native plain field), so every launch reset it to
  `{0,0}` = "phone perfectly flat". Opening while holding the phone at any natural angle
  deflected the stick immediately (~44% at a 20° hold with 45° sensitivity). Now persisted in
  localStorage `gp_gyro_zero` and pushed to native via `setNativeGyroConfig` as `zx`/`zy`.
  ⚠️ **Auto-calibrate was explicitly VETOED by Akhil** — correctly, since a mounted wheel must
  keep the mount's deliberate neutral. Persisting the user's own zero is not auto-calibration;
  do not "improve" this into one.
- **Wheel mode roughness — the One Euro filter's speed term was in ABSOLUTE deg/s**, so a 900°
  range drove the cutoff ~6× higher and most smoothing was lost. Now normalised by range.
  Verified numerically by `apps/android-client/tools/euro_sim.js` (there are NO Android unit
  tests in this project): wheel roughness 0.653 → 0.333 LSB, matching normal mode exactly;
  cost is peak lag 2.65° → 4.05°, the same %-of-lock as normal mode.
- **Two overstatements corrected by that sim** — I claimed ~453 Hz cutoff / full pass-through
  (real: 196 Hz median, alpha 0.86) and dCutoff gains of ~50% (real: 37–46%). Direction right,
  magnitude inflated both times. **Simulate before quoting numbers in commit messages.**
- **"Server interferes while gaming"** — two real mechanisms, both fixed in source but
  **UNBUILT**: `HIGH_PRIORITY_CLASS` put the server above the foreground game (its own comment
  admitted it "did NOT fix the RTT jitter it was written for"), and the adb-reverse watcher
  spawned `adb devices` every 10s forever even for Wi-Fi-only users (~720 spawns in 2 hours).
- **"Server killed my Wi-Fi" — NO mechanism found.** `netdetect.rs` is read-only
  (`GetAdaptersAddresses`); nothing in the server modifies network state. Unreproduced.
- 🚫 **BLOCKED: `golden_vectors.json` regen for the ±4→±1 snap.** Needs Python (`tools/gen_golden.py`);
  only the Microsoft Store stub is on this machine. Do NOT hand-edit or reimplement in JS — the
  file header forbids it, it contains `-0.0` (JS serialises as `0`), and the test packets
  deliberately straddle the ±4 boundary (123/124/126/127/129/130/132/133), so 10 `snapped` +
  `pad_axes` values change. `cargo test` will fail until the real generator is run.
- 🚫 **BLOCKED: no MSVC linker** — `cargo check` passes but `cargo build` cannot link, so no
  PC-server fix can ship. Needs VS Build Tools with the C++ workload.

## Ranked actions

1. Field telemetry (above).
2. **Settle the Phase 3 gameplay-feel verdict** — still the biggest available win, already built
   and device-verified, blocked since 2026-07-21. Nothing in this research comes close.
3. Thin the `__nvis` per-frame visual mirror (targets the 14–18 ms p95 spike).
4. Try **ADPF `PerformanceHintManager`** (API 31+) — the *supported* way to get what `SCHED_FIFO`
   is denied on stock Android, without the thermal cost that got core-pinning removed.
5. **Fix two false doc claims** — `LOW_LATENCY_GUIDE.md:50` tells customers there's a "1000 Hz
   send thread pinned to performance cores"; the code does neither, deliberately.
   `ARCHITECTURE.md:230` makes the same overclaim about `SCHED_FIFO`.
6. Add **6 GHz** to the user guide (it stops at "5 GHz not 2.4"). Best ms-per-hour available.

## Two findings worth keeping

- **Wi-Fi 6 is not automatically better for this app.** Uplink OFDMA makes a station wait for the
  AP's trigger frame and pads small payloads up to the largest in the group. Say "6 GHz band" in
  user guidance, not "Wi-Fi 6". Wi-Fi 7 **MLO** is the real win (p99 45→12 ms in one trial), and
  plain **TWT is a latency risk** that the low-latency lock should suppress.
- **Jitter, not mean, is the remaining problem** — matches both the industry framing and Akhil's
  own p95 data. Frame all remaining work as tail reduction.

Related: [[project_realtime_latency_stack]], [[reference_wire_protocol]], [[project_pending_tasks]].

## 2026-09-03 — re-checked on request, verdict UNCHANGED

Re-researched. **Nothing reopened.** Current literature on Wi-Fi tail latency is all
MAC/PHY or AP-side and unreachable from an app: 802.11bn coordinated TDMA (~24%,
needs Wi-Fi 8 silicon both ends), Blade adaptive contention (>4× tail PPDU, driver
level), 802.11ax uplink OFDMA scheduling (NIST), MU-MIMO pre-arrival contention.
One ACM paper **confirms the L4S rejection** — its tail mechanism is send-rate vs
bottleneck-queue mismatch, and 1–10 kbps never builds that queue.
**There is no app-layer Wi-Fi technique left to adopt.** Don't re-research this.

Ranked actions 4, 5 and 6 are now DONE (commit `ed734d9`):

- **ADPF is BUILT** — hint session on the TX thread, `dlsym` from `libandroid.so` (API
  33+ vs minSdk 24, so it is a no-op that cannot crash on old devices). Target 2 ms;
  duration reported only on a real send, because reporting idle cycles teaches the
  governor it can slow down. Session closed with its thread. Vendor number ~17% less
  jitter. **NOT device-tested.** CPU affinity stays removed — ADPF is how you get that
  effect without the heat.
- **The two false doc claims are gone.** `LOW_LATENCY_GUIDE.md` had promised a "1000 Hz
  send thread pinned to performance cores" (event-driven; zero affinity code) and
  `ARCHITECTURE.md` twice claimed `SCHED_FIFO` was achieved (it is refused; falls back
  to `nice(-19)`).
- **6 GHz guidance shipped**, plus "band beats generation" and Wi-Fi 7 MLO as buying
  advice — 2026 CableLabs/Intel trials show 35–48% lower app-layer latency, but NSTR
  radios give ~a third of that and a clean 6 GHz link gains little.

**Field telemetry is no longer just the ranked gap — it is the BLOCKER.** A change whose
entire purpose is tail reduction just shipped, and the only field number is an EWMA mean
that mathematically hides tails. Nothing further should be attempted on latency until
raw RTT samples → p50/p95/p99 exist off Akhil's own desk.
