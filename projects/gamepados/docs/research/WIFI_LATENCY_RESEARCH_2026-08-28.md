# Wi-Fi latency research — grounded against the real GamepadOS stack

**Date:** 2026-08-28
**Scope:** the six research dimensions in `AGENT_PROMPT_Claude_Opus_WiFi_Latency_Research.md`
**Method:** read the shipped code first (`gamepad-engine.cpp`, `MainActivity.kt`,
`NativeInputEngine.kt`, `pc-server/server.py`), then research each dimension against it.

---

## 0. Read this part first

The prompt document opens with a premise that is **not true of your app**:

> "Problem: WiFi latency degrades gaming experience (currently 80–400ms P50-P99)"
> "Goal: Achieve <50ms P50, <120ms P99 latency with 70%+ improvement"

Nothing in your codebase or your measurements supports 80–400 ms. Your own on-device
instrumentation (2026-07-20, the `GPM` logcat harness) measured:

| segment | avg | p95 |
|---|---|---|
| touch → JS dispatch (old path) | 6.8 ms | 15 ms |
| touch → handle (native path, Phase 3) | **1.6–1.9 ms** | ~3× tighter tail |
| JS → native bridge | 0.71 ms | 1.8 ms |
| network RTT, USB tether | 2.5 ms round trip | |
| network RTT, wireless | ~10 ms round trip | |

Finger → game on tuned 5 GHz is roughly **10–18 ms**, and your own
`apps/docs/LOW_LATENCY_GUIDE.md` already says so. The prompt's target of "<50 ms P50" is a
target you passed some time in July. **You are already ~3–5× better than the goal the
document sets.**

That matters, because the whole 10–12 week roadmap in the prompt is sized for an app with a
200 ms problem. You don't have one. Chasing it would burn a quarter on work with no user-visible
payoff, while the two things that would actually help sit unfinished.

### The second thing that premise misses: most of the "quick wins" already shipped

The prompt proposes DSCP marking and packet coalescing as Phase 2 "quick wins" (weeks 3–4).
Here is what is already in the tree, on both sides of the wire:

| Optimisation | Where | Status |
|---|---|---|
| DSCP EF (0xB8) via `IP_TOS` | `gamepad-engine.cpp:137` | ✅ shipped |
| `SO_PRIORITY` 6 → WMM AC_VO | `gamepad-engine.cpp:147` | ✅ shipped |
| Event-driven send (condvar, no poll wait) | `gamepad-engine.cpp` `payloadCv` | ✅ shipped |
| Send-on-change + adaptive 30/60 Hz keep-alive | TX loop | ✅ shipped |
| 3× packet redundancy on every changed input | `CHANGED_PACKET_REDUNDANCY = 3` | ✅ shipped |
| Redundant copies spread ~2 ms apart | `RX_POLL_NS` | ✅ shipped |
| `SCHED_FIFO` attempt + `nice(-19)` fallback | TX thread init | ✅ shipped |
| Single-copy JNI (`GetByteArrayRegion`) | `injectNativePayload` | ✅ shipped |
| `connect()`ed socket (cached route) | TX send path | ✅ shipped |
| Wi-Fi low-latency radio lock | `MainActivity.kt:768` | ✅ shipped |
| Native input path, bypassing the WebView | `NativeInputEngine.kt` | ✅ built, **verdict pending** |
| PC: 1 MB `SO_RCVBUF` / `SO_SNDBUF` | `server.py:684` | ✅ shipped |
| PC: symmetric DSCP-EF on ACKs | `server.py:695` | ✅ shipped |
| PC: `HIGH_PRIORITY_CLASS` | `server.py:711` | ✅ shipped |
| PC: `timeBeginPeriod(1)` — 1 ms timer | `server.py:726` | ✅ shipped |
| PC: drain-to-newest, never accumulate lag | recv loop | ✅ shipped |

That is a genuinely well-optimised stack. Whoever generated that prompt had not seen it.

**So the real question is not "how do we cut 200 ms". It is: at 10–18 ms, what is left, and
is any of it worth the risk?** That is what the rest of this document answers.

---

## 1. Where your latency actually is now

Breaking the wireless path into its real components:

```
finger lands on glass
  │
  ├─ touchscreen digitizer sampling ......... 4–17 ms   ← PHONE HARDWARE, you cannot fix this
  │     (240 Hz panel = 4.2 ms, 120 Hz = 8.3 ms, 60 Hz = 16.7 ms)
  │
  ├─ Android input dispatch → your overlay ... ~1.6–1.9 ms  ← Phase 3 native path
  │
  ├─ JNI inject + condvar wake .............. <0.1 ms
  │
  ├─ GRX AES-GCM seal (JNI up-call) ......... ~0.1–0.3 ms
  │
  ├─ kernel → Wi-Fi driver → radio .......... ~1–3 ms
  │
  ├─ AIR: contention + preamble + TX + ACK .. ~1–5 ms typical, 10–40 ms under contention
  │
  ├─ PC kernel → Python recv ................ ~0.5–2 ms
  │
  ├─ ViGEmBus → virtual DS4 → game .......... ~1–2 ms
  │
  └─ game reads pad on its own tick ......... 0–16 ms   ← THE GAME, you cannot fix this
```

Two observations that should shape everything:

**(a) The two largest terms are both outside your code.** The touchscreen digitizer and the
game's own input tick each contribute more than your entire network path. A 60 Hz-touch phone
adds 16.7 ms of pure sampling delay — more than your whole finger-to-PC pipeline on a good
link. This is why `LOW_LATENCY_GUIDE.md` section 4 is arguably the highest-leverage document
in the project: *steering users to a 120 Hz+ touch phone beats every optimisation in this
research combined.*

**(b) Your problem is jitter, not mean.** Your mean is excellent. Your own Phase 3 notes flag
"occasional p95 spike (~14–18 ms) when the UI thread is busy". Players do not perceive a stable
12 ms — they perceive the one input in fifty that took 40 ms. Every worthwhile item in section 4
below targets the tail, not the average.

---

## 2. Dimension-by-dimension verdicts

### Dimension 1 — Wi-Fi fundamentals and standards. **Verdict: relevant, but as user guidance, not code.**

**What's real:**

The airtime cost of your packets is almost entirely overhead, not payload. A 41-byte GRX frame
is nothing; the cost is the PHY preamble, the contention backoff, and the ACK.
[CWNP's overhead analysis](https://www.cwnp.com/wi-fi-overhead-part-2-solutions-to-overhead/)
puts data-preamble overhead at 100–200% of payload transmission time, and SIFS+ACK together at
~60 µs — roughly 300% of the payload's own airtime. Frame aggregation is the normal fix, but
[aggregation is exactly what you must not have](https://inet.omnetpp.org/docs/showcases/wireless/aggregation/doc/index.html):
it trades latency for efficiency by waiting to batch frames. Your traffic is correctly
classified into AC_VO, which has the shortest contention window and does not aggregate.

**The counterintuitive finding — Wi-Fi 6 is not automatically better for you.**

Wi-Fi 6's headline uplink feature, OFDMA, can *hurt* traffic shaped like yours. In uplink
OFDMA the station cannot simply transmit when it has data; it waits for the AP to send a
**trigger frame** allocating it a resource unit. And to keep the multi-user transmission
synchronised, smaller payloads are **padded to match the largest payload in the group**. For a
station sending one 41-byte packet at an unpredictable moment, that is a scheduling delay it
did not have under legacy EDCA contention. The
[ns-3 evaluation of 802.11ax uplink OFDMA](https://arxiv.org/html/2506.22260v1) reports that
*without additional uplink traffic, OFDMA showed abnormally high round-trip latencies* — i.e.
in the light-load case, which is your case, trigger-based access can be worse than just
contending for the medium.

Practical read: do not assume a user's new Wi-Fi 6 router improved things. It may not have.

**Where the real standards win is: Wi-Fi 7 MLO, and the 6 GHz band.**

Multi-Link Operation lets a station keep links on two bands simultaneously and send on
whichever is free, which directly attacks the contention-delay tail. Measured results are
strong: the [Wireless Broadband Alliance field trials](https://wballiance.com/wba-validates-wifi-7-mlo-reliability-cablelabs-intel/)
found 35–48% lower application-layer latency and up to 40% lower MAC-layer jitter, with 66%
lower uplink latency for real-time applications. One cloud-gaming test cited a p99 drop from
45 ms (Wi-Fi 6) to 12 ms (Wi-Fi 7 MLO). The caveat in the same sources matters: **the gains
are large under congestion and modest on a clean link.** Which is precisely the shape of your
problem — your mean is fine, your tail is not.

Also note Wi-Fi 7's **R-TWT (Restricted Target Wake Time)**, which reserves contention-free
service periods for latency-sensitive flows —
[the arXiv treatment](https://arxiv.org/abs/2402.15900) models it as a way to give a flow
bounded delay. This is the first Wi-Fi mechanism actually designed for traffic like yours. It
is AP-side and years from mainstream consumer deployment, so it is a "watch this" item, not an
action.

⚠️ **Conversely, plain TWT (Wi-Fi 6) is a latency *risk*.** TWT holds a station's data until
its next negotiated wake window. For unsolicited real-time data that is added delay by
construction. Your `WIFI_MODE_FULL_LOW_LATENCY` lock disables power save and should suppress
this, but it is worth knowing that a phone which fails to take that lock could be sitting in a
TWT schedule.

**Actions:** none in code. Two documentation updates — see §4 items 5 and 6.

---

### Dimension 2 — L4S and congestion control. **Verdict: not applicable. Skip entirely.**

This is the dimension I'd cut without hesitation.

L4S solves a specific problem: **bulk flows filling a bottleneck queue**, causing bufferbloat
for everyone sharing it. It works by having the bottleneck mark packets with ECN and having
*scalable* senders react to those marks by backing off smoothly. It is congestion *control* —
it needs a sender with a sending rate to control.

Your stream sends 20 bytes on change plus a 30 Hz keep-alive. That is on the order of
**1–10 kbps**. It cannot fill a queue. It is never the cause of congestion; it is a victim of
someone else's. And there is nothing to "back off" — you cannot send a button press more
slowly.

Deployment reality reinforces this. Per [CableLabs](https://www.cablelabs.com/blog/l4s-in-wi-fi-a-path-to-seamless-interactive-experiences),
Wi-Fi is acknowledged as the usual congestion point and needs L4S support — but that support
is at the *AP*, it is at the guidelines/simulation stage via the Wireless Broadband Alliance,
and consumer router deployment is essentially nil. Apple shipped client-side beta support in
iOS 16 / Ventura; DOCSIS operators are enabling it upstream. None of that is a lever you can pull.

**One thing to *not* change:** your TOS byte is `0xB8` = DSCP EF (46) in the top 6 bits with
**ECN bits 00 (Not-ECT)**. That is correct. Do not set ECT(1) to "opt in to L4S" — with no
L4S-aware bottleneck in the path it buys nothing, and a Classic-ECN middlebox that marks it
would just be noise you have no logic to interpret. Leave it.

**Actions:** none. Remove this from the roadmap.

---

### Dimension 3 — QoS and prioritisation. **Verdict: already implemented, on both sides. Nothing left to build.**

The prompt asks for "DSCP marking implementation (C++ code example)". You wrote it, and you
wrote the more important half too.

```c
// gamepad-engine.cpp:133
static void applyLowLatencyTos(int sock) {
    if (sock < 0) return;
    int tos = 0xB8;                     // DSCP EF (Expedited Forwarding) << 2 | ECN 0
    setsockopt(sock, IPPROTO_IP, IP_TOS, &tos, sizeof(tos));
#ifdef SO_PRIORITY
    int prio = 6;                       // TC_PRIO_INTERACTIVE → WMM AC_VO
    setsockopt(sock, SOL_SOCKET, SO_PRIORITY, &prio, sizeof(prio));
#endif
}
```

The `SO_PRIORITY` line is the one that actually does the work, and the comment in your source
already explains why: on Android, the Wi-Fi HAL picks the WMM access category from
`skb->priority`, and many HALs honour that even when they ignore the IP_TOS/DSCP byte. Priority
6 maps to AC_VO — the voice queue, shortest contention window, no aggregation delay. That is
the correct destination for gamepad input, and you're getting there by the reliable route.

**The research does add one caveat worth understanding**, and it argues *against* investing
more here. DSCP-to-WMM mapping is not dependable across the industry: as the
[Wi-Fi Alliance notes](https://www.wi-fi.org/beacon/m-consuelo-ortiz/wi-fi-certified-qos-management-prioritizes-traffic-to-improve-user),
the IETF (DiffServ) and IEEE (WMM) never aligned on a common mapping, and
[Cisco's design guidance](https://www.cisco.com/c/en/us/td/docs/wireless/controller/8-1/Enterprise-Mobility-8-1-Design-Guide/Enterprise_Mobility_8-1_Deployment_Guide/ch5_QoS.html)
documents APs classifying on tunnel headers rather than the inner packet's DSCP. Enterprise
vendors like Meraki honour the standard mapping; consumer routers frequently remap or strip
DSCP outright.

The practical consequence: **your uplink prioritisation (phone → AP) works, because it's
decided on the phone by `SO_PRIORITY`. Your downlink prioritisation (AP → phone, i.e. your
ACKs and rumble) is at the mercy of the router.** There is no app-side fix for that. The good
news is the downlink carries only ACKs and rumble — nothing on the critical input path — so
the exposure is small.

**Actions:** none in code. The existing "enable WMM/QoS on your router" line in
`LOW_LATENCY_GUIDE.md` is already the right user-facing advice.

---

### Dimension 4 — Multipath and FEC. **Verdict: mostly not applicable — and the part that *is* applicable, you already built correctly.**

Taking the four sub-proposals separately:

**MPTCP / ReMP TCP — not applicable.** These are TCP. You are UDP by deliberate design, and
your `reference_wire_protocol` notes record exactly why: TCP head-of-line blocking delays
input, and a dropped sample beats a late one. Adopting a TCP variant would reintroduce the
problem the architecture exists to avoid. The papers are good; they are about a different
problem.

**Dual-path Wi-Fi + LTE — actively harmful as a latency measure.** The idea is redundant
transmission over two paths, taking whichever arrives first. But cellular RTT is typically
30–70 ms against your Wi-Fi path's ~10 ms. A redundant scheduler takes the *minimum* of the
two, so the cellular copy would essentially never win — you would spend the user's mobile data
and battery to lose a race every single time. It is defensible as a *failover* (keep playing
when Wi-Fi drops entirely), which is a reliability feature with its own product argument. It
is not a latency feature. Do not file it under this heading.

**Reed-Solomon / block FEC — strictly worse than what you have.** Block FEC computes parity
across a block of N packets. The receiver must wait for enough of the block to arrive before
it can reconstruct anything, so recovery latency is bounded below by (N−1) packet intervals.
The [patent and standards literature](https://patents.google.com/patent/US20090003207) is
consistent that redundancy costs latency through both computation and the need to span
multiple packets in time. For a 20-byte payload where the whole point is that *this* packet
arrives now, adding a decode-block delay is backwards.

**What you already do is the right answer.** `CHANGED_PACKET_REDUNDANCY = 3` sends three copies
of every changed input. For tiny packets this is optimal:

- **Bandwidth cost is irrelevant** — 3 × 41 bytes is nothing.
- **Airtime cost is real but acceptable** — because airtime is dominated by preamble and ACK
  overhead, 3 copies cost roughly 3× airtime regardless of how small the payload is. This is
  the true cost, and it is the reason not to raise the number further.
- **Recovery is instantaneous** — no decode, no block, no waiting. The first copy to arrive wins.
- **And critically, your copies are spread in time, not back-to-back.** The TX loop re-arms on
  the `RX_POLL_NS` (2 ms) tick, so the three copies go out over roughly 4 ms. Burst interference
  that kills one copy is unlikely to kill all three. Three genuinely back-to-back copies would
  be far weaker. (The `FIX 1` comment says "back-to-back sends"; the code's actual behaviour,
  correctly described by the later comment, is ~2 ms apart. The behaviour is right — only the
  first comment is misleading.)

**Actions:** none. If anything, resist the temptation to raise the redundancy count — you'd pay
airtime on a congested AP, which is exactly the situation where you can least afford it.

---

### Dimension 5 — Machine learning and prediction. **Verdict: not worth it. Recommend dropping.**

I want to be direct about this one, because it is the most expensive item in the prompt and I
think it has the weakest case.

**The cost is comparable to the entire thing it would optimise.** Your touch→handle time is
1.6–1.9 ms. A TensorFlow Lite inference, even for a tiny model, lands in the same order of
magnitude. You would be spending your latency budget to predict your latency budget.

**More fundamentally: there is nothing to act on.** ML-driven optimisation pays off when a
prediction lets you *choose* something — pick a path, pick a bitrate, pick a wake schedule,
pre-render a frame. Look at what your engine actually decides:

- Which path? There's one.
- What bitrate? There isn't one — the payload is fixed at 20 bytes.
- When to send? Immediately, on change. That's already optimal; a predictor cannot beat "now".
- How much redundancy? This is the *only* genuinely tunable knob, and it's a single integer.
  If you ever want it adaptive, a threshold on measured packet loss does the job in ten lines.
  You do not need a neural network to decide between 2 and 4.

**Input prediction / dead reckoning is worse than a no-op here.** It is standard in cloud
gaming and multiplayer netcode because there the client is rendering a *world* and can correct
a wrong guess on the next frame. You are not rendering anything — you are asserting the state
of a physical control. Extrapolating a stick position means telling the game the user pushed
the stick somewhere they did not. A mispredicted analog stick is a car that steers itself into
a wall. Mispredicted button state is a shot the player never fired. In a controller, a wrong
input is far worse than a late one — which is the same principle that made UDP the right
choice in the first place.

**The one legitimate ML-adjacent idea**, and it isn't ML: use the RTT you already measure to
*inform the user*. "Your link is degrading, switch to 5 GHz" is a statistics problem, and it
falls out of the telemetry work in §4 item 1 for free.

**Actions:** drop the dimension. Redirect the effort to §4 item 1.

---

### Dimension 6 — Cloud gaming protocols. **Verdict: limited transfer. One genuinely useful idea.**

The instinct is reasonable but the problem shapes differ more than they look.

Cloud gaming's latency problem is **downstream video**: encode, transmit a multi-megabit
stream, decode, display. Their entire toolkit — adaptive bitrate, congestion control over a
fat flow, FEC across video packets, frame pacing, reference-frame recovery — exists to manage
a large downstream flow under bandwidth pressure. You have **no video, no downstream flow, and
no bandwidth pressure.** Your stream is tiny, uplink, and sporadic. Almost none of the toolkit
transfers.

Their *input* path — which is the part that resembles yours — is the part they publish least
about, and it is architecturally simpler than yours (a USB controller into a client that is
already streaming). Reported end-to-end figures for GeForce NOW sit around
[20–40 ms as expected behaviour](https://www.nvidia.com/en-us/geforce-now/recommended/), but
that is the whole round trip including video, so it isn't comparable to your number.

**The one idea that does transfer, and it's a good one:** the industry consistently treats
**jitter as more damaging than mean latency**, and optimises the tail. NVIDIA's own guidance
singles out latency "spiking with jitter" as what actually ruins the experience, ahead of raw
ping. That matches your data exactly: your mean is ~10–18 ms and fine; your problem is the
14–18 ms p95 spike when the UI thread is busy. **Frame your remaining work as tail reduction,
not mean reduction.** Everything in §4 follows from that.

A second, smaller transfer: they instrument obsessively and expose latency to the user
(NVIDIA ships a per-stage overlay). That's §4 item 1.

**Actions:** adopt the framing. Nothing to port.

---

## 3. Strategy comparison matrix

Scored for *your* stack as it exists today, not for a generic app.

| Strategy | Already done? | Latency gain | Jitter gain | CPU/battery | Complexity | Risk | Verdict |
|---|---|---|---|---|---|---|---|
| DSCP-EF marking | ✅ yes | — | — | none | — | — | done |
| SO_PRIORITY → AC_VO | ✅ yes | — | — | none | — | — | done |
| Event-driven send | ✅ yes | — | — | none | — | — | done |
| 3× spread redundancy | ✅ yes | — | — | low | — | — | done, don't raise it |
| Wi-Fi low-latency lock | ✅ yes | — | — | high (by design) | — | — | done |
| **Field latency telemetry** | ❌ no | 0 ms direct | **enables everything** | negligible | low | very low | **DO FIRST** |
| **Ship Phase 3 native input** | ⚠️ built, unverified | **−5 ms** | **~3× tail** | neutral | zero (built) | low | **DO NEXT** |
| **Thin the `__nvis` mirror** | ❌ no | ~0 ms mean | **targets the p95 spike** | lower | medium | medium | **worth it** |
| ADPF PerformanceHintManager | ❌ no | ~0 ms mean | tail, scheduler-dependent | low | low-medium | low | worth trying |
| Fix the two false doc claims | ❌ no | 0 ms | 0 ms | none | trivial | none | **do it, 10 min** |
| 6 GHz / Wi-Fi 7 user guidance | ❌ no | up to −30 ms tail | large, user-side | none | trivial | none | **best ms-per-hour** |
| L4S / ECN | — | 0 | 0 | — | high | high | **skip** |
| MPTCP | — | negative | — | — | high | high | **skip** |
| Wi-Fi + LTE dual path | — | negative | negative | high | high | high | **skip as latency work** |
| Reed-Solomon FEC | — | negative | negative | medium | high | medium | **skip** |
| TFLite latency prediction | — | ~0 | ~0 | medium | very high | medium | **skip** |
| Input dead-reckoning | — | fake gain | — | low | high | **very high** | **skip — actively wrong** |

---

## 4. What is actually worth doing, in order

### 1. Build field latency telemetry — p50/p95/p99, not one smoothed float. **← the real #1**

**Why this is first:** you cannot currently answer the question this entire research document
is about. You have exactly one latency number in the field:

```c
// gamepad-engine.cpp:488 — a single EWMA-smoothed float
float smoothed = (prev <= 0.0f) ? rttMs : (prev * 0.8f + rttMs * 0.2f);
latencyMsAtomic.store(smoothed, ...);
```

An EWMA is a *mean estimator*. It is mathematically designed to hide exactly the spikes that
are your actual problem — a single 40 ms outlier moves it by 6 ms and then decays away. Your
p95 is invisible to you in the field. The detailed `GPM` harness exists but is
`adb logcat` only, so it only ever runs on your desk, on your phone, on your Wi-Fi.

That is why the prompt could assert "80–400 ms" unchallenged, and it is why every target in it
is unfalsifiable. **Fix the measurement before optimising anything else.**

**Shape of the work** (small, self-contained, low risk):

- Keep a fixed ring buffer of the last N raw RTT samples in `gamepad-engine.cpp` (N = 512 is
  ~10 s of keep-alive at 30 Hz, a few KB — keep the raw samples, *not* the EWMA).
- Compute p50 / p95 / p99 / max on demand when the UI asks, not per packet.
- Expose alongside the existing `latencyMsAtomic` getter — additive, nothing existing changes.
- Surface it in a **Network Health** panel: current, p50, p95, p99, worst, loss %, and which
  transport is active (USB / Wi-Fi / AOA).

**Three payoffs, and only one of them is engineering:**
- You find out whether users actually have a problem, and which users.
- It becomes a support tool. "Send me a screenshot of the Network Health panel" is enormously
  better than "it feels laggy" — including for reports relayed from Aukstea.
- It's a visible feature. "Real measured p99 latency, shown live" is a differentiator no
  competing controller app advertises.

**Caveat, stated plainly:** RTT is a *round trip*, and it is measured from a PC ACK. It does
not include the digitizer or the game's input tick — the two largest terms in §1. Do not label
it "input latency" in the UI. Label it "link latency" or "network round trip". Overclaiming
here would make the number worse than useless.

### 2. Finish the Phase 3 gameplay-feel verdict

This has been the release gate since **2026-07-21** — over five weeks. The work is *built and
device-verified*: 6.8 ms → 1.6–1.9 ms, 3.7× faster, p95 tail cut ~3×. It is behind a flag
(`gp_native_input`, default ON) and it is the single largest latency win in the project's
history. It is sitting there unshipped.

Nothing in this research produces a gain anywhere near it. **This is the highest-value latency
action available and it costs no new engineering** — it needs you to play a real game and
judge buttons, sticks, triggers, d-pad and gyro.

The two known gaps to weigh: touch ripples and stick grab-tint don't render in native mode.
Both are cosmetic. That is a defensible trade for 3.7×, but it is your call, not mine.

### 3. Thin the `__nvis` per-frame visual mirror

Your own Phase 3 notes name this as the first lever for the residual p95 spike (~14–18 ms when
the UI thread is busy). Per §2 D6 and §1(b), the p95 *is* the remaining problem. This is the
one item where your existing notes and this research point at the same place.

Worth doing *after* item 1, so you can measure whether it worked.

### 4. Try ADPF `PerformanceHintManager`

This is the genuinely new API since your last latency pass, and it addresses a limitation
already documented in your own code. Your TX thread tries `SCHED_FIFO` and expects to fail:

```c
// gamepad-engine.cpp:239 — "on stock Android this almost always fails with EPERM"
```

ADPF is the *supported* way to ask for what `SCHED_FIFO` was denied.
[`PerformanceHintManager`](https://developer.android.com/games/optimize/adpf) lets you declare
a thread (or thread group) with a target work duration; the OS ramps clocks and picks core
types to meet it, then drops them again when the work is done — so unlike core pinning it does
not keep big cores spun up. That distinction matters here, because your affinity pinning was
removed for exactly that thermal reason (`gamepad-engine.cpp:227`) and the code carries a
"do NOT re-add it" note. ADPF is the version of that idea which doesn't have the thermal
downside.

Realistic expectation: **this targets the jitter tail, not the mean, and the benefit is
OEM-dependent** — the OS "decides how to best use the hints". Treat it as an experiment gated
on item 1's telemetry, not a guaranteed win. Requires API 31+.

### 5. Fix two false claims in the docs — 10 minutes, and one is customer-facing

The code and the documentation disagree, and the documentation is wrong in a way that is
visible to users.

`apps/docs/LOW_LATENCY_GUIDE.md:50` tells customers:

> "**1000 Hz native send thread**, pinned to the phone's performance cores"

The code does neither, deliberately:

```c
// gamepad-engine.cpp:227
// NOTE: no CPU-affinity pinning. Forcing cores 4-7 (big cores) kept them spun
// up 1000x/second, which was the main source of high CPU + phone heat.
// (Affinity pinning was intentionally removed for thermal reasons — do NOT re-add it.)
```

and it sends **on change plus a 30 Hz keep-alive**, not at 1000 Hz. Both changes were correct
engineering decisions; the guide was never updated to match.

`apps/docs/ARCHITECTURE.md:230` has the same problem internally — it claims `SCHED_FIFO`
"gives the UDP send loop the highest possible priority", where the code comments say it almost
always fails with EPERM and falls back to `nice(-19)`. This one has already cost you: your
memory notes record that `ARCHITECTURE.md`'s 1000 Hz / SCHED_FIFO claim needed correcting once
before.

The honest replacement is also the better sales pitch: *"event-driven send — the packet leaves
within microseconds of your finger moving, instead of waiting for a poll tick."* That is what
the code does, and it's a stronger claim than a polling rate.

### 6. Add 6 GHz / Wi-Fi 6E / Wi-Fi 7 guidance to the user guide

`LOW_LATENCY_GUIDE.md` section 2 says "use 5 GHz, not 2.4 GHz" and stops there. In 2026 that is
incomplete: **6 GHz is the single biggest user-side improvement available**, because the band
is largely empty and contention delay is your dominant air-side variable. Per §2 D1, Wi-Fi 7
MLO measured 35–48% lower application latency and a p99 drop from 45 ms to 12 ms in one
cloud-gaming trial.

Best ms-per-hour-of-work in this entire document, and it's a documentation edit. Suggested
band ordering for the guide: **USB tether > 6 GHz (Wi-Fi 6E/7) > 5 GHz > 2.4 GHz (avoid)**.

Add the honest caveat too: a Wi-Fi 6 router is *not* automatically an upgrade for this app
(the OFDMA trigger-frame finding in §2 D1). Say "6 GHz band", not "Wi-Fi 6".

---

## 5. Suggested sequencing

Not the 10–12 weeks the prompt asks for. That timeline was sized for a 200 ms problem you
don't have, and you have a 1.4.0 Play closed test in flight plus wheel mode owed to a customer.

| When | What | Effort |
|---|---|---|
| Now, ~10 min | §4.5 — fix the two false doc claims | trivial |
| Now, ~30 min | §4.6 — 6 GHz guidance in the user guide | trivial |
| This week | §4.2 — play a real game, settle the Phase 3 verdict | an evening |
| Next | §4.1 — RTT percentile ring buffer + Network Health panel | 1–2 sessions |
| After measuring | §4.3 — thin `__nvis`, verify against the new p95 | 1–2 sessions |
| Experiment | §4.4 — ADPF hint session, A/B against the new p95 | 1 session |
| Never | L4S, MPTCP, LTE dual-path, Reed-Solomon, TFLite, dead reckoning | — |

Everything after §4.2 should wait until 1.4.0 is out. None of it is urgent, because **you do
not currently have a latency problem you can demonstrate** — which is itself the finding that
§4.1 exists to change.

---

## 6. Answers to the prompt's own "questions to clarify"

1. **Can we see the UDP implementation?** Yes — read before writing this. §0 lists what's in it.
2. **Typical user's Wi-Fi setup, % on Wi-Fi 5 vs 6?** *Unknown, and that's the finding.* No
   field telemetry exists. §4.1.
3. **Max acceptable CPU/battery overhead?** Already answered by a past decision: core pinning
   was removed for heat. That's your revealed threshold, and it rules out the ML dimension.
4. **Timeline urgency?** None demonstrable. 1.4.0 and wheel mode both outrank this.
5. **Deployment strategy?** You already have the right pattern — `gp_native_input` is a
   localStorage flag with a runtime setter. Use the same for anything here.
6. **Target devices?** Android 10+ (API 29) is the floor for `WIFI_MODE_FULL_LOW_LATENCY`.
   ADPF needs API 31+, so it must be feature-detected.
7. **Budget for FEC libraries?** Not needed. §2 D4 — you already have the correct scheme.

---

## 7. Sources

**Wi-Fi standards, OFDMA and latency**
- [Design and Evaluation of IEEE 802.11ax Uplink OFDMA Random Access in ns-3 (arXiv 2506.22260)](https://arxiv.org/html/2506.22260v1) — the "OFDMA can be worse at light load" finding
- [Latency-Sensitive Networked Control Using 802.11ax OFDMA Triggering — NIST](https://www.nist.gov/publications/latency-sensitive-networked-control-using-80211ax-ofdma-triggering)
- [Dedicated Restricted Target Wake Time for Real-Time Applications in Wi-Fi 7 (arXiv 2402.15900)](https://arxiv.org/abs/2402.15900)
- [R-TWT in Wi-Fi 7 and Beyond: Enabling Bounded Latency — Menth et al.](https://atlas.cs.uni-tuebingen.de/~menth/papers/Menth25n.pdf)
- [Deterministic Scheduling over Wi-Fi 6 using Target Wake Time (arXiv 2505.00447)](https://arxiv.org/pdf/2505.00447)
- [Wi-Fi: Twenty-Five Years and Counting (arXiv 2507.09613)](https://arxiv.org/pdf/2507.09613)

**Wi-Fi 7 MLO measurements**
- [WBA validates Wi-Fi 7 MLO reliability — CableLabs/Intel field trials](https://wballiance.com/wba-validates-wifi-7-mlo-reliability-cablelabs-intel/)
- [Wi-Fi 7's Multi-Link Operation dissected — Cisco Blogs](https://blogs.cisco.com/networking/wi-fi-7s-multi-link-operation-mlo-dissection-from-packets-to-performance)
- [MediaTek Wi-Fi 7 MLO white paper](https://mediatek-marketing.files.svdcdn.com/production/documents/Wi-Fi-7-MLO-White-Paper-WF7MLOWP0622.pdf)

**QoS, DSCP and WMM**
- [Wi-Fi CERTIFIED QoS Management — Wi-Fi Alliance](https://www.wi-fi.org/beacon/m-consuelo-ortiz/wi-fi-certified-qos-management-prioritizes-traffic-to-improve-user)
- [Cisco Enterprise Mobility 8.1 Design Guide — Wireless QoS](https://www.cisco.com/c/en/us/td/docs/wireless/controller/8-1/Enterprise-Mobility-8-1-Design-Guide/Enterprise_Mobility_8-1_Deployment_Guide/ch5_QoS.html)
- [Wireless QoS and Fast Lane — Cisco Meraki](https://documentation.meraki.com/Wireless/Design_and_Configure/Architecture_and_Best_Practices/Wireless_QoS_and_Fast_Lane)
- [Understanding Wireless QoS — mrn-cciew](https://mrncciew.com/2012/11/28/understanding-wireless-qos-part-1/)

**Airtime overhead**
- [Wi-Fi Overhead, Part 2: Solutions to Overhead — CWNP](https://www.cwnp.com/wi-fi-overhead-part-2-solutions-to-overhead/)
- [IEEE 802.11 Frame Aggregation — INET/OMNeT++](https://inet.omnetpp.org/docs/showcases/wireless/aggregation/doc/index.html)

**L4S**
- [L4S in Wi-Fi: A Path to Seamless Interactive Experiences — CableLabs](https://www.cablelabs.com/blog/l4s-in-wi-fi-a-path-to-seamless-interactive-experiences)
- [Your guide to L4S — Ericsson](https://www.ericsson.com/en/blog/2026/6/your-guide-to-l4s)
- [L4S — Nokia Bell Labs](https://www.nokia.com/bell-labs/research/l4s/)
- [draft-ietf-tsvwg-l4sops — Operational Guidance on L4S Deployment](https://datatracker.ietf.org/doc/draft-ietf-tsvwg-l4sops/)

**FEC vs duplication**
- [Wireless performance improvement via client-free FEC (US20090003207A1)](https://patents.google.com/patent/US20090003207)
- [Evaluating Packet-level Forward Error Correction — IEEE](https://ieeexplore.ieee.org/document/6268525/)

**Android platform**
- [Wi-Fi low-latency mode — Android Open Source Project](https://source.android.com/docs/core/connect/wifi-low-latency)
- [Optimize thermal and CPU performance with ADPF — Android Developers](https://developer.android.com/games/optimize/adpf)
- [Best practices for ADPF — Android Developers](https://developer.android.com/games/optimize/adpf/best-practices-adpf)
- [Performance Hint API — Android Open Source Project](https://source.android.com/docs/core/perf/performance-hint-api)

**Cloud gaming**
- [Recommended Routers & Controllers for GeForce NOW — NVIDIA](https://www.nvidia.com/en-us/geforce-now/recommended/)
- [How can I reduce lag on GeForce NOW — NVIDIA support](https://nvidia.custhelp.com/app/answers/detail/a_id/4504/~/how-can-i-reduce-lag-or-improve-streaming-quality-when-using-geforce-now)

**Internal**
- `apps/android-client/app/src/main/cpp/gamepad-engine.cpp`
- `apps/android-client/app/src/main/java/com/gamepad/client/{MainActivity,NativeInputEngine}.kt`
- `apps/pc-server/server.py`
- `apps/docs/LOW_LATENCY_GUIDE.md`, `apps/docs/ARCHITECTURE.md`
- `docs/handoffs/SESSION_HANDOFF_2026-07-20*.md`, `_2026-07-21.md`

---

# Addendum — 2026-09-03 re-check

Re-researched on request. **Nothing here overturns the August verdict.** The new
material either confirms it or sharpens the user-facing advice. No decision above is
reopened.

## The academic frontier is all below our layer

Searched for current work on Wi-Fi tail latency for real-time traffic. Everything
credible sits at MAC/PHY or in the AP, i.e. nowhere an Android app can reach:

| Work | Claim | Why we cannot ship it |
|---|---|---|
| IEEE 802.11bn Coordinated TDMA (arXiv 2508.18755) | ~24% better worst-case latency + jitter | Next standard (Wi-Fi 8). Needs AP **and** client silicon. |
| Blade — adaptive contention control (arXiv 2603.16119) | >4× lower tail PPDU delay | Rewrites MAC contention. Driver/firmware, not app. |
| 802.11ax OFDMA triggering (NIST) | 1 ms at 99.999% via uplink scheduling | Requires AP-side scheduler control. |
| MU-MIMO pre-arrival contention (USPTO 11259324) | Bounded worst-case latency | MAC/PHY change. |
| Consistent Low Latency for Wireless RT (ACM 3544216.3544225) | Tail comes from send-rate vs bottleneck-queue mismatch | **Confirms the L4S rejection** — at 1–10 kbps we never build the queue this describes. |

The honest conclusion: **there is no app-layer Wi-Fi latency technique left to adopt.**
The remaining wins are on the device (scheduling) and in what we tell users about their
band. That is exactly where this round's changes went.

## Two things that did sharpen

**Wi-Fi 7 MLO — now has field numbers.** CableLabs/Intel residential trials (Feb 2026,
WBA) measured ~35–48% lower application-layer latency and up to 40% less MAC-layer
jitter; a lab figure of 145 ms → 18 ms at the 95th percentile under 70% load. Two
caveats that matter more than the headline: cheaper **NSTR** radios deliver only ~30% of
premium MLO, and on an already-clean 6 GHz link the gain is modest — there was no
congestion left to remove. Still hardware the *user* buys, never something we ship, so
it belongs in the guide and nowhere else. Added.

**ADPF has a measured number.** ~17% less frame-time jitter (MediaTek/Google, Dimensity
9400). That was ranked action #4 and is now **built** — see below.

## Applied this round

1. **ADPF hint session on the TX thread** (`gamepad-engine.cpp`). Resolved by `dlsym`
   from `libandroid.so`, not the NDK header: `APerformanceHint` is API 33+ and minSdk
   here is 24, so on an older device every pointer stays null and the whole thing is a
   no-op that cannot crash. Target 2 ms — the loop's own poll budget. Actual duration is
   reported only on a real send; reporting idle cycles would teach the governor it can
   slow down. Session is closed with the thread that owns it.
   This is the *supported* route to what `SCHED_FIFO` is denied, and unlike affinity
   pinning it carries no thermal cost — pinning stays removed.
2. **Three false claims deleted from the customer-facing docs.** `LOW_LATENCY_GUIDE.md`
   promised a "1000 Hz send thread pinned to the phone's performance cores"; the send
   loop is event-driven and there is **no affinity code at all** (deliberately —
   removed for heat). `ARCHITECTURE.md` twice described `SCHED_FIFO` as achieved when
   stock Android refuses it and the code falls back to `nice(-19)`. Users were being
   told to expect behaviour that does not exist.
3. **Band guidance rewritten.** Was "5 GHz not 2.4". Now leads with **6 GHz**, explains
   that band beats generation (Wi-Fi 6 uplink OFDMA is the wrong trade for a controller —
   the NIST paper above is the reason), and gives the MLO buying advice with its caveats.

Verified: native build clean on all three ABIs, all four `APerformanceHint_*` symbols
present in the release `.so`, regression `--fast` at 5 passed / 2 failed where both
failures are the known environment gaps (no `cargo` on this machine, the 13-error TS
baseline). **Not device-tested** — ADPF's effect is invisible without field telemetry.

## Ranked actions after this round

1. **Field telemetry — now the blocker for everything else.** Still an EWMA mean
   (`latencyMsAtomic`, α=0.2) that mathematically hides the p95 spikes, with the real
   p50/p95 harness reachable only over `adb logcat`. We have just shipped a change whose
   entire purpose is tail reduction and **no way to see whether it worked.**
2. Settle the Phase 3 gameplay-feel verdict — still the largest built-and-unshipped win.
3. Thin the `__nvis` per-frame visual mirror further.
