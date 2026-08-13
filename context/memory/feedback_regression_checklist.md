---
name: regression-checklist-process
description: "Akhil's process rule: after every big change, run the documented regression checklist; every new bug gets an entry the same session"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a23b65ce-42bf-4713-bb67-c975d147ca6c
  modified: 2026-07-21T08:49:27.802Z
---

**After any big change to GamepadOS, run the regression checklist — and when a
new bug is found and fixed, add an entry for it in the SAME session.**

Akhil proposed this (2026-07-21): *"when we did a big change to our application
we should do tests right, to do them we should document all the problems and
test them all for that big change so this can be easy to find errors."*

## Where it lives

* **`D:\AKHIL\HP\hlooo\docs\REGRESSION_CHECKLIST.md`** — the bug register. Each entry is a
  bug that ACTUALLY happened: symptom, root cause, and the exact check that
  proves it hasn't returned. Organised A (PC server) / B (Android+UI) /
  C (native input) / D (release pipeline) / E (environment gotchas).
* **`D:\AKHIL\HP\hlooo\tools\regression-check.sh`** — runs the automatable half:
  * `--fast` Rust tests + golden-vector regen + TS typecheck + vite build +
    stale-asset check + debug-WebView gate (~1 min, no hardware)
  * `--full` + APK build + UDP loopback + WebSocket protocol tests
  * `--device` + on-device checks, then prints the MANUAL list (feel, haptics,
    gyro-while-mashing, one-pad-only) that automation cannot cover

## Why this matters here specifically

`D:\AKHIL\HP\hlooo\apps\` is **not a git repo** — timestamped `.bak-` copies are the only
rollback. And this project's worst bugs are invisible to compilers: the JNI
`internal` crash compiled cleanly, the deleted Rust server built fine and dropped
every packet, the double-pad bug needed a specific event *sequence*. "It builds"
proves almost nothing, so the written register is the memory that survives
between sessions.

## How to apply

* Run `--fast` after any code change; `--full` before building artifacts;
  `--device` before shipping. Never skip Tier 3 for input-path changes — that is
  exactly where automation is blind.
* **Verify the checker can fail.** Its stale-asset check was negative-controlled
  by deliberately drifting the file (FAIL) and restoring (PASS). A check that
  cannot fail is worse than none, because it manufactures false confidence.
* Prefer converting a manual item into an automated one whenever possible, but
  don't fake it — feel and haptics stay manual and explicitly listed.

Related: [[challenge-own-code]], [[gamepados-double-pad-bug]],
[[kotlin-jni-internal-mangling]], [[realtime-latency-stack]].
