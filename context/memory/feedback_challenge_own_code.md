---
name: challenge-own-code
description: "Akhil's architect rule: always judge whether code you wrote is genuinely useful or a burden — try to change/optimize it before accepting it; failing is better than accepting"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e36c245e-335b-4b20-9b95-67ad68937e51
  modified: 2026-07-21T06:53:38.506Z
---

**Never accept code just because it works or because you wrote it.** For every
piece of code, ask: *is this genuinely useful, or is it a burden?* If it's a
burden, change or optimize it. Only accept it when there is genuinely no
alternative.

Akhil's words (2026-07-21, as the project architect): *"whatever code you write
always double check will this code really useful or burden, then try to change
or optimize it rather than just accepting it. If there is no alternative we
accept. Failing is better than accepting."*

**Why:** he is optimizing for a lean, fast, maintainable product, not for
volume of code. Dead weight that "works" is worse than an honest failure,
because it silently costs maintenance, footprint and attention forever — and it
misleads whoever reads it next into thinking it earned its place.

**How to apply:**
- After writing something, re-examine it against measurement, not intuition. If
  it produced **no measured benefit, remove it** and record why, so nobody
  re-adds it later as cargo cult.
- Weigh hidden/global costs, not just local ones (e.g. a system-wide Windows
  setting that raises power draw machine-wide for zero local gain is a burden
  even though it is only one line).
- Distinguish reasons: a knob can be unjustified for latency yet justified for
  robustness. Say which, rather than keeping it for a vague "might help".
- Say plainly when an approach failed, and prefer reverting it to quietly
  keeping it. Report the negative result — it's real information.
- Apply the same lens to whole components, not just lines: if a subsystem's
  measured contribution is ~2%, question whether building more of it is worth
  it at all before writing the next module.

Worked example: `apps/pc-server-rs/src/winperf.rs` — added
`timeBeginPeriod(1)` + HIGH priority + big socket buffers + DSCP to chase RTT
jitter; measurement showed **no difference**, so the global timer call was
removed rather than kept "just in case". See [[realtime-latency-stack]].

Related: [[gamepados-double-pad-bug]], [[kotlin-jni-internal-mangling]].
