# RemoteGamepad — Low-Latency Guide

How to get the lowest possible input latency, in order of impact.

## Realistic latency targets (finger → game)

| Setup | Latency |
|-------|---------|
| USB tethering (wired-quality) | **~6–12 ms** |
| Tuned 5 GHz Wi-Fi (this app, optimized) | **~10–18 ms** |
| Typical 5 GHz home Wi-Fi | ~20–35 ms |
| 2.4 GHz / congested | 50–120 ms+ |

For reference: wired Xbox pad ≈ 4–8 ms, Bluetooth ≈ 15–25 ms.

---

## 1. USB Tethering — lowest latency, no Wi-Fi (recommended for competitive play)

This routes packets over the USB cable instead of Wi-Fi, giving a wired-quality
link while keeping the app's normal UDP path. **No app changes needed.**

1. Connect the phone to the PC with a USB cable.
2. On the phone: **Settings → Network & Internet → Hotspot & tethering → USB tethering → ON.**
   (On some phones: Settings → Connections → Mobile Hotspot and Tethering → USB tethering.)
3. Windows creates a new "Remote NDIS" network adapter — the phone and PC are now
   on a direct USB subnet.
4. Launch `GamepadServer.exe`. It auto-detects its LAN IP; scan the QR as usual.
   Traffic now flows over USB, not your Wi-Fi router.

> Tip: keep Wi-Fi ON on the phone too — Android still routes the gamepad subnet
> over USB, and you avoid mobile-data usage.

---

## 2. Wi-Fi optimization (if you prefer wireless)

- **Use 6 GHz if you have it, otherwise 5 GHz. Never 2.4 GHz.** This is the #1 Wi-Fi
  factor by a wide margin. 2.4 GHz is crowded (microwaves, neighbours, Bluetooth) and
  its jitter is what you feel as random stutter.
  **6 GHz is the single best change most people can make**: only Wi-Fi 6E/7 devices are
  allowed on it, so there are no legacy neighbours competing for airtime. It is a
  shorter-range band — stay in the same room as the router and it will beat 5 GHz;
  through two walls it may not reach at all, in which case 5 GHz is the right choice.
- **Band matters more than Wi-Fi generation.** "Wi-Fi 6" on the box is not automatically
  better for this app — Wi-Fi 6 uplink OFDMA makes your phone wait for the router's
  invitation to transmit and pads tiny packets out to the size of the largest in the
  group, which is the wrong trade for a controller sending a few hundred bytes a second.
  Ask for the **6 GHz band**, not for a generation number.
- **If you are buying a router: Wi-Fi 7 with MLO is the real upgrade**, and it is the one
  wireless change with published evidence behind it — 2026 field trials measured roughly
  35–48% lower application-layer latency and up to 40% less MAC-layer jitter, with the
  95th-percentile figure improving most on a busy network. Two cautions: the cheaper
  "NSTR" implementations deliver only about a third of that, and if you already have a
  clean, quiet 6 GHz link the gain is modest, because there was little congestion left
  to fix.
- **Be in the same room as the router**, line-of-sight if possible.
- **Enable WMM / QoS** on your router. The app tags its packets as
  DSCP-EF (expedited), so a WMM-capable router will prioritise them.
- **Avoid mesh hops / extenders** between phone and router.
- Close bandwidth-heavy apps on the same network (downloads, 4K video).

---

## 3. What the app already does for you (no action needed)

- **Event-driven native send thread** — a packet goes out the moment your input
  actually changes, rather than on a fixed clock, plus a 30 Hz keep-alive (60 Hz while
  rumble is active) to keep the link warm. Written and flushed in C, so no garbage
  collector can pause it.
- **Deadline-aware scheduling** — the send thread asks Android for high priority and,
  on Android 13+, tells the CPU governor its actual deadline so clocks ramp up when a
  send is running late. (Real-time priority is requested first, but stock Android
  almost always refuses it — the app degrades to the strongest normal priority it can
  get, which is why the deadline hint matters.)
- **Wi-Fi radio low-latency lock** — prevents the radio power-saving between
  packets (eliminates 10–40 ms spikes).
- **Unbuffered touch dispatch + historical sample replay** — touches skip the
  display-vsync batching and no sub-frame movement is dropped.
- **DSCP-EF / IP_TOS priority tagging** on every packet.
- **Real round-trip latency measurement** shown in the in-app telemetry.
- **PC server**: HIGH process priority, 1 MB receive buffer, drains to the
  newest packet so input lag never accumulates, low-delay socket TOS.

---

## 4. Phone requirements for lowest latency

The phone's own hardware sets the latency *floor* — even a perfect network
can't beat a slow touchscreen. In rough order of impact:

| Factor | Why it matters | Want |
|--------|----------------|------|
| **Touch sampling rate** | This is the single biggest phone-side cost. A 60 Hz digitizer adds up to ~16 ms just to *detect* the touch; 240 Hz cuts that to ~4 ms. | **120 Hz+ touch sampling** (gaming phones do 240–720 Hz) |
| **Display refresh rate** | The screen redraw and vsync batching ride on the panel rate. | **90–120 Hz+ display** |
| **Wi-Fi band** | Band matters far more than Wi-Fi generation. 6 GHz is the quietest air — no legacy 2.4/5 GHz neighbours sharing it — and that shows up as fewer latency spikes, not a higher headline speed. | **6 GHz if your router and phone have it, otherwise 5 GHz. Never 2.4 GHz.** |
| **SoC** | A faster chip finishes each send sooner and holds its clocks up under load. The send thread is *not* pinned to specific cores — pinning was tried and removed because it kept the big cores spun up and cooked the phone. | **Mid-range or better, 2020+ chipset** |
| **Android version** | `WIFI_MODE_FULL_LOW_LATENCY` (the radio anti-spike lock) needs **Android 10 (API 29)+**; older versions fall back to a weaker high-perf lock. | **Android 10 or newer** |
| **Free RAM / thermal headroom** | Background load and thermal throttling cause scheduler jitter and CPU downclock. | Close other apps; avoid overheating |

**Minimum to run well:** Android 10+, dual-band 5 GHz Wi-Fi, 90 Hz display,
120 Hz touch.

**Ideal ("esports"):** a gaming phone with **240 Hz+ touch sampling**, 120 Hz+
display, Wi-Fi 6, flagship SoC — or simply use **USB tethering** (section 1),
which sidesteps the Wi-Fi variable entirely.

> Note: touch sampling rate ≠ display refresh rate. A phone can have a 120 Hz
> screen but only 120 Hz touch, or a 60 Hz screen with 180 Hz touch. Check the
> spec sheet for "touch sampling rate" / "touch response rate" specifically —
> it's the number that most affects how fast your taps register.

---

## 5. Measuring your real latency

The in-app telemetry now shows **measured** round-trip latency (via the PC's
ACK), not an estimate. Watch it while playing:
- Steady single-digit to low-teens ms → excellent (USB or tuned 5 GHz).
- Frequent spikes → Wi-Fi interference; switch to 5 GHz or USB tethering.
